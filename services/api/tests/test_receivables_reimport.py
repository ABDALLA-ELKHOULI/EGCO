# -*- coding: utf-8 -*-
"""استيراد التحصيلات مرتين على ملف مُصنَّع — يجب ألا يُضاف شيء في المرة الثانية.

report4.html الحقيقي غير متوفر في كل بيئة (انظر test_receivables.py)، فهذا الملف يبني
نسخة مُصغَّرة بنفس الشكل (6 جداول، الجدولان 3 و4 هما جدولا التحصيل) حتى يعمل الاختبار
في أي بيئة دون الاعتماد على ملف المستخدم الحقيقي. ونفعل الشيء ذاته لقارئ الإكسل.
"""
import importlib
import os

import pytest


def _write_report4_html(path):
    def table(rows):
        trs = ''.join(
            '<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
        return f'<table>{trs}</table>'

    header = ['وحدة', 'العميل', 'الدفعة الثانية', 'الدفعة الثالثة', 'المحصّل', 'المتبقي', '٪']
    # table 3 and table 4 hold different units — two distinct real-world sections
    # of the report — so the two collection tables never collide with each other.
    table3_rows = [
        header,
        ['١٠١', 'عميل واحد', '-', '-', '50,000', '10,000', '83%'],
        ['١٠٢', 'عميل اثنان', '-', '-', '20,000', '-', '100%'],
    ]
    table4_rows = [
        header,
        ['٢٠١', 'عميل ثلاثة', '-', '-', '15,000', '-', '100%'],
    ]
    # tables 0,1,2 are irrelevant filler tables; 3 and 4 are the collection tables;
    # 5 is trailing filler — legacy parser requires >= 5 tables total.
    filler = '<table><tr><td>x</td></tr></table>'
    html = (
        '<html><body>'
        + filler * 3
        + table(table3_rows)
        + table(table4_rows)
        + filler
        + '</body></html>'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)


@pytest.fixture()
def db_env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.services.receivables_service as receivables_service_mod
    importlib.reload(receivables_service_mod)

    session_mod.init_db()
    db = session_mod.SessionLocal()
    yield db, receivables_service_mod
    db.close()


def test_reimport_legacy_html_adds_zero_rows(tmp_path, db_env):
    db, receivables_service = db_env
    from app.db import models

    path = str(tmp_path / 'report4.html')
    _write_report4_html(path)

    first = receivables_service.import_receivables(db, path, source='receivables_legacy_html')
    assert first['saved'] is True
    assert first['added'] > 0
    assert first['skipped'] == 0

    live_count = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None)).count()
    assert live_count == first['added']

    second = receivables_service.import_receivables(db, path, source='receivables_legacy_html')
    assert second['added'] == 0
    assert second['skipped'] == first['added']

    # row count in the DB must not have grown
    assert db.query(models.Receivable).filter(
        models.Receivable.deleted_at.is_(None)).count() == live_count


def test_same_row_repeated_within_one_file_does_not_crash(tmp_path, db_env):
    """Regression: report4.html's two collection tables can legitimately list the same
    unit/client/amount/status twice (e.g. a unit appearing in both table sections).
    Before the fix, the identity-check query ran with autoflush disabled, so the
    in-memory duplicate wasn't visible yet and the second insert crashed the whole
    import with a UNIQUE constraint IntegrityError instead of being skipped."""
    db, receivables_service = db_env
    from app.db import models

    def table(rows):
        trs = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
        return f'<table>{trs}</table>'

    header = ['وحدة', 'العميل', 'الدفعة الثانية', 'الدفعة الثالثة', 'المحصّل', 'المتبقي', '٪']
    dup_rows = [header, ['١٠١', 'عميل واحد', '-', '-', '50,000', '-', '100%']]
    filler = '<table><tr><td>x</td></tr></table>'
    html = '<html><body>' + filler * 3 + table(dup_rows) + table(dup_rows) + filler + '</body></html>'
    path = str(tmp_path / 'report4_dup.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)

    result = receivables_service.import_receivables(db, path, source='receivables_legacy_html')
    assert result['saved'] is True
    assert result['added'] == 1
    assert result['skipped'] == 1
    assert db.query(models.Receivable).filter(
        models.Receivable.deleted_at.is_(None)).count() == 1


def test_reimport_excel_adds_zero_rows(tmp_path, db_env):
    openpyxl = pytest.importorskip('openpyxl')
    db, receivables_service = db_env
    from app.db import models

    path = str(tmp_path / 'receivables.xlsx')
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(['الوحدة', 'العميل', 'المبلغ', 'تاريخ التحصيل', 'تاريخ الاستحقاق', 'المشروع'])
    ws.append(['201', 'عميل ثلاثة', 30000, '2026-01-15', None, 'مشروع أ'])
    ws.append(['202', 'عميل أربعة', 15000, None, '2026-05-01', 'مشروع أ'])
    wb.save(path)

    first = receivables_service.import_receivables(db, path, source='receivables_excel')
    assert first['saved'] is True
    assert first['added'] == 2
    assert first['skipped'] == 0

    second = receivables_service.import_receivables(db, path, source='receivables_excel')
    assert second['added'] == 0
    assert second['skipped'] == 2

    assert db.query(models.Receivable).filter(
        models.Receivable.deleted_at.is_(None)).count() == 2
