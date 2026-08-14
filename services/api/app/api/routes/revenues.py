# -*- coding: utf-8 -*-
"""التحصيلات (الإيراد) — إدخال يدوي يكمّل الاستيراد من الملفات.

سجلات هذا المسار تحمل source='manual'. سجلات الاستيراد (source='receivables_legacy_html'
أو 'receivables_excel') قابلة للتعديل والحذف من هنا أيضاً — البيانات ملك المستخدم — لكن
حقل source نفسه لا يتغيّر، حتى تبقى قابلة للتمييز في الواجهة وتقرير الاستيراد.

قاعدة الاتساق بين status و collected_on هي نفسها في كل مكان: 'collected' بلا تاريخ تحصيل
غير منطقي، وتاريخ تحصيل بلا status='collected' غير منطقي — فنُطبّع أحدهما من الآخر بدل
رفض الطلب كلما أمكن، ونرفض فقط الحالة المتناقضة صراحة (collected بلا تاريخ).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.schemas.common import RevenueIn, RevenueUpdate

router = APIRouter()


def _parse_date(s: Optional[str]) -> Optional[dt.date]:
    if not s:
        return None
    return dt.date.fromisoformat(s)


def _out(row: models.Receivable) -> dict:
    return dict(
        id=row.id, project=row.project, unit=row.unit, client=row.client,
        amount=row.amount,
        dueDate=row.due_date.isoformat() if row.due_date else None,
        collectedOn=row.collected_on.isoformat() if row.collected_on else None,
        status=row.status, source=row.source or 'manual', notes=row.notes,
        createdAt=row.created_at.isoformat() if row.created_at else None,
    )


@router.get('')
def list_revenues(q: Optional[str] = Query(None), project: Optional[str] = Query(None),
                  status: Optional[str] = Query(None),
                  db: Session = Depends(get_session)) -> dict:
    base_q = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None))
    if project:
        base_q = base_q.filter(models.Receivable.project == project)
    # totals/projects reflect the project scope but not the status filter, so the KPI
    # strip and selector stay stable while the user flips between statuses
    scoped_rows = base_q.all()

    rows = scoped_rows
    if status:
        rows = [r for r in rows if r.status == status]
    if q:
        needle = q.strip()
        rows = [r for r in rows if needle in (r.client or '') or needle in (r.unit or '')]

    # newest due first, undated last
    rows.sort(key=lambda r: (r.due_date is None, r.due_date and -r.due_date.toordinal() or 0))

    projects = sorted({r.project for r in
                       db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None)).all()
                       if r.project})

    totals = dict(
        open=sum(r.amount for r in scoped_rows if r.status == 'open'),
        collected=sum(r.amount for r in scoped_rows if r.status == 'collected'),
        all=sum(r.amount for r in scoped_rows),
    )

    return dict(count=len(rows), rows=[_out(r) for r in rows], totals=totals, projects=projects)


def _validate_status_coherence(status: str, collected_on: Optional[dt.date]) -> None:
    if status == 'collected' and collected_on is None:
        raise HTTPException(422, detail='حدد تاريخ التحصيل')


@router.post('', status_code=201)
def create_revenue(body: RevenueIn, db: Session = Depends(get_session)) -> dict:
    collected_on = _parse_date(body.collected_on)
    due_date = _parse_date(body.due_date)
    status = body.status or 'open'

    if collected_on is not None:
        status = 'collected'
    _validate_status_coherence(status, collected_on)

    row = models.Receivable(
        project=body.project or '', unit=body.unit or '', client=body.client,
        amount=body.amount, due_date=due_date, collected_on=collected_on,
        status=status, source='manual', notes=body.notes or '',
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.put('/{revenue_id}')
def update_revenue(revenue_id: str, body: RevenueUpdate,
                   db: Session = Depends(get_session)) -> dict:
    row = db.query(models.Receivable).filter_by(id=revenue_id).filter(
        models.Receivable.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail='لا يوجد تحصيل بهذا المعرّف')

    fields = body.dict(exclude_unset=True, by_alias=False)

    if 'project' in fields:
        row.project = fields['project'] or ''
    if 'unit' in fields:
        row.unit = fields['unit'] or ''
    if 'client' in fields and fields['client'] is not None:
        row.client = fields['client']
    if 'amount' in fields and fields['amount'] is not None:
        row.amount = fields['amount']
    if 'notes' in fields:
        row.notes = fields['notes'] or ''
    if 'due_date' in fields:
        row.due_date = _parse_date(fields['due_date'])
    if 'collected_on' in fields:
        row.collected_on = _parse_date(fields['collected_on'])
    if 'status' in fields and fields['status'] is not None:
        row.status = fields['status']

    # normalise / validate coherence after applying the partial update
    if 'collected_on' in fields and row.collected_on is not None and 'status' not in fields:
        row.status = 'collected'
    if 'status' in fields and fields['status'] == 'open' and 'collected_on' not in fields:
        row.collected_on = None

    _validate_status_coherence(row.status, row.collected_on)

    db.commit()
    db.refresh(row)
    return _out(row)


@router.delete('/{revenue_id}')
def delete_revenue(revenue_id: str, db: Session = Depends(get_session)) -> dict:
    row = db.query(models.Receivable).filter_by(id=revenue_id).filter(
        models.Receivable.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail='لا يوجد تحصيل بهذا المعرّف')
    row.deleted_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return dict(deleted=True)
