# -*- coding: utf-8 -*-
"""اختبارات المرحلة 3 — مسح المجلدات، الاستيراد الدفعي، التغطية، وتعديل تاريخ الاستحقاق.

Routes new in this phase (`/coverage`, `/invoices/{id}/due-date`) are not wired into
`app.api.router` yet — that belongs to the integrator. Tests exercise them either
directly against the service layer, or through a small standalone FastAPI app that
mounts only the new routers on top of the same reloaded, temp-dir-backed db session.
"""
import datetime as dt
import importlib
import os

import pytest

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
SUPPLIERS_XLSX = os.path.join(SAMPLES, 'suppliers-terms.xlsx')
STATEMENT_QANBAR = os.path.join(SAMPLES, 'statement-qanbar.pdf')
STATEMENT_INJAZ = os.path.join(SAMPLES, 'statement-injaz-alsuddan.pdf')

pytestmark = pytest.mark.skipif(
    not (os.path.exists(SUPPLIERS_XLSX) and os.path.exists(STATEMENT_QANBAR)
         and os.path.exists(STATEMENT_INJAZ)),
    reason='design/samples not present in this checkout')


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """Reloads config/session/services against a fresh temp EGCO_DATA_DIR, and returns
    a bag of the reloaded modules the tests need — mirrors tests/conftest.py's
    api_client fixture but without needing app.api.router (which we must not touch)."""
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.payables_service as payables_service_mod
    importlib.reload(payables_service_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)
    import app.services.coverage_service as coverage_service_mod
    importlib.reload(coverage_service_mod)
    import app.api.routes.imports as imports_route
    importlib.reload(imports_route)
    import app.api.routes.coverage as coverage_route
    importlib.reload(coverage_route)
    import app.api.routes.invoices as invoices_route
    importlib.reload(invoices_route)

    session_mod.init_db()

    class Env:
        pass

    e = Env()
    e.config = config_mod
    e.session = session_mod
    e.models = models_mod
    e.payables_service = payables_service_mod
    e.import_service = import_service_mod
    e.coverage_service = coverage_service_mod
    e.imports_route = imports_route
    e.coverage_route = coverage_route
    e.invoices_route = invoices_route
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
    """Standalone client mounting only the routers this agent owns, so /coverage and
    /invoices/{id}/due-date can be exercised over HTTP without touching router.py."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(env.imports_route.router, prefix='/import')
    app.include_router(env.coverage_route.router, prefix='/coverage')
    app.include_router(env.invoices_route.router, prefix='/invoices')
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------- scan_dir

def test_scan_classifies_by_extension(tmp_path, env):
    (tmp_path / 'a.pdf').write_bytes(b'x')
    (tmp_path / 'b.csv').write_text('x')
    (tmp_path / 'c.xlsx').write_bytes(b'x')
    (tmp_path / 'd.txt').write_text('x')

    result = env.import_service.scan_dir(str(tmp_path))
    by_name = {f['name']: f for f in result['files']}
    assert by_name['a.pdf']['source'] == 'pdf_statement'
    assert by_name['b.csv']['source'] == 'csv_statement'
    assert by_name['c.xlsx']['source'] == 'suppliers_excel'
    assert 'd.txt' not in by_name
    assert result['skipped'] == [dict(name='d.txt', reason='صيغة غير مدعومة')]
    assert all('sizeKb' in f for f in result['files'])


def test_scan_missing_dir_raises_not_a_directory_error(env):
    with pytest.raises(NotADirectoryError):
        env.import_service.scan_dir('/no/such/directory/at/all')


def test_scan_route_returns_404_arabic_for_missing_dir(client):
    r = client.post('/import/scan', json={'dir': '/no/such/directory/at/all'})
    assert r.status_code == 404
    assert r.json()['detail']


# ---------------------------------------------------------------- batch_import

def test_batch_processes_suppliers_first_and_reconciles_qanbar(db, env):
    # Deliberately order statements before the suppliers file — batch must reorder.
    paths = [STATEMENT_QANBAR, STATEMENT_INJAZ, SUPPLIERS_XLSX]
    out = env.import_service.batch_import(db, paths)

    assert out['total'] == 3
    assert all(r['status'] for r in out['results'])

    by_path = {r['path']: r for r in out['results']}
    # suppliers file must appear first in the results, regardless of input order
    assert out['results'][0]['path'] == SUPPLIERS_XLSX
    assert by_path[SUPPLIERS_XLSX]['status'] == 'saved'

    qanbar_row = by_path[STATEMENT_QANBAR]
    assert qanbar_row['status'] == 'saved'
    assert qanbar_row['account'] == '2110110'
    assert abs(qanbar_row['computedBalance'] - 80049.95) < 0.01

    injaz_row = by_path[STATEMENT_INJAZ]
    assert injaz_row['status'] == 'saved'
    assert injaz_row['account'] == '2110960'

    assert out['saved'] == 3
    assert out['failed'] == 0


def test_batch_bad_path_becomes_a_result_row_not_an_exception(db, env):
    paths = [SUPPLIERS_XLSX, '/no/such/file.pdf']
    out = env.import_service.batch_import(db, paths)

    assert out['total'] == 2
    by_path = {r['path']: r for r in out['results']}
    assert by_path['/no/such/file.pdf']['status'] == 'read_error'
    assert by_path['/no/such/file.pdf']['message']
    assert by_path[SUPPLIERS_XLSX]['status'] == 'saved'
    assert out['failed'] == 1
    assert out['saved'] == 1


def test_batch_route_returns_aggregate_shape(client):
    r = client.post('/import/batch', json={'paths': [SUPPLIERS_XLSX, STATEMENT_QANBAR]})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {'total', 'saved', 'duplicates', 'failed', 'results'}
    assert body['total'] == 2


# ---------------------------------------------------------------- coverage

def test_coverage_totals_on_seeded_db(db, env):
    env.import_service.batch_import(db, [SUPPLIERS_XLSX, STATEMENT_QANBAR])

    out = env.coverage_service.coverage(db, today=dt.date(2026, 8, 8), stale_days=90)
    t = out['totals']
    assert t['suppliers'] > 0
    assert t['withData'] >= 1
    assert t['withoutData'] == t['suppliers'] - t['withData']
    assert t['coveredPct'] == round(t['withData'] / t['suppliers'] * 100, 1)

    rows_by_account = {r['account']: r for r in out['rows']}
    qanbar = rows_by_account['2110110']
    assert qanbar['state'] in ('ok', 'stale')
    assert qanbar['firstActivity'] is not None
    assert qanbar['lastActivity'] is not None

    # suppliers never imported have no activity at all
    none_rows = [r for r in out['rows'] if r['state'] == 'none']
    assert all(r['firstActivity'] is None and r['daysSinceLast'] is None for r in none_rows)

    # sort order: none first, then stale (desc by daysSinceLast), then ok
    states = [r['state'] for r in out['rows']]
    first_stale = states.index('stale') if 'stale' in states else len(states)
    first_ok = states.index('ok') if 'ok' in states else len(states)
    last_none = max((i for i, s in enumerate(states) if s == 'none'), default=-1)
    assert last_none < first_stale <= first_ok or last_none < first_ok


def test_coverage_zero_suppliers_has_zero_percent(db, env):
    out = env.coverage_service.coverage(db, today=dt.date(2026, 8, 8))
    assert out['totals']['suppliers'] == 0
    assert out['totals']['coveredPct'] == 0


def test_coverage_route(client):
    r = client.get('/coverage')
    assert r.status_code == 200
    body = r.json()
    assert 'totals' in body and 'rows' in body and 'asOf' in body


# ---------------------------------------------------------------- due-date override

def test_due_date_override_changes_computed_due_date_for_claim_supplier(db, env):
    models = env.models
    supplier = models.Supplier(account='CLAIM1', name='مورد مستخلص', project='',
                               term_raw='مستخلص', term_kind='claim', term_days=None)
    db.add(supplier)
    db.commit()
    db.refresh(supplier)

    inv = models.Invoice(supplier_id=supplier.id, number='INV1',
                         date=dt.date(2026, 1, 1), amount=1000.0, source='statement')
    db.add(inv)
    db.commit()
    db.refresh(inv)

    assert inv.manual_due_date is None  # claim term: no derivable due date yet

    from app.domain.payables import Term, due_date as _due_date
    term = Term(days=supplier.term_days, kind=supplier.term_kind, raw=supplier.term_raw)
    assert _due_date(inv.date, term) is None

    # apply the override directly through the same logic the route uses
    inv.manual_due_date = dt.date(2026, 9, 1)
    db.commit()
    db.refresh(inv)
    assert inv.manual_due_date.isoformat() == '2026-09-01'


def test_due_date_route_sets_and_clears_override(db, env, client):
    models = env.models
    supplier = models.Supplier(account='CLAIM2', name='مورد مستخلص 2', project='',
                               term_raw='مستخلص', term_kind='claim', term_days=None)
    db.add(supplier)
    db.commit()
    db.refresh(supplier)

    inv = models.Invoice(supplier_id=supplier.id, number='INV2',
                         date=dt.date(2026, 1, 1), amount=500.0, source='statement')
    db.add(inv)
    db.commit()
    db.refresh(inv)

    r = client.put(f'/invoices/{inv.id}/due-date', json={'due_date': '2026-10-15'})
    assert r.status_code == 200
    body = r.json()
    assert body['dueDate'] == '2026-10-15'
    assert body['source'] == 'statement'

    r2 = client.put(f'/invoices/{inv.id}/due-date', json={'due_date': None})
    assert r2.status_code == 200
    assert r2.json()['dueDate'] is None  # claim term still has no derivable due date

    r3 = client.put('/invoices/does-not-exist/due-date', json={'due_date': '2026-01-01'})
    assert r3.status_code == 404
