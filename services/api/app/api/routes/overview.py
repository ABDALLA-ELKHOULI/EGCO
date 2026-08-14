# -*- coding: utf-8 -*-
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import overview_service

router = APIRouter()


@router.get('')
def overview(db: Session = Depends(get_session)) -> dict:
    """مركز القيادة — كل شيء في شاشة واحدة."""
    return overview_service.overview(db)
