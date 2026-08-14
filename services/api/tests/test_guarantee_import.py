# -*- coding: utf-8 -*-
"""اختبارات مسار حفظ كشوفات الضمان (216) عبر commit_statement/batch_import،
وواجهة تصنيف الحسابات (اسأل، لا تخمّن)."""
import importlib
import os

import pytest

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
GUARANTEE_ALQUDS = os.path.join(SAMPLES, 'guarantee-alquds.pdf')

pytestmark = pytest.mark.skipif(
    not os.path.exists(GUARANTEE_ALQUDS),
    reason='design/samples/guarantee-alquds.pdf not present in this checkout')


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.guarantees_service as guarantees_service_mod
    importlib.reload(guarantees_service_mod)
    import app.services.contractors_service as contractors_service_mod
    importlib.reload(contractors_service_mod)
    import app.services.ai_features_service as ai_features_service_mod
    importlib.reload(ai_features_service_mod)
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


def test_alquds_imports_as_guarantee_and_reconciles(db, env):
    res = env.import_service.commit_statement(db, GUARANTEE_ALQUDS, source='pdf_statement')
    assert res['saved'] is True
    assert res['reconciled'] is True
    assert res['account'] == '21620'
    assert res['computedBalance'] == pytest.approx(8033.19)
    assert res['statementBalance'] == pytest.approx(8033.19)
    ga = db.query(env.models.GuaranteeAccount).filter_by(account='21620').one()
    assert ga.balance == pytest.approx(8033.19)


def test_alquds_reimport_is_idempotent_and_flagged_duplicate(db, env, client):
    first = env.import_service.commit_statement(db, GUARANTEE_ALQUDS, source='pdf_statement')
    assert first['added'] > 0
    batch = env.import_service.batch_import(db, [GUARANTEE_ALQUDS])
    row = batch['results'][0]
    assert row['status'] == 'duplicate'


def test_alquds_appears_in_history_and_delete_removes_entries(db, env, client):
    res = env.import_service.commit_statement(db, GUARANTEE_ALQUDS, source='pdf_statement')
    log_id = db.query(env.models.ImportLog).filter_by(
        account='21620', source='pdf_statement').order_by(
        env.models.ImportLog.created_at.desc()).first().id

    r = client.get('/import/history')
    row = next(x for x in r.json()['rows'] if x['id'] == log_id)
    assert row['detected'] == env.import_service.DETECTED_LABELS['pdf_statement']
    assert row['linkedRows'] == res['added']

    d = client.delete(f'/import/history/{log_id}')
    assert d.status_code == 200
    live = db.query(env.models.GuaranteeEntry).filter_by(
        import_log_id=log_id, deleted_at=None).count()
    assert live == 0


# ---------------------------------------------------------------- classification API

def test_needs_classification_for_unknown_prefix(db, env):
    res = env.import_service.commit_statement(db, GUARANTEE_ALQUDS, source='pdf_statement')
    assert res['account'] == '21620'  # sanity: sample really is a 216 account

    # An unknown-prefix account is never guessed at — simulate via dispatch_kind directly.
    assert env.import_service.dispatch_kind(db, '2990001') is None


def test_classification_crud_roundtrip(client, db, env):
    r = client.get('/import/classify')
    assert r.status_code == 200
    assert r.json()['rows'] == []

    put = client.put('/import/classify', json=dict(account='2990001', kind='supplier',
                                                    name='مورد تجريبي'))
    assert put.status_code == 200
    assert put.json()['kind'] == 'supplier'

    r = client.get('/import/classify')
    rows = r.json()['rows']
    assert len(rows) == 1
    assert rows[0]['account'] == '2990001'

    assert env.import_service.dispatch_kind(db, '2990001') == 'supplier'

    delc = client.delete('/import/classify/2990001')
    assert delc.status_code == 200
    r = client.get('/import/classify')
    assert r.json()['rows'] == []

    missing = client.delete('/import/classify/2990001')
    assert missing.status_code == 404
