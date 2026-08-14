# -*- coding: utf-8 -*-
"""لوحة القيادة — يجمّع أرقام الموردين، التغطية، التدفق النقدي، والمشاريع في شاشة واحدة.

Does NOT import coverage_service (owned by another agent, may not exist yet) — coverage
numbers are computed locally from the same suppliers/invoices/payments data.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import D, money
from app.services import (cashflow_service, contractors_service as CS,
                          payables_service as PS, projects_service)

STALE_DAYS_DEFAULT = 90

_AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
              'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
_AR_DIGITS = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')


def _ar_num(n) -> str:
    """أرقام هندية للعدّ داخل الجُمل العربية — المبالغ وحدها تبقى لاتينية."""
    return str(n).translate(_AR_DIGITS)


def _ar_date(iso: str) -> str:
    """2026-08-14 → ١٤ أغسطس ٢٠٢٦ — نصّ ISO داخل جملة عربية يُقلب بصرياً فيقرأ معكوساً."""
    y, m, d = (int(x) for x in iso.split('-'))
    return f'{_ar_num(d)} {_AR_MONTHS[m - 1]} {_ar_num(y)}'


def _suppliers(n: int) -> str:
    """تمييز العدد: ٣–١٠ جمع مجرور (موردين)، وما فوق مفرد منصوب (مورداً)."""
    if n == 1:
        return 'مورد واحد'
    if n == 2:
        return 'موردان'
    if 3 <= n <= 10:
        return f'{_ar_num(n)} موردين'
    return f'{_ar_num(n)} مورداً'


def _coverage(db: Session, today: dt.date, stale_days: int = STALE_DAYS_DEFAULT) -> dict:
    ps = PS.positions(db, today=today, include_empty=True)
    total = len(ps)
    with_data = 0
    stale = 0
    for p in ps:
        dates = [i.date for i in p.invoices] + [x.date for x in p.payments]
        if not dates:
            continue
        with_data += 1
        last = max(dates)
        if (today - last).days > stale_days:
            stale += 1
    without_data = total - with_data
    covered_pct = round((with_data / total) * 100, 1) if total else 0.0
    return dict(coveredPct=covered_pct, withoutData=without_data, stale=stale,
                total=total, withData=with_data)


def _contractors_block(db: Session, today: dt.date) -> dict:
    """يطابق /contractors تماماً — نفس دالة الخدمة، فلا يمكن أن يختلف الرقمان."""
    cl = CS.contractors_list_json(db, today)
    release_alerts = sum(r['releaseAlerts'] for r in cl['rows'])
    return dict(count=cl['count'],
               owedToContractors=cl['totals']['owedToContractors'],
               owedToUs=cl['totals']['owedToUs'],
               retentionHeld=cl['totals']['retentionHeld'],
               releaseAlerts=release_alerts)


def _last_payments(db: Session, limit: int = 6) -> list:
    """آخر الدفعات — دفعات الموردين ∪ حركات دفع المقاولين، مرتبة زمنياً تنازلياً."""
    items = []
    for p in db.query(models.Payment).filter(models.Payment.deleted_at.is_(None)).all():
        s = p.supplier
        if s is None or s.deleted_at is not None:
            continue
        items.append(dict(date=p.date, created_at=p.created_at, amount=money(D(p.amount)),
                          partyKind='supplier', name=s.name, account=s.account,
                          description=(p.description or '')[:60], source=p.source or 'statement'))
    for e in db.query(models.ContractorEntry).filter(
            models.ContractorEntry.deleted_at.is_(None),
            models.ContractorEntry.kind == 'payment',
            models.ContractorEntry.debit > 0).all():
        c = e.contractor
        if c is None or c.deleted_at is not None:
            continue
        items.append(dict(date=e.date, created_at=e.created_at, amount=money(D(e.debit)),
                          partyKind='contractor', name=c.name, account=c.code,
                          description=(e.description or '')[:60], source=e.source or 'statement'))
    items.sort(key=lambda x: (x['date'], x['created_at']), reverse=True)
    return [dict(date=it['date'].isoformat(), amount=it['amount'], partyKind=it['partyKind'],
                name=it['name'], account=it['account'], description=it['description'],
                source=it['source'])
            for it in items[:limit]]


def _revenues_block(db: Session) -> dict:
    zero = Decimal('0')
    rows = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None)).all()
    open_ = sum((D(r.amount) for r in rows if r.status == 'open'), zero)
    collected = sum((D(r.amount) for r in rows if r.status == 'collected'), zero)
    return dict(open=money(open_), collected=money(collected))


def _guarantees_block(db: Session, today: dt.date) -> dict:
    """الضمانات — نفس CS.guarantee_release() المستخدمة في شاشة المقاولين، فلا يختلف
    تصنيف مستحق/يقترب بين الشاشتين.

    مُحاط بحماية ضد جدول/عمود ناقص: عامل آخر قد يضيف عمود «كشوف الضمان» على نفس
    الجدول قبل أن يكتمل الترحيل في هذه البيئة — لا يجوز أن يسقط /overview بسبب ذلك.
    """
    zero = Decimal('0')
    empty = dict(heldTotal=0.0, dueCount=0, upcomingCount=0, nextRelease=None,
                releasedThisYear=dict(count=0, amount=0.0))
    try:
        rows = db.query(models.ContractorGuarantee).filter(
            models.ContractorGuarantee.deleted_at.is_(None)).all()
    except SQLAlchemyError:
        db.rollback()
        return empty

    unreleased = [g for g in rows if g.released_on is None]
    held_total = sum((D(g.amount or 0) for g in unreleased), zero)

    due_count = upcoming_count = 0
    candidates = []
    for g in unreleased:
        due, status = CS.guarantee_release(g, today)
        if status == 'due':
            due_count += 1
        elif status == 'upcoming':
            upcoming_count += 1
        if due is not None:
            candidates.append((due, g))

    next_release = None
    if candidates:
        candidates.sort(key=lambda t: t[0])
        due, g = candidates[0]
        c = g.contractor
        next_release = dict(date=due.isoformat(), amount=money(D(g.amount or 0)),
                            contractorName=c.name if c is not None else '',
                            contractorCode=c.code if c is not None else '',
                            project=g.project or '')

    released_rows = [g for g in rows
                     if g.released_on is not None and g.released_on.year == today.year]
    released_amount = sum((D(g.amount or 0) for g in released_rows), zero)

    return dict(heldTotal=money(held_total), dueCount=due_count, upcomingCount=upcoming_count,
               nextRelease=next_release,
               releasedThisYear=dict(count=len(released_rows), amount=money(released_amount)))


def overview(db: Session, today: Optional[dt.date] = None) -> dict:
    today = today or dt.date.today()
    ps = PS.positions(db, today=today, include_empty=True)
    zero = Decimal('0')

    payables = dict(
        outstanding=money(sum((p.outstanding for p in ps), zero)),
        overdue=money(sum((p.overdue for p in ps), zero)),
        dueWithin7=money(sum((p.due_within_7 for p in ps), zero)),
        supplierCount=len(ps),
        withData=len([p for p in ps if p.invoices or p.payments]),
    )

    cov = _coverage(db, today)
    coverage = dict(coveredPct=cov['coveredPct'], withoutData=cov['withoutData'], stale=cov['stale'])

    cf = cashflow_service.cashflow(db, weeks=8, today=today)
    next_deficit = None
    if cf['summary']['firstDeficit']:
        fd = cf['summary']['firstDeficit']
        next_deficit = dict(label=fd['label'], amount=fd['amount'],
                            **{'from': fd['from'], 'to': fd['to']})
    cash = dict(nextDeficit=next_deficit, minBalance=cf['summary']['minBalance'],
                hasReceivables=cf['summary']['hasReceivables'])

    proj_rows = projects_service.list_projects(db, today)['rows']
    projects = [dict(project=r['project'], outstanding=r['outstanding'], overdue=r['overdue'])
                for r in proj_rows[:5]]

    alerts = []
    if payables['overdue'] > 0:
        alerts.append(dict(level='danger',
                           text=f"متأخرات مستحقة الآن: {payables['overdue']:,.2f} ر.س"))
    if coverage['withoutData'] > 0:
        alerts.append(dict(level='warning',
                           text=f"{_suppliers(coverage['withoutData'])} بلا كشوفات — الأرقام أدناه ناقصة"))
    if coverage['stale'] > 0:
        alerts.append(dict(level='warning',
                           text=f"{_suppliers(coverage['stale'])} بلا حركة منذ فترة طويلة — قد تكون البيانات قديمة"))
    if next_deficit is not None:
        alerts.append(dict(level='danger',
                           text=f"عجز نقدي متوقع خلال {_ar_date(next_deficit['from'])} — "
                                f"{_ar_date(next_deficit['to'])} بمقدار "
                                f"{abs(next_deficit['amount']):,.2f} ر.س"))
    if not cash['hasReceivables']:
        alerts.append(dict(level='info', text='لم تُرفع بيانات التحصيلات بعد'))
    if payables['dueWithin7'] > 0:
        alerts.append(dict(level='info',
                           text=f"مستحق خلال ٧ أيام: {payables['dueWithin7']:,.2f} ر.س"))

    contractors = _contractors_block(db, today)
    last_payments = _last_payments(db, limit=6)
    last_payment = last_payments[0] if last_payments else None
    revenues = _revenues_block(db)
    guarantees = _guarantees_block(db, today)

    return dict(asOf=today.isoformat(), payables=payables, coverage=coverage,
               cash=cash, projects=projects, alerts=alerts,
               contractors=contractors, lastPayments=last_payments, lastPayment=last_payment,
               revenues=revenues, guarantees=guarantees)
