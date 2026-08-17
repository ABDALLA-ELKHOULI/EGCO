# -*- coding: utf-8 -*-
"""يربط قاعدة البيانات بطبقة الحسابات.

Loads rows, hands them to the pure domain layer, and shapes the result for the wire.
No arithmetic lives here — if you find yourself adding a calculation, it belongs in
`domain/payables.py` where it can be tested without a database.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import datetime as dt
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import models
from app.domain import payables as P
from app.domain.payables import D, money


def _term(row: models.Supplier) -> P.Term:
    return P.Term(days=row.term_days, kind=row.term_kind, raw=row.term_raw)


def _supplier(row: models.Supplier) -> P.Supplier:
    return P.Supplier(account=row.account, name=row.name,
                      project=row.project, term=_term(row))


# ---------------------------------------------------------------- «تخصيص الدفعات» settings

#: مفتاح app_settings — انظر شرح كامل الميزة في models.PaymentAllocation.
_SMART_ALLOCATION_KEY = 'payment_allocation_enabled'


def is_smart_allocation_enabled(db: Session) -> bool:
    """هل تخصيص الدفعات مفعّل؟ الغياب == متوقف — هذا ما يبقي السلوك القديم
    كما هو لكل تركيب لم يفعّل الإعداد صراحةً (الافتراضي OFF بالتصميم)."""
    row = db.query(models.AppSetting).filter_by(key=_SMART_ALLOCATION_KEY).one_or_none()
    return row is not None and row.value == '1'


def set_smart_allocation_enabled(db: Session, enabled: bool) -> None:
    row = db.query(models.AppSetting).filter_by(key=_SMART_ALLOCATION_KEY).one_or_none()
    if row is None:
        row = models.AppSetting(key=_SMART_ALLOCATION_KEY)
        db.add(row)
    row.value = '1' if enabled else '0'
    db.commit()


def _load_decisions(db: Session, payment_ids: List[str]) -> Dict[str, List[tuple]]:
    """يبني payment_id -> [(invoice_id أو None, Decimal amount), ...] من الجدول."""
    if not payment_ids:
        return {}
    rows = (db.query(models.PaymentAllocation)
            .filter(models.PaymentAllocation.payment_id.in_(payment_ids),
                    models.PaymentAllocation.deleted_at.is_(None)).all())
    out: Dict[str, List[tuple]] = {}
    for r in rows:
        out.setdefault(r.payment_id, []).append((r.invoice_id, D(r.amount)))
    return out


def save_payment_allocation(db: Session, payment_id: str, lines: List[dict]) -> None:
    """يستبدل قرار دفعة بالكامل — يحذف الأسطر القديمة (soft) ويكتب الجديدة.

    `lines`: [{invoiceId: str|None, amount: float}] — invoiceId=None يعني «على
    الحساب». يتحقق المستدعي (route) من صحة المجموع والحساب قبل النداء؛ هذه
    الدالة تخزّن القرار كما وصل، فتبقى domain/payables.py وحدها مصدر الحساب.
    """
    now = dt.datetime.now(dt.timezone.utc)
    existing = db.query(models.PaymentAllocation).filter_by(
        payment_id=payment_id, deleted_at=None).all()
    for r in existing:
        r.deleted_at = now
    for line in lines:
        db.add(models.PaymentAllocation(
            payment_id=payment_id, invoice_id=line.get('invoiceId'),
            amount=line['amount'],
            kind='on_account' if line.get('invoiceId') is None else 'manual'))
    db.commit()


def clear_payment_allocation(db: Session, payment_id: str) -> None:
    """يمحو قرار دفعة — تعود إلى قائمة المراجعة عند إعادة الحساب."""
    now = dt.datetime.now(dt.timezone.utc)
    for r in db.query(models.PaymentAllocation).filter_by(
            payment_id=payment_id, deleted_at=None).all():
        r.deleted_at = now
    db.commit()


def positions(db: Session, today: Optional[dt.date] = None,
              account: Optional[str] = None,
              project: Optional[str] = None,
              include_empty: bool = False,
              smart: Optional[bool] = None) -> list:
    """smart=None (الافتراضي) يقرأ إعداد app_settings؛ مرّر True/False صراحةً
    لتجاوزه (مثال: أدوات القياس)."""
    today = today or dt.date.today()
    if smart is None:
        smart = is_smart_allocation_enabled(db)
    q = db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None))
    if account:
        q = q.filter(models.Supplier.account == account)
    if project:
        q = q.filter(models.Supplier.project == project)

    out: list = []
    for row in q.all():
        invs = [P.Invoice(date=i.date, amount=i.amount, number=i.number,
                          doc=i.doc, description=i.description, id=i.id,
                          source=i.source or 'statement',
                          manual_due_date=i.manual_due_date)
                for i in row.invoices if i.deleted_at is None]
        pays = [P.Payment(date=p.date, amount=p.amount, doc=p.doc,
                          description=p.description, id=p.id,
                          source=p.source or 'statement')
                for p in row.payments if p.deleted_at is None]
        # A supplier with no movement yet still belongs in the list screen — it just
        # has nothing owing. Only the dashboard filters these out.
        if not invs and not pays and not include_empty:
            continue
        decisions = _load_decisions(db, [p.id for p in pays]) if smart else None
        out.append(P.position(_supplier(row), invs, pays, today,
                              smart=smart, decisions=decisions))
    return out


def count_pending_allocations(db: Session) -> int:
    """عدد الدفعات المعلَّقة عبر كل الموردين — للعرض «٣ دفعات بانتظار التخصيص».

    يُعاد حسابه من الصفر (لا يُخزَّن) لأنه مشتق: يتغيّر مع كل استيراد أو قرار
    مراجعة جديد، وحسابه هنا هو نفس المسار الذي يبني به كشف كل مورد فرادى."""
    if not is_smart_allocation_enabled(db):
        return 0
    ps = positions(db, include_empty=False, smart=True)
    return sum(len(p.unallocated_payments) for p in ps)


# ---------------------------------------------------------------- period window

def period_breakdown(p, date_from: Optional[dt.date], date_to: Optional[dt.date]) -> dict:
    """opening/closing balance and in-period sums, from the full-history position `p`.

    opening = (invoices before date_from) - (payments before date_from)
    invoicedInPeriod / paidInPeriod = sums with date in [date_from, date_to]
    closing = opening + invoicedInPeriod - paidInPeriod   (must hold exactly)
    """
    zero = Decimal('0')
    if date_from is not None:
        opening = (sum((i.amount for i in p.invoices if i.date < date_from), zero) -
                   sum((x.amount for x in p.payments if x.date < date_from), zero))
        has_history_before = any(i.date < date_from for i in p.invoices) or \
            any(x.date < date_from for x in p.payments)
    else:
        opening = zero
        has_history_before = False

    def _in_range(d: dt.date) -> bool:
        if date_from is not None and d < date_from:
            return False
        if date_to is not None and d > date_to:
            return False
        return True

    invoiced_in_period = sum((i.amount for i in p.invoices if _in_range(i.date)), zero)
    paid_in_period = sum((x.amount for x in p.payments if _in_range(x.date)), zero)
    closing = opening + invoiced_in_period - paid_in_period
    return dict(opening=opening, closing=closing,
                invoiced_in_period=invoiced_in_period, paid_in_period=paid_in_period,
                has_history_before=has_history_before)


# ---------------------------------------------------------------- serialisation

def invoice_json(i) -> dict:
    return dict(id=i.id, number=i.number, date=i.date.isoformat(), amount=money(i.amount),
                paid=money(i.paid), remaining=money(i.remaining),
                dueDate=i.due_date.isoformat() if i.due_date else None,
                daysToDue=i.days_to_due, doc=i.doc, description=i.description,
                source=i.source)


def payment_json(x) -> dict:
    return dict(id=x.id, date=x.date.isoformat(), amount=money(x.amount),
                doc=x.doc, description=x.description, source=x.source)


def position_json(p, detail: bool = False,
                   date_from: Optional[dt.date] = None,
                   date_to: Optional[dt.date] = None,
                   projects: Optional[List[str]] = None) -> dict:
    # `projects` — لائحة مشاريع المورد الكاملة (party_projects.projects_of)، يمررها
    # المستدعي الذي يملك جلسة db. بلا تمرير صريح نتراجع لعمود Supplier.project
    # المفرد، حتى لا ينكسر مستدعٍ قديم لا يعرف بجدول party_projects بعد.
    projects = projects if projects is not None else (
        [p.supplier.project] if p.supplier.project else [])
    d = dict(
        account=p.supplier.account, name=p.supplier.name, project=p.supplier.project,
        projects=projects,
        term=p.supplier.term.raw or 'كاش', termKind=p.supplier.term.kind,
        termDays=p.supplier.term.days,
        totalInvoiced=money(p.total_invoiced), totalPaid=money(p.total_paid),
        outstanding=money(p.outstanding), overdue=money(p.overdue),
        dueToday=money(p.due_today), dueWithin7=money(p.due_within_7),
        needsManualDueDate=p.needs_manual_due_date,
        ageing=dict(current=money(p.ageing.current), d1_30=money(p.ageing.d1_30),
                    d31_60=money(p.ageing.d31_60), d61_90=money(p.ageing.d61_90),
                    d90_plus=money(p.ageing.d90_plus)),
        invoiceCount=len(p.invoices), openInvoiceCount=len([i for i in p.invoices if i.remaining > 0]),
        # التأخر — أسوأ رقم للعمود، والتوزيع للنقر عليه. الاثنان من نفس المحرك.
        delay=dict(days=p.delay.days, bucket=p.delay.bucket,
                   amount=money(p.delay.amount),
                   byBucket={k: money(v) for k, v in p.delay.by_bucket.items()}),
        # عدد الدفعات بانتظار التخصيص — [] دائماً حين إعداد تخصيص الدفعات متوقف،
        # حتى لا يظهر رقم يوحي بميزة لا يعرف عنها المستخدم شيئاً بعد.
        unallocatedCount=len(p.unallocated_payments),
    )
    # آخر دفعة — معلومة أساسية في القائمة: متى دُفع لهذا المورد آخر مرة وكم
    last_pay = max(p.payments, key=lambda x: x.date, default=None)
    d['lastPayment'] = (dict(date=last_pay.date.isoformat(), amount=money(last_pay.amount))
                        if last_pay is not None else None)
    if detail:
        d['invoices'] = [invoice_json(i) for i in p.invoices]
        d['payments'] = [payment_json(x) for x in p.payments]
        # دفعات بانتظار التخصيص — تفصيل كامل فقط في شاشة المورد (شاشة القائمة
        # تكتفي بـ unallocatedCount أعلاه، خفة الحمل).
        d['unallocatedPayments'] = [
            dict(payment=payment_json(u.payment),
                 candidates=[invoice_json(c) for c in u.candidates],
                 reason=u.reason)
            for u in p.unallocated_payments
        ]
        if date_from is not None or date_to is not None:
            b = period_breakdown(p, date_from, date_to)
            d['openingBalance'] = money(b['opening'])
            d['closingBalance'] = money(b['closing'])
            d['invoicedInPeriod'] = money(b['invoiced_in_period'])
            d['paidInPeriod'] = money(b['paid_in_period'])
            d['hasHistoryBefore'] = b['has_history_before']
        else:
            d['openingBalance'] = 0.0
            d['closingBalance'] = money(p.outstanding)
            d['invoicedInPeriod'] = money(p.total_invoiced)
            d['paidInPeriod'] = money(p.total_paid)
            d['hasHistoryBefore'] = False
    return d


def status_of(p) -> str:
    """حالة المورد — the single label the list screen shows."""
    if p.supplier.term.is_claim and p.outstanding > 0:
        return 'awaiting_date'
    if p.overdue > 0:
        return 'overdue'
    if p.due_within_7 > 0:
        return 'due_soon'
    if p.outstanding > 0:
        return 'open'
    return 'clear'


def dashboard(db: Session, today: Optional[dt.date] = None,
              date_from: Optional[dt.date] = None,
              date_to: Optional[dt.date] = None,
              project: Optional[str] = None) -> dict:
    """لوحة اليوم — the numbers على S1."""
    today = today or dt.date.today()
    ps = positions(db, today, project=project)

    rows = []
    for p in ps:
        for i in p.invoices:
            if i.remaining <= 0 or i.due_date is None:
                continue
            if i.days_to_due is not None and i.days_to_due <= settings.DUE_SOON_DAYS:
                rows.append(dict(account=p.supplier.account, supplier=p.supplier.name,
                                 project=p.supplier.project, invoice=i.number,
                                 dueDate=i.due_date.isoformat(), daysToDue=i.days_to_due,
                                 amount=money(i.remaining), overdue=i.days_to_due < 0))
    rows.sort(key=lambda r: (r['daysToDue'], -r['amount']))

    zero = Decimal('0')
    ag = dict(current=zero, d1_30=zero, d31_60=zero, d61_90=zero, d90_plus=zero)
    for p in ps:
        for k in ag:
            ag[k] += getattr(p.ageing, k)

    summary = dict(
        overdue=money(sum((p.overdue for p in ps), zero)),
        dueWithin7=money(sum((p.due_within_7 for p in ps), zero)),
        outstanding=money(sum((p.outstanding for p in ps), zero)),
        totalPaid=money(sum((p.total_paid for p in ps), zero)),
        supplierCount=len(ps),
        awaitingDate=len([p for p in ps if p.needs_manual_due_date]),
    )

    if date_from is not None:
        opening_total = sum((period_breakdown(p, date_from, date_to)['opening'] for p in ps), zero)
        summary['openingBalance'] = money(opening_total)
        period = dict(from_=date_from.isoformat(), to=(date_to or dt.date.today()).isoformat())
        period = {'from': date_from.isoformat(), 'to': (date_to or dt.date.today()).isoformat()}
    else:
        summary['openingBalance'] = 0.0
        period = None

    return dict(
        today=today.isoformat(),
        summary=summary,
        period=period,
        payToday=rows,
        ageing={k: money(v) for k, v in ag.items()},
        schedule=[dict(date=b['date'].isoformat(), amount=money(b['amount']),
                       count=len(b['items']),
                       overdue=b['date'] < today)
                  for b in P.payment_schedule(ps, today, 90)],
    )
