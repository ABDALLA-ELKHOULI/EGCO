# -*- coding: utf-8 -*-
"""الموازنة — لقطات تقارير انحراف الموازنة التقديرية حسب المشروع.

العقد ثابت في docs/feedback/PLAN-BUDGET.md §٤ — وكلاء الواجهة يبنون عليه بلا
انتظار. لا تُغيَّر أسماء الحقول هنا بلا تنسيق.
"""
import datetime as dt
import io
import os
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.ingest.budget_xlsx import BudgetParseError
from app.schemas.budget import BudgetSnapshotIn, CommentIn, ProjectCityIn
from app.services import budget_service
from app.services import export_service as ES

router = APIRouter()


class ImportRequest(BaseModel):
    path: str


class PreviewRequest(BaseModel):
    project: str
    month: str
    actualMonth: float = 0.0
    plannedMonth: float = 0.0


@router.get('')
def budget_list(project: Optional[str] = None, city: Optional[str] = None,
               from_month: Optional[str] = None, to_month: Optional[str] = None,
               status: Optional[str] = None, has_claims: Optional[bool] = None,
               db: Session = Depends(get_session)) -> dict:
    """القائمة المفلترة على الخادم — العقد القاطع في PLAN-BUDGET §٤."""
    return budget_service.budget_list_json(
        db, project=project, city=city, from_month=from_month, to_month=to_month,
        status=status, has_claims=has_claims)


@router.get('/overview')
def budget_overview(db: Session = Depends(get_session)) -> dict:
    """الشكل القديم {projects:[...]}} — مبقى للتوافق الخلفي فقط."""
    return budget_service.overview(db)


@router.get('/project/{name}')
def budget_project(name: str, from_month: Optional[str] = None,
                   to_month: Optional[str] = None,
                   db: Session = Depends(get_session)) -> dict:
    """لقطات مشروع واحد + مقاولوه (مصدر منفصل — لا يُدمج بالموازنة)."""
    row = budget_service.project_detail(db, name, from_month=from_month, to_month=to_month)
    if row is None:
        raise HTTPException(404, detail=f'لا توجد لقطات موازنة لمشروع {name}')
    return row


@router.post('/preview')
def budget_preview(body: PreviewRequest, db: Session = Depends(get_session)) -> dict:
    """يحسب الأثر ويكتشف التعارض بلا أي كتابة."""
    return budget_service.preview(db, body.project, body.month,
                                  body.actualMonth, body.plannedMonth)


@router.post('')
def budget_create(body: BudgetSnapshotIn, db: Session = Depends(get_session)) -> dict:
    """إنشاء شهر يدوياً (entry_source='manual'). يرفض الكتابة عند تعارض غير
    مؤكَّد — يعيد {conflict, saved:false} بدل الكتابة الصامتة."""
    result = budget_service.upsert_manual(
        db, body.project, body.month, body.actualMonth, body.plannedMonth,
        [c.model_dump() for c in body.claims], body.docNo, body.issuedOn,
        body.notes, force_conflict=body.forceConflict, attachment=body.attachment)
    return result


@router.put('/{snapshot_id}')
def budget_update(snapshot_id: str, body: BudgetSnapshotIn,
                  db: Session = Depends(get_session)) -> dict:
    """تعديل شهر قائم + إعادة بناء السلسلة."""
    try:
        return budget_service.upsert_manual(
            db, body.project, body.month, body.actualMonth, body.plannedMonth,
            [c.model_dump() for c in body.claims], body.docNo, body.issuedOn,
            body.notes, snapshot_id=snapshot_id, force_conflict=body.forceConflict,
            attachment=body.attachment)
    except ValueError as e:
        raise HTTPException(404, detail=str(e))


@router.delete('/{snapshot_id}')
def budget_delete(snapshot_id: str, db: Session = Depends(get_session)) -> dict:
    """حذف منطقي + إعادة بناء ما بعده."""
    ok = budget_service.delete_snapshot(db, snapshot_id)
    if not ok:
        raise HTTPException(404, detail='السجل غير موجود')
    return dict(deleted=True)


@router.post('/{snapshot_id}/comments')
def budget_add_comment(snapshot_id: str, body: CommentIn,
                       db: Session = Depends(get_session)) -> dict:
    return budget_service.add_comment(db, snapshot_id, body.text)


@router.get('/{snapshot_id}/comments')
def budget_list_comments(snapshot_id: str, db: Session = Depends(get_session)) -> dict:
    return dict(comments=budget_service.list_comments(db, snapshot_id))


@router.delete('/{snapshot_id}/comments/{comment_id}')
def budget_delete_comment(snapshot_id: str, comment_id: str,
                          db: Session = Depends(get_session)) -> dict:
    ok = budget_service.delete_comment(db, comment_id)
    if not ok:
        raise HTTPException(404, detail='التعليق غير موجود')
    return dict(deleted=True)


@router.put('/project/{name}/city')
def budget_set_city(name: str, body: ProjectCityIn, db: Session = Depends(get_session)) -> dict:
    return budget_service.set_project_city(db, name, body.city)


@router.post('/import')
def budget_import(req: ImportRequest, db: Session = Depends(get_session)) -> dict:
    """استيراد ملف تقرير انحراف الموازنة (xlsx)."""
    if not os.path.exists(req.path):
        raise HTTPException(404, detail=f'الملف غير موجود: {req.path}')
    try:
        return budget_service.import_budget(db, req.path)
    except BudgetParseError as e:
        raise HTTPException(422, detail=str(e))


@router.get('/export.xlsx')
def budget_export_xlsx(project: Optional[str] = None, city: Optional[str] = None,
                       from_month: Optional[str] = None, to_month: Optional[str] = None,
                       status: Optional[str] = None, has_claims: Optional[bool] = None,
                       db: Session = Depends(get_session)):
    """تصدير Excel — بنفس فلاتر GET /budget بالضبط، لا الدفتر كاملاً (قاعدة
    ثابتة في هذا المشروع، انظر export_suppliers_xlsx/export_contractors_xlsx
    وPLAN-BUDGET §٥-٤). يستدعي budget_list_json مباشرةً حتى يبقى مسار تصفية
    واحد يُثق بنتائجه في الشاشة والملف معاً."""
    data = budget_service.budget_list_json(
        db, project=project, city=city, from_month=from_month, to_month=to_month,
        status=status, has_claims=has_claims)
    filters_label = ES.budget_filters_label(data['filtersApplied'])
    buf_bytes = ES.build_budget_export_workbook(data, filters_label, db,
                                                filters=data['filtersApplied'])
    buf = io.BytesIO(buf_bytes)
    today = dt.date.today()
    ascii_name = f'EGCO-budget-{today:%Y%m%d}.xlsx'
    encoded = quote(f'EGCO-الموازنة-{today:%Y%m%d}.xlsx', safe='')
    headers = {'Content-Disposition':
              f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"}
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers=headers,
    )
