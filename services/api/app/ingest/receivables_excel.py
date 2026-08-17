# -*- coding: utf-8 -*-
"""قارئ ملف تحصيلات عام (Excel) — عمود بأي ترتيب، عربي أو إنجليزي.

Columns recognised (Arabic or English header, case/whitespace-insensitive, any order):
    الوحدة / unit
    العميل / client
    المبلغ / amount
    تاريخ التحصيل / collected
    تاريخ الاستحقاق / due
    المشروع / project
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import List, Optional

from app.ingest.friendly_errors import check_basic_file, describe_excel_open_error

_HEADER_MAP = {
    'الوحدة': 'unit', 'unit': 'unit',
    'العميل': 'client', 'client': 'client',
    'المبلغ': 'amount', 'amount': 'amount',
    'تاريخ التحصيل': 'collected', 'collected': 'collected', 'collected_on': 'collected',
    'تاريخ الاستحقاق': 'due', 'due': 'due', 'due_date': 'due',
    'المشروع': 'project', 'project': 'project',
}


class ReceivablesExcelParseError(Exception):
    pass


@dataclass
class ReceivableRow:
    unit: str
    client: str
    amount: Decimal
    status: str
    project: str = ''
    due_date: Optional[dt.date] = None
    collected_on: Optional[dt.date] = None


def _norm_header(cell) -> Optional[str]:
    if cell is None:
        return None
    key = str(cell).strip()
    return _HEADER_MAP.get(key) or _HEADER_MAP.get(key.lower())


def _to_date(v) -> Optional[dt.date]:
    if v is None or v == '':
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    text = str(v).strip()
    if not text:
        return None
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _to_amount(v) -> Decimal:
    if v is None or v == '':
        return Decimal('0')
    if isinstance(v, (int, float)):
        return Decimal(str(v))
    text = str(v).strip().replace(',', '')
    try:
        return Decimal(text)
    except InvalidOperation:
        return Decimal('0')


def parse(path: str) -> dict:
    try:
        import openpyxl
    except ImportError as e:   # pragma: no cover
        raise ReceivablesExcelParseError('openpyxl is required to read the receivables file') from e

    check_basic_file(path, 'ملف التحصيلات', ReceivablesExcelParseError)
    try:
        wb = openpyxl.load_workbook(path, data_only=True)
    except Exception as e:
        raise ReceivablesExcelParseError(str(describe_excel_open_error(e, path, 'xlsx'))) from e
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)

    header = None
    for row in rows_iter:
        mapped = {_norm_header(c): i for i, c in enumerate(row) if _norm_header(c)}
        if 'unit' in mapped or 'client' in mapped:
            header = mapped
            break
    if header is None:
        raise ReceivablesExcelParseError('لم يُعثر على صف عناوين صالح في ملف التحصيلات')

    def get(row, key):
        idx = header.get(key)
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    rows: List[ReceivableRow] = []
    issues: List[dict] = []

    for r_idx, row in enumerate(rows_iter, start=1):
        if row is None or all(c is None for c in row):
            continue
        client = get(row, 'client')
        unit = get(row, 'unit')
        if not client and not unit:
            continue

        amount = _to_amount(get(row, 'amount'))
        if amount <= 0:
            issues.append(dict(severity='warning', row=r_idx,
                               message=f'صف بلا مبلغ صالح — تم تجاهله ({client or unit})'))
            continue

        collected_on = _to_date(get(row, 'collected'))
        due_date = _to_date(get(row, 'due'))
        status = 'collected' if collected_on is not None else 'open'

        rows.append(ReceivableRow(
            unit=str(unit).strip() if unit is not None else '',
            client=str(client).strip() if client is not None else '',
            amount=amount, status=status,
            project=str(get(row, 'project') or '').strip(),
            due_date=due_date, collected_on=collected_on,
        ))

    if not rows:
        raise ReceivablesExcelParseError('لم تُقرأ أي بيانات تحصيل من الملف')

    return dict(receivables=rows, issues=issues)
