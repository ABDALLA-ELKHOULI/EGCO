# -*- coding: utf-8 -*-
"""قارئ كشف الحساب بصيغة CSV.

Same output shape as `ingest.pdf_statement.parse` — {account, invoices, payments,
statement_balance, issues} — so `import_service` can treat both statement sources
identically. Unlike the PDF, a CSV file may not carry a printed closing balance;
`statement_balance=None` is allowed and the caller reports it as reconciled with a
warning instead of rejecting the import.

Accepted headers (case-insensitive, any order), Arabic or English:
    التاريخ / date          — dd-mm-yyyy or yyyy-mm-dd
    مدين / debit             — payment we made
    دائن / credit            — invoice we owe
    رقم المستند / doc
    الوصف / description
    الحساب / account         — optional; falls back to None (unknown_supplier at commit)
"""
from __future__ import annotations

import csv
import datetime as dt
import io

from app.domain.payables import Invoice, Payment

HEADER_MAP = {
    'التاريخ': 'date', 'date': 'date',
    'مدين': 'debit', 'debit': 'debit',
    'دائن': 'credit', 'credit': 'credit',
    'رقم المستند': 'doc', 'doc': 'doc', 'document': 'doc',
    'الوصف': 'description', 'description': 'description',
    'الحساب': 'account', 'account': 'account',
}


class CsvStatementParseError(Exception):
    pass


def _norm_header(h: str) -> str:
    return (h or '').strip().lower()


def _parse_date(s: str) -> dt.date:
    s = s.strip()
    for fmt in ('%d-%m-%Y', '%Y-%m-%d'):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f'تعذّرت قراءة التاريخ: {s}')


def _parse_money(s: str) -> float:
    s = (s or '').strip().replace(',', '')
    if not s:
        return 0.0
    neg = s.startswith('(') and s.endswith(')')
    s = s.strip('()')
    v = float(s)
    return -v if neg else v


def parse(path: str) -> dict:
    with open(path, 'r', encoding='utf-8-sig', newline='') as fh:
        content = fh.read()

    reader = csv.reader(io.StringIO(content))
    rows = list(reader)
    if not rows:
        raise CsvStatementParseError('الملف فارغ')

    header = [_norm_header(h) for h in rows[0]]
    cols = {}
    for idx, h in enumerate(header):
        key = HEADER_MAP.get(h)
        if key:
            cols[key] = idx

    if 'date' not in cols or ('debit' not in cols and 'credit' not in cols):
        raise CsvStatementParseError(
            'أعمدة غير معروفة — يلزم عمود التاريخ وأحد عمودي مدين/دائن')

    issues: list = []
    invoices: list = []
    payments: list = []
    account = None

    for i, row in enumerate(rows[1:], start=1):
        if not any(c.strip() for c in row):
            continue
        try:
            date = _parse_date(row[cols['date']])
        except (ValueError, IndexError):
            issues.append(dict(severity='warning', row=i, message='تعذّرت قراءة السطر'))
            continue

        debit = _parse_money(row[cols['debit']]) if 'debit' in cols and cols['debit'] < len(row) else 0.0
        credit = _parse_money(row[cols['credit']]) if 'credit' in cols and cols['credit'] < len(row) else 0.0
        doc = row[cols['doc']].strip() if 'doc' in cols and cols['doc'] < len(row) else ''
        desc = row[cols['description']].strip() if 'description' in cols and cols['description'] < len(row) else ''

        if 'account' in cols and cols['account'] < len(row) and row[cols['account']].strip():
            account = row[cols['account']].strip()

        if credit > 0:
            invoices.append(Invoice(date=date, amount=credit, doc=doc, description=desc))
        elif debit > 0:
            payments.append(Payment(date=date, amount=debit, doc=doc, description=desc))
        else:
            issues.append(dict(severity='info', row=i, message='حركة بقيمة صفر — تم تجاهلها'))

    if not invoices and not payments:
        raise CsvStatementParseError('لم يُعثر على أي حركة صالحة في الملف')

    return dict(account=account, invoices=invoices, payments=payments,
                statement_balance=None, issues=issues)
