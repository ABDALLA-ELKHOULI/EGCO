# -*- coding: utf-8 -*-
"""الموازنة — لقطات تقارير انحراف الموازنة التقديرية حسب المشروع."""
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.ingest.budget_xlsx import BudgetParseError
from app.services import budget_service

router = APIRouter()


class ImportRequest(BaseModel):
    path: str


@router.get('')
def budget_overview(db: Session = Depends(get_session)) -> dict:
    """نظرة عامة — كل المشاريع مع لقطات الشهور واتجاه التأخر."""
    return budget_service.overview(db)


@router.get('/project/{name}')
def budget_project(name: str, db: Session = Depends(get_session)) -> dict:
    """لقطات موازنة مشروع واحد."""
    row = budget_service.project_detail(db, name)
    if row is None:
        raise HTTPException(404, detail=f'لا توجد لقطات موازنة لمشروع {name}')
    return row


@router.post('/import')
def budget_import(req: ImportRequest, db: Session = Depends(get_session)) -> dict:
    """استيراد ملف تقرير انحراف الموازنة (xlsx)."""
    if not os.path.exists(req.path):
        raise HTTPException(404, detail=f'الملف غير موجود: {req.path}')
    try:
        return budget_service.import_budget(db, req.path)
    except BudgetParseError as e:
        raise HTTPException(422, detail=str(e))
