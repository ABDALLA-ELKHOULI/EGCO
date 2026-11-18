# -*- coding: utf-8 -*-
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import project_registry_service as PR
from app.services import projects_service
from app.services.money_wire import parse_money

router = APIRouter()


def _parse_date(s: Optional[str], label: str) -> Optional[dt.date]:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, detail=f'{label} غير صالح: {s}')


@router.get('')
def list_projects(q: Optional[str] = Query(None),
                  date_from: Optional[str] = Query(None),
                  date_to: Optional[str] = Query(None),
                  min_outstanding: Optional[float] = Query(None),
                  db: Session = Depends(get_session)) -> dict:
    """قائمة المشاريع مع إجماليات كل مشروع."""
    df = _parse_date(date_from, 'تاريخ البداية')
    dtt = _parse_date(date_to, 'تاريخ النهاية')
    if df is not None and dtt is not None and df > dtt:
        raise HTTPException(422, detail='تاريخ البداية يجب أن يسبق تاريخ النهاية')
    out = projects_service.list_projects(db, q=q, date_from=df, date_to=dtt,
                                         min_outstanding=min_outstanding)
    # مشاريع أُنشئت من السجل ولا حركة لها بعد — تُلحق بأصفار (لا تغيّر أي إجمالي)
    if not (q or df or dtt or min_outstanding):
        for reg in PR.registry_only_rows(db, [r['project'] for r in out['rows']]):
            row = projects_service._row_for(reg.name, [])
            projects_service._enrich_row(row, {}, {})
            out['rows'].append(row)
        out['totals']['count'] = len(out['rows'])
    PR.enrich_project_rows(db, out['rows'])  # م-٥٠: مفاتيح إضافية فقط
    return out


@router.post('', status_code=201)
def create_project(body: dict = Body(...), db: Session = Depends(get_session)) -> dict:
    """مشروع جديد — يرفض الاسم المكرر بعد تجاهل «ال» والهمزات (409)."""
    cv = _amount_field(body, 'contractValue')
    try:
        return PR.create_project(db, body.get('name') or '', cv)
    except FileExistsError as e:
        raise HTTPException(409, detail=f'المشروع موجود باسم «{e}»')
    except ValueError as e:
        raise HTTPException(422, detail=str(e))


@router.delete('/{project}')
def delete_project(project: str, db: Session = Depends(get_session)) -> dict:
    """حذف منطقي لمشروع فارغ فقط؛ مشروع عليه بيانات → 409 بالأعداد (الواجهة تعرض الدمج)."""
    reg = _reg(db, project)
    if reg.name == projects_service.UNKNOWN_PROJECT:
        raise HTTPException(422, detail='«غير محدد» لا يُحذف')
    counts = PR.linked_counts(db, reg)
    if any(counts.values()):
        raise HTTPException(409, detail=dict(message='المشروع عليه بيانات — ادمجه في مشروع آخر بدل حذفه',
                                              linked=counts))
    import datetime as _dt
    reg.deleted_at = _dt.datetime.now(_dt.timezone.utc)
    db.commit()
    return dict(deleted=True, id=reg.id)


@router.get('/registry')
def project_registry(db: Session = Depends(get_session)) -> list:
    """سجل المشاريع بمعرّفاتها الثابتة وقيمة العقد."""
    return PR.registry_list(db)


@router.get('/budget-plans')
def budget_plans(db: Session = Depends(get_session)) -> list:
    """المشاريع التي لها خطة تقديرية محفوظة — لاختيار المشروع في لوحة الخطة."""
    from app.db import models
    rows = db.query(models.BudgetPlan).filter(models.BudgetPlan.deleted_at.is_(None)).all()
    return [dict(id=r.id, project=r.project, period=r.period_label,
                 startMonth=r.start_month.strftime('%Y-%m') if r.start_month else None,
                 endMonth=r.end_month.strftime('%Y-%m') if r.end_month else None)
            for r in sorted(rows, key=lambda r: r.project)]


def _reg(db: Session, project: str):
    reg = PR.resolve(db, project)
    if reg is None:
        raise HTTPException(404, detail=f'لا يوجد مشروع باسم أو معرّف {project}')
    return reg


def _amount_field(body: dict, key: str):
    try:
        return parse_money(body.get(key))
    except ValueError as e:
        raise HTTPException(422, detail=str(e))


@router.put('/{project}')
def update_project(project: str, body: dict = Body(...),
                   db: Session = Depends(get_session)) -> dict:
    """قيمة عقد المشروع وملاحظته — `null` يمسح القيمة."""
    reg = _reg(db, project)
    fields = {}
    if 'contractValue' in body:
        fields['contractValue'] = _amount_field(body, 'contractValue')
    if 'notes' in body:
        fields['notes'] = body.get('notes') or ''
    return PR.update_project(db, reg, fields)


@router.get('/{project}/parties')
def project_parties(project: str, db: Session = Depends(get_session)) -> list:
    return PR.project_parties(db, _reg(db, project))


def _check_type(party_type: str) -> None:
    if party_type not in PR.PARTY_TYPES:
        raise HTTPException(422, detail='نوع الطرف يجب أن يكون supplier أو contractor')


@router.put('/{project}/parties/{party_type}/{party_id}')
def put_project_party(project: str, party_type: str, party_id: str, response: Response,
                      body: dict = Body(default={}),
                      db: Session = Depends(get_session)) -> dict:
    """يربط الطرف بالمشروع بمبلغ (يُنشئ الرابط إن غاب، ويُحيي المحذوف)."""
    _check_type(party_type)
    reg = _reg(db, project)
    if reg.name == projects_service.UNKNOWN_PROJECT:
        raise HTTPException(422, detail='«غير محدد» ليس مشروعاً يُربط به طرف')
    amount = _amount_field(body, 'amount')
    try:
        item, created = PR.set_party(db, reg, party_type, party_id, amount, body.get('notes'))
    except LookupError as e:
        raise HTTPException(404, detail=str(e))
    response.status_code = 201 if created else 200
    return item


@router.delete('/{project}/parties/{party_type}/{party_id}')
def delete_project_party(project: str, party_type: str, party_id: str,
                         db: Session = Depends(get_session)) -> dict:
    _check_type(party_type)
    try:
        ok = PR.unlink_party(db, _reg(db, project), party_type, party_id)
    except LookupError as e:
        raise HTTPException(404, detail=str(e))
    if not ok:
        raise HTTPException(404, detail='الطرف غير مرتبط بهذا المشروع')
    return dict(deleted=True)


@router.get('/{project}/budget-plan')
def project_budget_plan(project: str, db: Session = Depends(get_session)) -> dict:
    """الخطة التقديرية الشهرية للمشروع + الفعلي حيث توجد لقطة موازنة لنفس الشهر."""
    from app.services import budget_plan_service
    out = budget_plan_service.plan_for_project(db, project)
    if out is None:
        raise HTTPException(404, detail='لا توجد خطة تقديرية لهذا المشروع — ارفع ملف الموازنة التقديرية من «رفع الملفات»')
    return out


@router.get('/{project}')
def project_detail(project: str, db: Session = Depends(get_session)) -> dict:
    """تفاصيل مشروع — الموردون وجدول الاستحقاقات."""
    reg = PR.resolve(db, project)
    # المعرّف يُترجم لاسم المشروع كما تعرفه الشاشة القديمة؛ الاسم يمرّ كما هو
    name = project
    if reg is not None and reg.id == project:
        name = reg.name
    row = projects_service.project_detail(db, name)
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مشروع باسم {project}')
    PR.enrich_project_rows(db, [row])
    if row.get('id'):
        reg = PR.resolve(db, row['id'])
        row['parties'] = PR.project_parties(db, reg) if reg is not None else []
    else:
        row['parties'] = []
    return row
