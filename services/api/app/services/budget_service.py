# -*- coding: utf-8 -*-
"""خدمة الموازنة — محرك الحساب، سلسلة التراكمي، وتعارض المصدرين.

انظر docs/feedback/PLAN-BUDGET.md للقرارات. ثلاث نقاط تحكم هذا الملف:

١. المستخدم يُدخل ٦ حقول فقط (actual_month · planned_month · claims · doc_no ·
   issued_on · notes). كل شيء آخر (deviation_month · cum_actual · cum_planned ·
   completion_pct · delay_pct) محسوب هنا حصراً — لا يُقبل من الواجهة أبداً.
٢. تراكمي الشهر يعتمد على تراكمي الشهر السابق (سلسلة). تعديل شهر قديم يجب أن
   يُعيد بناء كل ما بعده، وإلا صارت نسبة الإنجاز خاطئة لكل شهر تالٍ بلا أي إشارة
   — هذا ما تفعله rebuild_chain، وتُستدعى من كل كتابة.
٣. مصدرا الملف والإدخال اليدوي قد يختلفان لنفس الشهر (حالة حقيقية موثّقة: سدايم
   يوليو ٢٠٢٦ — فرق ٧٤٨,٦١٣.٠٢ ر.س بين xlsx وتقرير PDF لاحق). preview() يكتشف
   هذا ولا يكتب شيئاً — الكتابة الفعلية ترفض أيضاً ما لم يُمرَّر forceConflict.

كل الحسابات بـDecimal عبر D()/money() من app/domain/payables.py — التقريب مرة
واحدة عند الحدّ (عند التحويل لـfloat في *_json)، لا قبله، حتى لا تنحرف نسبة
مئوية محسوبة من رقمين مقرَّبين سلفاً (حدث ثلاث مرات في هذا المشروع).
"""
from __future__ import annotations

import datetime as dt
import json
import os
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import D, money
from app.ingest import budget_xlsx

CONFLICT_TOLERANCE = Decimal('0.01')  # هللة واحدة — لا يُبلَّغ تعارض بسبب تقريب


# ------------------------------------------------------------ استيراد الملفات

def import_budget(db: Session, path: str) -> dict:
    """استيراد ملف xlsx — يُحدّث بدل التكرار عند إعادة الاستيراد نفسه.

    مبقاة كما كانت (وكيل ح٢ يستدعيها من import_service.py) — التغيير الوحيد:
    الصفوف المستوردة من ملف تحمل entry_source='file' (افتراضي النموذج) وdoc_no
    يُملأ من الرقم التسلسلي في الترويسة، ثم تُعاد بناء السلسلة لكل مشروع مسّه
    الاستيراد حتى لا يبقى تراكمي شهرٍ لاحق محسوباً من قيم قديمة.
    """
    sheets = budget_xlsx.parse(path)
    source = os.path.basename(path)

    imported = 0
    updated = 0
    projects = set()
    issues: List[dict] = []

    for s in sheets:
        projects.add(s['project'])
        issues.extend(s['issues'])
        row = (db.query(models.BudgetSnapshot)
                 .filter(models.BudgetSnapshot.project == s['project'],
                         models.BudgetSnapshot.month == s['month'])
                 .one_or_none())
        if row is None:
            row = models.BudgetSnapshot(project=s['project'], month=s['month'])
            db.add(row)
            imported += 1
        else:
            updated += 1

        row.serial = s['serial']
        row.issued_on = s['issued_on']
        row.actual_month = s['actual_month']
        row.planned_month = s['planned_month']
        row.deviation_month = s['deviation_month']
        row.cum_actual = s['cum_actual']
        row.cum_planned = s['cum_planned']
        row.cum_prev_actual = s['cum_prev_actual']
        row.cum_prev_planned = s['cum_prev_planned']
        row.delay_pct = s['delay_pct']
        row.completion_pct = s['completion_pct']
        row.claims = json.dumps(
            [dict(no=c['no'], amount=c['amount'],
                  date=c['date'].isoformat() if c['date'] else None)
             for c in s['claims']], ensure_ascii=False)
        row.notes = s['notes']
        row.source = source
        row.entry_source = 'file'
        row.doc_no = s['serial']

    db.commit()

    for p in projects:
        rebuild_chain(db, p)
    db.commit()

    return dict(imported=imported, updated=updated,
                projects=sorted(projects), issues=issues)


# ------------------------------------------------------------ محرك الحساب

def _rows_for_project(db: Session, project: str) -> List[models.BudgetSnapshot]:
    return (db.query(models.BudgetSnapshot)
              .filter(models.BudgetSnapshot.project == project,
                      models.BudgetSnapshot.deleted_at.is_(None))
              .order_by(models.BudgetSnapshot.month.asc())
              .all())


def rebuild_chain(db: Session, project: str,
                  from_month: Optional[dt.date] = None) -> List[models.BudgetSnapshot]:
    """يُعيد حساب deviation/cum_actual/cum_planned/completion_pct/delay_pct لكل
    أشهر المشروع بدءاً من from_month (أو من البداية إن حُذف) حتى آخر شهر.

    الترتيب الزمني وحده هو ما يحدد التسلسل — لا افتراض أن الأشهر متتالية بلا
    فجوة، فالفجوة نفسها بيانات صادقة (شهر بلا تقرير)، لا تُخترع قيمة له.
    القاعدة العامة (لا الثابت الظاهري) تُستعمل دائماً — راجع §٢ في PLAN-BUDGET:
    cum_planned = cum_planned(السابق) + planned_month، حتى لو بقيت planned_month
    صفراً في كل العيّنات الحالية؛ لو عاد البرنامج الزمني للنمو تبقى الصيغة صحيحة.
    """
    rows = _rows_for_project(db, project)
    if not rows:
        return []

    # الأساس (baseline) الذي يبدأ منه أول شهر في السلسلة: إن كان أول شهرٍ في
    # قاعدة البيانات هو حقاً أول شهر نعيد بناءه، فأساسه ليس صفراً بالضرورة —
    # ملفات مستوردة (مثل سدايم) تبدأ منتصف عمر المشروع وتحمل cum_prev_actual/
    # cum_prev_planned حقيقيَّين من تاريخ خارج القاعدة (تراكم أشهر لم تُستورد).
    # محوهما إلى صفر كان يمحو ٤٨.٧ مليون ر.س من تاريخ سدايم الحقيقي بصمت.
    prev_actual = D(rows[0].cum_prev_actual)
    prev_planned = D(rows[0].cum_prev_planned)
    changed: List[models.BudgetSnapshot] = []
    started = from_month is None or from_month <= rows[0].month
    for row in rows:
        if not started:
            if row.month >= from_month:
                started = True
            else:
                # قبل نقطة البدء — لا تُعاد كتابته، لكن تراكمياته أساس ما بعده
                prev_actual = D(row.cum_actual)
                prev_planned = D(row.cum_planned)
                continue

        actual = D(row.actual_month)
        planned = D(row.planned_month)
        cum_actual = prev_actual + actual
        cum_planned = prev_planned + planned

        row.deviation_month = money(actual - planned)
        row.cum_prev_actual = money(prev_actual)
        row.cum_prev_planned = money(prev_planned)
        row.cum_actual = money(cum_actual)
        row.cum_planned = money(cum_planned)
        row.completion_pct = (float(cum_actual / cum_planned)
                              if cum_planned != 0 else None)
        row.delay_pct = (1.0 - row.completion_pct
                         if row.completion_pct is not None else None)

        prev_actual = cum_actual
        prev_planned = cum_planned
        changed.append(row)

    return changed


# ------------------------------------------------------------ تسلسل JSON

def _claims_of(row: models.BudgetSnapshot) -> list:
    try:
        return json.loads(row.claims or '[]')
    except ValueError:
        return []


def _status_of(row: models.BudgetSnapshot) -> str:
    if row.cum_actual > row.cum_planned:
        return 'ahead'
    if row.cum_actual < row.cum_planned:
        return 'behind'
    return 'on_track'


def _row_json(row: models.BudgetSnapshot, city: str = '') -> dict:
    return dict(
        id=row.id,
        project=row.project,
        city=city,
        month=row.month.isoformat(),
        actualMonth=row.actual_month,
        plannedMonth=row.planned_month,
        deviationMonth=row.deviation_month,
        cumActual=row.cum_actual,
        cumPlanned=row.cum_planned,
        completionPct=row.completion_pct,
        delayPct=row.delay_pct,
        delayDeltaPp=None,  # يُملأ لاحقاً بمقارنة الشهر السابق ضمن نفس المشروع
        claims=_claims_of(row),
        notes=row.notes,
        docNo=row.doc_no,
        issuedOn=row.issued_on.isoformat() if row.issued_on else None,
        entrySource=row.entry_source,
        hasAttachment=bool(row.attachment),
        status=_status_of(row),
        serial=row.serial,
    )


def _with_delay_deltas(rows_json: List[dict]) -> List[dict]:
    """delayDeltaPp لكل صف = تأخره ناقص تأخر الشهر السابق **لنفس المشروع** —
    سالبٌ يعني تحسّناً (مثال PLAN §٥-١: 17.08% ← 15.96% = تحسّن 1.12 نقطة)."""
    by_project: dict = {}
    for r in rows_json:
        by_project.setdefault(r['project'], []).append(r)
    for _, group in by_project.items():
        group.sort(key=lambda r: r['month'])
        prev_delay = None
        for r in group:
            if prev_delay is not None and r['delayPct'] is not None:
                r['delayDeltaPp'] = round((r['delayPct'] - prev_delay) * 100.0, 2)
            prev_delay = r['delayPct']
    return rows_json


def _cities(db: Session) -> dict:
    return {c.project: c.city for c in
            db.query(models.ProjectCity).filter(models.ProjectCity.deleted_at.is_(None)).all()}


# ------------------------------------------------------------ القائمة المفلترة

def budget_list_json(db: Session, project: Optional[str] = None,
                     city: Optional[str] = None,
                     from_month: Optional[str] = None,
                     to_month: Optional[str] = None,
                     status: Optional[str] = None,
                     has_claims: Optional[bool] = None) -> dict:
    """كل الشهور — مصفّاة على الخادم على المجموعة كاملةً، لا في المتصفح
    (قاعدة CLAUDE.md §٢) — سطر الإجماليات يصف بالضبط ما يُعرض."""
    cities = _cities(db)
    all_rows = (db.query(models.BudgetSnapshot)
                  .filter(models.BudgetSnapshot.deleted_at.is_(None))
                  .order_by(models.BudgetSnapshot.project.asc(),
                           models.BudgetSnapshot.month.asc())
                  .all())
    rows_json = _with_delay_deltas([_row_json(r, cities.get(r.project, '')) for r in all_rows])

    from_d = dt.date.fromisoformat(from_month) if from_month else None
    to_d = dt.date.fromisoformat(to_month) if to_month else None

    def _keep(r: dict) -> bool:
        if project and r['project'] != project:
            return False
        if city and r['city'] != city:
            return False
        m = dt.date.fromisoformat(r['month'])
        if from_d and m < from_d:
            return False
        if to_d and m > to_d:
            return False
        if status and r['status'] != status:
            return False
        if has_claims is not None and bool(r['claims']) != has_claims:
            return False
        return True

    filtered = [r for r in rows_json if _keep(r)]

    zero = Decimal('0')
    actual_total = sum((D(r['actualMonth']) for r in filtered), zero)
    planned_total = sum((D(r['plannedMonth']) for r in filtered), zero)
    # التراكمي ليس مجموعاً يُجمَع عبر الصفوف — هو رصيد قائم، وجمعه عبر أشهر
    # مشروعٍ واحد ينتج رقماً بلا معنى مالي (يناير ١م + فبراير ٢.١م = ٣.١م رغم
    # أن التقدّم الفعلي بنهاية فبراير هو ٢.١م فقط، لا مجموع الاثنين). آخر شهر
    # لكل مشروع ضمن المصفّى هو الذي يمثّل حالته — وهو ما يستعمله project_detail
    # أصلاً؛ عدم مطابقة المسارين هنا كان الانحراف نفسه الذي يحذّر منه CLAUDE.md.
    latest_per_project: Dict[str, dict] = {}
    for r in filtered:
        cur = latest_per_project.get(r['project'])
        if cur is None or r['month'] > cur['month']:
            latest_per_project[r['project']] = r
    cum_actual_total = sum((D(r['cumActual']) for r in latest_per_project.values()), zero)
    cum_planned_total = sum((D(r['cumPlanned']) for r in latest_per_project.values()), zero)
    totals = dict(count=len(filtered),
                 actualMonth=money(actual_total),
                 plannedMonth=money(planned_total),
                 cumActual=money(cum_actual_total),
                 cumPlanned=money(cum_planned_total))

    filters_applied = dict(project=project, city=city, fromMonth=from_month,
                           toMonth=to_month, status=status, hasClaims=has_claims)
    return dict(count=len(filtered), rows=filtered, totals=totals,
               projects=sorted({r.project for r in all_rows}),
               cities=sorted({c for c in cities.values() if c}),
               filtersApplied=filters_applied)


# ------------------------------------------------------------ تفصيل مشروع

def project_detail(db: Session, project: str,
                   from_month: Optional[str] = None,
                   to_month: Optional[str] = None) -> Optional[dict]:
    """لقطات مشروع واحد + مقاولوه (مصدر منفصل، لا يُدمج — انظر §١-ب في PLAN).

    الشكل يبقى فيه 'months'/'project' كما في الإصدار السابق عمداً — مسار
    /ai/budget-notes (app/services/ai_features_service.budget_deltas) يقرأ
    detail['months'][-1]/[-2] بهذه الأسماء بالضبط ولا يُلمس هنا (ملك وكيل آخر).
    """
    rows = _rows_for_project(db, project)
    if not rows:
        return None

    cities = _cities(db)
    city = cities.get(project, '')
    months = _with_delay_deltas([_row_json(r, city) for r in rows])

    from_d = dt.date.fromisoformat(from_month) if from_month else None
    to_d = dt.date.fromisoformat(to_month) if to_month else None
    if from_d or to_d:
        months = [m for m in months
                 if (not from_d or dt.date.fromisoformat(m['month']) >= from_d)
                 and (not to_d or dt.date.fromisoformat(m['month']) <= to_d)]
    if not months:
        return dict(project=project, city=city, months=[], totals={}, contractors=[])

    zero = Decimal('0')
    totals = dict(actualMonth=money(sum((D(m['actualMonth']) for m in months), zero)),
                 plannedMonth=money(sum((D(m['plannedMonth']) for m in months), zero)),
                 cumActual=months[-1]['cumActual'],
                 cumPlanned=months[-1]['cumPlanned'],
                 completionPct=months[-1]['completionPct'],
                 delayPct=months[-1]['delayPct'])

    contractors = []
    try:
        from app.services import contractors_service
        contractors = contractors_service.contractors_list_json(db, project=project)['rows']
    except Exception:
        # وحدة المقاولين قد تفشل لسبب لا علاقة له بالموازنة (مثلاً بيانات
        # ناقصة) — لا يجوز أن يُسقط ذلك صفحة الموازنة كاملة، فهو عرضٌ جانبي.
        contractors = []

    return dict(project=project, city=city, months=months, totals=totals,
               contractors=contractors)


def overview(db: Session) -> dict:
    """مبقاة للتوافق الخلفي — النظرة العامة القديمة {projects:[{project,months,
    latest,trend}]}. الواجهة الجديدة تستعمل budget_list_json بدلها."""
    cities = _cities(db)
    all_rows = (db.query(models.BudgetSnapshot)
                  .filter(models.BudgetSnapshot.deleted_at.is_(None)).all())
    groups: dict = {}
    for r in all_rows:
        groups.setdefault(r.project, []).append(r)
    projects = []
    for p, rs in groups.items():
        rs = sorted(rs, key=lambda r: r.month)
        months = _with_delay_deltas([_row_json(r, cities.get(p, '')) for r in rs])
        latest = months[-1]
        delay_delta = latest['delayDeltaPp']
        projects.append(dict(project=p, months=months, latest=latest,
                             trend=dict(delayDeltaPp=delay_delta, monthsBehind=None)))
    projects.sort(key=lambda p: p['project'])
    return dict(projects=projects)


# ------------------------------------------------------------ تعارض المصدرين

def _find_row(db: Session, project: str, month: dt.date) -> Optional[models.BudgetSnapshot]:
    return (db.query(models.BudgetSnapshot)
              .filter(models.BudgetSnapshot.project == project,
                      models.BudgetSnapshot.month == month,
                      models.BudgetSnapshot.deleted_at.is_(None))
              .one_or_none())


def _find_row_any(db: Session, project: str, month: dt.date) -> Optional[models.BudgetSnapshot]:
    """يجد الصفّ حتى لو محذوفاً منطقياً — يشمله قيد الفرادة على (project, month)
    رغم أنه محذوف، فحذفٌ خاطئ لشهر كان يجعله غير قابل للاسترجاع أبداً: لا POST
    يعمل (يصطدم بالقيد فيفشل بخطأ ٥٠٠ خام)، ولا PUT يجده (deleted_at مستبعد
    فيرد ٤٠٤). أُثبت هذا بالتشغيل قبل الإصلاح."""
    return (db.query(models.BudgetSnapshot)
              .filter(models.BudgetSnapshot.project == project,
                      models.BudgetSnapshot.month == month)
              .order_by(models.BudgetSnapshot.deleted_at.is_(None).desc())
              .first())


def _prev_cums(db: Session, project: str, month: dt.date) -> tuple:
    prev = (db.query(models.BudgetSnapshot)
              .filter(models.BudgetSnapshot.project == project,
                      models.BudgetSnapshot.month < month,
                      models.BudgetSnapshot.deleted_at.is_(None))
              .order_by(models.BudgetSnapshot.month.desc())
              .first())
    if prev is None:
        return Decimal('0'), Decimal('0')
    return D(prev.cum_actual), D(prev.cum_planned)


def _compute_month(db: Session, project: str, month: dt.date,
                   actual_month: float, planned_month: float) -> dict:
    prev_actual, prev_planned = _prev_cums(db, project, month)
    actual = D(actual_month)
    planned = D(planned_month)
    cum_actual = prev_actual + actual
    cum_planned = prev_planned + planned
    completion_pct = float(cum_actual / cum_planned) if cum_planned != 0 else None
    delay_pct = (1.0 - completion_pct) if completion_pct is not None else None
    return dict(deviationMonth=money(actual - planned),
               cumActual=money(cum_actual), cumPlanned=money(cum_planned),
               completionPct=completion_pct, delayPct=delay_pct)


def preview(db: Session, project: str, month: str, actual_month: float,
           planned_month: float) -> dict:
    """يحسب أثر إدخال محتمل بلا كتابة — chainImpact لكل الأشهر التالية،
    وconflict إن اختلف رقمٌ قائم عمّا سيُكتب (الخطر الثاني، حالة سدايم الحقيقية:
    فرق ٧٤٨,٦١٣.٠٢ ر.س بين ملف يوليو وتقرير أغسطس عنه)."""
    month_d = dt.date.fromisoformat(month)
    computed = _compute_month(db, project, month_d, actual_month, planned_month)

    existing = _find_row(db, project, month_d)
    conflict = None
    # التعارض معناه مصدران يختلفان على نفس الرقم — لا مجرد تعديل مقصود لسجل
    # يدوي قائم (ذاك تحرير عادي، لا تعارض). لذا يُفحص فقط حين الموجود من
    # مصدر آخر (ملف) وما يُكتب الآن يدوي — حالة سدايم الحقيقية بالضبط.
    if existing is not None and existing.entry_source == 'file':
        for field, key in (('cumActual', 'cum_actual'), ('delayPct', 'delay_pct')):
            current = getattr(existing, key)
            incoming = computed[field]
            if current is None or incoming is None:
                continue
            if abs(D(current) - D(incoming)) > CONFLICT_TOLERANCE:
                conflict = dict(field=field, current=current, incoming=incoming,
                               currentSource=existing.entry_source)
                break

    # أثر السلسلة: أشهر المشروع اللاحقة بعد إعادة البناء على نسخة مؤقتة، دون
    # أي كتابة فعلية على db — نبني الأرقام يدوياً بنفس منطق rebuild_chain.
    rows = _rows_for_project(db, project)
    chain_impact = []
    prev_actual = D(computed['cumActual'])
    prev_planned = D(computed['cumPlanned'])
    for row in rows:
        if row.month <= month_d:
            continue
        actual = D(row.actual_month)
        planned = D(row.planned_month)
        cum_actual = prev_actual + actual
        cum_planned = prev_planned + planned
        new_completion = float(cum_actual / cum_planned) if cum_planned != 0 else None
        new_delay = (1.0 - new_completion) if new_completion is not None else None
        if abs(D(row.cum_actual) - cum_actual) > CONFLICT_TOLERANCE or \
           (row.delay_pct is None) != (new_delay is None) or \
           (new_delay is not None and row.delay_pct is not None
            and abs(D(row.delay_pct) - D(new_delay)) > Decimal('0.0001')):
            chain_impact.append(dict(
                month=row.month.isoformat(),
                cumActualBefore=row.cum_actual, cumActualAfter=money(cum_actual),
                delayPctBefore=row.delay_pct, delayPctAfter=new_delay))
        prev_actual = cum_actual
        prev_planned = cum_planned

    result = dict(computed=computed, chainImpact=chain_impact)
    if conflict:
        result['conflict'] = conflict
    return result


# ------------------------------------------------------------ الكتابة

def _apply_claims(row: models.BudgetSnapshot, claims: list) -> None:
    row.claims = json.dumps(
        [dict(no=c.get('no', ''), amount=c.get('amount', 0), date=c.get('date'))
         for c in claims], ensure_ascii=False)


def upsert_manual(db: Session, project: str, month: str, actual_month: float,
                  planned_month: float, claims: list, doc_no: str,
                  issued_on: Optional[str], notes: str,
                  snapshot_id: Optional[str] = None,
                  force_conflict: bool = False,
                  attachment: Optional[str] = None) -> dict:
    """إنشاء/تعديل شهر يدوياً + إعادة بناء السلسلة. يرفض الكتابة عند تعارض ما
    لم يُمرَّر force_conflict=True (المستخدم رأى التعارض في /preview وقرر)."""
    month_d = dt.date.fromisoformat(month)
    prev = preview(db, project, month, actual_month, planned_month)
    if prev.get('conflict') and not force_conflict:
        return dict(conflict=prev['conflict'], saved=False)

    if snapshot_id:
        row = db.query(models.BudgetSnapshot).filter(
            models.BudgetSnapshot.id == snapshot_id,
            models.BudgetSnapshot.deleted_at.is_(None)).one_or_none()
        if row is None:
            raise ValueError('السجل غير موجود')
    else:
        # يبحث حتى في المحذوف منطقياً: نفس (project, month) قيدُ فرادة في
        # القاعدة سواءٌ أكان الصفّ حيّاً أم محذوفاً — فإن أُغفل هذا هنا يُنشأ
        # صفٌّ ثانٍ يصطدم بالقيد نفسه ويفشل الطلب كله بخطأ ٥٠٠ خام.
        row = _find_row_any(db, project, month_d)
        if row is None:
            row = models.BudgetSnapshot(project=project, month=month_d)
            db.add(row)
        elif row.deleted_at is not None:
            row.deleted_at = None   # إحياء الشهر المحذوف بدل إنشاء صفّ ثانٍ

    row.project = project
    row.month = month_d
    row.actual_month = actual_month
    row.planned_month = planned_month
    _apply_claims(row, claims)
    row.doc_no = doc_no
    row.issued_on = dt.date.fromisoformat(issued_on) if issued_on else None
    row.notes = notes
    row.entry_source = 'manual'
    if attachment is not None:
        row.attachment = attachment
    db.flush()

    rebuild_chain(db, project, from_month=month_d)
    db.commit()

    return dict(saved=True, row=_row_json(row, _cities(db).get(project, '')))


def delete_snapshot(db: Session, snapshot_id: str) -> bool:
    """حذف منطقي + إعادة بناء ما بعده — الحذف يترك فجوة تُحسب منها الأشهر
    التالية اعتباراً من الشهر الذي يليها مباشرة."""
    row = db.query(models.BudgetSnapshot).filter(
        models.BudgetSnapshot.id == snapshot_id,
        models.BudgetSnapshot.deleted_at.is_(None)).one_or_none()
    if row is None:
        return False
    project, month = row.project, row.month
    row.deleted_at = dt.datetime.now(dt.timezone.utc)
    db.flush()
    rebuild_chain(db, project, from_month=month)
    db.commit()
    return True


# ------------------------------------------------------------ التعليقات

def add_comment(db: Session, snapshot_id: str, text: str) -> dict:
    row = models.BudgetComment(snapshot_id=snapshot_id, text=text)
    db.add(row)
    db.commit()
    return _comment_json(row)


def list_comments(db: Session, snapshot_id: str) -> List[dict]:
    rows = (db.query(models.BudgetComment)
              .filter(models.BudgetComment.snapshot_id == snapshot_id,
                      models.BudgetComment.deleted_at.is_(None))
              .order_by(models.BudgetComment.created_at.asc()).all())
    return [_comment_json(r) for r in rows]


def delete_comment(db: Session, comment_id: str) -> bool:
    row = db.query(models.BudgetComment).filter(
        models.BudgetComment.id == comment_id,
        models.BudgetComment.deleted_at.is_(None)).one_or_none()
    if row is None:
        return False
    row.deleted_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return True


def _comment_json(row: models.BudgetComment) -> dict:
    return dict(id=row.id, snapshotId=row.snapshot_id, text=row.text,
               createdAt=row.created_at.isoformat())


# ------------------------------------------------------------ مدينة المشروع

def set_project_city(db: Session, project: str, city: str) -> dict:
    row = db.query(models.ProjectCity).filter(
        models.ProjectCity.project == project,
        models.ProjectCity.deleted_at.is_(None)).one_or_none()
    if row is None:
        row = models.ProjectCity(project=project, city=city)
        db.add(row)
    else:
        row.city = city
    db.commit()
    return dict(project=project, city=city)
