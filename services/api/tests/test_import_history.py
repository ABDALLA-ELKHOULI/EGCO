# -*- coding: utf-8 -*-
"""اختبارات ميزة إدارة الملفات المرفوعة — «أريد أن أرى الملفات التي رفعتها وأستطيع
حذف أي ملف منها».

Mirrors tests/test_intake.py's pattern: a standalone FastAPI app mounting only the
imports router on top of a reloaded, temp-dir-backed db session, plus samples under
design/samples for a real supplier statement to import.
"""
import datetime as dt
import importlib
import os
import uuid

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
    e.config = config_mod
    e.session = session_mod
    e.models = models_mod
    e.payables_service = payables_service_mod
    e.contractors_service = contractors_service_mod
    e.receivables_service = receivables_service_mod
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


def _live_count(db, model, import_log_id):
    return db.query(model).filter(
        model.import_log_id == import_log_id, model.deleted_at.is_(None)).count()


# ---------------------------------------------------------------- history listing

def test_history_row_after_supplier_import(db, env, client):
    env.import_service.import_suppliers(db, SUPPLIERS_XLSX)
    res = env.import_service.commit_statement(db, STATEMENT_QANBAR, source='pdf_statement')
    assert res['saved'] is True

    r = client.get('/import/history')
    assert r.status_code == 200
    rows = r.json()['rows']
    # newest first — the statement import is the most recent row
    stmt_row = next(x for x in rows if x['source'] == 'pdf_statement')
    assert stmt_row['fileName'] == os.path.basename(STATEMENT_QANBAR)
    assert stmt_row['account'] == '2110110'
    assert stmt_row['partyName']
    assert stmt_row['added'] == res['added']
    assert stmt_row['linkedRows'] == res['added']
    assert stmt_row['canDelete'] is True
    assert stmt_row['legacy'] is False
    assert stmt_row['reconciled'] is True

    suppliers_row = next(x for x in rows if x['source'] == 'suppliers_excel')
    assert suppliers_row['canDelete'] is False


# ---------------------------------------------------------------- delete + re-import

def test_delete_then_reimport_resurrects_rows_and_balance_reconciles(db, env, client):
    env.import_service.import_suppliers(db, SUPPLIERS_XLSX)
    res = env.import_service.commit_statement(db, STATEMENT_QANBAR, source='pdf_statement')
    added = res['added']
    account = res['account']

    r = client.get('/import/history')
    stmt_row = next(x for x in r.json()['rows'] if x['source'] == 'pdf_statement')
    log_id = stmt_row['id']

    supplier = db.query(env.models.Supplier).filter_by(account=account).one()

    def live_invoice_count():
        return db.query(env.models.Invoice).filter_by(
            supplier_id=supplier.id).filter(
            env.models.Invoice.deleted_at.is_(None)).count()

    def live_payment_count():
        return db.query(env.models.Payment).filter_by(
            supplier_id=supplier.id).filter(
            env.models.Payment.deleted_at.is_(None)).count()

    before_inv, before_pay = live_invoice_count(), live_payment_count()
    assert before_inv + before_pay == added

    # ---- delete
    dr = client.delete(f'/import/history/{log_id}')
    assert dr.status_code == 200
    deleted = dr.json()['deleted']
    assert deleted['invoices'] + deleted['payments'] == added

    db.expire_all()
    assert live_invoice_count() == 0
    assert live_payment_count() == 0

    # the log itself is soft-deleted too, so it no longer appears in the list at all
    r2 = client.get('/import/history')
    assert all(x['id'] != log_id for x in r2.json()['rows'])

    # ---- re-import the same statement — rows must be RESURRECTED, not duplicated,
    # and counted as added (not skipped), reconciling the balance again.
    res2 = env.import_service.commit_statement(db, STATEMENT_QANBAR, source='pdf_statement')
    assert res2['saved'] is True
    assert res2['added'] == added
    assert res2['skipped'] == 0
    assert res2['reconciled'] is True

    db.expire_all()
    assert live_invoice_count() == before_inv
    assert live_payment_count() == before_pay


# ---------------------------------------------------------------- legacy path

def test_legacy_log_requires_force_then_deletes_approximately(db, env, client):
    """An ImportLog created before this feature existed — rows carry no
    import_log_id — must 409 without force and delete an approximate window with it."""
    env.import_service.import_suppliers(db, SUPPLIERS_XLSX)
    supplier = db.query(env.models.Supplier).first()
    assert supplier is not None

    now = dt.datetime.now(dt.timezone.utc)
    inv = env.models.Invoice(supplier_id=supplier.id, number='LEGACY-1',
                             date=dt.date.today(), amount=1000.0, source='statement')
    db.add(inv)
    db.flush()

    log = env.models.ImportLog(source='pdf_statement', path='/legacy/old-statement.pdf',
                               account=supplier.account, imported=1, skipped=0,
                               reconciled=1, issues='[]')
    db.add(log)
    db.commit()

    r = client.get('/import/history')
    row = next(x for x in r.json()['rows'] if x['id'] == log.id)
    assert row['legacy'] is True
    assert row['linkedRows'] == 0
    assert row['canDelete'] is True

    dr = client.delete(f'/import/history/{log.id}')
    assert dr.status_code == 409

    dr2 = client.delete(f'/import/history/{log.id}?force=true')
    assert dr2.status_code == 200
    body = dr2.json()
    assert body['approximate'] is True
    assert body['deleted']['invoices'] == 1

    db.expire_all()
    assert db.query(env.models.Invoice).filter_by(id=inv.id).one().deleted_at is not None


# ---------------------------------------------------------------- undeletable sources

def test_suppliers_excel_cannot_be_deleted(db, env, client):
    env.import_service.import_suppliers(db, SUPPLIERS_XLSX)
    r = client.get('/import/history')
    row = next(x for x in r.json()['rows'] if x['source'] == 'suppliers_excel')
    assert row['canDelete'] is False

    dr = client.delete(f"/import/history/{row['id']}")
    assert dr.status_code == 400
