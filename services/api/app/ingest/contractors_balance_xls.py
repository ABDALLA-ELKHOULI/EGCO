# -*- coding: utf-8 -*-
"""قارئ «كشف المقاولين» — لقطة رصيد مجمّعة، صيغة xls قديمة (BIFF) مختلفة عن
تقرير المديونيات (app/ingest/debts_report_xls.py) رغم تشارك الامتداد.

الفرق الجوهري عن تقرير المديونيات: هذا الملف أربع أوراق، لكن **ورقة واحدة فقط**
(الأولى، «كشف المقاولين حتى <تاريخ>») هي المصدر — البقية (٣٦١/٢٣٨/١٨٩ صفاً) لقطات
جزئية لنفس الحسابات (مشروع واحد فقط، أو مصدر بديل) تُستعمل هنا للمقارنة فقط
(cross-check): إن اختلف رصيد حساب بين الورقة الأولى وورقة فرعية تحمله يُسجَّل
`issue`، لكن صفوف الأوراق الفرعية لا تدخل `rows` إطلاقاً — ضمّها كان يُضاعف نحو
١٠ ملايين ريال (كل حساب في أكثر من ورقة).

فهارس الأعمدة تُشتق من نص عناوين الصفين ٤ و٥ (فهرس صفري) بنفس أسلوب
debts_report_xls، لا تُثبَّت رقمياً — لكن يُتحقق أن الفهارس المشتقة تطابق ما
لوحظ فعلياً في هذا التصدير (انظر _EXPECTED_INDICES) فيفشل التحليل بوضوح بدل أن
يقرأ أعمدة خاطئة صامتاً لو تغيّر التصدير مستقبلاً.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Dict, List, Optional

from app.domain.payables import D, money
from app.ingest.friendly_errors import check_basic_file, describe_excel_open_error

#: الصف الذي يحمل عناوين المجموعات (تبويب / اجمالي الرصيد / اجمالي الحركة / ...)
HEADER_ROW1 = 4
#: الصف الذي يحمل «دائن»/«مدين»/«الرصيد» تحت كل مجموعة
HEADER_ROW2 = 5
FIRST_DATA_ROW = 6

#: الفهارس الملحوظة فعلياً في هذا التصدير — تُستعمل كتأكيد لا كمصدر، انظر شرح
#: الملف أعلاه. أي اختلاف يعني تغيّراً في تصدير النظام المصدر يستحق فحصاً يدوياً
#: قبل الثقة بالنتيجة، فيُرفع خطأ صريح بدل قراءة صامتة خاطئة.
_EXPECTED_INDICES = dict(project=0, balance=1, period_credit=3, period_debit=5,
                         opening_credit=7, opening_debit=9, name=11, account=16)

_TOTAL_ROW_RE_TEXT = 'الإجمالي'


class ContractorsBalanceParseError(Exception):
    pass


def _header_indices(row1: list, row2: list) -> Optional[Dict[str, int]]:
    """يستخرج فهارس الأعمدة من نص العناوين نفسها — نفس أسلوب debts_report_xls،
    كي لا يعتمد القارئ على أرقام أعمدة ثابتة بلا تحقق من مصدرها."""
    def find(row, label):
        for i, v in enumerate(row):
            if str(v).strip() == label:
                return i
        return None

    col_project = find(row1, 'تبويب')
    col_account = find(row1, 'رقم الحساب')
    col_name = find(row1, 'اسم الحساب')
    if col_account is None or col_name is None:
        return None

    balance_idx = [i for i, v in enumerate(row2) if str(v).strip() == 'الرصيد']
    credit_idx = [i for i, v in enumerate(row2) if str(v).strip() == 'دائن']
    debit_idx = [i for i, v in enumerate(row2) if str(v).strip() == 'مدين']
    if not balance_idx or len(credit_idx) < 2 or len(debit_idx) < 2:
        return None

    return dict(project=col_project if col_project is not None else -1,
               balance=balance_idx[0],
               period_credit=credit_idx[0], opening_credit=credit_idx[1],
               period_debit=debit_idx[0], opening_debit=debit_idx[1],
               name=col_name, account=col_account)


def _clean_str(v) -> str:
    return str(v).strip() if v is not None else ''


def _cell(row: list, idx: int):
    return row[idx] if 0 <= idx < len(row) else None


def _num(v) -> Decimal:
    if v is None or v == '':
        return Decimal('0')
    return D(v)


def _read_sheet_rows(ws) -> tuple:
    """يُرجع (rows, issues) لورقة واحدة، أو (None, issues) إن كان تخطيطها غير متعرَّف
    عليه — الاستدعاء يقرر بنفسه هل يعتمد الورقة أم يتجاهلها."""
    issues: List[dict] = []
    if ws.nrows <= HEADER_ROW2:
        return None, issues

    row1 = [ws.cell_value(HEADER_ROW1, c) for c in range(ws.ncols)]
    row2 = [ws.cell_value(HEADER_ROW2, c) for c in range(ws.ncols)]
    idx = _header_indices(row1, row2)
    if idx is None:
        return None, issues

    rows: List[dict] = []
    for r in range(FIRST_DATA_ROW, ws.nrows):
        row = [ws.cell_value(r, c) for c in range(ws.ncols)]
        name = _clean_str(_cell(row, idx['name']))
        account = _clean_str(_cell(row, idx['account']))
        if not name and not account:
            continue                                  # سطر فارغ تماماً
        if _TOTAL_ROW_RE_TEXT in name and not account:
            continue                                  # صف الإجمالي الكلي في الذيل
        if not account:
            issues.append(dict(severity='error', row=r, sheet=ws.name,
                               message='%s: بلا رقم حساب — تم تجاهل الصف' % (name or '؟')))
            continue

        opening_debit = _num(_cell(row, idx['opening_debit']))
        opening_credit = _num(_cell(row, idx['opening_credit']))
        movement_debit = _num(_cell(row, idx['period_debit']))
        movement_credit = _num(_cell(row, idx['period_credit']))
        balance = _num(_cell(row, idx['balance']))
        project = _clean_str(_cell(row, idx['project']))

        expected = (opening_debit - opening_credit) + (movement_debit - movement_credit)
        if abs(expected - balance) > Decimal('0.02'):
            issues.append(dict(
                severity='warning', row=r, sheet=ws.name, account=account, name=name,
                kind='equation_mismatch',
                message='%s (%s): الرصيد %.2f لا يطابق (مدين افتتاحي − دائن افتتاحي) + '
                        '(مدين حركة − دائن حركة) = %.2f' % (
                            name, account, money(balance), money(expected))))

        rows.append(dict(account=account, name=name, project=project,
                         openingDebit=money(opening_debit), openingCredit=money(opening_credit),
                         movementDebit=money(movement_debit), movementCredit=money(movement_credit),
                         balance=money(balance), sheet=ws.name))

    return rows, issues


def parse(path: str) -> dict:
    """يقرأ الورقة الأولى (المصدر الوحيد لـ`rows`) ويقارنها بالأوراق الفرعية.

    الناتج: {asOfDate, fromDate, rows, sheets, totals, issues}. `rows` من الورقة
    الأولى حصراً — انظر شرح الملف أعلاه لسبب استبعاد بقية الأوراق من الناتج.
    """
    try:
        import xlrd
    except ImportError as e:      # pragma: no cover
        raise ContractorsBalanceParseError('xlrd مطلوب لقراءة ملفات xls القديمة') from e

    check_basic_file(path, 'كشف المقاولين', ContractorsBalanceParseError)
    try:
        wb = xlrd.open_workbook(path)
    except Exception as e:
        raise ContractorsBalanceParseError(str(describe_excel_open_error(e, path, 'xls'))) from e

    if not wb.sheet_names():
        raise ContractorsBalanceParseError('لا توجد أوراق في الملف')

    master_ws = wb.sheet_by_index(0)
    as_of_date = _clean_str(master_ws.cell_value(3, 3)) if master_ws.nrows > 3 else ''
    from_date = _clean_str(master_ws.cell_value(3, 8)) if master_ws.nrows > 3 else ''

    issues: List[dict] = []

    # تحقق الفهارس المشتقة مقابل الملاحظ فعلياً — انظر شرح _EXPECTED_INDICES.
    row1 = [master_ws.cell_value(HEADER_ROW1, c) for c in range(master_ws.ncols)]
    row2 = [master_ws.cell_value(HEADER_ROW2, c) for c in range(master_ws.ncols)]
    idx = _header_indices(row1, row2)
    if idx is None:
        raise ContractorsBalanceParseError(
            'تخطيط أعمدة غير متعرَّف عليه في الورقة الأولى («%s»)' % master_ws.name)
    for key, expected_i in _EXPECTED_INDICES.items():
        if idx[key] != expected_i:
            raise ContractorsBalanceParseError(
                'فهرس عمود «%s» تغيّر (متوقَّع %d، وُجد %d) — تحقق يدوياً من تخطيط '
                'الملف قبل المتابعة' % (key, expected_i, idx[key]))

    master_rows, master_issues = _read_sheet_rows(master_ws)
    if master_rows is None:
        raise ContractorsBalanceParseError('تعذّرت قراءة الورقة الأولى «%s»' % master_ws.name)
    issues += master_issues

    master_by_account: Dict[str, dict] = {}
    dup_count = 0
    for r in master_rows:
        if r['account'] in master_by_account:
            dup_count += 1
            issues.append(dict(severity='warning', kind='duplicate_in_master',
                               account=r['account'], name=r['name'],
                               message='%s (%s): حساب مكرر داخل الورقة الأولى نفسها' % (
                                   r['name'], r['account'])))
            continue
        master_by_account[r['account']] = r

    sheets_report = [dict(name=master_ws.name, role='master', rows=len(master_rows),
                          duplicates=dup_count)]

    # الأوراق الفرعية — للمقارنة فقط، لا تُضاف صفوفها إلى rows إطلاقاً.
    for i in range(1, wb.nsheets):
        ws = wb.sheet_by_index(i)
        sub_rows, sub_issues = _read_sheet_rows(ws)
        if sub_rows is None:
            sheets_report.append(dict(name=ws.name, role='skipped', rows=0, duplicates=0))
            continue
        issues += sub_issues
        seen_here = set()
        sub_dup = 0
        for r in sub_rows:
            if r['account'] in seen_here:
                sub_dup += 1
                continue
            seen_here.add(r['account'])
            m = master_by_account.get(r['account'])
            if m is None:
                issues.append(dict(severity='warning', kind='missing_from_master',
                                   sheet=ws.name, account=r['account'], name=r['name'],
                                   message='%s (%s): موجود في «%s» وغير موجود في الورقة '
                                           'الأولى' % (r['name'], r['account'], ws.name)))
                continue
            if abs(D(m['balance']) - D(r['balance'])) > Decimal('0.02'):
                issues.append(dict(severity='warning', kind='cross_sheet_mismatch',
                                   sheet=ws.name, account=r['account'], name=r['name'],
                                   message='%s (%s): الرصيد في «%s» (%.2f) يختلف عن الورقة '
                                           'الأولى (%.2f)' % (
                                               r['name'], r['account'], ws.name,
                                               money(D(r['balance'])), money(D(m['balance'])))))
        sheets_report.append(dict(name=ws.name, role='cross_check', rows=len(sub_rows),
                                  duplicates=sub_dup))

    rows = list(master_by_account.values())
    positive = sum((D(r['balance']) for r in rows if D(r['balance']) > 0), Decimal('0'))
    negative = sum((D(r['balance']) for r in rows if D(r['balance']) < 0), Decimal('0'))
    zero_count = sum(1 for r in rows if D(r['balance']) == 0)
    totals = dict(accounts=len(rows),
                 positiveCount=sum(1 for r in rows if D(r['balance']) > 0),
                 positiveSum=money(positive),
                 negativeCount=sum(1 for r in rows if D(r['balance']) < 0),
                 negativeSum=money(negative),
                 zeroCount=zero_count,
                 net=money(positive + negative))

    return dict(asOfDate=as_of_date, fromDate=from_date, rows=rows,
               sheets=sheets_report, totals=totals, issues=issues)
