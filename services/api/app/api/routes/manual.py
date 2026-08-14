# -*- coding: utf-8 -*-
"""المديونية المستحقة اليدوية — manual invoices/payments, not from a statement.

Rows created here carry source='manual'. Rows with source='statement' are protected —
editing or deleting them here would break reconciliation with the imported statement,
so those requests are rejected with 403.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import parse_date
from app.db import models
from app.db.session import get_session
from app.domain.payables import Term, due_date as _due_date
from app.services import payables_service as PS
from app.schemas.common import InvoiceIn, InvoiceUpdate, PaymentIn

router = APIRouter()


def _get_supplier(db: Session, account: str) -> models.Supplier:
    row = db.query(models.Supplier).filter_by(account=account).filter(
        models.Supplier.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مورد بالحساب {account}')
    return row


def _resolve_due_date(supplier: models.Supplier, invoice_date: dt.date,
                      due_date_in: str = None):
    """Returns the value to store in `manual_due_date` (None means: derive from term
    at read time, using the normal invoice-date + term-days rule)."""
    if due_date_in:
        return parse_date(due_date_in, 'تاريخ الاستحقاق')
    term = Term(days=supplier.term_days, kind=supplier.term_kind, raw=supplier.term_raw)
    if term.is_claim:
        raise HTTPException(422, detail='مدة المورد «مستخلص» — يلزم إدخال تاريخ الاستحقاق يدوياً')
    return None


@router.post('/invoices', status_code=201)
def create_invoice(body: InvoiceIn, db: Session = Depends(get_session)) -> dict:
    supplier = _get_supplier(db, body.account)
    inv_date = parse_date(body.date, 'تاريخ الفاتورة', required=True)
    manual_due = _resolve_due_date(supplier, inv_date, body.due_date)

    row = models.Invoice(supplier_id=supplier.id, date=inv_date, amount=body.amount,
                         doc=body.reference or '', description=body.description,
                         manual_due_date=manual_due, source='manual')
    db.add(row)
    db.commit()
    db.refresh(row)
    return _invoice_out(row)


@router.put('/invoices/{invoice_id}')
def update_invoice(invoice_id: str, body: InvoiceUpdate,
                   db: Session = Depends(get_session)) -> dict:
    row = db.query(models.Invoice).filter_by(id=invoice_id).filter(
        models.Invoice.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail='لا توجد فاتورة بهذا المعرّف')
    if row.source != 'manual':
        raise HTTPException(403, detail='لا يمكن تعديل حركة مستوردة من كشف حساب')

    supplier = db.query(models.Supplier).filter_by(id=row.supplier_id).one()
    if body.amount is not None:
        row.amount = body.amount
    if body.date is not None:
        row.date = parse_date(body.date, 'تاريخ الفاتورة', required=True)
    if body.description is not None:
        row.description = body.description
    if body.reference is not None:
        row.doc = body.reference
    if body.due_date is not None:
        row.manual_due_date = parse_date(body.due_date, 'تاريخ الاستحقاق')
    elif supplier.term_kind == 'claim' and row.manual_due_date is None:
        raise HTTPException(422, detail='مدة المورد «مستخلص» — يلزم إدخال تاريخ الاستحقاق يدوياً')

    db.commit()
    db.refresh(row)
    return _invoice_out(row)


@router.delete('/invoices/{invoice_id}')
def delete_invoice(invoice_id: str, db: Session = Depends(get_session)) -> dict:
    row = db.query(models.Invoice).filter_by(id=invoice_id).filter(
        models.Invoice.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail='لا توجد فاتورة بهذا المعرّف')
    if row.source != 'manual':
        raise HTTPException(403, detail='لا يمكن حذف حركة مستوردة من كشف حساب')
    row.deleted_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return dict(deleted=True)


@router.post('/payments', status_code=201)
def create_payment(body: PaymentIn, db: Session = Depends(get_session)) -> dict:
    supplier = _get_supplier(db, body.account)
    row = models.Payment(supplier_id=supplier.id,
                         date=parse_date(body.date, 'تاريخ الدفعة', required=True),
                         amount=body.amount, doc=body.reference or '',
                         description=body.description, source='manual')
    db.add(row)
    db.commit()
    db.refresh(row)
    return dict(id=row.id, account=supplier.account, date=row.date.isoformat(),
                amount=row.amount, doc=row.doc, description=row.description,
                source=row.source)


@router.delete('/payments/{payment_id}')
def delete_payment(payment_id: str, db: Session = Depends(get_session)) -> dict:
    row = db.query(models.Payment).filter_by(id=payment_id).filter(
        models.Payment.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail='لا توجد دفعة بهذا المعرّف')
    if row.source != 'manual':
        raise HTTPException(403, detail='لا يمكن حذف حركة مستوردة من كشف حساب')
    row.deleted_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return dict(deleted=True)


def _invoice_out(row: models.Invoice) -> dict:
    supplier = row.supplier
    return dict(id=row.id, account=supplier.account, date=row.date.isoformat(),
                amount=row.amount, description=row.description, doc=row.doc,
                dueDate=row.manual_due_date.isoformat() if row.manual_due_date else None,
                source=row.source)
