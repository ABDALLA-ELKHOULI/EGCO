# -*- coding: utf-8 -*-
from typing import Optional
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import cashflow_service

router = APIRouter()

_GRANULARITY_DAYS = {'week': 7, 'fortnight': 14}


@router.get('')
def cashflow(weeks: int = Query(26, ge=1, le=104),
            from_: Optional[str] = Query(None, alias='from'),
            opening_balance: float = Query(0.0),
            project: Optional[str] = Query(None),
            parties: str = Query('suppliers', pattern='^(suppliers|contractors|both)$'),
            period_days: Optional[int] = Query(None),
            granularity: Optional[str] = Query(None, pattern='^(week|fortnight)$'),
            db: Session = Depends(get_session)) -> dict:
    """التدفق النقدي — دخل وخرج على دلاء طولها `period_days` يوماً (١٤ افتراضياً).

    `project` narrows both the outflow (supplier invoices) and inflow (receivables)
    sides to a single project; omitted, the whole company is shown as before.

    `parties` picks which outflow side(s) feed the buckets — 'suppliers' (default,
    kept for backward compatibility with old callers — numbers are identical to
    before this parameter existed), 'contractors', or 'both'. The frontend UI
    defaults its own selector to 'both' but passes it explicitly.

    `period_days` is the primary contract for bucket length — default 14 (byte-
    identical to the pre-existing behaviour when omitted), must be within 1..92
    inclusive or the request is rejected with 422. `granularity` ('week' | 'fortnight')
    is kept only as a backward-compat alias for the short-lived week/fortnight toggle;
    if both are supplied, `period_days` wins.

    Contractor attribution to a `project` filter is an approximation: a contractor
    "belongs" to the filtered project if ANY of its ledger entries carry that
    project — contractors routinely work several projects at once, so this is not
    a perfect split, just the best available without per-project ledger balances.
    """
    if period_days is None and granularity is not None:
        period_days = _GRANULARITY_DAYS[granularity]
    if period_days is None:
        period_days = 14
    if not (1 <= period_days <= 92):
        raise HTTPException(status_code=422, detail='طول الفترة بين ١ و٩٢ يوماً')

    from_date = dt.date.fromisoformat(from_) if from_ else None
    return cashflow_service.cashflow(db, weeks=weeks, from_date=from_date,
                                     opening_balance=opening_balance, project=project,
                                     parties=parties, period_days=period_days)
