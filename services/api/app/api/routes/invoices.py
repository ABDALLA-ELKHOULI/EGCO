# -*- coding: utf-8 -*-
"""إصلاح تاريخ استحقاق المستخلص — the ONLY mutation permitted on a statement-sourced
invoice row. The due date is not part of the reconciliation identity (amount/date/
description are, and stay immutable — see app/api/routes/manual.py), so overriding it
here cannot desync a saved statement from the balance it reconciled against.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.domain.payables import Term, due_date as _due_date
from app.schemas.common import DueDateUpdate

router = APIRouter()


def _invoice_out(row: models.Invoice) -> dict:
    supplier = row.supplier
    term = Term(days=supplier.term_days, kind=supplier.term_kind, raw=supplier.term_raw)
    due = row.manual_due_date or _due_date(row.date, term)
    return dict(id=row.id, number=row.number, date=row.date.isoformat(),
                amount=row.amount, dueDate=due.isoformat() if due else None,
                source=row.source, doc=row.doc, description=row.description)


@router.put('/{invoice_id}/due-date')
def update_due_date(invoice_id: str, body: DueDateUpdate,
                    db: Session = Depends(get_session)) -> dict:
    row = db.query(models.Invoice).filter_by(id=invoice_id).filter(
        models.Invoice.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail='لا توجد فاتورة بهذا المعرّف')

    row.manual_due_date = dt.date.fromisoformat(body.due_date) if body.due_date else None
    db.commit()
    db.refresh(row)
    return _invoice_out(row)
