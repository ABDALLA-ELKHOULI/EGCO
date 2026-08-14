# -*- coding: utf-8 -*-
"""مسارات ضمانات المقاولين — كشوف حساب الضمان (٢١٦) + مطابقتها بضمانات المقاولين."""
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import guarantees_service as GS
from fastapi import Depends

router = APIRouter()


@router.get('')
def list_guarantees(db: Session = Depends(get_session)):
    return GS.list_page(db)


@router.get('/{account}')
def guarantee_account_detail(account: str, db: Session = Depends(get_session)):
    row = GS.account_detail(db, account)
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد حساب ضمان بالرقم {account}')
    return row
