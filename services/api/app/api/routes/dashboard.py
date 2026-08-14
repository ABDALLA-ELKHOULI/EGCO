# -*- coding: utf-8 -*-
from typing import Optional
import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import payables_service

router = APIRouter()


@router.get('')
def dashboard(date_from: Optional[str] = Query(None),
             date_to: Optional[str] = Query(None),
             project: Optional[str] = Query(None),
             db: Session = Depends(get_session)) -> dict:
    """لوحة اليوم."""
    df = dt.date.fromisoformat(date_from) if date_from else None
    dtt = dt.date.fromisoformat(date_to) if date_to else None
    return payables_service.dashboard(db, date_from=df, date_to=dtt, project=project)


@router.get('/day')
def day_detail(date: str = Query(...), project: Optional[str] = Query(None),
              db: Session = Depends(get_session)) -> dict:
    """تفاصيل يوم في التقويم — كل ما يستحق فيه، مع ما يلزم للانتقال إلى صاحبه.

    Two kinds of obligations can land on a day: supplier invoices falling due,
    and contractor guarantee releases. Each item carries the account/code the
    frontend needs to link straight to the supplier or contractor screen.
    """
    from app.domain.payables import money, payment_schedule
    from app.services import contractors_service

    day = dt.date.fromisoformat(date)
    today = dt.date.today()

    suppliers = []
    ps = payables_service.positions(db, project=project)
    # horizon wide enough that any clickable month is covered either way
    span = abs((day - today).days) + 40
    for bucket in payment_schedule(ps, today, horizon_days=span):
        if bucket['date'] == day:
            suppliers = [dict(account=i['account'], supplier=i['supplier'],
                              invoice=i['invoice'], amount=money(i['amount']),
                              overdue=i['overdue'])
                         for i in bucket['items']]
            break

    guarantees = []
    from app.db import models
    gq = db.query(models.ContractorGuarantee).filter(
        models.ContractorGuarantee.deleted_at.is_(None))
    if project:
        gq = gq.filter(models.ContractorGuarantee.project == project)
    for g in gq.all():
        release_due, status = contractors_service.guarantee_release(g, today)
        if release_due == day and status != 'released':
            c = g.contractor
            guarantees.append(dict(code=c.code, name=c.name, project=g.project,
                                   amount=money(g.amount or 0), status=status))

    return dict(date=date,
                suppliers=suppliers,
                guarantees=guarantees,
                totals=dict(due=money(sum((i['amount'] for i in suppliers), 0.0)),
                            guarantees=money(sum((g['amount'] for g in guarantees), 0.0))))
