# -*- coding: utf-8 -*-
"""بحث الأطراف لمنتقي «إضافة طرف» في صفحة المشروع (م-٥٠)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import project_registry_service as PR

router = APIRouter()


@router.get('/search')
def search(q: Optional[str] = Query(None), type: Optional[str] = Query(None),
           limit: int = Query(20, ge=1, le=200), db: Session = Depends(get_session)) -> list:
    if type not in (None, '', 'supplier', 'contractor'):
        raise HTTPException(422, detail='نوع الطرف يجب أن يكون supplier أو contractor')
    return PR.search_parties(db, q, type, limit)
