# -*- coding: utf-8 -*-
"""تصدير Excel — GET /api/v1/reports/export.xlsx.

Three sheets, right-to-left, Arabic titles: الملخص (summary), الفترات (periods),
الموردون (suppliers).
"""
from __future__ import annotations

import base64
import io
import logging
from typing import List, Optional

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

NUM_FMT = '#,##0.00'

#: بند «غير مُسنَد» — حركة دفتر بلا مشروع محدَّد (project=''). يُعرض صراحةً في كل
#: تجميع بالمشروع ولا يُقسَّم على مشاريع أخرى (م-٢٨ في PLAN.md): رقمٌ ناقص معلومٌ
#: نقصه خيرٌ من رقم مخترَع يبدو كاملاً.
UNASSIGNED_LABEL = 'غير مُسنَد'

# شعار الشركة — نسخة مصغّرة من build/icon.png (بلا الشريط السفلي «Emaar Gulf
# for Construction» غير المقروء بهذا الحجم)، مُضمَّنة كـ base64 داخل الكود
# بدل مسار ملف: الخادم يُشحن كحزمة PyInstaller (onedir) لا تحمل أصولاً غير
# البرمجيات المُدرجة صراحةً في egco-api.spec، وأي مسار نسبي للملف الأصلي
# لن يوجد على جهاز المستخدم. التضمين يضمن ظهور الشعار في كل بيئة تشغيل.
_LOGO_PNG_B64 = (
    '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'
)


def _logo_image() -> Optional[XLImage]:
    """كل ورقة تحتاج نسخة Image مستقلة — openpyxl لا يسمح بإضافة نفس الكائن
    لأكثر من ورقة.

    تُعيد None إن تعذّر إنشاء الصورة (Pillow غائبة عن الحزمة مثلاً). الشعار
    زينة، والتصدير وثيقة يحتاجها المستخدم: انهيار التصدير كله لأن صورة لم
    تُحمّل مقايضة خاسرة. الفشل يُسجَّل ولا يُبتلع.
    """
    try:
        img = XLImage(io.BytesIO(base64.b64decode(_LOGO_PNG_B64)))
    except Exception as e:                      # pragma: no cover - يعتمد على البيئة
        logger.warning('تعذّر إدراج الشعار في ملف Excel: %s', e)
        return None
    img.width = 88
    img.height = 50
    return img


def _add_logo(ws, anchor: str) -> None:
    """يضيف الشعار إن أمكن — وإلا يمضي التصدير بلا شعار."""
    img = _logo_image()
    if img is not None:
        ws.add_image(img, anchor)


def _style_header(ws, row=1):
    for cell in ws[row]:
        if cell.value is not None:
            cell.font = Font(bold=True)


def _autosize(ws):
    for col_cells in ws.columns:
        length = max((len(str(c.value)) if c.value is not None else 0) for c in col_cells)
        letter = get_column_letter(col_cells[0].column)
        ws.column_dimensions[letter].width = min(max(length + 2, 10), 40)


# =============================================================================
# استعلامات مساعدة على حركات الدفتر مباشرة (ContractorEntry) — تخدم صيغ التصدير
# ١٤ التي تحتاج إسناداً حقيقياً بالمشروع أو تمييز «له كشف حقيقي» أو مقارنة
# الافتتاحي بالحركة، وهذه لا تُحسب في contractors_service.contractors_list_json
# اليوم. تُقيَّد كل الاستعلامات هنا بمجموعة أكواد الصفوف المصفّاة (codes) حتى
# تصف بالضبط ما تعرضه الشاشة، لا الدفتر كاملاً (قاعدة «ما تراه الشاشة يُصدَّر»).
# =============================================================================

def _statement_flags(db: Session, codes: set) -> dict:
    """code → {hasStatement, statementEntryCount} — مبني على حركات
    source='statement' (كشف حقيقي مرفوع) فقط، لا حركات اللقطة التركيبية
    (balance_snapshot) التي ينشئها استيراد تقرير المديونيات المجمّع تلقائياً
    لكل مقاول سطرين. الخلط بين الاثنين هو عطب م-٢٦: إبلاغ عن «تغطية كاملة»
    بينما مقاول واحد فقط له كشف حساب حقيقي مرفوع."""
    from app.db import models
    if not codes:
        return {}
    q = (db.query(models.Contractor.code, models.ContractorEntry.id)
         .join(models.ContractorEntry,
               models.ContractorEntry.contractor_id == models.Contractor.id)
         .filter(models.Contractor.code.in_(codes),
                 models.ContractorEntry.source == 'statement',
                 models.ContractorEntry.deleted_at.is_(None)))
    counts: dict = {}
    for code, _id in q.all():
        counts[code] = counts.get(code, 0) + 1
    return {c: dict(hasStatement=True, statementEntryCount=n) for c, n in counts.items()}


def _statement_flag(flags: dict, code: str) -> dict:
    """قيمة افتراضية آمنة لمقاول بلا أي حركة كشف حقيقي على الإطلاق."""
    return flags.get(code) or dict(hasStatement=False, statementEntryCount=0)


def _contractor_project_balances(db: Session, codes: set) -> List[dict]:
    """رصيد كل مقاول ضمن كل مشروع عمل عليه فعلاً، من حركات دفتره الحقيقية
    (ContractorEntry.project) — لا بالقسمة بالتساوي على مشاريعه (عطب م-٢٨).
    مقاولٌ له ١٠٠ ألف على مشروع وصفر على آخر يظهر هنا ١٠٠ ألف على الأول
    وصفراً على الثاني، لا ٥٠ ألفاً لكلٍّ. project='' → UNASSIGNED_LABEL."""
    from app.db import models
    if not codes:
        return []
    q = (db.query(models.Contractor.code, models.Contractor.name,
                  models.ContractorEntry.project,
                  models.ContractorEntry.debit, models.ContractorEntry.credit)
         .join(models.ContractorEntry,
               models.ContractorEntry.contractor_id == models.Contractor.id)
         .filter(models.Contractor.code.in_(codes),
                 models.ContractorEntry.deleted_at.is_(None)))
    per: dict = {}
    names: dict = {}
    for code, name, project, debit, credit in q.all():
        key = (code, project or UNASSIGNED_LABEL)
        per[key] = per.get(key, 0.0) + (debit or 0.0) - (credit or 0.0)
        names[code] = name
    out = []
    for (code, project), bal in per.items():
        if abs(bal) < 0.005:
            continue  # صفر تام لا يخدم قائمة دائنين/مدينين
        out.append(dict(project=project, code=code, name=names.get(code, ''),
                        balance=round(bal, 2),
                        unassigned=(project == UNASSIGNED_LABEL)))
    return out


def _project_totals(per_pairs: List[dict]) -> List[dict]:
    """يجمع _contractor_project_balances إلى صفّ واحد لكل مشروع — نظرة القرار
    (صيغة ٤). المجموع الكلي هنا يساوي بالضبط totals.owedToContractors/owedToUs
    لنفس مجموعة الأكواد، لأنه مبني من نفس الحركات بنفس المعادلة."""
    buckets: dict = {}
    for r in per_pairs:
        b = buckets.setdefault(r['project'], dict(owedToContractors=0.0, owedToUs=0.0,
                                                  count=0, unassigned=r['unassigned']))
        if r['balance'] < 0:
            b['owedToContractors'] += abs(r['balance'])
        else:
            b['owedToUs'] += r['balance']
        b['count'] += 1
    out = [dict(project=p, owedToContractors=round(b['owedToContractors'], 2),
               owedToUs=round(b['owedToUs'], 2), count=b['count'],
               unassigned=b['unassigned']) for p, b in buckets.items()]
    out.sort(key=lambda r: -r['owedToContractors'])
    return out


def _reported_vs_derived_rows(db: Session, codes: set, derived_by_code: dict) -> List[dict]:
    """يقارن الرصيد المُبلَّغ (تقرير المديونيات المجمّع، reported_balance) بالرصيد
    المشتقّ من حركات الدفتر لنفس مجموعة الأكواد المصفّاة. كل اختلاف > هللة واحدة
    يستحق النظر — قد يكون خطأ إدخال أو حركة ناقصة."""
    from app.db import models
    if not codes:
        return []
    rows = (db.query(models.Contractor)
            .filter(models.Contractor.code.in_(codes),
                    models.Contractor.deleted_at.is_(None),
                    models.Contractor.reported_balance.isnot(None)).all())
    out = []
    for r in rows:
        derived = derived_by_code.get(r.code, 0.0)
        diff = round((r.reported_balance or 0.0) - derived, 2)
        out.append(dict(code=r.code, name=r.name, reportedBalance=round(r.reported_balance, 2),
                        derivedBalance=round(derived, 2), diff=diff,
                        mismatch=abs(diff) > 0.01))
    out.sort(key=lambda r: -abs(r['diff']))
    return out


def _opening_vs_activity_rows(db: Session, codes: set) -> dict:
    """code → {openingBalance, activityBalance} — الرصيد الافتتاحي (kind='opening')
    مقابل بقية الحركات، من نفس معادلة الرصيد (مدين − دائن). دَينٌ راكد من قبل
    استعمال التطبيق أم نشاط هذا العام؟ البيانات مخزَّنة أصلاً ولا تُعرض حالياً."""
    from app.db import models
    if not codes:
        return {}
    q = (db.query(models.Contractor.code, models.ContractorEntry.kind,
                  models.ContractorEntry.debit, models.ContractorEntry.credit)
         .join(models.ContractorEntry,
               models.ContractorEntry.contractor_id == models.Contractor.id)
         .filter(models.Contractor.code.in_(codes),
                 models.ContractorEntry.deleted_at.is_(None)))
    out: dict = {}
    for code, kind, debit, credit in q.all():
        b = out.setdefault(code, dict(openingBalance=0.0, activityBalance=0.0))
        net = (debit or 0.0) - (credit or 0.0)
        if kind == 'opening':
            b['openingBalance'] += net
        else:
            b['activityBalance'] += net
    for b in out.values():
        b['openingBalance'] = round(b['openingBalance'], 2)
        b['activityBalance'] = round(b['activityBalance'], 2)
    return out


def _contractors_sheet(wb: Workbook, contractors: dict, first: bool = False):
    """ورقة المقاولون — no ageing columns: their ledger has no due dates."""
    ws = wb.active if first else wb.create_sheet('المقاولون')
    if first:
        ws.title = 'المقاولون'
    ws.sheet_view.rightToLeft = True
    ws.append(['كود المقاول', 'الاسم', 'المشاريع', 'المحمّل عليه', 'المدفوع',
               'خصومات وتحميلات', 'المستحق له', 'الرصيد'])
    _style_header(ws)
    for c in contractors.get('rows', []):
        ws.append([c.get('code', ''), c.get('name', ''),
                   '، '.join(c.get('projects') or []),
                   c.get('invoiced', 0), c.get('paid', 0), c.get('deductions', 0),
                   c.get('outstanding', 0), c.get('balance', 0)])
    t = contractors.get('totals') or {}
    if t:
        ws.append(['الإجمالي', '', '', t.get('invoiced', 0), t.get('paid', 0),
                   t.get('deductions', 0), t.get('outstanding', 0), t.get('balance', 0)])
        for cell in ws[ws.max_row]:
            cell.font = Font(bold=True)
    for r in range(2, ws.max_row + 1):
        for c in (4, 5, 6, 7, 8):
            cell = ws.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _autosize(ws)
    return ws


def _priorities_sheet(wb: Workbook, priorities: dict):
    """ورقة أولويات السداد — نفس القائمة الحتمية المعروضة في قسم التقرير التحليلي
    (F.build_priorities)، بلا عمود «ضمن الميزانية» — ذاك تقدير محلي في الواجهة
    فقط، فلا يُطبع كحقيقة من الخادم على وثيقة مُصدَّرة.
    """
    ws = wb.create_sheet('أولويات السداد')
    ws.sheet_view.rightToLeft = True
    ws.append(['#', 'الاسم', 'النوع', 'المبلغ (ر.س)', 'السبب'])
    _style_header(ws)
    for i, it in enumerate(priorities.get('items') or [], start=1):
        ws.append([i, it.get('name', ''),
                   'مقاول' if it.get('partyKind') == 'contractor' else 'مورد',
                   it.get('amount', 0), it.get('reason', '')])
    for r in range(2, ws.max_row + 1):
        cell = ws.cell(row=r, column=4)
        if isinstance(cell.value, (int, float)):
            cell.number_format = NUM_FMT
    _autosize(ws)
    return ws


# =============================================================================
# صيغ تصدير المقاولين الـ١٤ (docs/feedback/PLAN.md §٣)
#
# قرار التصميم: كل صيغة **ملف مستقل** بورقة تحليل واحدة (لا أوراق متعددة داخل
# ملف واحد لكل الصيغ معاً)، ما عدا «تقرير كامل» الذي يجمعها كلها كأوراق داخل
# ملف واحد لأن غرضه بالتعريف أن يكون كل شيء في مكان واحد. السبب: المستخدم يطبع
# هذه الملفات (راجع السياق في مهمة الوكيل) — ملف واحد بورقة واحدة يُفتح ويُطبع
# مباشرة بلا اختيار ورقة، وملف "لهم علينا" منفصل عن "لنا عليهم" لا يحتاج تنظيفاً
# قبل تسليمه لمحاسب أو طباعته وحده. صيغة «تقرير كامل» وحدها تكسر هذه القاعدة
# عمداً لأنها *بديل* عن فتح كل الملفات الأخرى واحداً واحداً.
# =============================================================================

def _sheet_title_block(ws, title: str, filters_label: str, count_label: str,
                       count: int) -> None:
    """سطر العنوان + سطر التصفية المطبَّقة أعلى كل ورقة — وإلا قُرئت ورقة مصفّاة
    كأنها القائمة كاملة (قاعدة صريحة في PLAN.md §٣-٣)."""
    ws.append([title])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=14)
    ws.append([f'التصفية المطبَّقة: {filters_label}'])
    ws.append([f'{count_label}: {count}'])
    ws.append([])


def _totals_block(ws, totals: dict) -> None:
    """الإجماليات في الأعلى — في كل صيغة، لا في التقرير الكامل وحده (قاعدة صريحة)."""
    ws.append(['الإجماليات'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.append(['البند', 'المبلغ (ر.س)'])
    _style_header(ws, ws.max_row)
    ws.append(['مستحق لهم علينا (owedToContractors)', totals.get('owedToContractors', 0)])
    ws.append(['مستحق لنا عليهم (owedToUs)', totals.get('owedToUs', 0)])
    ws.append(['الرصيد الصافي', totals.get('balance', 0)])
    ws.append(['التأمينات المحتجزة', totals.get('retentionHeld', 0)])
    for r in range(ws.max_row - 3, ws.max_row + 1):
        cell = ws.cell(row=r, column=2)
        if isinstance(cell.value, (int, float)):
            cell.number_format = NUM_FMT
    ws.append([])


_ROW_HEADERS = ['الكود', 'الاسم', 'المشاريع', 'له كشف حقيقي؟', 'عدد حركات الكشف',
               'المستحقات (مستخلصات)', 'المدفوع', 'خصومات', 'التأمين المحتجز',
               'الرصيد', 'الحالة', 'آخر دفعة — التاريخ', 'آخر دفعة — المبلغ', 'الهاتف']
_ROW_NUM_COLS = (6, 7, 8, 9, 10, 13)


def _row_values(r: dict, flags: dict) -> list:
    """صفّ جهة واحدة بالأعمدة المشتركة بين معظم الصيغ — الجهات بلا كشف تُوسَم
    صراحةً هنا (عمود «له كشف حقيقي؟») في كل صيغة تسرد جهات، لا في صيغة واحدة
    فقط: فراغ عمود الضمان بلا هذا الوسم يُقرأ «لا ضمان» وحقيقته «لم يُرفع كشفه»."""
    from app.services.contractors_service import CONTRACTOR_STATUS_LABELS_AR
    f = _statement_flag(flags, r.get('code', ''))
    lp = r.get('lastPayment') or {}
    return [r.get('code', ''), r.get('name', ''), '، '.join(r.get('projects') or []),
           'نعم' if f['hasStatement'] else 'لا', f['statementEntryCount'],
           r.get('duesTotal', 0), r.get('paidTotal', 0), r.get('deductionsTotal', 0),
           r.get('retentionHeld', 0), r.get('balance', 0),
           CONTRACTOR_STATUS_LABELS_AR.get(r.get('status', ''), r.get('status', '')),
           lp.get('date', ''), lp.get('amount', ''), r.get('phone', '')]


def _write_rows_sheet(ws, rows: List[dict], flags: dict) -> None:
    ws.append(_ROW_HEADERS)
    _style_header(ws)
    for r in rows:
        ws.append(_row_values(r, flags))
    header_row = ws.max_row - len(rows)
    for rr in range(header_row + 1, ws.max_row + 1):
        for c in _ROW_NUM_COLS:
            cell = ws.cell(row=rr, column=c)
            if isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool):
                cell.number_format = NUM_FMT


#: محارف يرفضها openpyxl في اسم الورقة، وحدّ الطول ٣١ محرفاً.
#: اسم الورقة يأتي أحياناً من اسم مشروع يكتبه المستخدم — ومشروعٌ اسمه
#: «روشن/المرحلة ٢» كان يُسقط التصدير كله بخطأ ٥٠٠ غامض بدل أن يُنتج ملفاً.
#: التنقية هنا في نقطة الإنشاء الوحيدة، فلا يمكن لمسارٍ جديد أن يفوتها.
_BAD_SHEET_CHARS = str.maketrans({c: '-' for c in '/\\?*[]:'})


def _safe_sheet_title(title: str) -> str:
    clean = (title or '').translate(_BAD_SHEET_CHARS).strip() or 'ورقة'
    return clean[:31]


def _new_ws(wb: Workbook, title: str, first: bool = False):
    safe = _safe_sheet_title(title)
    ws = wb.active if first else wb.create_sheet(safe)
    if first:
        ws.title = safe
    ws.sheet_view.rightToLeft = True
    return ws


def _finish_sheet(ws) -> None:
    _autosize(ws)
    _add_logo(ws, f'{get_column_letter(ws.max_column + 2)}1')


# ---------------------------------------------------------------- ١ · القائمة الكاملة
def _sheet_full_list(wb, data: dict, filters_label: str, db: Session, first=False):
    ws = _new_ws(wb, 'كل المقاولين', first)
    rows = data.get('rows') or []
    codes = {r.get('code', '') for r in rows}
    flags = _statement_flags(db, codes)
    _sheet_title_block(ws, 'القائمة الكاملة — المقاولون', filters_label,
                       'عدد المقاولين ضمن هذه التصفية', data.get('count', 0))
    _totals_block(ws, data.get('totals') or {})
    _write_rows_sheet(ws, rows, flags)
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ٢/٣/١٢ · اتجاه واحد
def _sheet_direction(wb, data: dict, filters_label: str, db: Session, title: str,
                     first=False):
    ws = _new_ws(wb, title, first)
    rows = data.get('rows') or []
    codes = {r.get('code', '') for r in rows}
    flags = _statement_flags(db, codes)
    _sheet_title_block(ws, title, filters_label, 'عدد الجهات ضمن هذه التصفية',
                       data.get('count', 0))
    _totals_block(ws, data.get('totals') or {})
    _write_rows_sheet(ws, rows, flags)
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ٤ · إجماليات المشاريع
def _sheet_project_totals(wb, data: dict, filters_label: str, db: Session, first=False):
    ws = _new_ws(wb, 'إجماليات المشاريع', first)
    rows = data.get('rows') or []
    codes = {r.get('code', '') for r in rows}
    per_pairs = _contractor_project_balances(db, codes)
    totals_by_project = _project_totals(per_pairs)
    _sheet_title_block(ws, 'إجماليات المشاريع — نظرة القرار', filters_label,
                       'عدد المشاريع', len(totals_by_project))
    _totals_block(ws, data.get('totals') or {})
    ws.append(['المشروع', 'عدد الجهات', 'مستحق لهم علينا', 'مستحق لنا عليهم', 'غير مُسنَد؟'])
    _style_header(ws, ws.max_row)
    header_row = ws.max_row
    for p in totals_by_project:
        ws.append([p['project'], p['count'], p['owedToContractors'], p['owedToUs'],
                  'نعم' if p['unassigned'] else ''])
    for rr in range(header_row + 1, ws.max_row + 1):
        for c in (3, 4):
            cell = ws.cell(row=rr, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ٥/٦ · بالمشروع ← تحته
def _sheet_by_project_nested(wb, data: dict, filters_label: str, db: Session,
                             want_negative: bool, title: str, first=False):
    """لكل مشروع: إجماليه ثم من له علينا (want_negative=True) أو من لنا عليه
    (want_negative=False) فيه، من حركات دفتره الحقيقية ضمن هذا المشروع تحديداً."""
    from app.services.contractors_service import CONTRACTOR_STATUS_LABELS_AR
    ws = _new_ws(wb, title, first)
    rows = data.get('rows') or []
    by_code = {r.get('code', ''): r for r in rows}
    codes = set(by_code.keys())
    flags = _statement_flags(db, codes)
    per_pairs = _contractor_project_balances(db, codes)
    per_pairs = [p for p in per_pairs
                if (p['balance'] < 0) == want_negative]
    totals_by_project = _project_totals(_contractor_project_balances(db, codes))
    total_key = 'owedToContractors' if want_negative else 'owedToUs'
    by_project_map = {p['project']: p for p in totals_by_project}

    _sheet_title_block(ws, title, filters_label, 'عدد المشاريع',
                       len({p['project'] for p in per_pairs}))
    _totals_block(ws, data.get('totals') or {})

    projects = sorted({p['project'] for p in per_pairs},
                      key=lambda p: -by_project_map.get(p, {}).get(total_key, 0))
    for proj in projects:
        b = by_project_map.get(proj, {})
        ws.append([f'مشروع: {proj}', '', f'الإجمالي: {b.get(total_key, 0)}',
                  f'عدد الجهات في المشروع: {b.get("count", 0)}'])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
        ws.append(['الكود', 'الاسم', 'له كشف حقيقي؟', 'الرصيد في هذا المشروع',
                  'الرصيد الكلي (كل المشاريع)', 'الحالة'])
        _style_header(ws, ws.max_row)
        header_row = ws.max_row
        sub = sorted((p for p in per_pairs if p['project'] == proj),
                    key=lambda p: p['balance'] if want_negative else -p['balance'])
        for p in sub:
            r = by_code.get(p['code'], {})
            f = _statement_flag(flags, p['code'])
            ws.append([p['code'], p['name'], 'نعم' if f['hasStatement'] else 'لا',
                      p['balance'], r.get('balance', 0),
                      CONTRACTOR_STATUS_LABELS_AR.get(r.get('status', ''), '')])
        for rr in range(header_row + 1, ws.max_row + 1):
            for c in (4, 5):
                cell = ws.cell(row=rr, column=c)
                if isinstance(cell.value, (int, float)):
                    cell.number_format = NUM_FMT
        ws.append([])
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ٧ · مشروع واحد
def _sheet_single_project(wb, data: dict, filters_label: str, db: Session,
                          project: str, first=False):
    """كل ما يخصّ مشروعاً بعينه — data مسبقاً مصفّاة على هذا المشروع (project=
    مُمرَّر إلى list_contractors)، فتصف الجهات المُسنَدة إليه، والمبالغ هنا مبنية
    من حركات كل جهة *ضمن هذا المشروع تحديداً* لا رصيدها الكلي عبر كل مشاريعها."""
    from app.services.contractors_service import CONTRACTOR_STATUS_LABELS_AR
    ws = _new_ws(wb, f'مشروع {project}'[:31], first)
    rows = data.get('rows') or []
    by_code = {r.get('code', ''): r for r in rows}
    codes = set(by_code.keys())
    flags = _statement_flags(db, codes)
    per_pairs = [p for p in _contractor_project_balances(db, codes)
                if p['project'] == project]
    owed = round(sum(abs(p['balance']) for p in per_pairs if p['balance'] < 0), 2)
    owed_us = round(sum(p['balance'] for p in per_pairs if p['balance'] > 0), 2)

    _sheet_title_block(ws, f'مشروع: {project}', filters_label, 'عدد الجهات في المشروع',
                       len(per_pairs))
    ws.append(['مستحق لهم علينا في هذا المشروع', owed])
    ws.append(['مستحق لنا عليهم في هذا المشروع', owed_us])
    for rr in (ws.max_row - 1, ws.max_row):
        cell = ws.cell(row=rr, column=2)
        cell.number_format = NUM_FMT
    ws.append([])

    ws.append(['الكود', 'الاسم', 'له كشف حقيقي؟', 'الرصيد في هذا المشروع',
              'الرصيد الكلي (كل مشاريعه)', 'الحالة'])
    _style_header(ws, ws.max_row)
    header_row = ws.max_row
    for p in sorted(per_pairs, key=lambda p: p['balance']):
        r = by_code.get(p['code'], {})
        f = _statement_flag(flags, p['code'])
        ws.append([p['code'], p['name'], 'نعم' if f['hasStatement'] else 'لا',
                  p['balance'], r.get('balance', 0),
                  CONTRACTOR_STATUS_LABELS_AR.get(r.get('status', ''), '')])
    for rr in range(header_row + 1, ws.max_row + 1):
        for c in (4, 5):
            cell = ws.cell(row=rr, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ٩ · كشف جهة واحدة
def _sheet_single_statement(wb, detail: dict, code: str, first=False):
    """كشف مقاول واحد — يُرسَل إليه للمطابقة. detail من
    contractors_service.contractor_detail_json (استدعاء قراءة فقط، لا تعديل
    لملف contractors_service.py المملوك لوكيل آخر)."""
    ws = _new_ws(wb, f'كشف {code}'[:31], first)
    ws.append([f"كشف حساب — {detail.get('name', '')} ({code})"])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=14)
    ws.append([f"الهاتف: {detail.get('phone', '')}"])
    ws.append([f"المشاريع: {'، '.join(detail.get('projects') or [])}"])
    ws.append([])
    ws.append(['الرصيد الحالي', detail.get('balance', 0)])
    ws.append(['إجمالي المستخلصات', detail.get('duesTotal', 0)])
    ws.append(['إجمالي المدفوع', detail.get('paidTotal', 0)])
    ws.append(['التأمين المحتجز', detail.get('retentionTotal', 0)])
    for rr in range(ws.max_row - 3, ws.max_row + 1):
        cell = ws.cell(row=rr, column=2)
        if isinstance(cell.value, (int, float)):
            cell.number_format = NUM_FMT
    ws.append([])

    ws.append(['التاريخ', 'النوع', 'المشروع', 'الوصف', 'رقم المستخلص', 'مدين', 'دائن',
              'المصدر'])
    _style_header(ws, ws.max_row)
    header_row = ws.max_row
    _KIND_LABELS = dict(claim='مستخلص', payment='دفعة', retention='تأمين/ضمان',
                        deduction='خصم', invoice='فاتورة محمّلة', opening='رصيد افتتاحي',
                        other='أخرى')
    _SOURCE_LABELS = dict(statement='كشف مرفوع', manual='يدوي',
                         balance_snapshot='لقطة رصيد (بلا كشف تفصيلي)')
    for e in detail.get('entries') or []:
        ws.append([e.get('date', ''), _KIND_LABELS.get(e.get('kind', ''), e.get('kind', '')),
                  e.get('project', ''), e.get('description', ''), e.get('claimNo', ''),
                  e.get('debit', 0), e.get('credit', 0),
                  _SOURCE_LABELS.get(e.get('source', ''), e.get('source', ''))])
    for rr in range(header_row + 1, ws.max_row + 1):
        for c in (6, 7):
            cell = ws.cell(row=rr, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ١٠ · بلا كشف مرفوع
def _sheet_missing_statement(wb, data: dict, filters_label: str, db: Session, first=False):
    """قائمة عمل: الجهات ضمن التصفية الحالية التي لم يُرفع لها كشف حساب حقيقي
    بعد (source='statement') — تحوّل النقص من تحذير عام إلى مهمة بأسماء وأكواد."""
    ws = _new_ws(wb, 'بلا كشف مرفوع', first)
    rows = data.get('rows') or []
    codes = {r.get('code', '') for r in rows}
    flags = _statement_flags(db, codes)
    missing = [r for r in rows if not _statement_flag(flags, r.get('code', ''))['hasStatement']]
    _sheet_title_block(ws, 'بلا كشف مرفوع — قائمة عمل', filters_label,
                       'عدد الجهات بلا كشف حقيقي', len(missing))
    _totals_block(ws, data.get('totals') or {})
    _write_rows_sheet(ws, missing, flags)
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ١١ · المبلَّغ مقابل المشتقّ
def _sheet_reported_vs_derived(wb, data: dict, filters_label: str, db: Session, first=False):
    ws = _new_ws(wb, 'المبلَّغ مقابل المشتقّ', first)
    rows = data.get('rows') or []
    codes = {r.get('code', '') for r in rows}
    derived_by_code = {r.get('code', ''): r.get('balance', 0) for r in rows}
    cmp_rows = _reported_vs_derived_rows(db, codes, derived_by_code)
    n_mismatch = sum(1 for r in cmp_rows if r['mismatch'])
    _sheet_title_block(ws, 'المبلَّغ (تقرير المديونيات) مقابل المشتقّ (الحركات)',
                       filters_label, 'عدد الجهات ذات رصيد مُبلَّغ', len(cmp_rows))
    ws.append([f'عدد الاختلافات (> ٠.٠١ ر.س) التي تستحق النظر: {n_mismatch}'])
    ws.append([])
    ws.append(['الكود', 'الاسم', 'الرصيد المُبلَّغ', 'الرصيد المشتقّ من الحركات',
              'الفرق', 'يستحق المراجعة؟'])
    _style_header(ws, ws.max_row)
    header_row = ws.max_row
    for r in cmp_rows:
        ws.append([r['code'], r['name'], r['reportedBalance'], r['derivedBalance'],
                  r['diff'], 'نعم' if r['mismatch'] else ''])
    for rr in range(header_row + 1, ws.max_row + 1):
        for c in (3, 4, 5):
            cell = ws.cell(row=rr, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ١٣ · بالحالة
def _sheet_by_status(wb, data: dict, filters_label: str, db: Session, first=False):
    from app.services.contractors_service import CONTRACTOR_STATUS_LABELS_AR
    ws = _new_ws(wb, 'بالحالة', first)
    rows = data.get('rows') or []
    codes = {r.get('code', '') for r in rows}
    flags = _statement_flags(db, codes)
    totals = data.get('totals') or {}
    by_status = totals.get('byStatus') or {}
    _sheet_title_block(ws, 'التوزيع بالحالة', filters_label, 'عدد الحالات المختلفة',
                       len(by_status))
    _totals_block(ws, totals)
    ws.append(['الحالة', 'العدد', 'الرصيد', 'مستحق لهم علينا', 'مستحق لنا عليهم'])
    _style_header(ws, ws.max_row)
    header_row = ws.max_row
    for status, b in sorted(by_status.items(), key=lambda kv: -kv[1].get('owedToContractors', 0)):
        label = CONTRACTOR_STATUS_LABELS_AR.get(status, status)
        ws.append([label, b.get('count', 0), b.get('balance', 0),
                  b.get('owedToContractors', 0), b.get('owedToUs', 0)])
    for rr in range(header_row + 1, ws.max_row + 1):
        for c in (3, 4, 5):
            cell = ws.cell(row=rr, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    ws.append([])

    # للمراجعة القانونية: تفصيل حالتي «متنازع عليه» و«قائمة سوداء» تحديداً بأسماء
    for status in ('disputed', 'blacklisted'):
        subset = [r for r in rows if r.get('status') == status]
        if not subset:
            continue
        ws.append([CONTRACTOR_STATUS_LABELS_AR.get(status, status)])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
        _write_rows_sheet(ws, subset, flags)
        ws.append([])
    _finish_sheet(ws)
    return ws


# ---------------------------------------------------------------- ١٤ · الافتتاحي مقابل الحركة
def _sheet_opening_vs_activity(wb, data: dict, filters_label: str, db: Session, first=False):
    ws = _new_ws(wb, 'الافتتاحي مقابل الحركة', first)
    rows = data.get('rows') or []
    codes = {r.get('code', '') for r in rows}
    flags = _statement_flags(db, codes)
    by_code = _opening_vs_activity_rows(db, codes)
    _sheet_title_block(ws, 'الرصيد الافتتاحي مقابل نشاط الحركة', filters_label,
                       'عدد الجهات ذات حركات دفتر', len(by_code))
    _totals_block(ws, data.get('totals') or {})
    ws.append(['الكود', 'الاسم', 'له كشف حقيقي؟', 'الرصيد الافتتاحي', 'نشاط الحركة',
              'الرصيد الكلي', 'الأغلب: افتتاحي راكد أم نشاط؟'])
    _style_header(ws, ws.max_row)
    header_row = ws.max_row
    by_name = {r.get('code', ''): r.get('name', '') for r in rows}
    for code, b in sorted(by_code.items(), key=lambda kv: kv[1]['openingBalance'] + kv[1]['activityBalance']):
        f = _statement_flag(flags, code)
        dominant = 'افتتاحي راكد' if abs(b['openingBalance']) >= abs(b['activityBalance']) \
            else 'نشاط جديد'
        ws.append([code, by_name.get(code, ''), 'نعم' if f['hasStatement'] else 'لا',
                  b['openingBalance'], b['activityBalance'],
                  round(b['openingBalance'] + b['activityBalance'], 2), dominant])
    for rr in range(header_row + 1, ws.max_row + 1):
        for c in (4, 5, 6):
            cell = ws.cell(row=rr, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _finish_sheet(ws)
    return ws


#: الصيغ الاثنتا عشرة القابلة للتجميع في «تقرير كامل» — كل عنصر (عنوان، دالة
#: بناء) يُستدعى بترتيب واحد. لا تشمل «مشروع واحد» و«كشف جهة واحدة»: تحتاجان
#: مُعطى إضافياً (اسم مشروع / كود) لا معنى له في تقرير شامل لكل الجهات.
def build_contractors_full_report(data: dict, filters_label: str, db: Session) -> bytes:
    """صيغة ٨ — تقرير كامل: الإجماليات في الأعلى (على مستوى الملف) ثم كل الصيغ
    القابلة للتجميع كأوراق داخل ملف واحد."""
    wb = Workbook()
    _sheet_full_list(wb, data, filters_label, db, first=True)
    _sheet_direction(wb, _subset(data, lambda r: r['balance'] < 0), filters_label, db,
                     'لهم علينا')
    _sheet_direction(wb, _subset(data, lambda r: r['balance'] > 0), filters_label, db,
                     'لنا عليهم')
    _sheet_project_totals(wb, data, filters_label, db)
    _sheet_by_project_nested(wb, data, filters_label, db, True, 'بالمشروع - الدائنون')
    _sheet_by_project_nested(wb, data, filters_label, db, False, 'بالمشروع - المدينون')
    _sheet_missing_statement(wb, data, filters_label, db)
    _sheet_reported_vs_derived(wb, data, filters_label, db)
    _sheet_direction(wb, _subset(data, lambda r: r['balance'] == 0), filters_label, db,
                     'المتساوية والخاملة')
    _sheet_by_status(wb, data, filters_label, db)
    _sheet_opening_vs_activity(wb, data, filters_label, db)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _subset(data: dict, predicate) -> dict:
    """ينسخ data['rows'] المصفّاة إلى مجموعة فرعية بنفس شكل payload القائمة —
    totals تبقى totals الأصلية (تصف كل التصفية المطبَّقة، لا المجموعة الفرعية
    وحدها) لأن هذه الأوراق تُبنى *داخل* تقرير كامل عن نفس التصفية بالضبط."""
    rows = [r for r in (data.get('rows') or []) if predicate(r)]
    out = dict(data)
    out['rows'] = rows
    out['count'] = len(rows)
    return out


def build_project_summary_workbook(payload: dict) -> bytes:
    """ورقة واحدة — ملخّص المشروع بسطر واحد لكل شركة، بنفس آلية build_workbook.

    عمود «أقصى تأخر» و«شريحته» يُتركان فارغين للمقاولين — لا يُخترع صفر لتأخر
    لا معنى محاسبياً له (انظر تعليق `delay` في report_service.project_summary).
    """
    wb = Workbook()
    ws = wb.active
    ws.title = 'ملخص المشروع'
    ws.sheet_view.rightToLeft = True
    ws.append(['اسم الشركة', 'رقم الحساب', 'نوع الطرف', 'إجمالي المفوتر', 'المسدد',
               'المتبقي', 'المتأخر', 'أقصى تأخر (يوم)', 'آخر دفعة — التاريخ',
               'آخر دفعة — المبلغ'])
    _style_header(ws)
    for r in payload.get('rows', []):
        delay = r.get('delay') or {}
        lp = r.get('lastPayment') or {}
        ws.append([
            r.get('name', ''), r.get('account', ''),
            'مقاول' if r.get('partyKind') == 'contractor' else 'مورد',
            r.get('totalInvoiced', 0), r.get('totalPaid', 0), r.get('outstanding', 0),
            delay.get('amount', '') if r.get('delay') is not None else '—',
            delay.get('days', '') if r.get('delay') is not None else '—',
            lp.get('date', ''), lp.get('amount', ''),
        ])
    t = payload.get('totals') or {}
    if t:
        ws.append(['الإجمالي', '', '', t.get('totalInvoiced', 0), t.get('totalPaid', 0),
                   t.get('outstanding', 0), t.get('delayedAmount', 0),
                   t.get('maxDelayDays', 0), '', ''])
        for cell in ws[ws.max_row]:
            cell.font = Font(bold=True)
    for r in range(2, ws.max_row + 1):
        for c in (4, 5, 6, 7, 8, 10):
            cell = ws.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _autosize(ws)
    _add_logo(ws, f'{get_column_letter(ws.max_column + 2)}1')
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


#: تسميات عربية لاتجاه الرصيد — نفس القيم المستعملة في تصفية /contractors
#: (_VALID_DIRECTIONS في routes/contractors.py) بترجمة عربية لعرض ورقة التحليل.
_DIRECTION_LABELS_AR = {
    'owed_to_them': 'لهم علينا', 'owed_to_us': 'لنا عليهم', 'balanced': 'متساوٍ',
}


def build_contractors_export_workbook(data: dict, filters_label: str, db: Session) -> bytes:
    """تصدير المقاولين — ورقتان: «تحليل المقاولين» (الأولى، مبنية من نفس rows
    المصفّاة التي يعرضها الجدول) ثم «المقاولون» (الجدول الخام، عبر _contractors_sheet
    المُعاد استعمالها من build_workbook). العمل السابق ترك استدعاءً لهذه الدالة
    بلا تعريفها إطلاقاً — GET /contractors/export.xlsx كان يعيد ٥٠٠ دائماً.

    الورقة التحليلية مبنية من data['rows'] المصفّاة نفسها لا من الدفتر كاملاً، وإلا
    ناقض التصدير ما تعرضه الشاشة فعلاً (نفس مبدأ priorities/analysis في الموردين).

    `db` إلزامي الآن — التوزيع بالمشروع يُبنى من حركات الدفتر الحقيقية
    (_contractor_project_balances) لا بالقسمة بالتساوي على مشاريع كل مقاول
    (عطب م-٢٨ الموثَّق في PLAN.md §٢: مقاولٌ له ١٠٠ ألف على مشروع وصفر على آخر
    كان يظهر ٥٠ ألفاً لكلٍّ منهما — رقمٌ لا وجود له في الدفتر يُطبَع ويُقرَّر عليه).
    """
    from app.services.contractors_service import CONTRACTOR_STATUS_LABELS_AR

    wb = Workbook()
    rows = data.get('rows') or []
    totals = data.get('totals') or {}

    # ---------------------------------------------------------- ورقة التحليل
    ws = wb.active
    ws.title = 'تحليل المقاولين'
    ws.sheet_view.rightToLeft = True

    ws.append(['تحليل المقاولين'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=14)
    ws.append([f'التصفية المطبَّقة: {filters_label}'])
    ws.append([f'عدد المقاولين ضمن هذه التصفية: {totals.get("count", 0)}'])
    ws.append([])

    ws.append(['الإجماليات بالاتجاه'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.append(['البند', 'المبلغ (ر.س)'])
    _style_header(ws, ws.max_row)
    ws.append(['مستحق لهم علينا (owedToContractors)', totals.get('owedToContractors', 0)])
    ws.append(['مستحق لنا عليهم (owedToUs)', totals.get('owedToUs', 0)])
    ws.append(['الرصيد الصافي', totals.get('balance', 0)])
    ws.append(['التأمينات المحتجزة', totals.get('retentionHeld', 0)])
    ws.append([])

    # ---- التوزيع بالمشروع — من حركات الدفتر الحقيقية (ContractorEntry.project) لكل
    # مقاول ضمن هذه المجموعة المصفّاة، لا بالقسمة بالتساوي (عطب م-٢٨، انظر تعليق
    # الدالة). project='' → UNASSIGNED_LABEL يُعرض صراحةً ولا يُقسَّم على مشاريع أخرى.
    codes = {r.get('code', '') for r in rows}
    by_project = _project_totals(_contractor_project_balances(db, codes))
    ws.append(['التوزيع بالمشروع'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.append(['المشروع', 'عدد المقاولين', 'مستحق لهم علينا', 'مستحق لنا عليهم'])
    _style_header(ws, ws.max_row)
    for p in by_project:
        ws.append([p['project'], p['count'], p['owedToContractors'], p['owedToUs']])
    ws.append([])

    # ---- التوزيع بالحالة
    ws.append(['التوزيع بالحالة'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.append(['الحالة', 'العدد', 'الرصيد', 'مستحق لهم علينا', 'مستحق لنا عليهم'])
    _style_header(ws, ws.max_row)
    by_status = totals.get('byStatus') or {}
    for status, b in sorted(by_status.items(), key=lambda kv: -kv[1]['owedToContractors']):
        label = CONTRACTOR_STATUS_LABELS_AR.get(status, status)
        ws.append([label, b.get('count', 0), b.get('balance', 0),
                  b.get('owedToContractors', 0), b.get('owedToUs', 0)])
    ws.append([])

    # ---- أعلى ١٠ في كل اتجاه — من يحتاج قرار سداد أولاً، ومن يستحق متابعة تحصيل.
    # يتضمن آخر دفعة وهاتف المقاول: مدير مالي أمام قائمة دائنين يحتاج «متى دفعنا
    # له آخر مرة» و«كيف أتواصل معه» في نفس الصف لا في كشف منفصل، وإلا يعود للنظام
    # يبحث عن هذين الحقلين لكل اسم في القائمة يدوياً.
    owed_them = sorted((r for r in rows if r['balance'] < 0), key=lambda r: r['balance'])[:10]
    owed_us = sorted((r for r in rows if r['balance'] > 0),
                     key=lambda r: -r['balance'])[:10]
    for title, subset in (('أعلى ١٠ — لهم علينا', owed_them),
                          ('أعلى ١٠ — لنا عليهم', owed_us)):
        ws.append([title])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
        ws.append(['الكود', 'الاسم', 'الرصيد', 'آخر دفعة — التاريخ', 'آخر دفعة — المبلغ',
                  'الهاتف', 'الحالة'])
        _style_header(ws, ws.max_row)
        for r in subset:
            lp = r.get('lastPayment') or {}
            ws.append([r.get('code', ''), r.get('name', ''), r.get('balance', 0),
                      lp.get('date', ''), lp.get('amount', ''), r.get('phone', ''),
                      CONTRACTOR_STATUS_LABELS_AR.get(r.get('status', ''), r.get('status', ''))])
        ws.append([])

    # تنسيق الأرقام على كل الأعمدة الرقمية المحتملة في الورقة
    for r in range(2, ws.max_row + 1):
        for c in range(2, 6):
            cell = ws.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool):
                cell.number_format = NUM_FMT
    _autosize(ws)
    _add_logo(ws, f'{get_column_letter(ws.max_column + 2)}1')

    # ---------------------------------------------------------- ورقة الجدول الخام
    _contractors_sheet(wb, data, first=False)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


#: يربط قيمة format= في GET /contractors/export.xlsx بدالة بناء ورقة واحدة —
#: كل صيغة غير full/full_report/single_project/single_statement ملف بورقة
#: واحدة (انظر تعليق التصميم أعلى _sheet_title_block). القيمة تُستدعى بـ
#: (wb, data, filters_label, db, first=True)، فتبني نفس التوقيع تماماً.
_SINGLE_SHEET_BUILDERS = {
    'creditors': lambda wb, data, fl, db, **kw: _sheet_direction(
        wb, data, fl, db, 'لهم علينا فقط', first=True),
    'debtors': lambda wb, data, fl, db, **kw: _sheet_direction(
        wb, data, fl, db, 'لنا عليهم فقط', first=True),
    'project_totals': lambda wb, data, fl, db, **kw: _sheet_project_totals(
        wb, data, fl, db, first=True),
    'by_project_creditors': lambda wb, data, fl, db, **kw: _sheet_by_project_nested(
        wb, data, fl, db, True, 'بالمشروع - الدائنون تحته', first=True),
    'by_project_debtors': lambda wb, data, fl, db, **kw: _sheet_by_project_nested(
        wb, data, fl, db, False, 'بالمشروع - المدينون تحته', first=True),
    'missing_statement': lambda wb, data, fl, db, **kw: _sheet_missing_statement(
        wb, data, fl, db, first=True),
    'reported_vs_derived': lambda wb, data, fl, db, **kw: _sheet_reported_vs_derived(
        wb, data, fl, db, first=True),
    'balanced_dormant': lambda wb, data, fl, db, **kw: _sheet_direction(
        wb, data, fl, db, 'المتساوية والخاملة', first=True),
    'by_status': lambda wb, data, fl, db, **kw: _sheet_by_status(
        wb, data, fl, db, first=True),
    'opening_vs_activity': lambda wb, data, fl, db, **kw: _sheet_opening_vs_activity(
        wb, data, fl, db, first=True),
}

#: قيم format= الصالحة — تُستعمل في routes/contractors.py للتحقق قبل التنفيذ.
CONTRACTOR_EXPORT_FORMATS = (
    ('full',) + tuple(_SINGLE_SHEET_BUILDERS.keys()) +
    ('single_project', 'single_statement', 'full_report'))


def build_contractors_format_workbook(fmt: str, data: dict, filters_label: str,
                                      db: Session, project: Optional[str] = None,
                                      code: Optional[str] = None,
                                      detail: Optional[dict] = None) -> bytes:
    """المُوزِّع المركزي لصيغ تصدير المقاولين الـ١٤ — استدعاء واحد من
    routes/contractors.py لأي format= صالح. 'full' و'full_report' لهما بناء خاص
    (تحليل + جدول خام / تجميع كل الصيغ)؛ 'single_project'/'single_statement'
    يحتاجان `project`/`code`+`detail` على الترتيب؛ البقية أوراق مفردة عبر
    _SINGLE_SHEET_BUILDERS أعلاه."""
    if fmt == 'full':
        return build_contractors_export_workbook(data, filters_label, db)
    if fmt == 'full_report':
        return build_contractors_full_report(data, filters_label, db)
    if fmt == 'single_project':
        wb = Workbook()
        _sheet_single_project(wb, data, filters_label, db, project or '', first=True)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()
    if fmt == 'single_statement':
        wb = Workbook()
        _sheet_single_statement(wb, detail or {}, code or '', first=True)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()
    builder = _SINGLE_SHEET_BUILDERS.get(fmt)
    if builder is None:
        raise ValueError(f'صيغة تصدير غير معروفة: {fmt}')
    wb = Workbook()
    builder(wb, data, filters_label, db)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_workbook(analysis: dict, periodic: Optional[dict] = None,
                   suppliers_rows: Optional[list] = None,
                   contractors_only: bool = False,
                   priorities: Optional[dict] = None) -> bytes:
    wb = Workbook()

    if contractors_only:
        # تقرير مقاول واحد — his sheet and nothing else; the supplier sheets would be
        # empty and would read as "no debts" rather than "not in scope".
        ws0 = _contractors_sheet(wb, analysis.get('contractors') or {}, first=True)
        _add_logo(ws0, f'{get_column_letter(ws0.max_column + 2)}1')
        if priorities is not None:
            _priorities_sheet(wb, priorities)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    # ---- الملخص
    ws1 = wb.active
    ws1.title = 'الملخص'
    ws1.sheet_view.rightToLeft = True
    meta = analysis['meta']
    summary = analysis['summary']
    rows = [
        ('الشركة', meta.get('company', '')),
        ('الفترة', meta.get('period', '')),
        ('رصيد أول المدة', meta.get('opening_balance', 0)),
        ('رصيد آخر المدة', meta.get('closing_balance', summary.get('outstanding', 0))),
        ('إجمالي الفواتير', summary.get('total_invoiced', 0)),
        ('إجمالي المسدد', summary.get('total_paid', 0)),
        ('المديونية القائمة', summary.get('outstanding', 0)),
        ('المتأخر', summary.get('overdue', 0)),
        ('مستحق خلال ٧ أيام', summary.get('due_within_7', 0)),
        ('عدد الموردين', summary.get('supplier_count', 0)),
    ]
    if analysis.get('contractors') is not None:
        rows += [('النطاق', meta.get('scope_label', '')),
                 ('عدد المقاولين', summary.get('contractor_count', 0)),
                 ('رصيد المقاولين', summary.get('contractor_balance', 0))]
    ws1.append(['البند', 'القيمة'])
    _style_header(ws1)
    for label, value in rows:
        ws1.append([label, value])
    for r in range(2, ws1.max_row + 1):
        cell = ws1.cell(row=r, column=2)
        if isinstance(cell.value, (int, float)):
            cell.number_format = NUM_FMT
    _autosize(ws1)
    _add_logo(ws1, 'D1')

    # ---- الفترات
    ws2 = wb.create_sheet('الفترات')
    ws2.sheet_view.rightToLeft = True
    headers2 = ['الفترة', 'من', 'إلى', 'الرصيد الافتتاحي', 'المفوتر', 'المسدد',
               'الصافي', 'الرصيد الختامي', 'متوسط أيام السداد']
    ws2.append(headers2)
    _style_header(ws2)
    if periodic:
        for p in periodic['periods']:
            ws2.append([p['label'], p['from'], p['to'], p['opening'], p['invoiced'],
                       p['paid'], p['net'], p['closing'],
                       p['avgSettlementDays'] if p['avgSettlementDays'] is not None else ''])
    for r in range(2, ws2.max_row + 1):
        for c in (4, 5, 6, 7, 8, 9):
            cell = ws2.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _autosize(ws2)

    # ---- الموردون
    ws3 = wb.create_sheet('الموردون')
    ws3.sheet_view.rightToLeft = True
    ws3.append(['رقم الحساب', 'الاسم', 'المشروع', 'المدة', 'المديونية القائمة', 'المتأخر'])
    _style_header(ws3)
    supplier_rows = suppliers_rows if suppliers_rows is not None else analysis.get('suppliers', [])
    for s in supplier_rows:
        ws3.append([s.get('account', ''), s.get('name', ''), s.get('project', ''),
                   s.get('term', ''), s.get('outstanding', 0), s.get('overdue', 0)])
    for r in range(2, ws3.max_row + 1):
        for c in (5, 6):
            cell = ws3.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _autosize(ws3)

    if analysis.get('contractors') is not None:
        _contractors_sheet(wb, analysis['contractors'])

    if priorities is not None:
        _priorities_sheet(wb, priorities)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# =============================================================================
# تصدير الموازنة — GET /api/v1/budget/export.xlsx (docs/feedback/PLAN-BUDGET.md
# §٥-٤). يُصدَّر بالضبط ما يعرضه GET /budget بنفس فلاتره — لا الدفتر كاملاً
# (نفس قاعدة export_suppliers_xlsx/export_contractors_xlsx أعلاه). `data` هنا هو
# استجابة budget_service.budget_list_json نفسها بحرفها — لا حساب محلي جديد.
# =============================================================================

#: تلوين اتجاه التراكمي (لا عتبة سحرية — انظر PLAN-BUDGET §٥-١): أخضر فاتح حين
#: الفعلي التراكمي أعلى من المخطط (إنجاز أعلى)، أحمر فاتح للعكس، بلا تلوين حين
#: يتطابقان تماماً.
_FILL_AHEAD = PatternFill(start_color='FFC6EFCE', end_color='FFC6EFCE', fill_type='solid')
_FILL_BEHIND = PatternFill(start_color='FFFFC7CE', end_color='FFFFC7CE', fill_type='solid')

_BUDGET_STATUS_LABELS_AR = {'ahead': 'متقدّم', 'behind': 'متأخر', 'on_track': 'مطابق'}
_BUDGET_SOURCE_LABELS_AR = {'file': 'ملف', 'manual': 'يدوي'}


def budget_filters_label(filters: dict) -> str:
    """نص عربي واحد يصف كل تصفية مُطبَّقة على الموازنة — نفس دور _filters_label
    في المقاولين، يُطبع أعلى ورقة التحليل حتى لا يُقرأ ملفٌ مُصدَّر لاحقاً على
    أنه يصف كل المشاريع وهو في الحقيقة مصفّى."""
    parts = []
    if filters.get('project'):
        parts.append(f"مشروع: {filters['project']}")
    if filters.get('city'):
        parts.append(f"مدينة: {filters['city']}")
    if filters.get('fromMonth') or filters.get('toMonth'):
        parts.append(f"المدة: {filters.get('fromMonth') or '—'} ← {filters.get('toMonth') or '—'}")
    if filters.get('status'):
        parts.append(f"الحالة: {_BUDGET_STATUS_LABELS_AR.get(filters['status'], filters['status'])}")
    if filters.get('hasClaims') is not None:
        parts.append('لها مستخلصات' if filters['hasClaims'] else 'بلا مستخلصات')
    return '؛ '.join(parts) if parts else 'بلا تصفية — كل المشاريع وكل الأشهر'


def _budget_missing_range_rows(db: Session, filters: dict) -> List[str]:
    """يكتشف مشروعاً **ضمن التصفية** لا يملك أي شهر داخل مدى from_month/to_month
    المختار رغم أن له لقطات حقيقية خارج هذه المدة — الخطر الرابع في PLAN-BUDGET
    §٨: «الفراغ يُقرأ صفراً في مدة بلا بيانات». لا معنى لهذا الفحص بلا مدى تاريخ،
    فيُعاد فارغاً حينها. يعتمد على استعلامات مباشرة على BudgetSnapshot لأنه يحتاج
    رؤية ما *خارج* التصفية أيضاً (اللقطات خارج المدى) لا ما تعرضه الشاشة فقط."""
    from app.db import models
    import datetime as _dt

    from_month, to_month = filters.get('fromMonth'), filters.get('toMonth')
    if not from_month and not to_month:
        return []
    from_d = _dt.date.fromisoformat(from_month) if from_month else None
    to_d = _dt.date.fromisoformat(to_month) if to_month else None

    q = db.query(models.BudgetSnapshot.project, models.BudgetSnapshot.month).filter(
        models.BudgetSnapshot.deleted_at.is_(None))
    if filters.get('project'):
        q = q.filter(models.BudgetSnapshot.project == filters['project'])
    if filters.get('city'):
        city_projects = {c.project for c in db.query(models.ProjectCity.project)
                         .filter(models.ProjectCity.city == filters['city'],
                                 models.ProjectCity.deleted_at.is_(None)).all()}
        if not city_projects:
            return []
        q = q.filter(models.BudgetSnapshot.project.in_(city_projects))

    by_project: dict = {}
    for project, month in q.all():
        by_project.setdefault(project, []).append(month)

    warnings = []
    for project, months in sorted(by_project.items()):
        in_range = [m for m in months
                   if (not from_d or m >= from_d) and (not to_d or m <= to_d)]
        if not in_range and months:
            first, last = min(months), max(months)
            warnings.append(
                f'مشروع «{project}»: لا يوجد أي شهر مُسجَّل ضمن المدة '
                f'{from_month or "—"} ← {to_month or "—"} — لقطاته الفعلية '
                f'تمتد من {first.isoformat()} إلى {last.isoformat()}. الفراغ هنا '
                f'لا يعني صفراً، بل أن المدة المختارة لا تغطي هذا المشروع.')
    return warnings


def build_budget_export_workbook(data: dict, filters_label: str, db: Session,
                                 filters: Optional[dict] = None) -> bytes:
    """ورقة تحليل أولى للموازنة — الإجماليات المجمَّعة أعلاها، ثم سطر التصفية
    المطبَّقة صراحةً، ثم جدول الأشهر بالمشروع ملوَّناً بالاتجاه (لا بعتبة)، ثم
    المستخلصات، وأخيراً تنويه صريح لأي مشروع ضمن التصفية بلا شهر في المدة
    المختارة. `data` هو خرج budget_service.budget_list_json حرفياً — لا حساب
    محلي جديد للأرقام هنا، القيم كلها منسوخة كما وصلت من محرك الحساب المختبَر.
    """
    filters = filters or (data.get('filtersApplied') or {})
    rows = data.get('rows') or []
    totals = data.get('totals') or {}

    wb = Workbook()
    ws = wb.active
    ws.title = 'تحليل الموازنة'
    ws.sheet_view.rightToLeft = True

    ws.append(['تحليل الموازنة التقديرية'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=14)
    ws.append([f'التصفية المطبَّقة: {filters_label}'])
    ws.append([f'عدد الأشهر ضمن هذه التصفية: {data.get("count", 0)}'])
    ws.append([])

    # ---- الإجماليات المجمَّعة في الأعلى (فعلي/مخطط/انحراف/نسبة إنجاز) — من
    # totals الجاهزة نفسها التي يعرضها GET /budget، لا حساب محلي جديد.
    cum_actual_t = totals.get('cumActual', 0) or 0
    cum_planned_t = totals.get('cumPlanned', 0) or 0
    deviation_t = (totals.get('actualMonth', 0) or 0) - (totals.get('plannedMonth', 0) or 0)
    completion_t = (cum_actual_t / cum_planned_t) if cum_planned_t else None
    delay_t = (1.0 - completion_t) if completion_t is not None else None

    ws.append(['الإجماليات (مجمَّعة على التصفية الحالية)'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.append(['البند', 'القيمة'])
    _style_header(ws, ws.max_row)
    ws.append(['الفعلي للأشهر المصفّاة', totals.get('actualMonth', 0)])
    ws.append(['المخطط للأشهر المصفّاة', totals.get('plannedMonth', 0)])
    ws.append(['انحراف الفترة (فعلي − مخطط)', deviation_t])
    ws.append(['التراكمي الفعلي (آخر قيمة لكل صف مصفّى، مجموعة)', cum_actual_t])
    ws.append(['التراكمي المخطط (آخر قيمة لكل صف مصفّى، مجموعة)', cum_planned_t])
    ws.append(['نسبة الإنجاز المجمَّعة', f'{completion_t * 100:.2f}٪' if completion_t is not None else '—'])
    ws.append(['نسبة التأخر المجمَّعة', f'{delay_t * 100:.2f}٪' if delay_t is not None else '—'])
    for r in range(ws.max_row - 6, ws.max_row - 2):
        cell = ws.cell(row=r, column=2)
        if isinstance(cell.value, (int, float)):
            cell.number_format = NUM_FMT
    ws.append([])

    # ---- تنويه صريح: مشروع ضمن التصفية بلا أي شهر في المدة المختارة — الفراغ
    # لا يُقرأ صفراً (PLAN-BUDGET §٨ خطر ٤).
    missing_warnings = _budget_missing_range_rows(db, filters)
    if missing_warnings:
        ws.append(['⚠ تنويه — مشاريع ضمن التصفية بلا بيانات في هذه المدة'])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True, color='FFCC0000')
        for w in missing_warnings:
            ws.append([w])
            ws.cell(row=ws.max_row, column=1).font = Font(color='FFCC0000')
        ws.append([])

    # ---- جدول الأشهر بالمشروع — ملوَّن حسب اتجاه كلٍّ من الشهر وتراكميه كلٌّ
    # بمعناه (شهرٌ أخضر لا يخفي تراكمياً أحمر، وبالعكس — قاعدة PLAN-BUDGET §٥-١).
    ws.append(['جدول الأشهر بالمشروع'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    headers = ['المشروع', 'المدينة', 'الشهر', 'الفعلي', 'المخطط', 'انحراف الشهر',
              'التراكمي الفعلي', 'التراكمي المخطط', 'نسبة الإنجاز', 'نسبة التأخر',
              'تحسّن/تراجع (نقطة)', 'الحالة', 'المصدر', 'رقم الوثيقة', 'تاريخ الإصدار']
    ws.append(headers)
    _style_header(ws, ws.max_row)
    header_row = ws.max_row
    month_col, actual_col, planned_col, dev_col = 3, 4, 5, 6
    cum_actual_col, cum_planned_col = 7, 8
    completion_col, delay_col, delta_col = 9, 10, 11

    sorted_rows = sorted(rows, key=lambda r: (r.get('project', ''), r.get('month', '')))
    for r in sorted_rows:
        completion = r.get('completionPct')
        delay = r.get('delayPct')
        delta = r.get('delayDeltaPp')
        ws.append([
            r.get('project', ''), r.get('city', ''), r.get('month', ''),
            r.get('actualMonth', 0), r.get('plannedMonth', 0), r.get('deviationMonth', 0),
            r.get('cumActual', 0), r.get('cumPlanned', 0),
            f'{completion * 100:.2f}٪' if completion is not None else '—',
            f'{delay * 100:.2f}٪' if delay is not None else '—',
            delta if delta is not None else '—',
            _BUDGET_STATUS_LABELS_AR.get(r.get('status', ''), r.get('status', '')),
            _BUDGET_SOURCE_LABELS_AR.get(r.get('entrySource', ''), r.get('entrySource', '')),
            r.get('docNo', ''), r.get('issuedOn', '') or '',
        ])
        row_idx = ws.max_row
        # تلوين الشهر بمعناه: الفعلي مقابل المخطط لنفس الشهر تحديداً
        month_fill = None
        actual_m, planned_m = r.get('actualMonth', 0) or 0, r.get('plannedMonth', 0) or 0
        if actual_m > planned_m:
            month_fill = _FILL_AHEAD
        elif actual_m < planned_m:
            month_fill = _FILL_BEHIND
        if month_fill is not None:
            for c in (actual_col, planned_col, dev_col):
                ws.cell(row=row_idx, column=c).fill = month_fill
        # تلوين التراكمي بمعناه المستقل — قد يختلف عن تلوين الشهر (يوليو أخضر في
        # شهره وأحمر في تراكميه، مثال PLAN-BUDGET §٥-١ بالحرف).
        cum_fill = None
        cum_a, cum_p = r.get('cumActual', 0) or 0, r.get('cumPlanned', 0) or 0
        if cum_a > cum_p:
            cum_fill = _FILL_AHEAD
        elif cum_a < cum_p:
            cum_fill = _FILL_BEHIND
        if cum_fill is not None:
            for c in (cum_actual_col, cum_planned_col, completion_col, delay_col):
                ws.cell(row=row_idx, column=c).fill = cum_fill

    for rr in range(header_row + 1, ws.max_row + 1):
        for c in (actual_col, planned_col, dev_col, cum_actual_col, cum_planned_col):
            cell = ws.cell(row=rr, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    ws.append([])

    # ---- المستخلصات — سطر لكل مستخلص، مربوطاً بمشروعه وشهره حتى لا يُفصَل عن
    # سياقه (نفس فكرة عمود المشروع في _row_values للمقاولين).
    ws.append(['المستخلصات'])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.append(['المشروع', 'الشهر', 'رقم المستخلص', 'المبلغ', 'التاريخ'])
    _style_header(ws, ws.max_row)
    claims_header_row = ws.max_row
    any_claim = False
    for r in sorted_rows:
        for c in (r.get('claims') or []):
            any_claim = True
            ws.append([r.get('project', ''), r.get('month', ''), c.get('no', ''),
                      c.get('amount', 0), c.get('date', '') or 'لم يصدر بعد'])
    if not any_claim:
        ws.append(['— لا مستخلصات ضمن هذه التصفية —'])
    for rr in range(claims_header_row + 1, ws.max_row + 1):
        cell = ws.cell(row=rr, column=4)
        if isinstance(cell.value, (int, float)):
            cell.number_format = NUM_FMT

    _autosize(ws)
    _add_logo(ws, f'{get_column_letter(ws.max_column + 2)}1')

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
