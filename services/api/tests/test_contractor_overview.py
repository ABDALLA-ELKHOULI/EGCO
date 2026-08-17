# -*- coding: utf-8 -*-
"""اختبارات لوحة نظرة المقاولين (/contractors/overview) — التوزيع على المشاريع،
أكبر عشرة، الضمانات المستقلة (216)، واختلافات الرصيد من أحدث تقرير مديونيات مجمّع.

يبني بياناته عبر مسارات الـ API نفسها (POST مقاول ثم حركات/ضمانات) + إدراج مباشر
لـ ImportLog/GuaranteeAccount عبر الجلسة، بلا اعتماد على ملفات design/samples،
فيعمل بلا شرط تخطٍ — نفس نمط test_contractors_filters.py.
"""
import importlib
import json

import pytest


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
    import app.api.routes.contractors as contractors_route
    importlib.reload(contractors_route)

    session_mod.init_db()

    class Env:
        pass

    e = Env()
    e.session = session_mod
    e.models = models_mod
    e.contractors_service = contractors_service_mod
    e.contractors_route = contractors_route
    return e


@pytest.fixture()
def client(env):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(env.contractors_route.router, prefix='/contractors')
    with TestClient(app) as c:
        yield c


def _seed(client):
    client.post('/contractors', json=dict(code='2120001', name='مقاول واحد'))
    client.post('/contractors', json=dict(code='2120002', name='مقاول اثنان'))

    # مقاول واحد: مستحق له (سالب) -8000 على مشروع الرسين
    client.post('/contractors/2120001/entries', json=dict(
        date='2025-02-01', debit=0, credit=8000,
        description='مستخلص', project='الرسين'))

    # مقاول اثنان: مستحق له -3000 على مشروع سدايم، ومستحق لنا +1000 على المدينة
    client.post('/contractors/2120002/entries', json=dict(
        date='2025-02-01', debit=0, credit=3000,
        description='مستخلص', project='سدايم'))
    client.post('/contractors/2120002/entries', json=dict(
        date='2025-02-05', debit=2000, credit=1000,
        description='دفعة', project='المدينة'))


def test_empty_overview_before_any_data(client):
    r = client.get('/contractors/overview')
    assert r.status_code == 200
    d = r.json()
    assert d['totals']['contractorCount'] == 0
    assert d['byProject'] == []
    assert d['topOwed'] == []
    assert d['guaranteeAccounts216'] == dict(total=0, count=0)
    assert d['balanceMismatches'] == []
    assert d['hasDebtsReportImport'] is False


def test_totals_and_top_owed(client):
    _seed(client)
    r = client.get('/contractors/overview').json()
    assert r['totals']['contractorCount'] == 2
    assert r['totals']['owedToContractors'] == 11000  # 8000 + 3000, لا 1000 من المدينة (موجب)
    codes = [row['code'] for row in r['topOwed']]
    assert codes == ['2120001', '2120002']  # الأكبر سالبية أولاً


def test_by_project_only_sums_negative_project_balances(client):
    _seed(client)
    r = client.get('/contractors/overview').json()
    by_project = {row['project']: row for row in r['byProject']}
    assert by_project['الرسين']['owed'] == 8000
    assert by_project['سدايم']['owed'] == 3000
    # المدينة برصيد موجب (مستحق لنا) — لا تظهر كدين على المشروع
    assert 'المدينة' not in by_project


def test_guarantee_accounts_216_total_independent_of_contractor_guarantees(env, client):
    _seed(client)
    db = env.session.SessionLocal()
    try:
        db.add(env.models.GuaranteeAccount(account='2160099', name='ضمان قنبر', balance=5000))
        db.commit()
    finally:
        db.close()

    r = client.get('/contractors/overview').json()
    assert r['guaranteeAccounts216'] == dict(total=5000, count=1)


def test_balance_mismatch_parsed_from_latest_debts_report_log(env, client):
    _seed(client)
    db = env.session.SessionLocal()
    try:
        issues = [
            dict(severity='warning', kind='balance_mismatch', account='2120001',
                 name='مقاول واحد',
                 message='مقاول واحد (2120001): رصيد الملف -160049.95 يختلف عن '
                         'الرصيد المحسوب من الحركات -80049.95 — يستحق المراجعة'),
            # حساب مورد (211) بنفس kind — يجب ألا يظهر في تقرير مقاولين هذه الشاشة
            dict(severity='warning', kind='balance_mismatch', account='2110005',
                 name='مورد ما',
                 message='مورد ما (2110005): رصيد الملف -100.00 يختلف عن '
                         'الرصيد المحسوب من الحركات -50.00 — يستحق المراجعة'),
        ]
        db.add(env.models.ImportLog(source='debts_report_xls', path='x.xls',
                                    imported=2, skipped=0, reconciled=1,
                                    issues=json.dumps(issues, ensure_ascii=False)))
        db.commit()
    finally:
        db.close()

    r = client.get('/contractors/overview').json()
    assert r['hasDebtsReportImport'] is True
    assert len(r['balanceMismatches']) == 1
    m = r['balanceMismatches'][0]
    assert m['account'] == '2120001'
    assert m['fileBalance'] == -160049.95
    assert m['derivedBalance'] == -80049.95
