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
            db: Session = Depends(get_session)) -> dict:
    """التدفق النقدي — دخل وخرج على دلاء أسبوعين."""
    from_date = dt.date.fromisoformat(from_) if from_ else None
    return cashflow_service.cashflow(db, weeks=weeks, from_date=from_date,
                                     opening_balance=opening_balance)
