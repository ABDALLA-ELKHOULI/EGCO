# -*- coding: utf-8 -*-
"""اختبارات التحصيلات اليدوية (الإيراد) — CRUD، تناسق الحالة، وتغذية التدفق النقدي."""


def test_revenue_crud_roundtrip(api_client):
    r = api_client.post('/api/v1/revenues', json={
        'project': 'الرسين', 'unit': 'A101', 'client': 'عميل واحد', 'amount': 1000,
        'dueDate': '2026-09-01'})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body['status'] == 'open'
    assert body['source'] == 'manual'
    assert body['dueDate'] == '2026-09-01'
    assert body['collectedOn'] is None
    rid = body['id']

    r = api_client.get('/api/v1/revenues')
    assert r.status_code == 200
    d = r.json()
    assert d['count'] == 1
    assert d['rows'][0]['client'] == 'عميل واحد'
    assert d['totals']['open'] == 1000
    assert d['totals']['collected'] == 0
    assert d['totals']['all'] == 1000
    assert 'الرسين' in d['projects']

    r = api_client.put(f'/api/v1/revenues/{rid}', json={'amount': 1200, 'notes': 'ملاحظة'})
    assert r.status_code == 200
    assert r.json()['amount'] == 1200
    assert r.json()['notes'] == 'ملاحظة'

    r = api_client.delete(f'/api/v1/revenues/{rid}')
    assert r.status_code == 200 and r.json() == {'deleted': True}

    r = api_client.get('/api/v1/revenues')
    assert r.json()['count'] == 0


def test_amount_must_be_positive(api_client):
    r = api_client.post('/api/v1/revenues', json={'client': 'عميل', 'amount': 0})
    assert r.status_code == 422


def test_collected_status_requires_collected_on(api_client):
    r = api_client.post('/api/v1/revenues', json={
        'client': 'عميل', 'amount': 500, 'status': 'collected'})
    assert r.status_code == 422
    assert 'تاريخ التحصيل' in r.json()['detail']


def test_setting_collected_on_auto_marks_collected(api_client):
    r = api_client.post('/api/v1/revenues', json={
        'client': 'عميل', 'amount': 500, 'collectedOn': '2026-08-10'})
    assert r.status_code == 201
    assert r.json()['status'] == 'collected'
    assert r.json()['collectedOn'] == '2026-08-10'


def test_update_unknown_id_404(api_client):
    r = api_client.put('/api/v1/revenues/does-not-exist', json={'amount': 10})
    assert r.status_code == 404


def test_update_to_collected_without_date_rejected(api_client):
    r = api_client.post('/api/v1/revenues', json={
        'client': 'عميل', 'amount': 300, 'dueDate': '2026-09-01'})
    rid = r.json()['id']
    r = api_client.put(f'/api/v1/revenues/{rid}', json={'status': 'collected'})
    assert r.status_code == 422


def test_mark_collected_via_put_clears_from_open(api_client):
    r = api_client.post('/api/v1/revenues', json={
        'client': 'عميل', 'amount': 300, 'dueDate': '2026-09-01'})
    rid = r.json()['id']
    r = api_client.put(f'/api/v1/revenues/{rid}', json={
        'status': 'collected', 'collectedOn': '2026-08-14'})
    assert r.status_code == 200
    assert r.json()['status'] == 'collected'

    d = api_client.get('/api/v1/revenues', params={'status': 'open'}).json()
    assert d['count'] == 0
    d = api_client.get('/api/v1/revenues', params={'status': 'collected'}).json()
    assert d['count'] == 1


def test_soft_deleted_excluded_from_list_and_search(api_client):
    r = api_client.post('/api/v1/revenues', json={'client': 'محذوف', 'amount': 100})
    rid = r.json()['id']
    api_client.delete(f'/api/v1/revenues/{rid}')
    d = api_client.get('/api/v1/revenues', params={'q': 'محذوف'}).json()
    assert d['count'] == 0


def test_search_matches_client_and_unit(api_client):
    api_client.post('/api/v1/revenues', json={'client': 'شركة الأمل', 'unit': 'B12', 'amount': 100})
    api_client.post('/api/v1/revenues', json={'client': 'آخر', 'unit': 'C99', 'amount': 200})
    d = api_client.get('/api/v1/revenues', params={'q': 'الأمل'}).json()
    assert d['count'] == 1
    d = api_client.get('/api/v1/revenues', params={'q': 'C99'}).json()
    assert d['count'] == 1


def test_manual_dated_open_revenue_feeds_cashflow_inflow_and_clears_warning(api_client):
    # before any data: the honesty warning about missing receivables should show
    d = api_client.get('/api/v1/cashflow', params={'weeks': 8, 'from': '2026-08-01'}).json()
    assert any('التحصيلات' in w for w in d['warnings'])

    r = api_client.post('/api/v1/revenues', json={
        'project': 'الرسين', 'client': 'عميل التدفق', 'amount': 5000,
        'dueDate': '2026-08-10'})
    assert r.status_code == 201
    rid = r.json()['id']

    d = api_client.get('/api/v1/cashflow', params={'weeks': 8, 'from': '2026-08-01'}).json()
    assert d['summary']['hasReceivables'] is True
    assert d['summary']['totalInflow'] == 5000
    assert d['summary']['receivablesStats']['dated'] == 1
    assert not any('بلا تواريخ استحقاق' in w for w in d['warnings'])
    buckets_with_inflow = [p for p in d['periods'] if p['inflow'] > 0]
    assert len(buckets_with_inflow) == 1

    # SEMANTICS CHANGE (synergy audit): marking a revenue collected removes it from the
    # forecast entirely. It used to be re-dated by `collected_on` and kept as inflow,
    # which made money that had ALREADY arrived show up as future income — the cashflow
    # screen then disagreed with التحصيلات, where the same row sits under «المحصّل».
    # A forecast may only contain money that has not arrived yet.
    r = api_client.put(f'/api/v1/revenues/{rid}', json={
        'status': 'collected', 'collectedOn': '2026-08-05'})
    assert r.status_code == 200
    d = api_client.get('/api/v1/cashflow', params={'weeks': 8, 'from': '2026-08-01'}).json()
    assert d['summary']['totalInflow'] == 0.0
    assert d['summary']['receivablesStats'] == dict(total=0, dated=0, undated=0, collected=1)
    # and the warning must say why — not "no data uploaded", which would be false
    assert any('محصَّلة بالفعل' in w for w in d['warnings'])
    # the inflow reconciliation ties to /revenues totals.open, which is now zero
    assert d['reconciliation']['inflow']['openTotal'] == 0.0
    assert d['reconciliation']['inflow']['difference'] == 0.0
    assert api_client.get('/api/v1/revenues').json()['totals']['open'] == 0.0
