# -*- coding: utf-8 -*-
"""اختبارات معاملات التصفية/الترتيب الإضافية على GET /import/history — أُضيفت
لدعم قائمة العمود (فرز/تصفية) في شاشة «الملفات المرفوعة» دون كسر السلوك
القديم (طلب بلا معاملات يُعيد كل الصفوف كما كان دائماً، أحدثها أولاً).

Mirrors tests/test_import_history.py's fixture setup (standalone FastAPI app
mounting only the imports router over a temp-dir-backed db).
"""
import importlib
import os

import pytest

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
SUPPLIERS_XLSX = os.path.join(SAMPLES, 'suppliers-terms.xlsx')
STATEMENT_QANBAR = os.path.join(SAMPLES, 'statement-qanbar.pdf')

pytestmark = pytest.mark.skipif(
    not (os.path.exists(SUPPLIERS_XLSX) and os.path.exists(STATEMENT_QANBAR)),
    reason='design/samples not present in this checkout')


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.payables_service as payables_service_mod
    importlib.reload(payables_service_mod)
    import app.services.contractors_service as contractors_service_mod
    importlib.reload(contractors_service_mod)
    import app.services.receivables_service as receivables_service_mod
    importlib.reload(receivables_service_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)
    import app.api.routes.imports as imports_route
    importlib.reload(imports_route)

    session_mod.init_db()

    class Env:
        pass

    e = Env()
    e.session = session_mod
    e.models = models_mod
    e.import_service = import_service_mod
    e.imports_route = imports_route
    return e


@pytest.fixture()
def db(env):
    session = env.session.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(env):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(env.imports_route.router, prefix='/import')
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def seeded(db, env, client):
    """موردون + كشف واحد مطابق — يكفي لصفَّي تاريخ (suppliers_excel و pdf_statement)."""
    env.import_service.import_suppliers(db, SUPPLIERS_XLSX)
    res = env.import_service.commit_statement(db, STATEMENT_QANBAR, source='pdf_statement')
    assert res['saved'] is True
    return res


def test_no_params_unchanged(client, seeded):
    """السلوك القديم يبقى كما هو تماماً لطلب بلا معاملات — هذا هو شرط «إضافي فقط»."""
    r = client.get('/import/history')
    assert r.status_code == 200
    rows = r.json()['rows']
    assert len(rows) == 2
    assert {row['source'] for row in rows} == {'pdf_statement', 'suppliers_excel'}


def test_filter_by_source(client, seeded):
    r = client.get('/import/history', params={'source': 'pdf_statement'})
    rows = r.json()['rows']
    assert len(rows) == 1
    assert rows[0]['source'] == 'pdf_statement'


def test_filter_by_file_name_substring_case_insensitive(client, seeded):
    fname = os.path.basename(STATEMENT_QANBAR)
    r = client.get('/import/history', params={'file_name': fname[:6].upper()})
    rows = r.json()['rows']
    assert len(rows) == 1
    assert rows[0]['fileName'] == fname


def test_filter_by_reconciled(client, seeded):
    # كل من ملف الموردين والكشف المطابق reconciled=True هنا — نتحقق أن معامل
    # reconciled=no يستبعدهما بلا استثناء، لا من عدد ثابت مسبقاً.
    r = client.get('/import/history', params={'reconciled': 'yes'})
    rows = r.json()['rows']
    assert len(rows) == 2
    assert all(row['reconciled'] is True for row in rows)

    r2 = client.get('/import/history', params={'reconciled': 'no'})
    rows2 = r2.json()['rows']
    assert rows2 == []


def test_filter_by_min_moves_excludes_zero_move_rows(client, seeded):
    r = client.get('/import/history', params={'min_moves': 1})
    rows = r.json()['rows']
    # ملف الموردين لا يترك حركات في linkedRows (ليس مصدراً مرتبطاً)، فيُستبعد
    assert all(row['linkedRows'] >= 1 or row['legacy'] for row in rows)


def test_sort_by_file_name_asc(client, seeded):
    r = client.get('/import/history', params={'sort': 'fileName', 'dir': 'asc'})
    rows = r.json()['rows']
    names = [row['fileName'] for row in rows]
    assert names == sorted(names)


def test_invalid_sort_key_rejected(client, seeded):
    r = client.get('/import/history', params={'sort': 'notacolumn'})
    assert r.status_code == 422


def test_invalid_dir_rejected(client, seeded):
    r = client.get('/import/history', params={'sort': 'date', 'dir': 'sideways'})
    assert r.status_code == 422
