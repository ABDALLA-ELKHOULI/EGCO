# -*- coding: utf-8 -*-
"""لوحة القيادة — يجمّع أرقام الموردين، التغطية، التدفق النقدي، والمشاريع في شاشة واحدة.

Does NOT import coverage_service (owned by another agent, may not exist yet) — coverage
numbers are computed locally from the same suppliers/invoices/payments data.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import money
from app.services import cashflow_service, payables_service as PS, projects_service

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

    return dict(asOf=today.isoformat(), payables=payables, coverage=coverage,
               cash=cash, projects=projects, alerts=alerts)
