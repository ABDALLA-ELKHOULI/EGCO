# -*- coding: utf-8 -*-
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import projects_service

router = APIRouter()


def _parse_date(s: Optional[str], label: str) -> Optional[dt.date]:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, detail=f'{label} غير صالح: {s}')


@router.get('')
def list_projects(q: Optional[str] = Query(None),
                  date_from: Optional[str] = Query(None),
                  date_to: Optional[str] = Query(None),
                  min_outstanding: Optional[float] = Query(None),
                  db: Session = Depends(get_session)) -> dict:
    """قائمة المشاريع مع إجماليات كل مشروع."""
    df = _parse_date(date_from, 'تاريخ البداية')
    dtt = _parse_date(date_to, 'تاريخ النهاية')
    if df is not None and dtt is not None and df > dtt:
        raise HTTPException(422, detail='تاريخ البداية يجب أن يسبق تاريخ النهاية')
    return projects_service.list_projects(db, q=q, date_from=df, date_to=dtt,
                                          min_outstanding=min_outstanding)


@router.get('/{project}')
def project_detail(project: str, db: Session = Depends(get_session)) -> dict:
    """تفاصيل مشروع — الموردون وجدول الاستحقاقات."""
    row = projects_service.project_detail(db, project)
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مشروع باسم {project}')
    return row
