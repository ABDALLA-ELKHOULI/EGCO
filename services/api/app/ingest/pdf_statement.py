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
from typing import List, Optional

from app.domain.payables import Invoice, Payment

#: يُقسَّم قبل العلامة لا عليها، فيبقى سطر العلامة هو lines[0] في كلا التخطيطين
#: وتظل فهارس بقية السطور كما هي.
BLOCK_MARKER = r'(?=ID=0\dTrxType=)'
#: رقم الحساب ليس طولاً ثابتاً — قِيس عبر 60+ كشفاً حقيقياً فظهرت أطوال 5 و6 و7 و8
#: أرقام (ضمان القدس 21620 بخمسة، الرسين 211181 بستة، أغلب الكشوف بسبعة، ديار الوادي
#: 21201020 بثمانية). لذلك لا نُثبِّت العدد، بل نربط المطابقة بمجاورة تسمية «الحساب»
#: نفسها بدل الاعتماد على عدد الأرقام — الترويسة تطبعه كسطر رقم يليه سطر «: الحساب»
#: (RTL يقلب ترتيب الكلمة والنقطتين). هذا يمنع الوقوع في فخ التواريخ والمبالغ المجاورة
#: (2025-01-01، 01-07-1446) التي كانت ستُلتقط لو وُسِّع عدد الأرقام بلا مرساة.
ACCOUNT_RE = re.compile(r'(\d{4,9})\s*\n\s*:\s*الحساب')
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


#: النظام المحاسبي يطبع تخطيطين مختلفين لنفس الكشف. الفاصل بينهما هو صيغة التاريخ:
#:
#:   «المفكوك»  — التاريخ dd-mm-yyyy في سطر مستقل، ثم مدين، دائن، المستند، الرصيد،
#:                ثم الوصف في سطر لاحق.        (مؤسسة انظمة الطلاء)
#:   «الملتصق» — التاريخ yyyy-mm-dd ملتصقاً بالوصف وبالمبلغ في سطر واحد، ثم المبلغ
#:                الثاني، المستند، الرصيد.      (سامي سويد المهندية · الكهربائية المتقدمة)
#:
#: كلا التخطيطين يبدأ بنفس العلامة ID=0…TrxNo، وهذه هي العلامة التي نقسّم عليها —
#: العلامة القديمة CompanyCode= غائبة تماماً عن التخطيط الملتصق، فكانت ملفاته تُرفض
#: بحجة «لم يُعثر على أي حركة» وهي مليئة بالحركات.
GLUED_DATE_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})')
#: الوصف ثم مدين ثم دائن ثم المستند. يُطبَّق على بقية الكتلة مجتمعةً لا على سطر بعينه،
#: لأن الوصف قد ينسكب على سطرين أو ثلاثة متى انتهى برقم أو حوى قوساً — «جزء من حوالھ25»
#: تدفع المبلغ إلى السطر التالي، وقراءةٌ بالفهرس تُسقط الحركة بأكملها بلا صوت.
GLUED_BODY_RE = re.compile(
    r'^(?P<desc>.*?)(?P<debit>[\d,]+\.\d{2})\s*(?P<credit>[\d,]+\.\d{2})\s*'
    r'(?P<doc>\d{6,10})\s*\(?(?P<balance>-?[\d,]+\.\d{2})\)?',
    re.DOTALL)


HEADER_WORDS = {'الحساب', 'التاريخ', 'الوصف', 'مدين', 'دائن', 'الرقم', 'رصيد',
                'الفرع', 'تقرير كشف حساب', 'مطبوع بواسطة', 'مدير النظام'}


def header_name(header_norm: str, account: Optional[str]) -> str:
    """اسم الطرف من ترويسة الكشف — أول سطر عربي طويل بعد رقم الحساب وليس عنوان عمود.

    Lives here rather than in contractor_statement because SUPPLIER statements need it
    too: when a statement arrives for an account we have never seen, this name is the
    only thing that lets us offer to create the account instead of silently dropping a
    fully-reconciled file on the floor.
    """
    lines = [ln.strip() for ln in header_norm.split('\n') if ln.strip()]
    start = 0
    if account:
        for i, ln in enumerate(lines):
            if account in ln:
                start = i
                break
    norm_ar = lambda s: re.sub('[يیى]', 'ي', s)  # noqa: E731 — الياء الفارسية والمقصورة
    header_set = {norm_ar(w) for w in HEADER_WORDS}
    for ln in lines[start:]:
        base = norm_ar(ln.lstrip(': ').strip())
        if base in header_set:
            continue
        if len(base) > 10 and re.search(r'[؀-ۿ]', base) and 'افتتاح' not in base:
            return ln.lstrip(': ').strip()
    return ''


def _read_block(lines: List[str]):
    """(date, debit, credit, doc, balance, desc) من كتلة حركة، أياً كان تخطيطها."""
    md = GLUED_DATE_RE.match(lines[1])
    if md:
        tail = '\n'.join(lines[1:])[len(md.group(1)):]
        m = GLUED_BODY_RE.match(tail)
        if m is None:
            raise ValueError('كتلة ملتصقة بلا مبالغ')
        bal = m.group('balance')
        # القوس علامة سالب في هذا النظام — نفس اصطلاح _money.
        return (dt.date.fromisoformat(md.group(1)),
                _money(m.group('debit')), _money(m.group('credit')),
                m.group('doc'),
                _money(bal if bal.startswith('-') else '(%s)' % bal
                       if tail[m.end('doc'):].lstrip().startswith('(') else bal),
                _norm(m.group('desc').strip()))
    date = _date(lines[1])
    debit = _money(lines[2])
    credit = _money(lines[3])
    doc = lines[4]
    balance = _money(lines[5])
    return date, debit, credit, doc, balance, _norm(
        next((x for x in lines[6:] if len(x) > 8), ''))


def parse(path: str) -> dict:
    """Return {account, invoices, payments, statement_balance, issues}."""
    text = extract_text(path)
    norm = _norm(text)
    issues: list[dict] = []

    blocks = re.split(BLOCK_MARKER, text)
    # A statement with NO transaction blocks is legal: an account whose whole balance
    # is carried forward prints only the «رصيد افتتاحي» line and its footer total
    # (شركة بي سي في جلوبال is a real example). Rejecting it here used to push such
    # files into the wrong flow, so the "is this a statement at all?" decision is
    # deferred until after the opening line has had its chance — see below.

    # The account number appears in the header, before the first transaction block.
    # ACCOUNT_RE anchors on the "الحساب" label, which in this PDF's raw text is stored
    # as Unicode presentation forms — normalise first or the label never matches.
    account = None
    m = ACCOUNT_RE.search(_norm(blocks[0]))
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
    if ob is None:
        # التخطيط الملتصق يعكس الترتيب: التسمية أولاً ثم مدين ودائن والرصيد
        # (رصيد افتتاحي0.00 \n 1,676.88 \n (1,676.88)).
        ob = re.search(r'رص[يی]د\s*افتتاح[^\d\n]*([\d,]+\.\d{2})\s*\n\s*([\d,]+\.\d{2})'
                       r'\s*\n\s*\(?(-?[\d,]+\.\d{2})\)?', header_norm)
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
        if len(lines) < 5:
            issues.append(dict(severity='warning', row=i, message='سطر ناقص — تم تجاهله'))
            continue
        try:
            date, debit, credit, doc, _bal, desc = _read_block(lines)
        except (ValueError, IndexError):
            issues.append(dict(severity='warning', row=i, message='تعذّرت قراءة السطر'))
            continue

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

    return dict(account=account, name=header_name(header_norm, account),
                invoices=invoices, payments=payments,
                statement_balance=balance, issues=issues)
