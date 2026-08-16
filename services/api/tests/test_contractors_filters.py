# -*- coding: utf-8 -*-
"""اختبارات فلاتر وترتيب قائمة المقاولين — نظير test_contractors_filters عند الموردين.

لا يوجد اختبار «تأخر» هنا: حركات دفتر المقاول قيود مدين/دائن بلا تاريخ استحقاق، فلا
شريحة تأخر تُحسب أصلاً (انظر app/domain/contractors.py وتعليق CS_VALID_SORT في
app/api/routes/contractors.py). الاختبارات تغطي فقط ما تدعمه البيانات فعلاً: البحث،
المشروع، الاتجاه، الضمانات، والترتيب على المجموعة المصفّاة كاملة.

يبني بياناته عبر مسارات الـ API نفسها (POST مقاول ثم حركات/ضمانات) بلا اعتماد على
ملفات design/samples، فيعمل بلا شرط تخطٍ.
"""
import importlib

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
    """ثلاثة مقاولين بأرصدة واتجاهات مختلفة، ومشاريع مختلفة، وضمان لأحدهم فقط.

    balance = Σdebit − Σcredit (نفس اصطلاح app/domain/contractors.py).
    """
    client.post('/contractors', json=dict(code='C1', name='مقاول الأول'))
    client.post('/contractors', json=dict(code='C2', name='مقاول الثاني'))
    client.post('/contractors', json=dict(code='C3', name='مقاول الثالث'))

    # C1: مستحق لنا (رصيد موجب +3000) — دفعة أكبر من مستخلصه
    client.post('/contractors/C1/entries', json=dict(
        date='2025-01-01', debit=5000, credit=0,
        description='دفعه تحت الحساب', project='روشن'))
    client.post('/contractors/C1/entries', json=dict(
        date='2025-01-10', debit=0, credit=2000,
        description='مستخلص رقم1', project='روشن'))

    # C2: مستحق له (رصيد سالب -8000) — مستخلص أكبر من الدفعة
    client.post('/contractors/C2/entries', json=dict(
        date='2025-02-01', debit=0, credit=9000,
        description='مستخلص رقم2', project='القصر ستون'))
    client.post('/contractors/C2/entries', json=dict(
        date='2025-02-15', debit=1000, credit=0,
        description='دفعة مقدمة', project='القصر ستون'))

    # C3: متوازن تماماً، بلا حركات (رصيد 0) وله ضمان محتجز — لا مشروع له في
    # r['projects'] لأن ذاك الحقل مبني من الحركات فقط (entries)، لا الضمانات.
    client.post('/contractors/C3/guarantees', json=dict(project='روشن', amount=1500))


def test_search_by_name_or_code(client):
    _seed(client)
    r = client.get('/contractors?q=الثاني').json()
    assert r['count'] == 1
    assert r['rows'][0]['code'] == 'C2'

    r2 = client.get('/contractors?q=C3').json()
    assert r2['count'] == 1
    assert r2['rows'][0]['name'] == 'مقاول الثالث'


def test_filter_by_project(client):
    _seed(client)
    r = client.get('/contractors?project=روشن').json()
    codes = {row['code'] for row in r['rows']}
    # C1 عمل على روشن عبر حركاته؛ C3 له ضمان على روشن لكن project مبني من
    # الحركات فقط، فلا يظهر هنا رغم الضمان.
    assert codes == {'C1'}


def test_filter_by_direction(client):
    _seed(client)
    owed_to_them = client.get('/contractors?direction=owed_to_them').json()
    assert [row['code'] for row in owed_to_them['rows']] == ['C2']

    owed_to_us = client.get('/contractors?direction=owed_to_us').json()
    assert [row['code'] for row in owed_to_us['rows']] == ['C1']

    balanced = client.get('/contractors?direction=balanced').json()
    assert [row['code'] for row in balanced['rows']] == ['C3']


def test_filter_invalid_direction_rejected(client):
    _seed(client)
    r = client.get('/contractors?direction=nope')
    assert r.status_code == 422


def test_filter_has_guarantees(client):
    _seed(client)
    r = client.get('/contractors?has_guarantees=true').json()
    assert [row['code'] for row in r['rows']] == ['C3']

    r2 = client.get('/contractors?has_guarantees=false').json()
    codes = {row['code'] for row in r2['rows']}
    assert codes == {'C1', 'C2'}


def test_sort_by_balance_asc_desc(client):
    _seed(client)
    asc = client.get('/contractors?sort=balance&dir=asc').json()
    # الأشد سالبية (C2: -8000) أولاً، ثم المتوازن (C3: 0)، ثم الموجب (C1: 3000)
    assert [row['code'] for row in asc['rows']] == ['C2', 'C3', 'C1']

    desc = client.get('/contractors?sort=balance&dir=desc').json()
    assert [row['code'] for row in desc['rows']] == ['C1', 'C3', 'C2']


def test_sort_by_name(client):
    _seed(client)
    r = client.get('/contractors?sort=name&dir=asc').json()
    names = [row['name'] for row in r['rows']]
    assert names == sorted(names)


def test_sort_invalid_column_rejected(client):
    _seed(client)
    r = client.get('/contractors?sort=delay')
    assert r.status_code == 422


def test_default_sort_is_most_negative_balance_first(client):
    _seed(client)
    r = client.get('/contractors').json()
    assert [row['code'] for row in r['rows']] == ['C2', 'C3', 'C1']


def test_totals_describe_the_filtered_set_not_the_full_one(client):
    _seed(client)
    r = client.get('/contractors?direction=owed_to_them').json()
    # فلترة على مقاول واحد فقط (C2) — الإجماليات يجب أن تصف هذا المقاول وحده
    assert r['totals']['count'] == 1
    assert r['totals']['owedToUs'] == 0.0
    assert r['totals']['owedToContractors'] == 8000.0
