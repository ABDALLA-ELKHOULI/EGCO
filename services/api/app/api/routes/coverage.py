# -*- coding: utf-8 -*-
"""تغطية البيانات — checklist screen showing which suppliers still need statements."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import coverage_service

router = APIRouter()


@router.get('')
def get_coverage(stale_days: int = Query(90, gt=0),
                 db: Session = Depends(get_session)) -> dict:
    return coverage_service.coverage(db, stale_days=stale_days)
