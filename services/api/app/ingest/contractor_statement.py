# -*- coding: utf-8 -*-
"""قارئ كشف حساب مقاول بصيغة PDF.

Same accounting-system export as pdf_statement.py (CompanyCode= blocks, NFKC
presentation forms, dd-mm-yyyy dates, parenthesised negatives) — verified against
`contractor-diyar-alwadi.pdf` (account 21201020).

Differences from the supplier reader, which is why this is a separate thin wrapper
rather than a change to pdf_statement.py:
  * contractor accounts are 8 digits (212xxxxx) — the header regex here accepts 7–9;
  * every row keeps BOTH debit and credit (the ledger convention, no collapsing into
    Invoice/Payment);
  * the opening balance line becomes a real row of kind 'opening' dated from the
    header's «من تاريخ» date;
  * the printed footer totals (مدين/دائن) are captured for reconciliation display.

Reuses pdf_statement's module-level helpers (_norm/_money/_date, extract_text) so the
presentation-form and number quirks stay fixed in one place.
"""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal
from typing import List, Optional

from app.domain.payables import D

from app.ingest.pdf_statement import (BLOCK_MARKER, StatementParseError, _date,
                                      _money, _norm, extract_text)

ACCOUNT_RE = re.compile(r'\b(\d{7,9})\b')
#: printed footer: debit-total \n credit-total اجمالي الحساب closing-balance
TOTALS_RE = re.compile(r'([\d,]+\.\d{2})\s*\n\s*([\d,]+\.\d{2})\s*اجمالي\s*الحساب')
CLOSING_RE = re.compile(r'اجمالي\s*الحساب\s*(-?\(?[\d,]+\.\d{2}\)?)')
#: NFKC maps this PDF's yeh to Farsi ی — accept both (see pdf_statement.py).
OPENING_RE = re.compile(
    r'([\d,]+\.\d{2})\s*\n\s*([\d,]+\.\d{2})\s*\n\s*\(?(-?[\d,]+\.\d{2})\)?\s*رص[يی]د\s*افتتاح')

#: column-header words that must not be mistaken for the contractor name
_HEADER_WORDS = {'الحساب', 'التاريخ', 'الوصف', 'مدين', 'دائن', 'الرقم', 'رصيد',
                 'الفرع', 'تقرير كشف حساب', 'مطبوع بواسطة', 'مدير النظام'}


def _clean_desc(s: str) -> str:
    """Row descriptions carry a leading 4-digit branch code (0001...) — strip it."""
    return re.sub(r'^\d{4}', '', s).strip()


_MONEY_ONLY_RE = re.compile(r'^[\d,.()\-\s]+$')


def _description(tail_lines) -> str:
    """الوصف — may span several lines (e.g. 'فاتوره رقم27' then '( لشركة...)').

    Joins contiguous text lines starting at the first long one, stopping at the
    footer ('اجمالي', 'Page') or a money-only line — the last block of a page has the
    printed totals glued after its description.
    """
    parts = []
    started = False
    for raw in tail_lines:
        ln = _norm(raw).strip()
        if not started:
            if len(ln) > 8 and not _MONEY_ONLY_RE.match(ln):
                started = True
            else:
                continue
        else:
            if (not ln or len(ln) <= 3 or _MONEY_ONLY_RE.match(ln)
                    or 'اجمالي' in ln or 'Page' in ln):
                break
        parts.append(ln)
    return _clean_desc(' '.join(parts))


def _header_name(header_norm: str, account: Optional[str]) -> str:
    """اسم المقاول من الترويسة — the long Arabic line after the account number that is
    not a column header. Heuristic, but stable for this export format."""
    lines = [ln.strip() for ln in header_norm.split('\n') if ln.strip()]
    start = 0
    if account:
        for i, ln in enumerate(lines):
            if account in ln:
                start = i
                break
    norm_ar = lambda s: re.sub('[يیى]', 'ي', s)
    for ln in lines[start:]:
        base = norm_ar(ln.lstrip(': ').strip())
        if base in {norm_ar(w) for w in _HEADER_WORDS}:
            continue
        if len(base) > 10 and re.search(r'[؀-ۿ]', base) and 'افتتاح' not in base:
            return ln.lstrip(': ').strip()
    return ''


def parse(path: str) -> dict:
    """Return {account, name, rows, opening_debit, opening_credit, opening_date,
    printed_balance, printed_debit_total, printed_credit_total, issues}.

    rows: [{date, debit, credit, doc, description, kind?}] — the opening balance, when
    printed, is included as the first row with kind='opening'.
    """
    text = extract_text(path)
    norm = _norm(text)
    issues: List[dict] = []

    # Zero CompanyCode blocks is legal here (unlike pdf_statement.parse): an
    # opening-balance-only statement prints just the رصيد افتتاحي line and the footer
    # total, with no transactions in the date range. The check for "nothing at all"
    # happens after the opening line is looked for, below.
    blocks = text.split(BLOCK_MARKER)
    header_norm = _norm(blocks[0])

    account = None
    m = ACCOUNT_RE.search(header_norm)
    if m:
        account = m.group(1)
    else:
        issues.append(dict(severity='warning', row=None,
                           message='لم يُعثر على رقم الحساب في الترويسة'))

    name = _header_name(header_norm, account)
    if not name:
        issues.append(dict(severity='warning', row=None,
                           message='لم يُعثر على اسم المقاول في الترويسة'))

    # ---- «من تاريخ» — dates the opening-balance row.
    from_m = re.search(r'(\d{4}-\d{2}-\d{2})', header_norm)
    opening_date = dt.date.fromisoformat(from_m.group(1)) if from_m else None

    rows: List[dict] = []
    opening_debit = opening_credit = None
    ob = OPENING_RE.search(header_norm)
    if ob:
        opening_debit, opening_credit = _money(ob.group(1)), _money(ob.group(2))

    # Running balance tracked in Decimal. The amount columns are ROUNDED for display
    # while the balance column carries the full-precision chain (verified on the
    # sample: two rows print e.g. 224,231.70 while the balances imply ...71). When a
    # row's printed running balance disagrees with the computed one by a cent or two,
    # the balance column wins and the row amount is nudged — otherwise the parse can
    # never reproduce the statement's own closing total.
    run = D(opening_debit or 0) - D(opening_credit or 0)

    for i, block in enumerate(blocks[1:], start=1):
        lines = [ln.strip() for ln in block.split('\n') if ln.strip()]
        if len(lines) < 6:
            issues.append(dict(severity='warning', row=i, message='سطر ناقص — تم تجاهله'))
            continue
        try:
            date = _date(lines[1])
            debit = D(str(_money(lines[2])))
            credit = D(str(_money(lines[3])))
            doc = lines[4]
            printed_run = D(str(_money(lines[5])))
        except (ValueError, IndexError):
            issues.append(dict(severity='warning', row=i, message='تعذّرت قراءة السطر'))
            continue
        diff = printed_run - (run + debit - credit)
        if diff != 0 and abs(diff) <= Decimal('0.02'):
            if debit > 0:
                debit += diff
            else:
                credit -= diff
            issues.append(dict(severity='info', row=i,
                               message='تصحيح فرق تقريب من عمود الرصيد: %s ر.س' % diff))
        run = run + debit - credit
        desc = _description(lines[6:])
        rows.append(dict(date=date, debit=float(debit), credit=float(credit),
                         doc=doc, description=desc))

    # opening as a real ledger row, dated from «من تاريخ» (fallback: day before the
    # first real transaction so ordering stays correct).
    if opening_debit is not None:
        if opening_date is None and rows:
            opening_date = min(r['date'] for r in rows) - dt.timedelta(days=1)
            issues.append(dict(severity='info', row=None,
                               message='رصيد افتتاحي بلا تاريخ بداية — أُرِّخ قبل أول حركة بيوم'))
        rows.insert(0, dict(date=opening_date or dt.date.min,
                            debit=opening_debit, credit=opening_credit,
                            doc='OPENING', description='رصيد افتتاحي (مُرحَّل من الكشف)',
                            kind='opening'))
        issues.append(dict(severity='info', row=None,
                           message=f'التُقط رصيد افتتاحي: {opening_debit - opening_credit:,.2f} ر.س'))

    if not rows:
        raise StatementParseError('لم يُعثر على أي حركة أو رصيد افتتاحي في الملف — '
                                  'تأكد أنه كشف حساب')

    flat = norm.replace('\n', '')
    printed_balance = None
    mc = CLOSING_RE.search(flat)
    if mc:
        printed_balance = _money(mc.group(1))
    else:
        issues.append(dict(severity='warning', row=None,
                           message='لم يُعثر على إجمالي الحساب — لا يمكن التحقق من المطابقة'))

    printed_debit_total = printed_credit_total = None
    mt = TOTALS_RE.search(norm)
    if mt:
        printed_debit_total, printed_credit_total = _money(mt.group(1)), _money(mt.group(2))

    return dict(account=account, name=name, rows=rows,
                opening_debit=opening_debit, opening_credit=opening_credit,
                opening_date=opening_date,
                printed_balance=printed_balance,
                printed_debit_total=printed_debit_total,
                printed_credit_total=printed_credit_total,
                issues=issues)
