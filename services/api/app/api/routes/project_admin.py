# -*- coding: utf-8 -*-
"""إدارة المشاريع — م-٣٠: «السدن»/«سدن» لا يلتقيان في أي فلتر لأن أحدهما أُدخل
بأل التعريف والآخر بدونها عبر وحدتين مختلفتين (شاشة الموردين مقابل عمود «تبويب»
في كشف المقاولين). القرار الصريح في docs/feedback/PLAN.md §٣: **لا هجرة تعيد
تسمية بيانات قائمة تلقائياً** — الدمج زرّ يضغطه المستخدم ويرى أثره أولاً.

هذا الملف يقرأ/يكتب `PartyProject.project` و`Supplier.project` و
`ContractorEntry.project` و`BudgetSnapshot.project` — كل عمود اسم مشروع في
القاعدة. لا يُنشئ صفاً جديداً ولا يحذف صفاً — يعيد كتابة نص الاسم فقط.
"""
import datetime as dt
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.services import party_projects as PP
from app.utils.arabic import project_key

router = APIRouter()


class MergeRequest(BaseModel):
    """fromName: الاسم الذي سيختفي، intoName: الاسم الذي سيبقى — كلاهما كما
    مكتوبان فعلاً في القاعدة (ليس مفتاح مطابقة)."""
    fromName: str
    intoName: str


#: الجداول التي تحمل عمود project نصياً مباشرة (لا عبر party_projects) — كل
#: واحد يُحدَّث بمطابقة حرفية كاملة على from_ فقط، لا project_key، حتى لا يمسّ
#: صفاً لم يقصده المستخدم بالضبط.
_PROJECT_COLUMN_MODELS = (
    ('suppliers', models.Supplier),
    ('contractor_entries', models.ContractorEntry),
    ('contractor_claims', models.ContractorClaim),
    ('contractor_guarantees', models.ContractorGuarantee),
    ('budget_snapshots', models.BudgetSnapshot),
)


def _affected_counts(db: Session, name: str) -> dict:
    counts = dict()
    for table, model in _PROJECT_COLUMN_MODELS:
        counts[table] = db.query(model).filter(model.project == name).count()
    counts['party_projects'] = db.query(models.PartyProject).filter(
        models.PartyProject.project == name).count()
    return counts


@router.get('')
def list_projects(db: Session = Depends(get_session)) -> dict:
    """كل المشاريع المعروفة، ومجموعات «تبدو مكرّرة» (نفس project_key، صيغ مختلفة)."""
    all_names = sorted(set(PP.raw_project_names(db)))
    groups: dict = {}
    for name in all_names:
        groups.setdefault(project_key(name), []).append(name)
    duplicates = [dict(key=k, variants=sorted(v)) for k, v in groups.items() if len(v) > 1]
    return dict(projects=all_names, possibleDuplicates=duplicates)


@router.get('/merge/preview')
def merge_preview(fromName: str, intoName: str, db: Session = Depends(get_session)) -> dict:
    """كم صفاً سيتأثر في كل جدول لو نُفِّذ هذا الدمج — بلا أي كتابة."""
    if fromName == intoName:
        raise HTTPException(422, detail='المصدر والهدف نفس الاسم')
    counts = _affected_counts(db, fromName)
    total = sum(counts.values())
    if total == 0:
        raise HTTPException(404, detail='لا صفوف بهذا الاسم — لا شيء لدمجه')
    return dict(fromName=fromName, intoName=intoName, affected=counts, total=total)


@router.post('/merge')
def merge_projects(body: MergeRequest, db: Session = Depends(get_session)) -> dict:
    """ينفّذ الدمج: كل صف اسمه fromName حرفياً يصير intoName حرفياً. تأكيد
    المستخدم يحدث في الواجهة بعد أن يرى نتيجة /merge/preview؛ هنا فقط ينفّذ."""
    from_, into = body.fromName, body.intoName
    if from_ == into:
        raise HTTPException(422, detail='المصدر والهدف نفس الاسم')
    counts = _affected_counts(db, from_)
    if sum(counts.values()) == 0:
        raise HTTPException(404, detail='لا صفوف بهذا الاسم — لا شيء لدمجه')

    for table, model in _PROJECT_COLUMN_MODELS:
        db.query(model).filter(model.project == from_).update(
            {model.project: into}, synchronize_session=False)

    # party_projects فريد على (party_type, party_id, project) — تحديث مباشر قد
    # يصطدم بصفٍّ (نفس الطرف) لديه `into` أصلاً؛ يُعالَج صفاً صفاً لتفادي خطأ
    # تفرّد صامت يوقف الدمج في منتصفه.
    moved_links = 0
    for link in db.query(models.PartyProject).filter(
            models.PartyProject.project == from_).all():
        clash = db.query(models.PartyProject).filter_by(
            party_type=link.party_type, party_id=link.party_id, project=into).one_or_none()
        if clash is not None:
            if link.amount is not None:
                if clash.amount is None:
                    clash.amount = link.amount
                elif clash.amount != link.amount:
                    clash.notes = ((clash.notes + '\n') if clash.notes else '') + \
                        'مبلغ مدموج من %s: %s' % (from_, link.amount)
            if link.notes and link.notes not in (clash.notes or ''):
                clash.notes = ((clash.notes + '\n') if clash.notes else '') + link.notes
            if clash.deleted_at is not None and link.deleted_at is None:
                clash.deleted_at = None
            link.deleted_at = dt.datetime.now(dt.timezone.utc)
        else:
            link.project = into
            moved_links += 1

    # م-٥٠: الرابط المكرر لا يُحذف فعلياً (كان يمحو مبلغ الإسناد) — يُبقى مبلغ
    # الهدف إن وُجد وإلا يُنقل مبلغ المصدر، واختلافهما يُسجَّل في الملاحظة لا يُجمع
    # (قد يكون نفس العقد مُدخلاً تحت الاسمين).
    from app.services import project_registry_service as PR
    PR.merge_registry(db, from_, into)
    db.commit()
    counts['party_projects'] = moved_links
    return dict(merged=dict(fromName=from_, intoName=into, affected=counts))
