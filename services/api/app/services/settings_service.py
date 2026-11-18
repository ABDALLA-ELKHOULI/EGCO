# -*- coding: utf-8 -*-
"""إعدادات مالية عامة — الرصيد البنكي حالياً.

يُخزَّن في app_settings نصاً Decimal مع وقت إدخاله: رصيد بنكي بلا تاريخ رقمٌ لا
يُعرف هل ما زال صادقاً. NULL/غياب = «لم يُدخل» — ولا يُعامل كصفر في أي عرض؛
الإسقاط النقدي يبدأ من صفر حينها لكنه يقول ذلك صراحةً (cashBasis).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.db import models
from app.services.money_wire import money_str_or_none

BANK_BALANCE_KEY = 'bank_balance'
BANK_BALANCE_AT_KEY = 'bank_balance_at'


def _get(db: Session, key: str) -> Optional[str]:
    row = db.query(models.AppSetting).filter_by(key=key).one_or_none()
    if row is None or row.deleted_at is not None or row.value in (None, ''):
        return None
    return row.value


def _set(db: Session, key: str, value: Optional[str]) -> None:
    row = db.query(models.AppSetting).filter_by(key=key).one_or_none()
    if row is None:
        row = models.AppSetting(key=key)
        db.add(row)
    row.value = value or ''


def bank_balance(db: Session) -> Optional[Decimal]:
    v = _get(db, BANK_BALANCE_KEY)
    return Decimal(v) if v is not None else None


def bank_balance_json(db: Session) -> dict:
    return dict(balance=money_str_or_none(bank_balance(db)), at=_get(db, BANK_BALANCE_AT_KEY))


def set_bank_balance(db: Session, value: Optional[Decimal]) -> dict:
    if value is None:
        _set(db, BANK_BALANCE_KEY, None)
        _set(db, BANK_BALANCE_AT_KEY, None)
    else:
        _set(db, BANK_BALANCE_KEY, str(value))
        _set(db, BANK_BALANCE_AT_KEY, dt.datetime.now().replace(microsecond=0).isoformat())
    db.commit()
    return bank_balance_json(db)
