# -*- coding: utf-8 -*-
"""مسارات المساعد الذكي — الإعدادات، اختبار الاتصال، واستخراج الملفات.

كل شيء هنا اختياري: التطبيق يعمل كاملاً والمساعد معطّل.
"""
import datetime as dt
from decimal import Decimal
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db.session import get_session
from app.services import ai_service, ai_features_service as F

router = APIRouter()

MASK = '•••'
DISABLED = F.DISABLED_MSG


def _require_enabled():
    s = ai_service.load_settings()
    if not s['enabled']:
        raise HTTPException(409, detail=DISABLED)


class AiSettingsBody(BaseModel):
    enabled: Optional[bool] = None
    provider: Optional[str] = None
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None
    model: Optional[str] = None
    maxTokens: Optional[int] = None


class ExtractBody(BaseModel):
    path: str


def _masked(s: dict) -> dict:
    out = dict(s)
    out['apiKey'] = MASK if s.get('apiKey') else ''
    return out


@router.get('/settings')
def get_settings() -> dict:
    """الإعدادات الحالية — المفتاح لا يُعاد أبداً، فقط قناع عند وجوده."""
    return _masked(ai_service.load_settings())


@router.put('/settings')
def put_settings(body: AiSettingsBody) -> dict:
    """حفظ جزئي — إرسال القناع '•••' كمفتاح يعني: أبقِ المفتاح المحفوظ."""
    partial = body.dict(exclude_unset=True)
    if partial.get('apiKey') == MASK:
        partial.pop('apiKey')
    # التفعيل يتطلب عنوان خدمة ونموذجاً — مفتاح API قد يكون فارغاً لبعض البوابات،
    # فيُنبَّه عنه في «اختبار الاتصال» بدل منعه هنا.
    merged = dict(ai_service.load_settings())
    merged.update(partial)
    if merged.get('enabled') and (not merged.get('baseUrl') or not merged.get('model')):
        raise HTTPException(422, detail='أكمل عنوان الخدمة واسم النموذج قبل التفعيل')
    return _masked(ai_service.save_settings(partial))


@router.post('/test')
def test_connection() -> dict:
    """اختبار الاتصال — يعيد 200 دائماً مع {ok, message} حتى عند فشل المزود."""
    return ai_service.test_connection()


@router.post('/extract')
def extract(body: ExtractBody) -> dict:
    """استخراج سطور القيود من ملف عبر النموذج — تحليل فقط.

    هذا المسار لا يكتب في قاعدة البيانات إطلاقاً؛ النتيجة تُعاد للمستخدم
    للمراجعة، وواجهة المراجعة والاعتماد عمل مستقبلي.
    """
    p = Path(body.path)
    if not p.exists() or not p.is_file():
        raise HTTPException(404, detail='الملف غير موجود: {}'.format(body.path))
    s = ai_service.load_settings()
    if not s['enabled']:
        raise HTTPException(409, detail='المساعد غير مفعّل — فعّله من الإعدادات')
    try:
        return ai_service.extract_rows(p)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))


# ---------------------------------------------------------------- v0.5 AI features
# القاعدة الحاكمة في كل مسار تحت: النموذج لا يحسب ولا يخترع أي رقم أبداً — كل رقم
# محسوب مسبقاً بكود بايثون حتمي (Decimal) ويُمرَّر للنموذج كنص جاهز؛ النموذج يقرأ
# نصاً ويكتب نصاً فقط (صياغة/تلخيص/شرح). الاستثناء المُعلن الوحيد هو /parse-text.


class AskBody(BaseModel):
    question: str


class RemindBody(BaseModel):
    partyKind: str
    key: str


class BudgetNotesBody(BaseModel):
    project: str


class SummaryBody(BaseModel):
    parties: Optional[str] = None
    account: Optional[str] = None
    project: Optional[str] = None
    contractor: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class BriefBody(BaseModel):
    days: Optional[int] = 7


class AnomaliesBody(BaseModel):
    pass


class ParseTextBody(BaseModel):
    text: str


class WhatIfBody(BaseModel):
    partyKind: str
    key: str
    shiftDays: int


class PrioritiesBody(BaseModel):
    budget: Optional[str] = None


@router.post('/ask')
def ask(body: AskBody, db=Depends(get_session)) -> dict:
    """سؤال وجواب عربي عن قاعدة البيانات عبر SQL آمن للقراءة فقط.

    القاعدة الحاكمة: النموذج لا يحسب ولا يخترع أي رقم أبداً. النموذج يقترح جملة
    SELECT فقط؛ الكود وحده يتحقق من أمانها وينفّذها فعلياً على اتصال SQLite
    للقراءة فقط، وكل رقم في الجواب مصدره صفوف حقيقية أعادتها قاعدة البيانات —
    النموذج بعد ذلك يصوغ جواباً عربياً من تلك الصفوف فقط دون إضافة أي رقم.
    """
    _require_enabled()
    try:
        return F.ask(ai_service.chat, body.question)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))


@router.post('/remind')
def remind(body: RemindBody, db=Depends(get_session)) -> dict:
    """رسالة متابعة/مطالبة عربية — الأرقام كلها محسوبة كودياً من الموقف الفعلي
    للطرف (مورد أو مقاول)، والنموذج يصوغ منها فقط رسالة نصية دون أي حساب.
    """
    _require_enabled()
    if body.partyKind not in ('supplier', 'contractor'):
        raise HTTPException(422, detail='partyKind يجب أن يكون supplier أو contractor')
    facts = F.build_remind_facts(db, body.partyKind, body.key)
    if facts is None:
        raise HTTPException(404, detail='لا يوجد طرف بهذا المفتاح')
    try:
        message = F.remind_message(ai_service.chat, facts)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))
    return {'message': message}


@router.post('/budget-notes')
def budget_notes(body: BudgetNotesBody, db=Depends(get_session)) -> dict:
    """ملاحظات مالية عربية على موازنة مشروع — الفروق بين آخر لقطتين محسوبة
    كودياً بالكامل (فرق الصرف، نقاط التأخر/الإنجاز)، والنموذج يصوغ منها فقط
    نقاطاً عربية دون أي حساب جديد.
    """
    _require_enabled()
    from app.services import budget_service
    detail = budget_service.project_detail(db, body.project)
    if detail is None:
        raise HTTPException(404, detail='لا توجد لقطات موازنة لهذا المشروع')
    deltas = F.budget_deltas(detail)
    try:
        notes = F.budget_notes(ai_service.chat, deltas)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))
    return {'notes': notes}


@router.post('/summary')
def summary(body: SummaryBody, db=Depends(get_session)) -> dict:
    """ملخص تنفيذي عربي — الأرقام (إجماليات وعدّادات فقط، بلا صفوف خام) محسوبة
    كودياً بالكامل من نفس طبقة التقارير، والنموذج يصوغ منها فقط 3-5 جمل رسمية.
    """
    _require_enabled()
    date_from = dt.date.fromisoformat(body.date_from) if body.date_from else None
    date_to = dt.date.fromisoformat(body.date_to) if body.date_to else None
    numbers = F.build_summary_numbers(db, body.parties, body.account, body.project,
                                      body.contractor, date_from, date_to)
    try:
        text = F.executive_summary(ai_service.chat, numbers)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))
    return {'summary': text}


@router.post('/brief')
def brief(body: BriefBody, db=Depends(get_session)) -> dict:
    """موجز دوري عربي قصير — كل الأرقام (قيود/فواتير/دفعات جديدة، ضمانات مستحقة
    قريباً) محسوبة كودياً عبر استعلامات حتمية على قاعدة البيانات، والنموذج يصوغ
    منها فقط فقرة موجزة دون أي حساب.
    """
    _require_enabled()
    days = body.days or 7
    digest = F.build_brief_digest(db, days)
    try:
        text = F.brief_text(ai_service.chat, digest)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))
    return {'brief': text}


@router.post('/anomalies')
def anomalies(body: AnomaliesBody, db=Depends(get_session)) -> dict:
    """حالات شاذة محتملة — الاكتشاف بالكامل كودي حتمي (دفعات شبه مكررة، فاتورة
    شاذة القيمة، تغيّر نسبة تأمين بين مستخلصين، قيد بتاريخ مستقبلي)؛ النموذج لا
    يقرر ما هو الشذوذ إطلاقاً، فقط يصوغ عنواناً وتفصيلاً عربياً لكل حالة مكتشفة
    مسبقاً. قائمة فارغة لا تستدعي النموذج إطلاقاً.
    """
    _require_enabled()
    candidates = F.find_anomalies(db)
    if not candidates:
        return {'items': []}
    try:
        items = F.phrase_anomalies(ai_service.chat, candidates)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))
    return {'items': items}


@router.post('/parse-text')
def parse_text(body: ParseTextBody, db=Depends(get_session)) -> dict:
    """استخراج مقترح قيد من نص حر (رسالة واتساب/إيميل) للمراجعة اليدوية فقط.

    هذا المسار الاستثناء الوحيد المُعلن: المبالغ هنا يستخرجها النموذج من نص حر
    كتبه المستخدم بنفسه، والمستخدم يراجع المقترح قبل أي حفظ — لا يُكتب أي شيء
    في قاعدة البيانات من هذا المسار إطلاقاً. مطابقة الطرف (key/partyKind) لا
    تُترك للنموذج أبداً؛ الكود وحده يطابق الاسم المستخرج مع قوائم الموردين
    والمقاولين الفعلية ويصحح key/partyKind بناءً على تلك المطابقة.
    """
    _require_enabled()
    try:
        proposal = F.parse_text_proposal(ai_service.chat, db, body.text)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))
    return {'proposal': proposal}


@router.post('/what-if')
def what_if(body: WhatIfBody, db=Depends(get_session)) -> dict:
    """محاكاة "ماذا لو" على التدفق النقدي — إعادة حساب التدفق (14 يوماً) مرتين
    بالكامل كودياً (Decimal): كما هو، ثم مع إزاحة استحقاقات الطرف المحدد
    shiftDays يوماً. النموذج يكتب narrative فقط، يصف الفرق بين before/after
    المحسوبين مسبقاً، دون أي حساب من طرفه.
    """
    _require_enabled()
    if body.partyKind not in ('supplier', 'contractor'):
        raise HTTPException(422, detail='partyKind يجب أن يكون supplier أو contractor')
    result = F.what_if_shift(db, body.partyKind, body.key, body.shiftDays)
    if result is None:
        raise HTTPException(404, detail='لا يوجد طرف بهذا المفتاح')
    try:
        narrative = F.what_if_narrative(ai_service.chat, result['before'], result['after'],
                                        body.shiftDays)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))
    return {'narrative': narrative, 'before': result['before'], 'after': result['after']}


@router.post('/priorities')
def priorities(body: PrioritiesBody, db=Depends(get_session)) -> dict:
    """قائمة أولويات السداد — الترتيب والدرجات وسبب كل عنصر مبنية بالكامل كودياً
    (صيغة الدرجة: overdue_amount × 1 + عمر_التأخر_بالأيام × 50 + 5000 عند
    الاستحقاق خلال 7 أيام، والمقاولون أصحاب الرصيد السالب مرتبون بالقيمة
    المطلقة). النموذج يكتب narrative تفسيرياً فقط، ولا يُعيد ترتيب أو يخترع
    رقماً.
    """
    _require_enabled()
    budget = Decimal(body.budget) if body.budget else None
    result = F.build_priorities(db, budget)
    try:
        narrative = F.priorities_narrative(ai_service.chat, result)
    except ai_service.AiError as e:
        raise HTTPException(502, detail=str(e))
    return {'items': result['items'], 'narrative': narrative}
