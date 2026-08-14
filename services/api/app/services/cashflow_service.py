# -*- coding: utf-8 -*-
"""يربط قاعدة البيانات بحسابات التدفق النقدي الصرفة (domain/cashflow.py)."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain import cashflow as C
from app.domain.payables import D, money
from app.services import payables_service as PS

NO_RECEIVABLES_WARNING = 'لم تُرفع بيانات التحصيلات بعد — التدفق الداخل صفر ولا يمثل توقعاً حقيقياً'
UNDATED_RECEIVABLES_WARNING = (
    'التحصيلات المرفوعة ({n} سجلاً) بلا تواريخ استحقاق — لا يمكن توقّع موعد دخولها، '
    'والتدفق الداخل أدناه صفر لهذا السبب لا لأنه لا يوجد مستحق لنا')
PAST_RECEIVABLES_WARNING = (
    'كل التحصيلات المرفوعة تواريخها قبل بداية المدى المعروض — لا يوجد داخل متوقّع فيه')


def _receivable_items(db: Session, project: Optional[str] = None):
    """Returns (items, stats).

    A receivable row is only usable as a forecast if it carries a date. The legacy
    report4.html source, for instance, gives amounts with no dates at all — rows exist
    but no inflow can be placed on the timeline. Reporting "we have receivables" from
    the row count alone would hide a zero inflow behind a green flag, so the caller
    gets the breakdown and warns accordingly.

    When `project` is given, only receivables belonging to that project are counted —
    both in the items placed on the timeline and in the stats used for the warnings,
    so the honesty messages stay true to the filtered scope, not the whole company.
    """
    q = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None))
    if project:
        q = q.filter(models.Receivable.project == project)
    rows = q.all()
    items = []
    undated = 0
    for r in rows:
        d = r.collected_on or r.due_date
        if d is None:
            undated += 1
            continue
        items.append(C.CashItem(date=d, amount=D(r.amount)))
    return items, dict(total=len(rows), dated=len(items), undated=undated)


def _payable_items(db: Session, today: dt.date, project: Optional[str] = None):
    ps = PS.positions(db, today=today, project=project, include_empty=True)
    items = []
    for p in ps:
        for inv in p.invoices:
            if inv.remaining > 0 and inv.due_date is not None:
                items.append(C.CashItem(date=inv.due_date, amount=inv.remaining))
    return items


def _scoped_contractors(db: Session, project: Optional[str] = None) -> list:
    """المقاولون ضمن نطاق المشروع، إن حُدِّد.

    تقريب موثَّق: يُعتبر المقاول تابعاً للمشروع المفلتَر إن حملت أي حركة من حركات
    دفتره ذلك المشروع (entry.project) — المقاول غالباً يعمل في أكثر من مشروع
    فلا يوجد رصيد "خاص بمشروع" دقيق في دفتر الحساب نفسه، فهذا أفضل تقريب متاح.
    """
    q = db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None))
    if not project:
        return q.all()
    ids = {cid for (cid,) in db.query(models.ContractorEntry.contractor_id)
           .filter(models.ContractorEntry.project == project).distinct()}
    return [c for c in q.all() if c.id in ids]


def _contractor_guarantee_items(db: Session, from_date: dt.date, weeks: int,
                                contractor_ids: set) -> tuple:
    """بنود الضمانات المجدولة (المؤرَّخة) ومجموعها — الجزء (a) من مخرجات المقاولين.

    ضمان غير مُصرف (released_on فارغ) له تاريخ إفراج محسوب (release_due الصريح، وإلا
    finished_on + guarantee_days) داخل الأفق يُبكَّت كخارج في تلك الفترة، كضمانات.
    الضمانات بلا تاريخ إفراج محسوب لا تدخل هنا إطلاقاً — تظهر ضمن الرصيد غير المؤرَّخ.
    """
    horizon_end = from_date + dt.timedelta(days=weeks * 7 - 1)
    q = db.query(models.ContractorGuarantee).filter(
        models.ContractorGuarantee.released_on.is_(None))
    if contractor_ids is not None:
        q = q.filter(models.ContractorGuarantee.contractor_id.in_(contractor_ids))
    items = []
    dated_total = Decimal('0')
    for g in q.all():
        due = g.release_due
        if due is None and g.finished_on is not None and g.guarantee_days is not None:
            due = g.finished_on + dt.timedelta(days=g.guarantee_days)
        if due is None:
            continue
        amount = D(g.amount or 0)
        if amount <= 0:
            continue
        if from_date <= due <= horizon_end:
            items.append(C.CashItem(date=due, amount=amount))
            dated_total += amount
    return items, dated_total


def _undated_contractor_dues(db: Session, contractor_ids: set, dated_total: Decimal) -> Decimal:
    """مستحق للمقاولين بلا تواريخ استحقاق — رصيد سالب لم يُغطَّ بضمانات مجدولة.

    دفاتر المقاولين لا تحمل تواريخ استحقاق (خلافاً للموردين)، فلا يمكن توزيع كل
    المستحق على الجدول الزمني بأمانة. نجمع القيمة المطلقة لكل الأرصدة السالبة
    (ما ندين به لكل مقاول) ثم نطرح ما سبق جدولته فعلاً عبر ضمانات مؤرَّخة داخل
    الأفق، حتى لا يُحتسب المبلغ مرتين — والنتيجة لا تقل عن صفر.
    """
    q = db.query(models.ContractorEntry.contractor_id,
                 models.ContractorEntry.debit, models.ContractorEntry.credit)
    if contractor_ids is not None:
        q = q.filter(models.ContractorEntry.contractor_id.in_(contractor_ids))
    per_contractor: dict = {}
    for cid, debit, credit in q.all():
        b = per_contractor.setdefault(cid, Decimal('0'))
        per_contractor[cid] = b + D(debit or 0) - D(credit or 0)
    total_owed = sum((-b for b in per_contractor.values() if b < 0), Decimal('0'))
    return max(Decimal('0'), total_owed - dated_total)


def _known_projects(db: Session) -> list:
    """Distinct supplier ∪ receivable projects, sorted — feeds the UI selector.

    Always company-wide (never filtered) so the selector can offer every project
    regardless of which one is currently applied.
    """
    supplier_projects = {p for (p,) in db.query(models.Supplier.project)
                         .filter(models.Supplier.deleted_at.is_(None)).distinct() if p}
    receivable_projects = {p for (p,) in db.query(models.Receivable.project)
                           .filter(models.Receivable.deleted_at.is_(None)).distinct() if p}
    return sorted(supplier_projects | receivable_projects)


def cashflow(db: Session, weeks: int = 26, from_date: Optional[dt.date] = None,
            opening_balance: float = 0.0, today: Optional[dt.date] = None,
            project: Optional[str] = None, parties: str = 'suppliers') -> dict:
    """`parties` — 'suppliers' (default, matches the pre-existing behaviour byte for
    byte), 'contractors', or 'both'. See the route docstring for the project ↔
    contractor attribution caveat.
    """
    today = today or dt.date.today()
    from_date = from_date or today

    recv_items, recv_stats = _receivable_items(db, project=project)

    pay_items = []
    undated_contractor_dues = Decimal('0')
    if parties in ('suppliers', 'both'):
        pay_items += _payable_items(db, today, project=project)
    if parties in ('contractors', 'both'):
        scoped = _scoped_contractors(db, project=project)
        contractor_ids = {c.id for c in scoped} if project else None
        guarantee_items, dated_total = _contractor_guarantee_items(db, from_date, weeks, contractor_ids)
        pay_items += guarantee_items
        undated_contractor_dues = _undated_contractor_dues(db, contractor_ids, dated_total)

    periods = C.build_periods(recv_items, pay_items, from_date, weeks, D(opening_balance))

    total_inflow = sum((p.inflow for p in periods), Decimal('0'))
    # "Do we have usable income data?" — not "do rows exist?". A green flag over a zero
    # inflow is exactly how a forecast starts lying.
    has_usable = recv_stats['dated'] > 0 and total_inflow > 0
    summary = C.summarise(periods, has_usable)

    warnings = []
    if recv_stats['total'] == 0:
        warnings.append(NO_RECEIVABLES_WARNING)
    elif recv_stats['dated'] == 0:
        warnings.append(UNDATED_RECEIVABLES_WARNING.format(n=recv_stats['total']))
    elif total_inflow == 0:
        warnings.append(PAST_RECEIVABLES_WARNING)

    fd = summary['first_deficit']
    first_deficit_json = None
    if fd is not None:
        first_deficit_json = {'label': fd.label, 'from': fd.from_date.isoformat(),
                              'to': fd.to_date.isoformat(), 'amount': money(fd.balance)}

    return dict(
        asOf=today.isoformat(),
        openingBalance=money(opening_balance),
        periodDays=C.PERIOD_DAYS,
        periods=[{
            'label': p.label, 'from': p.from_date.isoformat(), 'to': p.to_date.isoformat(),
            'inflow': money(p.inflow), 'outflow': money(p.outflow), 'net': money(p.net),
            'balance': money(p.balance), 'inflowCount': p.inflow_count,
            'outflowCount': p.outflow_count, 'deficit': p.deficit,
        } for p in periods],
        summary=dict(
            totalInflow=money(summary['total_inflow']), totalOutflow=money(summary['total_outflow']),
            netTotal=money(summary['net_total']), minBalance=money(summary['min_balance']),
            firstDeficit=first_deficit_json, hasReceivables=has_usable,
                     receivablesStats=recv_stats,
        ),
        warnings=warnings,
        projects=_known_projects(db),
        parties=parties,
        undatedContractorDues=money(undated_contractor_dues),
    )
