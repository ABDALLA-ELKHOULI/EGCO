# -*- coding: utf-8 -*-
"""الموازنة التقديرية — قارئ ملف «موازنة تقديرية — شركة …» وحفظه وقراءته.

الملف (مثاله موازنة أفيرا) ثلاث أوراق: «الملخص التنفيذي» (قيمة العقد والفروض)،
«الرسوم البيانية»، و«الموازنة التفصيلية» بجدول شهري (١٨ شهراً) وصف «الاجمالى».

كل شيء يُحدَّد بنصّ العنوان لا بإحداثيات ثابتة، والأرقام Decimal من أول لحظة.
قاعدة «لا تخترع رقماً»: مجموع الأشهر يجب أن يساوي صف «الاجمالى» عموداً عموداً
(بفرق ≤ ٠٫٠١) وإلا يُرفض الملف كله برسالة تسمّي العمود والفرق.

الخطة لا تُكتب في `budget_snapshots` أبداً — ذاك جدول الفعلي؛ شهر خطة بلا فعلي
هناك سيُقرأ تأخراً ١٠٠٪.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.db import models
from app.ingest.budget_xlsx import _MONTHS, _norm
from app.ingest.friendly_errors import FriendlyFileError

CENT = Decimal('0.01')
TOLERANCE = Decimal('0.01')
SOURCE = 'budget_plan'
DETECTED_LABEL = 'موازنة تقديرية (خطة شهرية)'

#: أعمدة النِّسَب — لا تُقرَّب للهللة
_RATIO_KEYS = {'completion_pct'}

#: أسماء عربية ثابتة لمفاتيح الأعمدة (تُعرض إن غاب رأس العمود)
COLUMN_LABELS = {
    'completion_pct': 'نسبة الإنجاز المتوقعة',
    'planned_excl_vat': 'القيمة المخططة بدون الضريبة',
    'planned_incl_vat': 'القيمة المخططة شامل الضريبة',
    'advance_deduction': 'خصم الدفعة المقدمة',
    'retention_deduction': 'خصم حسن الأداء',
    'net_claim': 'صافي المستخلص',
    'materials_deduction': 'خصم نسبة المواد',
    'net_transfer': 'صافي المبلغ المحوّل',
    'vat': 'الضريبة',
    'net_transfer_after_vat': 'صافي المبلغ المحوّل بعد خصم الضريبة',
    'emaar_net': 'صافي مستخلص أعمار',
    'emaar_vat': 'ضريبة مستخلص أعمار',
    'emaar_net_after_vat': 'صافي مستخلص أعمار بعد خصم الضريبة',
    'vat_due': 'الضريبة المستحقة',
}


class BudgetPlanParseError(FriendlyFileError):
    """ملف موازنة تقديرية لا يُقرأ أو لا يتطابق إجماليه — الرسالة عربية للمستخدم."""


# ---------------------------------------------------------------- أدوات

def _txt(v: Any) -> str:
    return _norm(str(v)) if isinstance(v, str) else ''


def _dec(v: Any) -> Optional[Decimal]:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        try:
            return Decimal(str(v))
        except InvalidOperation:
            return None
    if isinstance(v, str):
        s = v.strip().replace(',', '').replace('٬', '')
        if re.fullmatch(r'-?\d+(\.\d+)?', s):
            return Decimal(s)
    return None


def _money(d: Optional[Decimal]) -> Optional[Decimal]:
    return None if d is None else d.quantize(CENT)


def _s(d: Optional[Decimal]) -> Optional[str]:
    return None if d is None else str(d)


_AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')


def parse_month_label(v: Any) -> Optional[dt.date]:
    """«يونيو 2026م»، «ديسمبر2026م»، «فبراير 2027م »، «اكتوبر2027»، «أغسطس 26» → أول الشهر."""
    if isinstance(v, dt.datetime):
        return dt.date(v.year, v.month, 1)
    if isinstance(v, dt.date):
        return dt.date(v.year, v.month, 1)
    if not isinstance(v, str):
        return None
    s = _norm(v).translate(_AR_DIGITS)
    month = None
    # الأطول أولاً حتى لا يسبق اسمٌ قصير اسماً يحتويه
    for name in sorted(_MONTHS, key=len, reverse=True):
        if name in s:
            month = _MONTHS[name]
            break
    if month is None:
        return None
    m = re.search(r'(\d{4})', s)
    if m:
        year = int(m.group(1))
    else:
        m = re.search(r'(?<!\d)(\d{2})(?!\d)', s)
        if not m:
            return None
        year = 2000 + int(m.group(1))
    if not 1990 <= year <= 2100:
        return None
    return dt.date(year, month, 1)


def _col_key(label: str, prev_key: Optional[str]) -> Optional[str]:
    """رأس عمود (مطبَّع) → مفتاح ثابت. الترتيب مهم: «بعد» قبل الأصل."""
    t = label
    if not t:
        return None
    if t.startswith('رقم') or t == 'م':
        return 'seq'
    if 'الشهر' in t:
        return 'month'
    if 'نسبه الانجاز' in t:
        return 'completion_pct'
    if 'المخطط' in t and 'بدون' in t:
        return 'planned_excl_vat'
    if 'المخطط' in t and 'شامل' in t:
        return 'planned_incl_vat'
    if 'الدفعه المقدمه' in t:
        return 'advance_deduction'
    if 'حسن الاداء' in t or 'الضمان' in t:
        return 'retention_deduction'
    if 'صافي المستخلص' in t and 'اعمار' not in t:
        return 'net_claim'
    if 'المواد' in t:
        return 'materials_deduction'
    if 'صافي المبلغ المحول' in t and 'بعد' in t:
        return 'net_transfer_after_vat'
    if 'صافي المبلغ المحول' in t:
        return 'net_transfer'
    if 'اعمار' in t and 'بعد' in t:
        return 'emaar_net_after_vat'
    if 'اعمار' in t:
        return 'emaar_net'
    if 'المستحقه' in t:
        return 'vat_due'
    if 'الضريبه' in t:
        # «الضريبة» تتكرر: بعد صافي أعمار = ضريبة أعمار، وإلا ضريبة المستخلص
        return 'emaar_vat' if prev_key == 'emaar_net' else 'vat'
    return None


# ---------------------------------------------------------------- القراءة

def _load(path: str):
    import openpyxl
    try:
        return openpyxl.load_workbook(path, data_only=True, read_only=False)
    except Exception as e:  # noqa: BLE001
        raise BudgetPlanParseError('تعذّر فتح ملف الموازنة التقديرية: %s' % e)


def _grid(ws, max_row: int = 200, max_col: int = 40) -> List[List[Any]]:
    out = []
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row or 1, max_row),
                            max_col=min(ws.max_column or 1, max_col), values_only=True):
        out.append(list(row))
    return out


def _find_header(grid: List[List[Any]]) -> Optional[int]:
    for i, row in enumerate(grid):
        texts = [_txt(v) for v in row]
        if any('الشهر' == t or t.startswith('الشهر') for t in texts) and \
                any('المخطط' in t for t in texts) and any('صافي' in t for t in texts):
            return i
    return None


def is_budget_plan(path: str) -> bool:
    """تصنيف سريع لا يرمي أبداً: ملف xlsx فيه «موازنه تقديريه» وجدول شهري بخطة."""
    if not str(path).lower().endswith(('.xlsx', '.xlsm')):
        return False
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        try:
            titled = False
            table = False
            for ws in wb.worksheets:
                grid = []
                for row in ws.iter_rows(min_row=1, max_row=60, max_col=30, values_only=True):
                    grid.append(list(row))
                for row in grid:
                    for v in row:
                        t = _txt(v)
                        if 'موازنه تقديريه' in t:
                            titled = True
                        if 'انحراف' in t:
                            return False   # تقرير انحراف الموازنة — قارئ آخر
                if _find_header(grid) is not None:
                    table = True
            return titled and table
        finally:
            wb.close()
    except Exception:  # noqa: BLE001
        return False


def _label_value(grid: List[List[Any]], prefixes: Tuple[str, ...]) -> Optional[Decimal]:
    """قيمة عنوان: أول رقم يمينه في نفس الصف، وإلا الخلية تحته مباشرة."""
    for i, row in enumerate(grid):
        for j, v in enumerate(row):
            t = _txt(v)
            if not t or not any(t.startswith(p) for p in prefixes):
                continue
            for w in row[j + 1:]:
                d = _dec(w)
                if d is not None:
                    return d
                if isinstance(w, str) and w.strip():
                    break      # عنوان آخر في نفس الصف — القيمة تحته (تخطيط البطاقات)
            if i + 1 < len(grid) and j < len(grid[i + 1]):
                d = _dec(grid[i + 1][j])
                if d is not None:
                    return d
    return None


def _project_from_title(title: str) -> str:
    raw = title.strip()
    for sep in ('—', '–', ' - ', '-', ':'):
        if sep in raw:
            raw = raw.split(sep, 1)[1].strip()
            break
    else:
        raw = ''
    raw = re.sub(r'^(شركة|شركه|مشروع)\s+', '', raw).strip()
    return raw


def parse(path: str) -> dict:
    if not os.path.isfile(path):
        raise BudgetPlanParseError('الملف غير موجود')
    wb = _load(path)
    sheets = {ws.title: _grid(ws) for ws in wb.worksheets}

    # الجدول الشهري
    detail_name = None
    header_idx = None
    for name, grid in sheets.items():
        h = _find_header(grid)
        if h is not None:
            detail_name, header_idx = name, h
            break
    if detail_name is None:
        raise BudgetPlanParseError('لم يُعثر على جدول الموازنة الشهري (عمود «الشهر» و«القيمة المخططة»)')
    grid = sheets[detail_name]
    header = grid[header_idx]

    columns: List[dict] = []
    keys: Dict[int, str] = {}
    prev = None
    for j, v in enumerate(header):
        if not isinstance(v, str) or not v.strip():
            continue
        k = _col_key(_txt(v), prev)
        if k is None:
            k = 'col_%d' % (j + 1)        # عمود غير معروف — يُحفظ بنصّه، لا يُهمل
        if k in keys.values():
            k = '%s_%d' % (k, j + 1)
        keys[j] = k
        prev = k
        if k not in ('seq', 'month'):
            columns.append(dict(key=k, label=re.sub(r'\s+', ' ', v).strip()))
    month_col = next((j for j, k in keys.items() if k == 'month'), None)
    if month_col is None:
        raise BudgetPlanParseError('لم يُعثر على عمود «الشهر» في جدول الموازنة')
    if 'planned_excl_vat' not in keys.values():
        raise BudgetPlanParseError('لم يُعثر على عمود «القيمة المخططة بدون الضريبة»')
    num_cols = {j: k for j, k in keys.items() if k not in ('seq', 'month')}

    months: List[dict] = []
    totals: Optional[Dict[str, Optional[Decimal]]] = None
    for r in range(header_idx + 1, len(grid)):
        row = grid[r]
        texts = [_txt(v) for v in row]
        if any(t.startswith('الاجمالي') or t == 'المجموع' for t in texts):
            totals = {k: _dec(row[j]) if j < len(row) else None for j, k in num_cols.items()}
            break
        cell = row[month_col] if month_col < len(row) else None
        vals = {k: (_dec(row[j]) if j < len(row) else None) for j, k in num_cols.items()}
        if (cell is None or (isinstance(cell, str) and not cell.strip())) and \
                all(v is None for v in vals.values()):
            continue
        m = parse_month_label(cell)
        if m is None:
            raise BudgetPlanParseError('تعذّر فهم الشهر «%s» في الصف %d من ورقة «%s»'
                                       % (str(cell).strip(), r + 1, detail_name))
        months.append(dict(seq=len(months) + 1, label=str(cell).strip(), month=m, values=vals))
    if not months:
        raise BudgetPlanParseError('جدول الموازنة لا يحوي أي شهر')
    if totals is None:
        raise BudgetPlanParseError('لم يُعثر على صف «الاجمالى» تحت جدول الموازنة — لا يمكن التحقق من الأرقام')
    seen = {}
    for mo in months:
        if mo['month'] in seen:
            raise BudgetPlanParseError('الشهر %s مكرر في الجدول («%s» و«%s»)' % (
                mo['month'].strftime('%Y-%m'), seen[mo['month']], mo['label']))
        seen[mo['month']] = mo['label']

    # التحقق: مجموع الأشهر = صف الاجمالى عموداً عموداً
    label_of = {c['key']: c['label'] for c in columns}
    check = []
    for k in num_cols.values():
        total = totals.get(k)
        parts = [mo['values'][k] for mo in months if mo['values'][k] is not None]
        ssum = sum(parts, Decimal('0'))
        if total is None:
            check.append(dict(key=k, label=label_of.get(k, k), sum=_s(_q(k, ssum)),
                              total=None, diff=None, ok=None))
            continue
        diff = _q(k, ssum) - _q(k, total)
        ok = abs(diff) <= TOLERANCE
        check.append(dict(key=k, label=label_of.get(k, k), sum=_s(_q(k, ssum)),
                          total=_s(_q(k, total)), diff=_s(diff), ok=ok))
        if not ok:
            raise BudgetPlanParseError(
                'مجموع الأشهر في عمود «%s» = %s لا يساوي صف «الاجمالى» = %s — الفرق %s ر.س. '
                'لم يُحفظ شيء؛ صحّح الملف ثم أعد رفعه.'
                % (label_of.get(k, k), _fmt(_q(k, ssum)), _fmt(_q(k, total)), _fmt(diff)))

    # العنوان والمشروع والفترة
    title = ''
    period = ''
    for grid2 in sheets.values():
        for row in grid2[:12]:
            for v in row:
                if isinstance(v, str):
                    t = _norm(v)
                    if not title and 'موازنه تقديريه' in t:
                        title = v.strip()
                    if not period and 'الفتره' in t:
                        seg = [p for p in v.split('|') if 'الفتر' in _norm(p)]
                        if seg:
                            period = seg[0].split(':', 1)[-1].strip()
        if title:
            break
    project = _project_from_title(title)
    if not project:
        raise BudgetPlanParseError('لم يُعثر على اسم المشروع في عنوان الملف («موازنة تقديرية — شركة …»)')

    # أرقام العقد والفروض — ورقة الجدول أولاً (هي المُدخل) ثم الملخص
    ordered = [sheets[detail_name]] + [g for n, g in sheets.items() if n != detail_name]

    def lv(*prefixes):
        for g in ordered:
            d = _label_value(g, prefixes)
            if d is not None:
                return d
        return None

    contract_incl = lv('قيمه العقد شامل')
    contract_excl = lv('قيمه العقد بدون')
    duration = lv('مده التنفيذ')
    vat_factor = lv('قيمه الضريبه')
    if vat_factor is None:
        rate = lv('معدل ضريبه')
        vat_factor = (Decimal('1') + rate) if rate is not None else None
    assumptions = dict(
        advancePayment=_s(_money(lv('قيمه الدفعه المقدمه'))),
        aluminiumFormwork=_s(_money(lv('قيمه الفورم'))),
        advanceRate=_s(lv('نسبه الدفعه المقدمه', 'نسبه خصم الدفعه المقدمه')),
        retentionRate=_s(lv('نسبه الضمان')),
        materialsRate=_s(lv('نسبه المواد')),
        vatFactor=_s(vat_factor.quantize(Decimal('0.0001')) if vat_factor is not None else None),
    )
    return dict(
        project=project, title=title, period=period, sheet=detail_name,
        contract=dict(inclVat=_s(_money(contract_incl)), exclVat=_s(_money(contract_excl)),
                      durationMonths=int(duration) if duration is not None else None),
        assumptions=assumptions, columns=columns, months=months,
        totals={k: _q(k, v) if v is not None else None for k, v in totals.items()},
        check=check,
    )


def _q(key: str, d: Decimal) -> Decimal:
    if key in _RATIO_KEYS:
        return d.quantize(Decimal('0.000001'))
    return d.quantize(CENT)


def _fmt(d: Decimal) -> str:
    return '{:,.2f}'.format(d)


def _month_json(mo: dict) -> dict:
    v = mo['values']
    vals = {k: _s(_q(k, d)) if d is not None else None for k, d in v.items()}
    return dict(seq=mo['seq'], label=mo['label'], month=mo['month'].strftime('%Y-%m'),
                completionPct=vals.get('completion_pct'),
                plannedExclVat=vals.get('planned_excl_vat'),
                plannedInclVat=vals.get('planned_incl_vat'),
                netTransfer=vals.get('net_transfer'), values=vals)


def _content_hash(p: dict) -> str:
    payload = dict(project=p['project'], contract=p['contract'], assumptions=p['assumptions'],
                   months=[_month_json(m) for m in p['months']],
                   totals={k: _s(v) for k, v in p['totals'].items()})
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False)
                          .encode('utf-8')).hexdigest()


# ---------------------------------------------------------------- المشروع

def find_project(db: Session, name: str) -> Optional[models.ProjectRegistry]:
    """صف السجل لهذا المشروع (أي صيغة إملائية) — قراءة فقط، لا ينشئ شيئاً."""
    from app.services.projects_service import _match_key
    from app.utils.arabic import project_key
    key = _match_key(name)
    rows = db.query(models.ProjectRegistry).filter(
        models.ProjectRegistry.deleted_at.is_(None)).all()
    for r in rows:
        if r.key == key or project_key(r.name) == project_key(name):
            return r
    return None


def _existing_status(db: Session, project: str, h: str) -> dict:
    plan = db.query(models.BudgetPlan).filter_by(project=project).one_or_none()
    if plan is None or plan.deleted_at is not None:
        return dict(status='new', message='خطة جديدة لهذا المشروع')
    if plan.content_hash == h:
        return dict(status='identical', message='مطابق مسبقاً — نفس الخطة محفوظة، لن يتغيّر شيء')
    return dict(status='changed', message='توجد خطة محفوظة لهذا المشروع وستُستبدل بأرقام هذا الملف')


# ---------------------------------------------------------------- المعاينة والحفظ

def preview(db: Session, path: str) -> dict:
    p = parse(path)
    reg = find_project(db, p['project'])
    project = reg.name if reg else p['project']
    h = _content_hash(p)
    months = [_month_json(m) for m in p['months']]
    return dict(
        kind=SOURCE, detected=DETECTED_LABEL, path=path,
        project=project, projectInFile=p['project'], projectExists=reg is not None,
        projectId=reg.id if reg else None,
        projectMessage=None if reg else
        'المشروع «%s» غير موجود في سجل المشاريع — أكّد إنشاءه عند الحفظ' % p['project'],
        title=p['title'], period=p['period'], sheet=p['sheet'],
        contract=p['contract'], assumptions=p['assumptions'], columns=p['columns'],
        months=months, monthCount=len(months),
        firstMonth=months[0]['month'], lastMonth=months[-1]['month'],
        totals={k: _s(v) for k, v in p['totals'].items()},
        check=p['check'], totalsOk=all(c['ok'] is not False for c in p['check']),
        existing=_existing_status(db, project, h),
    )


def commit(db: Session, path: str, confirm_project: bool = False) -> dict:
    p = parse(path)
    reg = find_project(db, p['project'])
    created_project = False
    if reg is None:
        if not confirm_project:
            return dict(saved=False, reason='project_missing', kind=SOURCE,
                        detected=DETECTED_LABEL, project=p['project'],
                        message='المشروع «%s» غير موجود — لم يُحفظ شيء. أكّد إنشاء المشروع ثم احفظ.'
                        % p['project'])
        from app.services import project_registry_service as PR
        try:
            PR.create_project(db, p['project'], _money(_dec(p['contract']['inclVat'])))
        except FileExistsError:
            pass
        reg = find_project(db, p['project'])
        created_project = True
    project = reg.name
    h = _content_hash(p)
    now = dt.datetime.now(dt.timezone.utc)

    plan = db.query(models.BudgetPlan).filter_by(project=project).one_or_none()
    if plan is not None and plan.deleted_at is None and plan.content_hash == h:
        live = db.query(models.BudgetPlanMonth).filter_by(project=project, deleted_at=None).count()
        if live == len(p['months']):
            _log(db, path, project, 0, len(p['months']))
            db.commit()
            return dict(saved=True, kind=SOURCE, detected=DETECTED_LABEL, project=project,
                        added=0, updated=0, skipped=len(p['months']), identical=True,
                        createdProject=created_project,
                        message='مطابق مسبقاً — الخطة محفوظة بنفس الأرقام، لم يتغيّر شيء')
    if plan is None:
        plan = models.BudgetPlan(project=project)
        db.add(plan)
    plan.deleted_at = None
    plan.title = p['title']
    plan.period_label = p['period']
    plan.start_month = p['months'][0]['month']
    plan.end_month = p['months'][-1]['month']
    plan.contract_incl_vat = _dec(p['contract']['inclVat'])
    plan.contract_excl_vat = _dec(p['contract']['exclVat'])
    plan.duration_months = p['contract']['durationMonths']
    plan.assumptions = json.dumps(p['assumptions'], ensure_ascii=False)
    plan.columns = json.dumps(p['columns'], ensure_ascii=False)
    plan.totals = json.dumps({k: _s(v) for k, v in p['totals'].items()}, ensure_ascii=False)
    plan.source_path = path
    plan.content_hash = h
    db.flush()

    existing = {m.month: m for m in db.query(models.BudgetPlanMonth).filter_by(project=project).all()}
    in_file = set()
    added = updated = same = 0
    for mo in p['months']:
        j = _month_json(mo)
        in_file.add(mo['month'])
        row = existing.get(mo['month'])
        vals_json = json.dumps(j['values'], sort_keys=True, ensure_ascii=False)
        if row is None:
            row = models.BudgetPlanMonth(project=project, month=mo['month'])
            db.add(row)
            added += 1
        elif row.deleted_at is None and row.values_json == vals_json and row.label == mo['label']:
            same += 1
        else:
            updated += 1
        row.deleted_at = None
        row.plan_id = plan.id
        row.seq = mo['seq']
        row.label = mo['label']
        row.completion_pct = j['completionPct']
        row.planned_excl_vat = _dec(j['plannedExclVat'])
        row.planned_incl_vat = _dec(j['plannedInclVat'])
        row.net_transfer = _dec(j['netTransfer'])
        row.values_json = vals_json
    removed = 0
    for m, row in existing.items():
        if m not in in_file and row.deleted_at is None:
            row.deleted_at = now          # شهر لم يعد في الخطة — حذف ناعم
            removed += 1
    _log(db, path, project, added + updated, same)
    db.commit()
    return dict(saved=True, kind=SOURCE, detected=DETECTED_LABEL, project=project,
                added=added, updated=updated, skipped=same, removed=removed,
                identical=False, createdProject=created_project,
                message='حُفظت الخطة التقديرية لمشروع «%s» — %d شهراً' % (project, len(p['months'])))


def _log(db: Session, path: str, project: str, imported: int, skipped: int) -> None:
    db.add(models.ImportLog(source=SOURCE, path=path, account='', imported=imported,
                            skipped=skipped, reconciled=1,
                            issues=json.dumps([dict(kind='budget_plan', project=project)],
                                              ensure_ascii=False)))


# ---------------------------------------------------------------- القراءة للواجهة

def plan_for_project(db: Session, project: str) -> Optional[dict]:
    """الخطة + الفعلي حيث توجد لقطة موازنة فعلية لنفس الشهر (لا فعلي مُخترع)."""
    from app.services.projects_service import _match_key
    reg = None
    rows = db.query(models.ProjectRegistry).filter(
        models.ProjectRegistry.deleted_at.is_(None)).all()
    for r in rows:
        if r.id == project:
            reg = r
    names = set()
    if reg is not None:
        key = reg.key
        names.add(reg.name)
    else:
        key = _match_key(project)
        names.add(project)
    plans = [pl for pl in db.query(models.BudgetPlan).filter(
        models.BudgetPlan.deleted_at.is_(None)).all() if _match_key(pl.project) == key]
    if not plans:
        return None
    plan = plans[0]
    names.add(plan.project)
    months = db.query(models.BudgetPlanMonth).filter(
        models.BudgetPlanMonth.project == plan.project,
        models.BudgetPlanMonth.deleted_at.is_(None)).order_by(models.BudgetPlanMonth.month).all()

    actuals: Dict[dt.date, models.BudgetSnapshot] = {}
    for s in db.query(models.BudgetSnapshot).filter(
            models.BudgetSnapshot.deleted_at.is_(None)).all():
        if s.project and _match_key(s.project) == key:
            actuals[dt.date(s.month.year, s.month.month, 1)] = s

    out_months = []
    actual_sum = Decimal('0')
    planned_with_actual = Decimal('0')
    for m in months:
        vals = json.loads(m.values_json or '{}')
        snap = actuals.get(m.month)
        actual = deviation = ratio = None
        if snap is not None and snap.actual_month is not None:
            actual = Decimal(str(snap.actual_month)).quantize(CENT)
            if m.planned_excl_vat is not None:
                deviation = actual - m.planned_excl_vat
                if m.planned_excl_vat != 0:
                    ratio = str((actual / m.planned_excl_vat).quantize(Decimal('0.0001')))
                actual_sum += actual
                planned_with_actual += m.planned_excl_vat
        out_months.append(dict(
            seq=m.seq, label=m.label, month=m.month.strftime('%Y-%m'),
            completionPct=m.completion_pct,
            plannedExclVat=_s(m.planned_excl_vat), plannedInclVat=_s(m.planned_incl_vat),
            advanceDeduction=vals.get('advance_deduction'),
            retentionDeduction=vals.get('retention_deduction'),
            materialsDeduction=vals.get('materials_deduction'),
            netClaim=vals.get('net_claim'),
            netTransfer=_s(m.net_transfer), values=vals,
            actualExclVat=_s(actual), deviation=_s(deviation), actualRatio=ratio,
            hasActual=actual is not None))
    with_actual = [x for x in out_months if x['hasActual']]
    return dict(
        id=plan.id, project=plan.project, title=plan.title, period=plan.period_label,
        startMonth=plan.start_month.strftime('%Y-%m') if plan.start_month else None,
        endMonth=plan.end_month.strftime('%Y-%m') if plan.end_month else None,
        contract=dict(inclVat=_s(plan.contract_incl_vat), exclVat=_s(plan.contract_excl_vat),
                      durationMonths=plan.duration_months),
        assumptions=json.loads(plan.assumptions or '{}'),
        columns=json.loads(plan.columns or '[]'),
        totals=json.loads(plan.totals or '{}'),
        months=out_months,
        actualVsPlan=dict(
            monthsWithActual=len(with_actual),
            actualExclVat=_s(actual_sum) if with_actual else None,
            plannedExclVat=_s(planned_with_actual) if with_actual else None,
            deviation=_s(actual_sum - planned_with_actual) if with_actual else None),
        importedAt=plan.updated_at.isoformat() if plan.updated_at else None,
        sourceFile=os.path.basename(plan.source_path or ''),
    )
