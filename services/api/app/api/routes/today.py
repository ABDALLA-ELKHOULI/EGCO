# -*- coding: utf-8 -*-
"""الصفحة الرئيسية بطلب واحد — API-CONTRACT.md §٢."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import today_service

router = APIRouter()


@router.get('')
def today(db: Session = Depends(get_session)) -> dict:
    return today_service.today_json(db)
