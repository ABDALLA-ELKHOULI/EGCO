# -*- coding: utf-8 -*-
"""اختبارات صفحة «ضمانات المقاولين»: شكل الاستجابة، حساب الإجماليات (Decimal دقيق)،
المطابقة/الفرق، 404، واستيراد حي لعينة القدس عند توفرها."""
import datetime as dt
import importlib
import os

import pytest

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
GUARANTEE_ALQUDS = os.path.join(SAMPLES, 'guarantee-alquds.pdf')


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.contractors_service as contractors_service_mod
    importlib.reload(contractors_service_mod)
    import app.services.guarantees_service as guarantees_service_mod
    importlib.reload(guarantees_service_mod)
    import app.services.ai_features_service as ai_features_service_mod
    importlib.reload(ai_features_service_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)
    import app.api.routes.guarantees as guarantees_route
    importlib.reload(guarantees_route)
    import app.api.routes.imports as imports_route
    importlib.reload(imports_route)

    session_mod.init_db()

    class Env:
        pass

    e = Env()
    e.session = session_mod
    e.models = models_mod
    e.guarantees_service = guarantees_service_mod
    e.import_service = import_service_mod
    e.guarantees_route = guarantees_route
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
    app.include_router(env.guarantees_route.router, prefix='/guarantees')
    app.include_router(env.imports_route.router, prefix='/import')
    with TestClient(app) as c:
        yield c


def _make_contractor(db, models, code='21299001', name='مقاول تجريبي'):
    c = models.Contractor(code=code, name=name)
    db.add(c)
    db.flush()
    return c


def test_empty_page_shape(client):
    r = client.get('/guarantees')
    assert r.status_code == 200
    body = r.json()
    assert body['accounts'] == []
    assert body['contractorGuarantees'] == []
    assert body['totals'] == dict(statementsHeld=0.0, trackedHeld=0.0,
                                  dueSoonCount=0, overdueCount=0)


def test_totals_and_reconciliation_match(db, env, client):
    models = env.models
    c = _make_contractor(db, models)
    ga = models.GuaranteeAccount(account='21610', name=c.name,
                                 linked_contractor_code=c.code, balance=1000.00)
    db.add(ga)
    g = models.ContractorGuarantee(contractor_id=c.id, project='مشروع أ', amount=1000.00)
    db.add(g)
    db.commit()

    r = client.get('/guarantees')
    body = r.json()
    assert body['totals']['statementsHeld'] == pytest.approx(1000.00)
    assert body['totals']['trackedHeld'] == pytest.approx(1000.00)
    row = next(a for a in body['accounts'] if a['account'] == '21610')
    assert row['matches'] is True
    assert row['difference'] == pytest.approx(0.0)
    assert row['linkedContractorCode'] == c.code
    assert row['linkedContractorName'] == c.name


def test_reconciliation_flags_mismatch(db, env, client):
    models = env.models
    c = _make_contractor(db, models, code='21299002')
    ga = models.GuaranteeAccount(account='21611', name=c.name,
                                 linked_contractor_code=c.code, balance=1000.00)
    db.add(ga)
    g = models.ContractorGuarantee(contractor_id=c.id, project='مشروع ب', amount=850.00)
    db.add(g)
    db.commit()

    r = client.get('/guarantees')
    row = next(a for a in r.json()['accounts'] if a['account'] == '21611')
    assert row['matches'] is False
    assert row['difference'] == pytest.approx(150.00)


def test_due_soon_and_overdue_counts(db, env, client):
    models = env.models
    c = _make_contractor(db, models, code='21299003')
    today = dt.date.today()
    overdue_g = models.ContractorGuarantee(
        contractor_id=c.id, project='متأخر', amount=100.0, release_due=today - dt.timedelta(days=5))
    upcoming_g = models.ContractorGuarantee(
        contractor_id=c.id, project='قريب', amount=200.0, release_due=today + dt.timedelta(days=10))
    db.add_all([overdue_g, upcoming_g])
    db.commit()

    r = client.get('/guarantees')
    totals = r.json()['totals']
    assert totals['overdueCount'] == 1
    assert totals['dueSoonCount'] == 1


def test_account_detail_and_404(db, env, client):
    models = env.models
    c = _make_contractor(db, models, code='21299004')
    ga = models.GuaranteeAccount(account='21612', name=c.name,
                                 linked_contractor_code=c.code, balance=500.0)
    db.add(ga)
    db.flush()
    e1 = models.GuaranteeEntry(guarantee_account_id=ga.id, date=dt.date(2024, 1, 1),
                               debit=0, credit=500.0, doc='1', description='تأمين مستخلص')
    db.add(e1)
    g = models.ContractorGuarantee(contractor_id=c.id, project='مشروع ج', amount=500.0)
    db.add(g)
    db.commit()

    r = client.get('/guarantees/21612')
    assert r.status_code == 200
    body = r.json()
    assert body['account']['account'] == '21612'
    assert len(body['entries']) == 1
    assert body['entries'][0]['credit'] == pytest.approx(500.0)
    assert len(body['linkedGuarantees']) == 1

    missing = client.get('/guarantees/99999')
    assert missing.status_code == 404
    assert 'لا يوجد' in missing.json()['detail']


@pytest.mark.skipif(not os.path.exists(GUARANTEE_ALQUDS),
                    reason='design/samples/guarantee-alquds.pdf not present in this checkout')
def test_alquds_sample_appears_in_page_after_import(db, env, client):
    res = env.import_service.commit_statement(db, GUARANTEE_ALQUDS, source='pdf_statement')
    assert res['saved'] is True

    r = client.get('/guarantees')
    body = r.json()
    row = next(a for a in body['accounts'] if a['account'] == '21620')
    assert row['balance'] == pytest.approx(8033.19)
    assert row['entryCount'] > 0

    detail = client.get('/guarantees/21620')
    assert detail.status_code == 200
    assert len(detail.json()['entries']) == row['entryCount']
