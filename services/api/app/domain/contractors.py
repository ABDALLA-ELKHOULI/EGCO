# -*- coding: utf-8 -*-
"""حسابات المقاولين — Contractor ledger domain.

Pure functions over plain data: no FastAPI, no database, no file I/O — the same layering
rule as domain/payables.py. All arithmetic is Decimal via D()/money() from payables.

Sign convention (matches the accounting statement itself):
    balance = Σ debit − Σ credit
    positive  = the contractor owes us
    negative  = we owe the contractor
debit (مدين) = payments to him / back-charges; credit (دائن) = مستخلصات وأعماله.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, Iterable, List, Optional

from app.domain.payables import D, DELAY_BUCKETS, bucket_of_days

# ---------------------------------------------------------------- text normalisation

_TATWEEL = 'ـ'


def _norm_ar(s: str) -> str:
    """Normalise Arabic for keyword matching.

    The statements mix orthographies freely (تأمين/تامين, دفعة/دفعه, الوادي/الوادى, and
    the PDF's NFKC output uses Farsi yeh ی) — collapse them all before any comparison.
    """
    s = (s or '').replace(_TATWEEL, '')
    s = re.sub('[يیى]', 'ي', s)
    # م-٤٩: الهاء الفارسية/الأردية (ھ U+06BE، ہ U+06C1، ۀ U+06C0) تصل من بعض الكشوف
    # فكانت «دفعھ» لا تطابق «دفعه» — ٤٥٠ ألفاً من دفعات حقيقية صُنّفت «أخرى»
    # فظهرت خصومات لا مدفوعات. توحَّد كلها إلى الهاء العربية قبل أي مقارنة.
    s = re.sub('[ةھہۀ]', 'ه', s)
    s = re.sub('[أإآ]', 'ا', s)
    return s


# ---------------------------------------------------------------- classification

def classify_entry(description: str) -> str:
    """تصنيف حركة من وصفها.

    Returns one of: 'opening' | 'claim' | 'retention' | 'deduction' | 'payment'
    | 'invoice' | 'other'.

    Order matters and is deliberate:
      * 'مستخلص' wins over anything embedded in the same line (a claim description can
        mention deductions).
      * retention ('تامين'/'ضمان') wins over 'خصم' — e.g. 'زياره تأمين تخصم على...'
        is a retention line even though it contains تخصم.
      * retention also wins over 'فاتوره' — 'فاتورة تامين' is retention, not a
        re-charged invoice.
    """
    t = _norm_ar(description)
    if 'رصيد افتتاح' in t:
        return 'opening'
    if 'مستخلص' in t:
        return 'claim'
    if 'تامين' in t or 'ضمان' in t:
        return 'retention'
    if 'خصم' in t:
        return 'deduction'
    if 'دفعه' in t or 'دفعات' in t or 'سداد' in t:
        return 'payment'
    # 'فتوره' is a real typo variant in the statements ('فتوره رقم641').
    if 'فاتوره' in t or 'فتوره' in t or 'فواتير' in t:
        return 'invoice'
    return 'other'


_CLAIM_NO_RE = re.compile(r'مستخلص\s*رقم\s*(\d+)')


def extract_claim_no(description: str) -> Optional[str]:
    """رقم المستخلص من الوصف — 'مستخلص رقم6' و'مستخلص رقم 14' كلاهما مقبول."""
    m = _CLAIM_NO_RE.search(_norm_ar(description))
    return m.group(1) if m else None


def detect_project(description: str, known_projects: List[str]) -> str:
    """أقرب مشروع معروف يظهر اسمه داخل الوصف — '' إن لم يوجد أو تعدّدت المطابقات.

    Both sides are normalised (_norm_ar) before substring matching, so روشن matches
    regardless of spelling variants. Ambiguity returns '' rather than guessing.
    """
    t = _norm_ar(description)
    hits = []
    for p in known_projects:
        pn = _norm_ar(p).strip()
        if pn and pn in t:
            hits.append(p)
    return hits[0] if len(hits) == 1 else ''


# ---------------------------------------------------------------- aggregation

def position(entries: Iterable[dict]) -> dict:
    """الموقف المالي من دفتر الحركات — Decimal sums, no floats.

    `entries` are dicts with keys debit / credit / kind. Per-kind sums use the side
    that kind naturally lives on: claims are credits (his work), payments are debits
    (money to him); retention/deductions are netted debit−credit.
    """
    zero = Decimal('0')
    debit_total = credit_total = zero
    claims_total = payments_total = retention_total = deductions_total = zero
    other_debits = other_credits = zero
    for e in entries:
        debit, credit = D(e.get('debit') or 0), D(e.get('credit') or 0)
        debit_total += debit
        credit_total += credit
        kind = e.get('kind') or 'other'
        if kind == 'claim':
            claims_total += credit
            other_debits += debit          # a claim line rarely carries a debit; keep it visible
        elif kind == 'payment':
            payments_total += debit
            other_credits += credit
        elif kind == 'retention':
            retention_total += debit - credit
        elif kind == 'deduction':
            deductions_total += debit - credit
        else:
            # فاتورة محمّلة عليه · رصيد افتتاحي · أخرى — كانت تُحتسب في الرصيد
            # ولا تظهر في أي بند معروض، فتختفي مبالغ حقيقية عن عين المستخدم
            # (٧٤٣٬٨٤٠.٨٩ ر.س في بيانات حقيقية). كل حركة الآن تسقط في بند ظاهر.
            other_debits += debit
            other_credits += credit
    # الثابت الذي يجعل الأرقام قابلة للتدقيق: بنود المدين تجمع إلى إجمالي المدين،
    # وبنود الدائن إلى إجمالي الدائن — بلا بقايا مخفية.
    #   payments + deductions(+debit part) + retention(+debit part) + other_debits == debit_total
    return dict(debit_total=debit_total, credit_total=credit_total,
                balance=debit_total - credit_total,
                claims_total=claims_total, payments_total=payments_total,
                retention_total=retention_total, deductions_total=deductions_total,
                other_debits=other_debits, other_credits=other_credits)


# ---------------------------------------------------------------- claim delay (م-٤٦)


def claim_due_date(entry_date: dt.date, term_days: Optional[int]) -> Optional[dt.date]:
    """استحقاق المستخلص = تاريخه + مدة السداد. بلا مدة → None لا تاريخ مخمَّن."""
    if term_days is None:
        return None
    return entry_date + dt.timedelta(days=term_days)


@dataclass
class ClaimDue:
    """مستخلص واحد بموقفه من الاستحقاق — كل ما تحتاجه شاشة الكشف لتتبّع الرقم."""
    entry_id: Optional[str]
    date: dt.date
    due_date: dt.date
    amount: Decimal
    paid: Decimal
    remaining: Decimal
    days_late: int                       # 0 إن لم يحن الاستحقاق بعد
    doc: str = ''
    description: str = ''
    claim_no: Optional[str] = None
    project: str = ''


@dataclass
class ContractorDelay:
    """تأخر المقاول على مستخلصاته — نفس أسئلة Delay عند الموردين:
    كم متأخر؟ (overdue_amount) · على كم مستخلص؟ · أقدم تأخر بالأيام · وكم مالاً في كل شريحة."""
    overdue_amount: Decimal = field(default_factory=lambda: Decimal('0'))
    overdue_count: int = 0
    max_days_late: int = 0
    due_7d: Decimal = field(default_factory=lambda: Decimal('0'))
    due_30d: Decimal = field(default_factory=lambda: Decimal('0'))
    by_bucket: Dict[str, Decimal] = field(default_factory=dict)
    claims: List[ClaimDue] = field(default_factory=list)


def compute_contractor_delay(entries: Iterable[dict], term_days: Optional[int],
                             today: dt.date) -> Optional[ContractorDelay]:
    """تأخر المقاول من مستخلصاته — **فقط** لمن له مدة سداد؛ بلا مدة يعود None.

    None لا صفر عمداً: الصفر يُقرأ «لا تأخر عليه» وهو ادّعاء لا تدعمه البيانات
    (قاعدة CLAUDE.md §٢: لا تخترع رقماً). الرصيد الافتتاحي والفواتير المحمّلة
    والخصومات لا تدخل — الاستحقاق يُقاس على المستخلصات (kind='claim') حصراً كما
    نصّ قرار م-٤٦ في PLAN.md.

    المتبقي من كل مستخلص بـFIFO — نفس اصطلاح allocate_fifo عند الموردين: الكشف
    لا يربط دفعة بمستخلص، فيُسدَّد الأقدم أولاً، وهو ما يعيد إنتاج رصيد الكشف
    الختامي نفسه. الوعاء = **كل جانب المدين** (دفعات، تأمينات محتجزة، خصومات،
    فواتير محمّلة عليه، «أخرى») لا الدفعات وحدها: على كشف ديار الوادي الحقيقي
    ٧٦٢ ألفاً من المدين ليست kind='payment' (منها ٤٦٦ ألف دفعات صُنّفت «أخرى»
    لاختلاف إملاء «دفعھ»)، فحصر الوعاء بالدفعات أخرج متأخراً ٨١٩ ألفاً لمقاول
    رصيده كله ٥٧ ألفاً — رقم يناقض شاشة الكشف نفسها. والالتزامات = **كل جانب
    الدائن** بترتيبه الزمني (افتتاحي دائن، مستخلصات، أخرى) لتُستهلك بالأقدم
    أولاً، لكن لا يُبلَّغ إلا عن المستخلصات: الافتتاحي بلا تاريخ استحقاق فلا
    تأخر منه، لكنه أقدم ما يُسدَّد فلا تُنسب دفعاته لمستخلص لاحق. الثابت:
    Σ المتبقي على كل الالتزامات = max(0, −الرصيد) — فلا يتجاوز المتأخر ما ندين به.

    `entries`: dicts بمفاتيح date/debit/credit/kind وبقية الحقول اختيارية.
    """
    if term_days is None:
        return None
    zero = Decimal('0')
    pool = zero
    obligations: List[ClaimDue] = []     # كل الدائن؛ المستخلصات منها تُبلَّغ فقط
    reportable: List[ClaimDue] = []
    for e in entries:
        kind = e.get('kind') or 'other'
        pool += D(e.get('debit') or 0)
        amount = D(e.get('credit') or 0)
        if amount <= 0:
            continue
        ob = ClaimDue(
            entry_id=e.get('id'), date=e['date'],
            due_date=claim_due_date(e['date'], term_days),
            amount=amount, paid=zero, remaining=amount, days_late=0,
            doc=e.get('doc') or '', description=e.get('description') or '',
            claim_no=e.get('claim_no'), project=e.get('project') or '')
        obligations.append(ob)
        if kind == 'claim':
            reportable.append(ob)
    # الأقدم أولاً — ثم رقم المستخلص كفاصل تعادل ثابت لنفس اليوم.
    obligations.sort(key=lambda c: (c.date, c.claim_no or '', c.doc))
    for c in obligations:
        take = min(pool, c.amount)
        c.paid = take
        c.remaining = c.amount - take
        pool -= take
        late = (today - c.due_date).days
        c.days_late = late if (late > 0 and c.remaining > 0) else 0
    claims = sorted(reportable, key=lambda c: (c.date, c.claim_no or '', c.doc))

    d = ContractorDelay(by_bucket={k: zero for k, _, _ in DELAY_BUCKETS}, claims=claims)
    for c in claims:
        if c.remaining <= 0:
            continue
        if c.days_late > 0:
            d.overdue_amount += c.remaining
            d.overdue_count += 1
            d.by_bucket[bucket_of_days(c.days_late)] += c.remaining
            if c.days_late > d.max_days_late:
                d.max_days_late = c.days_late
            continue
        ahead = (c.due_date - today).days      # 0 = يستحق اليوم (لم يتأخر بعد)
        if ahead <= 7:
            d.due_7d += c.remaining
        if ahead <= 30:
            d.due_30d += c.remaining
    return d
