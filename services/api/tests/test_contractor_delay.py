# -*- coding: utf-8 -*-
"""اختبارات وحدة لتأخر المقاولين (م-٤٦) — app/domain/contractors.py.

القاعدة المختبَرة: بلا مدة سداد لا رقم (None لا صفر)؛ ومع المدة يُحسب الاستحقاق
على المستخلصات (claim) فقط، والمتبقي بـFIFO على الدفعات — نفس اصطلاح الموردين.
"""
import datetime as dt
from decimal import Decimal

from app.domain import contractors as C

TODAY = dt.date(2026, 9, 24)


def _e(date, kind, debit=0, credit=0, **kw):
    d = dict(date=dt.date.fromisoformat(date), kind=kind, debit=debit, credit=credit)
    d.update(kw)
    return d


def test_claim_due_date():
    assert C.claim_due_date(dt.date(2026, 1, 1), 30) == dt.date(2026, 1, 31)
    assert C.claim_due_date(dt.date(2026, 1, 1), 0) == dt.date(2026, 1, 1)
    assert C.claim_due_date(dt.date(2026, 1, 1), None) is None


def test_no_term_returns_none_not_zero():
    entries = [_e('2026-01-01', 'claim', credit=1000)]
    assert C.compute_contractor_delay(entries, None, TODAY) is None


def test_single_claim_partial_payment_30_days():
    # مستخلص ١٠٬٠٠٠ بتاريخ ١ يوليو، مدة ٣٠ → استحقاق ٣١ يوليو؛ دفعة ٤٬٠٠٠ لاحقاً.
    entries = [
        _e('2026-07-01', 'claim', credit=10000, claim_no='5'),
        _e('2026-07-20', 'payment', debit=4000),
    ]
    d = C.compute_contractor_delay(entries, 30, TODAY)
    assert d is not None
    assert len(d.claims) == 1
    c = d.claims[0]
    assert c.due_date == dt.date(2026, 7, 31)
    assert c.paid == Decimal('4000')
    assert c.remaining == Decimal('6000')
    assert c.days_late == (TODAY - dt.date(2026, 7, 31)).days == 55
    assert d.overdue_amount == Decimal('6000')
    assert d.overdue_count == 1
    assert d.max_days_late == 55
    assert d.by_bucket['m2'] == Decimal('6000')     # ٣١–٦٠ يوماً
    assert d.due_7d == d.due_30d == Decimal('0')


def test_full_payment_clears_overdue():
    entries = [
        _e('2026-07-01', 'claim', credit=10000),
        _e('2026-07-20', 'payment', debit=10000),
    ]
    d = C.compute_contractor_delay(entries, 30, TODAY)
    assert d.overdue_amount == Decimal('0')
    assert d.overdue_count == 0
    assert d.max_days_late == 0
    assert d.claims[0].remaining == Decimal('0')
    assert d.claims[0].days_late == 0


def test_opening_balance_and_other_kinds_do_not_enter():
    # الافتتاحي والخصم والفاتورة المحمّلة ليست مستخلصات — لا استحقاق ولا تأخر منها.
    entries = [
        _e('2025-01-01', 'opening', credit=500000),
        _e('2026-09-01', 'deduction', debit=200),
        _e('2026-09-01', 'invoice', debit=300),
        _e('2026-09-10', 'retention', credit=100),
    ]
    d = C.compute_contractor_delay(entries, 30, TODAY)
    assert d.claims == []
    assert d.overdue_amount == Decimal('0')


def test_fifo_oldest_claim_first_and_buckets():
    # ثلاثة مستخلصات بأعمار مختلفة، ودفعة تُسدّد الأقدم كاملاً ونصف الثاني.
    entries = [
        _e('2026-01-01', 'claim', credit=1000),   # استحقاق ٣١ يناير → ٢٣٦ يوماً (m6_plus)
        _e('2026-05-01', 'claim', credit=2000),   # استحقاق ٣١ مايو → ١١٦ يوماً (m4)
        _e('2026-09-10', 'claim', credit=3000),   # استحقاق ١٠ أكتوبر → قادم خلال ٣٠ يوماً
        _e('2026-06-01', 'payment', debit=2000),
    ]
    d = C.compute_contractor_delay(entries, 30, TODAY)
    c1, c2, c3 = d.claims
    assert (c1.remaining, c2.remaining, c3.remaining) == (Decimal('0'), Decimal('1000'), Decimal('3000'))
    assert d.overdue_amount == Decimal('1000')
    assert d.overdue_count == 1
    assert d.max_days_late == (TODAY - dt.date(2026, 5, 31)).days == 116
    assert d.by_bucket['m4'] == Decimal('1000')
    assert d.by_bucket['m6_plus'] == Decimal('0')       # الأقدم سُدِّد فلا يدخل شريحته
    assert d.due_30d == Decimal('3000')
    assert d.due_7d == Decimal('0')
    assert sum(d.by_bucket.values(), Decimal('0')) == d.overdue_amount


def test_due_today_is_not_overdue_but_counts_in_7d():
    entries = [_e('2026-08-25', 'claim', credit=700)]           # استحقاق ٢٤ سبتمبر = اليوم
    d = C.compute_contractor_delay(entries, 30, TODAY)
    assert d.overdue_amount == Decimal('0')
    assert d.due_7d == Decimal('700')


def test_advance_payment_before_claim_settles_it():
    # دفعة مقدَّمة قبل المستخلص تبقى في الوعاء — تجاهلها كان سيُظهر تأخراً كاذباً.
    entries = [
        _e('2026-06-01', 'payment', debit=5000),
        _e('2026-07-01', 'claim', credit=5000),
    ]
    d = C.compute_contractor_delay(entries, 30, TODAY)
    assert d.overdue_amount == Decimal('0')
    assert d.claims[0].remaining == Decimal('0')


def test_all_debits_settle_claims_not_only_payments():
    # تأمين محتجز وخصم وفاتورة محمّلة عليه تُنقص ما يُستحق من المستخلص — حصر الوعاء
    # بالدفعات أخرج على بيانات حقيقية متأخراً أكبر من الرصيد كله (انظر docstring).
    entries = [
        _e('2026-07-01', 'claim', credit=10000),
        _e('2026-07-05', 'retention', debit=500),
        _e('2026-07-06', 'deduction', debit=300),
        _e('2026-07-07', 'invoice', debit=200),
        _e('2026-07-08', 'other', debit=4000),   # «دفعھ» بإملاء لم يلتقطه المصنّف
        _e('2026-07-20', 'payment', debit=4000),
    ]
    d = C.compute_contractor_delay(entries, 30, TODAY)
    assert d.claims[0].remaining == Decimal('1000')
    assert d.overdue_amount == Decimal('1000')


def test_opening_credit_absorbs_payments_first_but_is_not_reported():
    # افتتاحي دائن ٣٬٠٠٠ (ندين له من قبل) ثم مستخلص ٥٬٠٠٠ ودفعة ٣٬٠٠٠: الدفعة تسدّد
    # الافتتاحي (الأقدم) لا المستخلص، فالمستخلص يبقى متأخراً كاملاً — لكن الافتتاحي
    # نفسه لا يظهر كمستخلص ولا يدخل المتأخر (لا تاريخ استحقاق له).
    entries = [
        _e('2025-01-01', 'opening', credit=3000),
        _e('2026-07-01', 'claim', credit=5000),
        _e('2026-07-15', 'payment', debit=3000),
    ]
    d = C.compute_contractor_delay(entries, 30, TODAY)
    assert len(d.claims) == 1
    assert d.claims[0].remaining == Decimal('5000')
    assert d.overdue_amount == Decimal('5000')


def test_remaining_never_exceeds_what_we_owe():
    # الثابت: Σ المتبقي على المستخلصات ≤ max(0, −الرصيد).
    entries = [
        _e('2026-01-01', 'claim', credit=8000),
        _e('2026-02-01', 'claim', credit=2000),
        _e('2026-02-10', 'other', debit=9500),
    ]
    d = C.compute_contractor_delay(entries, 30, TODAY)
    balance = Decimal('9500') - Decimal('10000')
    assert sum((c.remaining for c in d.claims), Decimal('0')) == -balance == Decimal('500')
