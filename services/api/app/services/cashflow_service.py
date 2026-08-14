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


def _receivable_items(db: Session):
    """Returns (items, stats).

    A receivable row is only usable as a forecast if it carries a date. The legacy
    report4.html source, for instance, gives amounts with no dates at all — rows exist
    but no inflow can be placed on the timeline. Reporting "we have receivables" from
    the row count alone would hide a zero inflow behind a green flag, so the caller
    gets the breakdown and warns accordingly.
    """
    rows = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None)).all()
    items = []
    undated = 0
    for r in rows:
        d = r.collected_on or r.due_date
        if d is None:
            undated += 1
            continue
        items.append(C.CashItem(date=d, amount=D(r.amount)))
    return items, dict(total=len(rows), dated=len(items), undated=undated)


def _payable_items(db: Session, today: dt.date):
    ps = PS.positions(db, today=today, include_empty=True)
    items = []
    for p in ps:
        for inv in p.invoices:
            if inv.remaining > 0 and inv.due_date is not None:
                items.append(C.CashItem(date=inv.due_date, amount=inv.remaining))
    return items


def cashflow(db: Session, weeks: int = 26, from_date: Optional[dt.date] = None,
            opening_balance: float = 0.0, today: Optional[dt.date] = None) -> dict:
    today = today or dt.date.today()
    from_date = from_date or today

    recv_items, recv_stats = _receivable_items(db)
    pay_items = _payable_items(db, today)

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
    )
