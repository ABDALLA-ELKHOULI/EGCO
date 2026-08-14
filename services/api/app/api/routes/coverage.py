# -*- coding: utf-8 -*-
"""تغطية البيانات — checklist screen showing which suppliers still need statements."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import coverage_service

router = APIRouter()

_VALID_STATES = ('none', 'stale', 'ok')


@router.get('')
def get_coverage(stale_days: int = Query(90, gt=0),
                 q: Optional[str] = Query(None),
                 project: Optional[str] = Query(None),
                 state: Optional[str] = Query(None),
                 db: Session = Depends(get_session)) -> dict:
    if state is not None and state not in _VALID_STATES:
        raise HTTPException(422, detail=f'قيمة حالة غير صالحة: {state} — '
                                        f'المسموح: {", ".join(_VALID_STATES)}')
    return coverage_service.coverage(db, stale_days=stale_days, q=q, project=project, state=state)
