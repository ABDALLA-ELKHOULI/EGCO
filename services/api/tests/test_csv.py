# -*- coding: utf-8 -*-
"""اختبارات قارئ كشف الحساب CSV — كلا لغتَي رأس الجدول."""
import datetime as dt

from app.ingest import csv_statement

ARABIC_CSV = (
    'التاريخ,مدين,دائن,رقم المستند,الوصف,الحساب\n'
    '01-01-2026,,1000.00,D1,فاتورة أولى,2110960\n'
    '15-01-2026,400.00,,P1,دفعة أولى,2110960\n'
)

ENGLISH_CSV = (
    'date,debit,credit,doc,description,account\n'
    '2026-01-01,,1000.00,D1,first invoice,2110960\n'
    '2026-01-15,400.00,,P1,first payment,2110960\n'
)


def _write(tmp_path, name, content):
    p = tmp_path / name
    p.write_text(content, encoding='utf-8-sig')
    return str(p)


def test_parses_arabic_header(tmp_path):
    path = _write(tmp_path, 'arabic.csv', ARABIC_CSV)
    result = csv_statement.parse(path)
    assert result['account'] == '2110960'
    assert result['statement_balance'] is None
    assert len(result['invoices']) == 1
    assert len(result['payments']) == 1
    assert result['invoices'][0].date == dt.date(2026, 1, 1)
    assert result['invoices'][0].amount == 1000.0
    assert result['payments'][0].date == dt.date(2026, 1, 15)
    assert result['payments'][0].amount == 400.0


def test_parses_english_header(tmp_path):
    path = _write(tmp_path, 'english.csv', ENGLISH_CSV)
    result = csv_statement.parse(path)
    assert result['account'] == '2110960'
    assert len(result['invoices']) == 1
    assert len(result['payments']) == 1


def test_yyyy_mm_dd_dates_also_parse(tmp_path):
    content = 'date,debit,credit\n2026-03-05,,250.5\n'
    path = _write(tmp_path, 'iso_dates.csv', content)
    result = csv_statement.parse(path)
    assert result['invoices'][0].date == dt.date(2026, 3, 5)


def test_preview_reports_reconciled_with_warning_when_no_balance(tmp_path):
    from app.services import import_service
    path = _write(tmp_path, 'no_balance.csv', ARABIC_CSV)
    pre = import_service.preview_statement(path, source='csv_statement')
    assert pre['reconciled'] is True
    assert pre['statementBalance'] is None
    assert any('رصيد' in i['message'] for i in pre['issues'])
