# -*- coding: utf-8 -*-
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import projects_service

router = APIRouter()


@router.get('')
def list_projects(db: Session = Depends(get_session)) -> dict:
    """قائمة المشاريع مع إجماليات كل مشروع."""
    return projects_service.list_projects(db)


@router.get('/{project}')
def project_detail(project: str, db: Session = Depends(get_session)) -> dict:
    """تفاصيل مشروع — الموردون وجدول الاستحقاقات."""
    row = projects_service.project_detail(db, project)
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مشروع باسم {project}')
    return row
