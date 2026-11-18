# -*- coding: utf-8 -*-
"""إعدادات مالية — الرصيد البنكي."""
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import settings_service as SS
from app.services.money_wire import parse_money

router = APIRouter()


@router.get('/bank-balance')
def get_bank_balance(db: Session = Depends(get_session)) -> dict:
    return SS.bank_balance_json(db)


@router.put('/bank-balance')
def put_bank_balance(body: dict = Body(...), db: Session = Depends(get_session)) -> dict:
    try:
        value = parse_money(body.get('balance'), allow_negative=True)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    return SS.set_bank_balance(db, value)
