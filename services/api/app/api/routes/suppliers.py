# -*- coding: utf-8 -*-
from typing import Optional
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.domain.payables import parse_term
from app.schemas.common import SupplierIn, SupplierUpdate
from app.services import payables_service as PS

router = APIRouter()


def _activity(db: Session, supplier_id: str):
    dates = []
    for i in db.query(models.Invoice.date).filter_by(supplier_id=supplier_id,
                                                       deleted_at=None).all():
        dates.append(i[0])
    for p in db.query(models.Payment.date).filter_by(supplier_id=supplier_id,
                                                       deleted_at=None).all():
        dates.append(p[0])
    if not dates:
        return None, None
    return min(dates).isoformat(), max(dates).isoformat()


@router.get('')
def list_suppliers(q: Optional[str] = Query(None),
                   project: Optional[str] = Query(None),
                   status: Optional[str] = Query(None),
                   db: Session = Depends(get_session)) -> dict:
    """قائمة الموردين مع حالتهم — filtering happens after positions are computed,
    because status depends on the calculation, not on a stored column."""
    ps = PS.positions(db, include_empty=True)
    rows = []
    supplier_ids = {row.account: row.id for row in
                    db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None)).all()}
    for p in ps:
        st = PS.status_of(p)
        if status and st != status:
            continue
        if project and p.supplier.project != project:
            continue
        if q:
            needle = q.strip()
            if needle not in p.supplier.name and needle not in p.supplier.account:
                continue
        d = PS.position_json(p)
        d['status'] = st
        sid = supplier_ids.get(p.supplier.account)
        first_act, last_act = _activity(db, sid) if sid else (None, None)
        d['firstActivity'] = first_act
        d['lastActivity'] = last_act
        rows.append(d)

    rows.sort(key=lambda r: (-r['overdue'], -r['outstanding'], r['name']))
    projects = sorted({s.project for s in db.query(models.Supplier).all() if s.project})
    return dict(count=len(rows), rows=rows, projects=projects,
                totals=dict(outstanding=sum(r['outstanding'] for r in rows),
                            overdue=sum(r['overdue'] for r in rows)))


@router.get('/{account}')
def supplier_detail(account: str,
                    date_from: Optional[str] = Query(None),
                    date_to: Optional[str] = Query(None),
                    db: Session = Depends(get_session)) -> dict:
    """كشف مورد — invoices, payments, ageing."""
    ps = PS.positions(db, account=account)
    if not ps:
        raise HTTPException(404, detail=f'لا يوجد مورد بالحساب {account}')
    df = dt.date.fromisoformat(date_from) if date_from else None
    dtt = dt.date.fromisoformat(date_to) if date_to else None
    d = PS.position_json(ps[0], detail=True, date_from=df, date_to=dtt)
    d['status'] = PS.status_of(ps[0])
    return d


@router.post('', status_code=201)
def create_supplier(body: SupplierIn, db: Session = Depends(get_session)) -> dict:
    """إضافة مورد يدوياً."""
    exists = db.query(models.Supplier).filter_by(account=body.account).one_or_none()
    if exists is not None and exists.deleted_at is None:
        raise HTTPException(409, detail=f'يوجد مورد بالفعل بالحساب {body.account}')
    term = parse_term(body.term)
    if exists is not None:
        # previously soft-deleted — resurrect
        row = exists
        row.deleted_at = None
    else:
        row = models.Supplier(account=body.account)
        db.add(row)
    row.name = body.name
    row.project = body.project
    row.term_raw = term.raw
    row.term_kind = term.kind
    row.term_days = term.days
    db.commit()
    db.refresh(row)
    return dict(account=row.account, name=row.name, project=row.project,
                term=row.term_raw or 'كاش', termKind=row.term_kind, termDays=row.term_days)


@router.put('/{account}')
def update_supplier(account: str, body: SupplierUpdate,
                    db: Session = Depends(get_session)) -> dict:
    """تعديل بيانات مورد — رقم الحساب ثابت."""
    row = db.query(models.Supplier).filter_by(account=account).filter(
        models.Supplier.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مورد بالحساب {account}')
    if body.name is not None:
        row.name = body.name
    if body.project is not None:
        row.project = body.project
    if body.term is not None:
        term = parse_term(body.term)
        row.term_raw = term.raw
        row.term_kind = term.kind
        row.term_days = term.days
    db.commit()
    db.refresh(row)
    return dict(account=row.account, name=row.name, project=row.project,
                term=row.term_raw or 'كاش', termKind=row.term_kind, termDays=row.term_days)


@router.delete('/{account}')
def delete_supplier(account: str, force: bool = Query(False),
                    db: Session = Depends(get_session)) -> dict:
    """حذف مورد (حذف منطقي). إن كان له فواتير/دفعات، يُرفض إلا مع force=true."""
    row = db.query(models.Supplier).filter_by(account=account).filter(
        models.Supplier.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مورد بالحساب {account}')

    has_invoices = db.query(models.Invoice).filter_by(
        supplier_id=row.id, deleted_at=None).first() is not None
    has_payments = db.query(models.Payment).filter_by(
        supplier_id=row.id, deleted_at=None).first() is not None

    if (has_invoices or has_payments) and not force:
        raise HTTPException(409, detail='لا يمكن حذف المورد لوجود فواتير أو دفعات مسجلة له — '
                                        'استخدم force=true للحذف مع الإبقاء على السجلات')

    row.deleted_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return dict(deleted=True)
