# -*- coding: utf-8 -*-
"""قارئ «تقرير مديونيات المقاولين والموردين للمشاريع» — ملف xls قديم (BIFF).

هذا التقرير المجمّع يذكر كل مقاول ومورد على كل المشاريع في ملف واحد، بعكس كشوف
الحساب الفردية المدعومة سابقاً (PDF/CSV لكل طرف على حدة). يحتاج قارئاً منفصلاً
لأنه:
  1. صيغة .xls قديمة (BIFF / Excel 97-2003) لا يقرأها openpyxl إطلاقاً — يلزم xlrd.
  2. 29 ورقة، لا ورقة واحدة، وأسماؤها تحمل تاريخاً متغيّراً («13-7») يجب عدم الاعتماد
     عليه — انظر SHEET_KIND_RE أدناه الذي يطابق الكلمات الدالة فقط.

# ما تعنيه كل ورقة (تحقّقتُ يدوياً من الملف الحقيقي بتاريخ 07-13)

الأوراق الثلاث المجمّعة تحمل التبويب (المشروع) في عمود لكل صف، أي أنها تغطي كل
شيء وحدها:
    'مديونية المقاولين حتى <تاريخ>'        — كل المقاولين، كل المشاريع
    'مديونية الموردين <تاريخ>'             — كل الموردين، كل المشاريع
    'مديونية ضمان المقاولين حتى <تاريخ>'   — كل حسابات الضمان (216/217)، كل المشاريع
أوراق «<مشروع> مقاولين/موردين/ضمان المقاولين <تاريخ>» هي نفس الصفوف مصفّاة لمشروع
واحد فقط (تحقّقتُ رقماً برقم: نفس الحساب بنفس الأرقام في الورقة المجمّعة وفي ورقة
مشروعه). قراءتها أيضاً لا تضيف بيانات جديدة، فقط تُكرّر — يعالجها `parse()` بجمع
كل الأوراق ثم حذف الحساب المكرر (يُبقي أول ظهور، يُحصي الباقي «مكرر»)، حتى تبقى
القراءة «كل الأوراق ذات الصلة» صحيحة حرفياً دون مضاعفة الأرصدة.
أوراق أخرى في الملف («Report», «Report (2)», «مديونية المقاولين للمشاريع»،
«مديونية الموردين للمشاريع», «مديونية الموردين (2)») هي جداول محورية/مسودات بلا
عمود «رقم الحساب» على الإطلاق — تُستبعد آلياً لعدم وجود مفتاح موثوق (الحساب)،
لا بالاسم.

# تخطيط الأعمدة — ديناميكي لا ثابت

الأعمدة تختلف بين أوراق المقاولين/الموردين (١٧ عموداً، عمود فاصل بين كل مجموعة)
وأوراق الضمان (١٦ عموداً، بلا فاصل) — بدل الاعتماد على أرقام أعمدة ثابتة (يكسرها
أي تغيير طفيف في تصدير مستقبلي)، يُقرأ العنوان (الصف الرابع فهرس ٣، والصف الخامس
فهرس ٤) وتُستخرج فهارس الأعمدة من نص العناوين نفسها: «تبويب»، «الرصيد»،
«اسم الحساب»، «رقم الحساب» من الصف الأول، وموضعا «دائن»/«مدين» (أول ظهور =
اجمالي الحركة الفترة، ثاني ظهور = الرصيد الافتتاحي) من الصف الثاني. هذا يعمل
لكلا التخطيطين بلا تفريق يدوي.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from app.domain.payables import D, money

#: الصف صفر-الفهرس الذي يحمل عناوين المجموعات (تبويب / الرصيد / اجمالي الحركة / ...)
HEADER_ROW1 = 3
#: الصف الذي يحمل «دائن»/«مدين» تحت كل مجموعة
HEADER_ROW2 = 4
#: أول صف بيانات فعلي
FIRST_DATA_ROW = 5

#: كلمة «ضمان» تُفحص أولاً لأن أوراق الضمان تحمل «ضمان المقاولين» فتطابق كلمة
#: «مقاولين» أيضاً لو فُحصت أولاً.
_GUARANTEE_RE = re.compile('ضمان')
_CONTRACTOR_RE = re.compile('مقاولين')
_SUPPLIER_RE = re.compile('موردين')
#: يفصل اسم المشروع عن كلمات النوع في أوراق «<مشروع> مقاولين/موردين/ضمان ...» —
#: أول كلمة نوع تظهر في اسم الورقة تُقطع عندها، وما قبلها هو المشروع.
_KIND_WORD_RE = re.compile('(ضمان|المقاولين|مقاولين|الموردين|موردين)')
#: صف الإجمالي الكلي في ذيل كل ورقة — بلا رقم حساب، اسمه «الإجمالي الكلي»
_TOTAL_ROW_RE = re.compile('الإجمالي')

KIND_LABELS = {'contractor': 'مقاول', 'supplier': 'مورد', 'guarantee': 'ضمان'}


class DebtsReportParseError(Exception):
    pass


def classify_sheet(name: str) -> Optional[str]:
    """'contractor' | 'supplier' | 'guarantee' | None (ورقة غير ذات صلة)."""
    if _GUARANTEE_RE.search(name):
        return 'guarantee'
    if _CONTRACTOR_RE.search(name):
        return 'contractor'
    if _SUPPLIER_RE.search(name):
        return 'supplier'
    return None


def _sheet_project_hint(name: str) -> str:
    """اسم المشروع من اسم الورقة لأوراق «<مشروع> ...» فقط — الأوراق المجمّعة
    تبدأ بكلمة «مديونية» ولا تحمل مشروعاً في اسمها، فيُترك الاعتماد على عمود
    الصف حصراً لها (انظر _row_project)."""
    if name.startswith('مديونية'):
        return ''
    m = _KIND_WORD_RE.search(name)
    return name[:m.start()].strip() if m else name.strip()


def _header_indices(row1: list, row2: list) -> Optional[Dict[str, int]]:
    """يبحث عن فهارس الأعمدة من نص العناوين. None إن لم يوجد عمود «رقم الحساب»
    (الأوراق المحورية غير المدعومة)."""
    def find(row, label):
        for i, v in enumerate(row):
            if str(v).strip() == label:
                return i
        return None

    col_account = find(row1, 'رقم الحساب')
    col_name = find(row1, 'اسم الحساب')
    col_project = find(row1, 'تبويب')
    col_balance = find(row1, 'الرصيد')
    if col_account is None or col_name is None:
        return None

    credit_idx = [i for i, v in enumerate(row2) if str(v).strip() == 'دائن']
    debit_idx = [i for i, v in enumerate(row2) if str(v).strip() == 'مدين']
    if len(credit_idx) < 2 or len(debit_idx) < 2:
        return None

    return dict(account=col_account, name=col_name,
                project=col_project if col_project is not None else -1,
                balance=col_balance if col_balance is not None else -1,
                period_credit=credit_idx[0], opening_credit=credit_idx[1],
                period_debit=debit_idx[0], opening_debit=debit_idx[1])


def _cell(row: list, idx: int):
    return row[idx] if 0 <= idx < len(row) else None


def _clean_str(v) -> str:
    return str(v).strip() if v is not None else ''


def _row_project(cell_val, sheet_project_hint: str) -> str:
    """قيمة عمود المشروع إن وُجدت (نص غير فارغ)، وإلا اسم المشروع المستنتج من
    اسم الورقة (لأوراق المشروع الواحد فقط — بعض صفوف الضمان تصل بلا مشروع في
    عمودها رغم وجودها في ورقة مجمّعة، فتبقى '' حين لا يوجد أي مصدر)."""
    s = _clean_str(cell_val)
    # عمود المشروع يصل أحياناً 0.0 (رقمياً) حين يكون فارغاً فعلياً في نسخة xlrd
    if s and s not in ('0', '0.0'):
        return s
    return sheet_project_hint


def _num(v) -> Decimal:
    if v is None or v == '':
        return Decimal('0')
    return D(v)


def parse(path: str) -> dict:
    """يقرأ كل الأوراق ذات الصلة، يُرجع dict(rows, issues, sheets).

    rows: كل صف {kind, account, name, project, balance, openingCredit,
    openingDebit, periodCredit, periodDebit, sheet} — بعد حذف التكرار بين
    الورقة المجمّعة وأوراق المشاريع (يُبقي أول ظهور).
    issues: كل ما جرى تجاهله ولماذا — لا إسقاط صامت.
    sheets: تقرير لكل ورقة — الاسم، النوع المكتشف، المشروع، صفوف وُجدت/تُجوهلت.
    """
    try:
        import xlrd
    except ImportError as e:      # pragma: no cover
        raise DebtsReportParseError('xlrd مطلوب لقراءة ملفات xls القديمة') from e

    try:
        wb = xlrd.open_workbook(path)
    except Exception as e:
        raise DebtsReportParseError('تعذّرت قراءة الملف: %s' % e) from e

    rows: List[dict] = []
    issues: List[dict] = []
    sheets: List[dict] = []
    seen_accounts: Dict[str, str] = {}   # account -> sheet name أول ظهور

    for sheet_name in wb.sheet_names():
        kind = classify_sheet(sheet_name)
        sheet_report = dict(name=sheet_name, kind=kind, project=None,
                            rowsFound=0, rowsSkipped=0, rowsDuplicate=0,
                            skipReasons={})
        if kind is None:
            sheet_report['skipReasons']['غير ذات صلة (لا تطابق مقاولين/موردين/ضمان)'] = 1
            sheets.append(sheet_report)
            continue

        ws = wb.sheet_by_name(sheet_name)
        project_hint = _sheet_project_hint(sheet_name)
        sheet_report['project'] = project_hint or None

        if ws.nrows <= HEADER_ROW2:
            sheet_report['skipReasons']['ورقة فارغة أو أقصر من العناوين المتوقعة'] = 1
            sheets.append(sheet_report)
            continue

        row1 = [ws.cell_value(HEADER_ROW1, c) for c in range(ws.ncols)]
        row2 = [ws.cell_value(HEADER_ROW2, c) for c in range(ws.ncols)]
        idx = _header_indices(row1, row2)
        if idx is None:
            sheet_report['skipReasons']['تخطيط أعمدة غير متعرَّف عليه (لا عمود رقم الحساب)'] = 1
            sheets.append(sheet_report)
            continue

        def bump(reason: str):
            sheet_report['skipReasons'][reason] = sheet_report['skipReasons'].get(reason, 0) + 1

        for r in range(FIRST_DATA_ROW, ws.nrows):
            row = [ws.cell_value(r, c) for c in range(ws.ncols)]
            name = _clean_str(_cell(row, idx['name']))
            if not name:
                bump('صف بلا اسم حساب (تذييل/سطر فارغ)')
                sheet_report['rowsSkipped'] += 1
                continue
            if _TOTAL_ROW_RE.search(name):
                bump('صف إجمالي كلي')
                sheet_report['rowsSkipped'] += 1
                continue

            account = _clean_str(_cell(row, idx['account']))
            if not account:
                issues.append(dict(severity='error', row=r, sheet=sheet_name,
                                   message='%s: بلا رقم حساب — تم تجاهل الصف' % name))
                bump('بلا رقم حساب')
                sheet_report['rowsSkipped'] += 1
                continue

            sheet_report['rowsFound'] += 1

            if account in seen_accounts:
                sheet_report['rowsDuplicate'] += 1
                continue        # مكرر عبر أوراق أخرى لنفس الحساب — لا فقدان بيانات، القيم متطابقة
            seen_accounts[account] = sheet_name

            project = _row_project(_cell(row, idx['project']), project_hint) if idx['project'] >= 0 else project_hint
            balance = _num(_cell(row, idx['balance'])) if idx['balance'] >= 0 else Decimal('0')

            rows.append(dict(
                kind=kind, account=account, name=name, project=project,
                balance=money(balance),
                periodCredit=money(_num(_cell(row, idx['period_credit']))),
                periodDebit=money(_num(_cell(row, idx['period_debit']))),
                openingCredit=money(_num(_cell(row, idx['opening_credit']))),
                openingDebit=money(_num(_cell(row, idx['opening_debit']))),
                sheet=sheet_name,
            ))

        sheets.append(sheet_report)

    if not rows:
        raise DebtsReportParseError('لم يُقرأ أي صف من الملف — تأكد من الصيغة')

    return dict(rows=rows, issues=issues, sheets=sheets)
