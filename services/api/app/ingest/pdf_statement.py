# -*- coding: utf-8 -*-
"""قارئ كشف الحساب بصيغة PDF.

Reads the accounting system's "تقرير كشف حساب" export. Verified against
`كشف مؤسسة انجاز الرواد.pdf` (account 2110960) — parsed totals reproduce the statement's
own footer exactly.

Format notes that cost time to work out, recorded so the next person does not repeat them:
  * Arabic in this PDF is stored as Unicode *presentation forms* (ﻓﺎﺗوره not فاتورة).
    NFKC normalisation converts them back before any matching.
  * Each transaction block starts with the literal `CompanyCode=` marker.
  * Field order inside a block: date · debit · credit · doc-no · running-balance · description.
  * Dates are dd-mm-yyyy. Negative balances are wrapped in parentheses.
  * مدين (debit) = a payment we made. دائن (credit) = an invoice we owe.
"""
from __future__ import annotations

import datetime as dt
import re
import unicodedata

from app.domain.payables import Invoice, Payment

BLOCK_MARKER = 'CompanyCode='
ACCOUNT_RE = re.compile(r'\b(\d{7})\b')
INVOICE_NO_RE = re.compile(r'رقم\s*(\d+)')
TOTAL_RE = re.compile(r'اجمالي\s*الحساب\s*(-?[\d,]+\.\d{2})')


class StatementParseError(Exception):
    pass


def _norm(s: str) -> str:
    """Presentation forms → normal Arabic letters."""
    return unicodedata.normalize('NFKC', s)


def _money(s: str) -> float:
    s = s.strip().replace(',', '')
    neg = s.startswith('(') and s.endswith(')')
    s = s.strip('()')
    v = float(s)
    return -v if neg else v


def _date(s: str) -> dt.date:
    return dt.datetime.strptime(s.strip(), '%d-%m-%Y').date()


def extract_text(path: str) -> str:
    try:
        import fitz  # PyMuPDF
    except ImportError as e:      # pragma: no cover
        raise StatementParseError('PyMuPDF (fitz) is required to read PDF statements') from e
    doc = fitz.open(path)
    return '\n'.join(page.get_text() for page in doc)


def parse(path: str) -> dict:
    """Return {account, invoices, payments, statement_balance, issues}."""
    text = extract_text(path)
    norm = _norm(text)
    issues: list[dict] = []

    blocks = text.split(BLOCK_MARKER)
    # A statement with NO transaction blocks is legal: an account whose whole balance
    # is carried forward prints only the «رصيد افتتاحي» line and its footer total
    # (شركة بي سي في جلوبال is a real example). Rejecting it here used to push such
    # files into the wrong flow, so the "is this a statement at all?" decision is
    # deferred until after the opening line has had its chance — see below.

    # The account number appears in the header, before the first transaction block.
    account = None
    m = ACCOUNT_RE.search(blocks[0])
    if m:
        account = m.group(1)
    else:
        issues.append(dict(severity='warning', row=None,
                           message='لم يُعثر على رقم الحساب في الترويسة'))

    invoices: list[Invoice] = []
    payments: list[Payment] = []

    # ---- سطر «رصيد افتتاحي» (statements that start mid-history print one).
    # It sits in the header, BEFORE the first CompanyCode block, as:
    #   debit \n credit \n (balance)رصيد افتتاحي
    # Without it the computed balance can never reconcile, so it is captured as a
    # carried-forward line dated from the statement's "من تاريخ" header (fallback:
    # day before the first transaction) — FIFO then correctly settles it first.
    header_norm = _norm(blocks[0])
    # NFKC maps this PDF's presentation forms to the Farsi yeh (ی U+06CC), not the
    # Arabic yeh (ي U+064A) — accept both or the line is silently missed.
    ob = re.search(r'([\d,]+\.\d{2})\s*\n\s*([\d,]+\.\d{2})\s*\n\s*\(?(-?[\d,]+\.\d{2})\)?\s*رص[يی]د\s*افتتاح',
                   header_norm)
    opening_debit = opening_credit = None
    if ob:
        opening_debit, opening_credit = _money(ob.group(1)), _money(ob.group(2))
        from_m = re.search(r'(\d{4}-\d{2}-\d{2})', header_norm)
        opening_date = (dt.date.fromisoformat(from_m.group(1)) if from_m else None)
        if opening_date is None:
            issues.append(dict(severity='info', row=None,
                               message='رصيد افتتاحي بلا تاريخ بداية — سيُؤرَّخ قبل أول حركة بيوم'))
        if opening_credit > 0:
            invoices.append(Invoice(date=opening_date or dt.date.min, amount=opening_credit,
                                    number=None, doc='OPENING',
                                    description='رصيد افتتاحي (مُرحَّل من الكشف)'))
        if opening_debit > 0:
            payments.append(Payment(date=opening_date or dt.date.min, amount=opening_debit,
                                    doc='OPENING', description='رصيد افتتاحي (مُرحَّل من الكشف)'))
        issues.append(dict(severity='info', row=None,
                           message=f'التُقط رصيد افتتاحي مُرحَّل: {opening_credit - opening_debit:,.2f} ر.س'))

    # Nothing at all — neither a transaction block nor an opening line — means this
    # simply is not one of the accounting system's statements.
    if len(blocks) < 2 and not ob:
        raise StatementParseError('لم يُعثر على أي حركة في الملف — تأكد أنه كشف حساب')

    for i, block in enumerate(blocks[1:], start=1):
        lines = [ln.strip() for ln in block.split('\n') if ln.strip()]
        if len(lines) < 6:
            issues.append(dict(severity='warning', row=i, message='سطر ناقص — تم تجاهله'))
            continue
        try:
            date = _date(lines[1])
            debit = _money(lines[2])
            credit = _money(lines[3])
            doc = lines[4]
        except (ValueError, IndexError):
            issues.append(dict(severity='warning', row=i, message='تعذّرت قراءة السطر'))
            continue

        desc = _norm(next((x for x in lines[6:] if len(x) > 8), ''))

        if credit > 0:
            num = INVOICE_NO_RE.search(desc)
            invoices.append(Invoice(date=date, amount=credit,
                                    number=num.group(1) if num else None,
                                    doc=doc, description=desc))
            if not num:
                issues.append(dict(severity='info', row=i,
                                   message='فاتورة بلا رقم في الوصف'))
        elif debit > 0:
            payments.append(Payment(date=date, amount=debit, doc=doc, description=desc))
        else:
            issues.append(dict(severity='info', row=i, message='حركة بقيمة صفر — تم تجاهلها'))

    # The statement prints its own closing total; we use it to verify our parse.
    balance = None
    mt = TOTAL_RE.search(norm.replace('\n', ''))
    if mt:
        balance = _money(mt.group(1))
    else:
        issues.append(dict(severity='warning', row=None,
                           message='لم يُعثر على إجمالي الحساب — لا يمكن التحقق من المطابقة'))

    # opening line dated with the sentinel => place it one day before the first real
    # transaction so FIFO ordering stays correct.
    real_dates = ([i.date for i in invoices if i.doc != 'OPENING'] +
                  [p.date for p in payments if p.doc != 'OPENING'])
    if real_dates:
        fallback = min(real_dates) - dt.timedelta(days=1)
        for row in invoices + payments:
            if row.doc == 'OPENING' and row.date == dt.date.min:
                row.date = fallback

    return dict(account=account, invoices=invoices, payments=payments,
                statement_balance=balance, issues=issues)
