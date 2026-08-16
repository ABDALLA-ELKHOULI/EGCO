# -*- coding: utf-8 -*-
"""حسابات مديونية الموردين — Supplier payables.

Pure functions over plain data: no FastAPI, no database, no file I/O. This is the layer
that has to stay correct; everything above it is replaceable. Tested directly against a
real account statement in tests/.

Arithmetic is done internally with decimal.Decimal to avoid float rounding drift; the
serialisation boundary (payables_service.py, report_service.py) converts back to float
via `money()`.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Sequence, Union

# ---------------------------------------------------------------- decimal helpers

Numeric = Union[int, float, str, Decimal]


def D(x: Numeric) -> Decimal:
    """Convert an incoming number to Decimal safely (via str for floats)."""
    if isinstance(x, Decimal):
        return x
    if isinstance(x, float):
        return Decimal(str(x))
    return Decimal(x)


def money(x: Numeric) -> float:
    """Serialisation boundary: Decimal -> float rounded to 2dp."""
    return float(D(x).quantize(Decimal('0.01')))


# ---------------------------------------------------------------- payment terms

CASH = 0

#: Terms that mean "pay on invoice date". A blank cell means cash in this company's file.
CASH_WORDS = ('كاش', 'بعد التوريد', 'نقدا', 'نقداً')

#: Terms tied to a project progress claim (مستخلص). The due date cannot be derived from
#: the invoice date — it depends on when the claim is certified — so it is entered by hand.
CLAIM_WORDS = ('مستخلص', 'مستخلصات')


@dataclass(frozen=True)
class Term:
    """A supplier's payment term, normalised from free text."""
    days: Optional[int]          # None => not derivable (claim-based)
    kind: str                 # 'days' | 'cash' | 'claim'
    raw: str

    @property
    def is_claim(self) -> bool:
        return self.kind == 'claim'


def parse_term(raw: Optional[str]) -> Term:
    """Normalise the free-text term column.

    The source file writes the same thing several ways — '45 يوم', '30يوم', 'كاش',
    'مستخلص', 'مستخلصات', or blank. Normalise once here so nothing downstream has to
    guess, and keep the original string for display and audit.
    """
    text = (raw or '').strip()
    if not text:
        return Term(days=CASH, kind='cash', raw='')          # blank == cash

    if any(w in text for w in CLAIM_WORDS):
        return Term(days=None, kind='claim', raw=text)
    if any(w in text for w in CASH_WORDS):
        return Term(days=CASH, kind='cash', raw=text)

    m = re.search(r'(\d+)', text)
    if m:
        return Term(days=int(m.group(1)), kind='days', raw=text)

    # Unrecognised wording: treat as claim (manual) rather than invent a number.
    return Term(days=None, kind='claim', raw=text)


# ---------------------------------------------------------------- records

@dataclass(frozen=True)
class Supplier:
    account: str              # رقم الحساب — the only reliable key; names repeat per project
    name: str
    project: str
    term: Term


@dataclass
class Invoice:
    """A credit line on the statement — an amount we owe."""
    date: dt.date
    amount: Decimal
    number: Optional[str] = None
    doc: str = ''
    description: str = ''
    id: Optional[str] = None
    source: str = 'statement'
    manual_due_date: Optional[dt.date] = None
    # filled by allocate()
    paid: Decimal = field(default_factory=lambda: Decimal('0'))
    remaining: Decimal = field(default_factory=lambda: Decimal('0'))
    due_date: Optional[dt.date] = None
    days_to_due: Optional[int] = None

    def __post_init__(self):
        self.amount = D(self.amount)
        self.paid = D(self.paid)
        self.remaining = D(self.remaining)


@dataclass
class Payment:
    """A debit line on the statement — an amount we paid."""
    date: dt.date
    amount: Decimal
    doc: str = ''
    description: str = ''
    id: Optional[str] = None
    source: str = 'statement'

    def __post_init__(self):
        self.amount = D(self.amount)


@dataclass
class Ageing:
    current: Decimal = field(default_factory=lambda: Decimal('0'))
    d1_30: Decimal = field(default_factory=lambda: Decimal('0'))
    d31_60: Decimal = field(default_factory=lambda: Decimal('0'))
    d61_90: Decimal = field(default_factory=lambda: Decimal('0'))
    d90_plus: Decimal = field(default_factory=lambda: Decimal('0'))

    def __eq__(self, other):
        if not isinstance(other, Ageing):
            return NotImplemented
        return (self.current, self.d1_30, self.d31_60, self.d61_90, self.d90_plus) == \
               (other.current, other.d1_30, other.d31_60, other.d61_90, other.d90_plus)


#: شرائح التأخر الشهرية — ستة أشهر ثم ما بعدها.
#: (المفتاح، الحد الأعلى بالأيام، التسمية) — الحد None يعني «ما بعد ذلك».
DELAY_BUCKETS = (
    ('m1', 30, 'شهر'),
    ('m2', 60, 'شهران'),
    ('m3', 90, '٣ أشهر'),
    ('m4', 120, '٤ أشهر'),
    ('m5', 150, '٥ أشهر'),
    ('m6', 180, '٦ أشهر'),
    ('m6_plus', None, 'أكثر من ٦ أشهر'),
)


def bucket_of_days(late: int) -> Optional[str]:
    """الشريحة التي يقع فيها تأخر بمقدار late يوماً — None إن لم يتأخر بعد."""
    if late <= 0:
        return None
    for key, upper, _ in DELAY_BUCKETS:
        if upper is None or late <= upper:
            return key
    return 'm6_plus'


@dataclass
class Delay:
    """تأخر السداد — أقصى تأخر، والمبلغ المتأخر موزعاً على الشرائح الشهرية.

    The distinction that matters: `days` answers «كم تأخرنا؟» while `by_bucket`
    answers «كم مالاً في كل شريحة؟». A supplier with one ancient 100-riyal invoice
    and two million riyals due last week has days=400 and almost nothing in m6_plus —
    reporting only the worst number would badly misrank him.
    """
    days: int = 0                                   # أقصى تأخر بالأيام (0 = لا تأخر)
    amount: Decimal = field(default_factory=lambda: Decimal('0'))   # مجموع المتأخر
    by_bucket: Dict[str, Decimal] = field(default_factory=dict)

    @property
    def bucket(self) -> Optional[str]:
        return bucket_of_days(self.days)


def compute_delay(invoices: Iterable[Invoice], today: dt.date) -> Delay:
    """تأخر السداد على المتبقي فقط، من تاريخ الاستحقاق — نفس أساس compute_ageing."""
    d = Delay(by_bucket={k: Decimal('0') for k, _, _ in DELAY_BUCKETS})
    for inv in invoices:
        if inv.remaining <= 0 or inv.due_date is None:
            continue
        late = (today - inv.due_date).days
        if late <= 0:
            continue
        key = bucket_of_days(late)
        d.by_bucket[key] += inv.remaining
        d.amount += inv.remaining
        if late > d.days:
            d.days = late
    return d


@dataclass
class SupplierPosition:
    supplier: Supplier
    invoices: List[Invoice] = field(default_factory=list)
    payments: List[Payment] = field(default_factory=list)
    total_invoiced: Decimal = field(default_factory=lambda: Decimal('0'))
    total_paid: Decimal = field(default_factory=lambda: Decimal('0'))
    outstanding: Decimal = field(default_factory=lambda: Decimal('0'))
    # المورد مدفوع له أكثر من فواتيره — رصيد لنا (مقدم). outstanding يبقى >= 0 دائماً؛
    # الفائض الفعلي (لو وُجد) يظهر هنا بدلاً من رقم outstanding سالب لا معنى محاسبياً له.
    credit_balance: Decimal = field(default_factory=lambda: Decimal('0'))
    due_today: Decimal = field(default_factory=lambda: Decimal('0'))        # overdue + due on or before today
    overdue: Decimal = field(default_factory=lambda: Decimal('0'))          # strictly past the due date
    due_within_7: Decimal = field(default_factory=lambda: Decimal('0'))
    ageing: Ageing = field(default_factory=Ageing)
    delay: Delay = field(default_factory=Delay)
    needs_manual_due_date: bool = False


# ---------------------------------------------------------------- core logic

def due_date(invoice_date: dt.date, term: Term) -> Optional[dt.date]:
    """تاريخ الاستحقاق = تاريخ الفاتورة + مدة المورد. Claim-based terms return None."""
    if term.days is None:
        return None
    return invoice_date + dt.timedelta(days=term.days)


def allocate_fifo(invoices: Sequence[Invoice], payments: Iterable[Payment]) -> None:
    """توزيع الدفعات على الفواتير: الأقدم أولاً.

    The statement does not link a payment to an invoice, so payments settle the oldest
    open invoice first — the standard accounting convention, and the one that reproduces
    the statement's own closing balance.

    Mutates the invoices in place (sets paid / remaining).
    """
    pool = sum((D(p.amount) for p in payments), Decimal('0'))
    for inv in sorted(invoices, key=lambda i: (i.date, i.number or '')):
        amt = D(inv.amount)
        take = min(pool, amt)
        inv.paid = take
        inv.remaining = amt - take
        pool -= take


def compute_ageing(invoices: Iterable[Invoice], today: dt.date) -> Ageing:
    """أعمار الديون على المتبقي فقط، محسوبة من تاريخ الاستحقاق لا تاريخ الفاتورة."""
    a = Ageing()
    for inv in invoices:
        if inv.remaining <= 0 or inv.due_date is None:
            continue
        late = (today - inv.due_date).days
        if late <= 0:
            a.current += inv.remaining
        elif late <= 30:
            a.d1_30 += inv.remaining
        elif late <= 60:
            a.d31_60 += inv.remaining
        elif late <= 90:
            a.d61_90 += inv.remaining
        else:
            a.d90_plus += inv.remaining
    return a


def _effective_due_date(inv: Invoice, term: Term) -> Optional[dt.date]:
    if inv.manual_due_date is not None:
        return inv.manual_due_date
    return due_date(inv.date, term)


def position(supplier: Supplier,
             invoices: Sequence[Invoice],
             payments: Sequence[Payment],
             today: dt.date) -> SupplierPosition:
    """الحالة الكاملة لمورد في يوم معيّن."""
    allocate_fifo(invoices, payments)

    for inv in invoices:
        inv.due_date = _effective_due_date(inv, supplier.term)
        inv.days_to_due = (inv.due_date - today).days if inv.due_date else None

    open_invoices = [i for i in invoices if i.remaining > 0]

    p = SupplierPosition(
        supplier=supplier,
        invoices=sorted(invoices, key=lambda i: i.date),
        payments=sorted(payments, key=lambda x: x.date),
        total_invoiced=sum((D(i.amount) for i in invoices), Decimal('0')),
        total_paid=sum((D(x.amount) for x in payments), Decimal('0')),
        ageing=compute_ageing(invoices, today),
        delay=compute_delay(invoices, today),
        needs_manual_due_date=supplier.term.is_claim and
            any(i.remaining > 0 and i.due_date is None for i in invoices),
    )
    net = p.total_invoiced - p.total_paid
    # net < 0 means payments exceeded invoices (overpaid / supplier owes us): keep
    # outstanding non-negative and surface the surplus as credit_balance instead.
    p.outstanding = net if net > 0 else Decimal('0')
    p.credit_balance = -net if net < 0 else Decimal('0')
    p.overdue = sum((i.remaining for i in open_invoices
                     if i.due_date and i.due_date < today), Decimal('0'))
    p.due_today = sum((i.remaining for i in open_invoices
                       if i.due_date and i.due_date <= today), Decimal('0'))
    p.due_within_7 = sum((i.remaining for i in open_invoices
                         if i.due_date and today < i.due_date <= today + dt.timedelta(days=7)),
                        Decimal('0'))
    return p


def reconciles(p: SupplierPosition, statement_balance: float, tolerance: float = 0.01) -> bool:
    """هل يطابق المحسوب رصيد الكشف؟

    An import that does not reconcile is rejected rather than saved — a wrong number in
    the database is worse than a failed import.
    """
    # Sign convention of the accounting system's printed «اجمالي الحساب», verified
    # against real statements: NEGATIVE closing == we owe them (انجاز الرواد prints
    # -64,565.45 while we owe 64,565.45), POSITIVE closing == they owe us (بيت الاباء
    # prints +474,147.10 after we prepaid). It matches the contractor ledger's rule
    # (Σمدين − Σدائن), so both modules speak one language.
    #
    # Comparing signed values — not magnitudes — is what lets an overpaid statement
    # reconcile instead of silently matching the wrong side.
    signed = p.credit_balance - p.outstanding
    return abs(signed - D(statement_balance)) <= D(tolerance)


def payment_schedule(positions: Iterable[SupplierPosition],
                     today: dt.date,
                     horizon_days: int = 90) -> List[dict]:
    """جدول الاستحقاقات القادمة، مجمّعاً بتاريخ الاستحقاق — يغذّي شاشة التقويم."""
    buckets: dict = {}
    limit = today + dt.timedelta(days=horizon_days)
    for p in positions:
        for inv in p.invoices:
            if inv.remaining <= 0 or inv.due_date is None or inv.due_date > limit:
                continue
            b = buckets.setdefault(inv.due_date, dict(date=inv.due_date, amount=Decimal('0'), items=[]))
            b['amount'] += inv.remaining
            b['items'].append(dict(supplier=p.supplier.name, account=p.supplier.account,
                                   invoice=inv.number, amount=inv.remaining,
                                   overdue=inv.due_date < today))
    return [buckets[d] for d in sorted(buckets)]
