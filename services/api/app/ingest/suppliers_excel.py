# -*- coding: utf-8 -*-
"""قارئ ملف مدد مديونية الموردين.

Reads `مدة مديونية الموردين.xlsx`. Layout (verified on the real file):
  row 1  company name
  row 2  report title
  row 3  headers: تبويب | المدة بالشهر | … | اسم الحساب | … | رقم الحساب
  row 4+ data

Column A = project (تبويب), B = payment term, D = account name, I = account number.
The account number is the key — supplier names repeat across projects
(انجاز الرواد appears in 5 projects, سماء البناء in 4), so names are never used to match.
"""
from __future__ import annotations

from app.domain.payables import Supplier, parse_term
from app.ingest.friendly_errors import check_basic_file, describe_excel_open_error

COL_PROJECT = 0
COL_TERM = 1
COL_NAME = 3
COL_ACCOUNT = 8
FIRST_DATA_ROW = 4     # 1-based; rows 1–3 are titles and headers


class SuppliersParseError(Exception):
    pass


def parse(path: str) -> dict:
    """Return {suppliers, issues}."""
    try:
        import openpyxl
    except ImportError as e:      # pragma: no cover
        raise SuppliersParseError('openpyxl is required to read the suppliers file') from e

    check_basic_file(path, 'ملف مدد الموردين', SuppliersParseError)
    try:
        wb = openpyxl.load_workbook(path, data_only=True)
    except Exception as e:
        raise SuppliersParseError(str(describe_excel_open_error(e, path, 'xlsx'))) from e
    ws = wb.active

    suppliers: list[Supplier] = []
    issues: list[dict] = []
    seen: dict[str, str] = {}

    for r, row in enumerate(ws.iter_rows(min_row=FIRST_DATA_ROW, values_only=True),
                            start=FIRST_DATA_ROW):
        name = row[COL_NAME] if len(row) > COL_NAME else None
        if not name or not str(name).strip():
            continue

        account = str(row[COL_ACCOUNT]).strip() if len(row) > COL_ACCOUNT and row[COL_ACCOUNT] else ''
        if not account:
            issues.append(dict(severity='error', row=r,
                               message=f'مورد بلا رقم حساب: {str(name).strip()} — تم تجاهله'))
            continue

        if account in seen:
            issues.append(dict(severity='error', row=r,
                               message=f'رقم الحساب {account} مكرر ({seen[account]}) — تم تجاهل الصف'))
            continue
        seen[account] = str(name).strip()

        term = parse_term(str(row[COL_TERM]) if row[COL_TERM] is not None else None)
        if term.is_claim:
            issues.append(dict(severity='info', row=r,
                               message=f'{str(name).strip()}: مدة «{term.raw}» — يحتاج تاريخ استحقاق يدوي'))

        suppliers.append(Supplier(
            account=account,
            name=str(name).strip(),
            project=str(row[COL_PROJECT]).strip() if row[COL_PROJECT] else '',
            term=term,
        ))

    if not suppliers:
        raise SuppliersParseError('لم يُقرأ أي مورد — تأكد من صيغة الملف')

    return dict(suppliers=suppliers, issues=issues)
