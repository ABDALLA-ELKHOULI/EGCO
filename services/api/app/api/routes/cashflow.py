# -*- coding: utf-8 -*-
from typing import Optional
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import parse_date
from app.db.session import get_session
from app.services import cashflow_service

router = APIRouter()


class ReconciliationNoteIn(BaseModel):
    """جسم POST /cashflow/reconciliation-note — تفسير المستخدم لفرق المطابقة."""
    parties: str = 'suppliers'
    project: Optional[str] = None
    noteCode: str
    noteText: Optional[str] = None

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

    from_date = parse_date(from_, 'تاريخ البداية')
    return cashflow_service.cashflow(db, weeks=weeks, from_date=from_date,
                                     opening_balance=opening_balance, project=project,
                                     parties=parties, period_days=period_days)


@router.get('/breakdown')
def cashflow_breakdown(term: str = Query(..., pattern='^(scheduled|overdue|undated|beyond|collected|forecast)$'),
                       period: Optional[str] = Query(None),
                       weeks: int = Query(26, ge=1, le=104),
                       from_: Optional[str] = Query(None, alias='from'),
                       project: Optional[str] = Query(None),
                       parties: str = Query('suppliers', pattern='^(suppliers|contractors|both)$'),
                       period_days: Optional[int] = Query(None),
                       db: Session = Depends(get_session)) -> dict:
    """الصفوف الفعلية وراء أي رقم في /cashflow — إجابة «من أين جاء هذا الرقم؟».

    `period` — تاريخ بداية دلو محدد من استجابة /cashflow (`periods[i].from`) لقصر
    scheduled/collected/forecast على تلك الفترة وحدها؛ يُهمَل لبقية المصطلحات
    (overdue/undated/beyond) ولا يوجد له معنى فيها.
    """
    if period_days is None:
        period_days = 14
    if not (1 <= period_days <= 92):
        raise HTTPException(status_code=422, detail='طول الفترة بين ١ و٩٢ يوماً')
    from_date = parse_date(from_, 'تاريخ البداية')
    period_date = parse_date(period, 'الفترة')
    return cashflow_service.breakdown(db, term=term, project=project, parties=parties,
                                      weeks=weeks, from_date=from_date, period_days=period_days,
                                      period=period_date)


@router.post('/reconciliation-note')
def save_cashflow_reconciliation_note(body: ReconciliationNoteIn,
                                      db: Session = Depends(get_session)) -> dict:
    """يحفظ تفسير المستخدم لفرق المطابقة (سطر «فرق غير مفسَّر») حتى لا يُسأل عنه مرة
    أخرى في نفس نطاق الأطراف/المشروع — انظر cashflow_service.save_reconciliation_note."""
    if body.parties not in ('suppliers', 'contractors', 'both'):
        raise HTTPException(status_code=422, detail='الأطراف غير معروفة')
    if not body.noteCode:
        raise HTTPException(status_code=422, detail='سبب الفرق مطلوب')
    return cashflow_service.save_reconciliation_note(
        db, parties=body.parties, project=body.project,
        note_code=body.noteCode, note_text=body.noteText)
