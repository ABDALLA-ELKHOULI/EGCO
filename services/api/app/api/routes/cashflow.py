# -*- coding: utf-8 -*-
from typing import Optional
import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import cashflow_service

router = APIRouter()


@router.get('')
def cashflow(weeks: int = Query(26, ge=1, le=104),
            from_: Optional[str] = Query(None, alias='from'),
            opening_balance: float = Query(0.0),
            project: Optional[str] = Query(None),
            parties: str = Query('suppliers', pattern='^(suppliers|contractors|both)$'),
            db: Session = Depends(get_session)) -> dict:
    """التدفق النقدي — دخل وخرج على دلاء أسبوعين.

    `project` narrows both the outflow (supplier invoices) and inflow (receivables)
    sides to a single project; omitted, the whole company is shown as before.

    `parties` picks which outflow side(s) feed the buckets — 'suppliers' (default,
    kept for backward compatibility with old callers — numbers are identical to
    before this parameter existed), 'contractors', or 'both'. The frontend UI
    defaults its own selector to 'both' but passes it explicitly.

    Contractor attribution to a `project` filter is an approximation: a contractor
    "belongs" to the filtered project if ANY of its ledger entries carry that
    project — contractors routinely work several projects at once, so this is not
    a perfect split, just the best available without per-project ledger balances.
    """
    from_date = dt.date.fromisoformat(from_) if from_ else None
    return cashflow_service.cashflow(db, weeks=weeks, from_date=from_date,
                                     opening_balance=opening_balance, project=project,
                                     parties=parties)
