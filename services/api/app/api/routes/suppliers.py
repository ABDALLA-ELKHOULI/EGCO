# -*- coding: utf-8 -*-
from typing import Optional
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import parse_date
from app.db import models
from app.db.session import get_session
from app.domain.payables import parse_term, money
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


_VALID_STATUSES = ('awaiting_date', 'overdue', 'due_soon', 'open', 'clear')


def _parse_filter_date(s: Optional[str], label: str) -> Optional[dt.date]:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, detail=f'{label} غير صالح: {s}')


@router.get('')
def list_suppliers(q: Optional[str] = Query(None),
                   project: Optional[str] = Query(None),
                   status: Optional[str] = Query(None),
                   date_from: Optional[str] = Query(None),
                   date_to: Optional[str] = Query(None),
                   min_outstanding: Optional[float] = Query(None),
                   max_outstanding: Optional[float] = Query(None),
                   overdue_only: bool = Query(False),
                   has_data: Optional[bool] = Query(None),
                   db: Session = Depends(get_session)) -> dict:
    """قائمة الموردين مع حالتهم — filtering happens after positions are computed,
    because status depends on the calculation, not on a stored column.

    Totals always reflect the applied filters, over the FULL filtered set (not just the
    rows shown) — one code path computes both."""
    if status is not None and status not in _VALID_STATUSES:
        raise HTTPException(422, detail=f'قيمة حالة غير صالحة: {status} — '
                                        f'المسموح: {", ".join(_VALID_STATUSES)}')
    df = _parse_filter_date(date_from, 'تاريخ البداية')
    dtt = _parse_filter_date(date_to, 'تاريخ النهاية')
    if df is not None and dtt is not None and df > dtt:
        raise HTTPException(422, detail='تاريخ البداية يجب أن يسبق تاريخ النهاية')
    if (min_outstanding is not None and max_outstanding is not None
            and min_outstanding > max_outstanding):
        raise HTTPException(422, detail='الحد الأدنى للرصيد يجب ألا يتجاوز الحد الأقصى')

    ps = PS.positions(db, include_empty=True)
    rows = []
    matched = []
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
        if min_outstanding is not None and p.outstanding < Decimal(str(min_outstanding)):
            continue
        if max_outstanding is not None and p.outstanding > Decimal(str(max_outstanding)):
            continue
        if overdue_only and p.overdue <= 0:
            continue
        if has_data is not None:
            has_movement = bool(p.invoices or p.payments)
            if has_movement != has_data:
                continue
        d = PS.position_json(p)
        d['status'] = st
        sid = supplier_ids.get(p.supplier.account)
        first_act, last_act = _activity(db, sid) if sid else (None, None)
        d['firstActivity'] = first_act
        d['lastActivity'] = last_act
        rows.append(d)
        matched.append(p)

    rows.sort(key=lambda r: (-r['overdue'], -r['outstanding'], r['name']))
    projects = sorted({s.project for s in db.query(models.Supplier).filter(
        models.Supplier.deleted_at.is_(None)).all() if s.project})
    # Sum the Decimal positions, not the already-rounded per-row floats — summing
    # money()-rounded floats can drift by fractions of a piaster from the exact total
    # (e.g. 5611014.100000001), disagreeing with dashboard/overview/projects which all
    # sum Decimals before rounding once at the boundary.
    zero = Decimal('0')
    totals = dict(
        count=len(matched),
        invoiced=money(sum((p.total_invoiced for p in matched), zero)),
        paid=money(sum((p.total_paid for p in matched), zero)),
        outstanding=money(sum((p.outstanding for p in matched), zero)),
        overdue=money(sum((p.overdue for p in matched), zero)),
        dueWithin7=money(sum((p.due_within_7 for p in matched), zero)),
        creditBalances=money(sum((p.credit_balance for p in matched), zero)),
    )
    if df is not None or dtt is not None:
        opening = invoiced_p = paid_p = closing = zero
        for p in matched:
            b = PS.period_breakdown(p, df, dtt)
            opening += b['opening']
            invoiced_p += b['invoiced_in_period']
            paid_p += b['paid_in_period']
            closing += b['closing']
        totals['openingBalance'] = money(opening)
        totals['invoicedInPeriod'] = money(invoiced_p)
        totals['paidInPeriod'] = money(paid_p)
        totals['closingBalance'] = money(closing)

    filters_applied = dict(q=q, project=project, status=status, dateFrom=date_from,
                           dateTo=date_to, minOutstanding=min_outstanding,
                           maxOutstanding=max_outstanding, overdueOnly=overdue_only,
                           hasData=has_data)
    return dict(count=len(rows), rows=rows, projects=projects, totals=totals,
               filtersApplied=filters_applied)


@router.get('/{account}')
def supplier_detail(account: str,
                    date_from: Optional[str] = Query(None),
                    date_to: Optional[str] = Query(None),
                    db: Session = Depends(get_session)) -> dict:
    """كشف مورد — invoices, payments, ageing."""
    ps = PS.positions(db, account=account)
    if not ps:
        raise HTTPException(404, detail=f'لا يوجد مورد بالحساب {account}')
    df = parse_date(date_from, 'تاريخ البداية')
    dtt = parse_date(date_to, 'تاريخ النهاية')
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
