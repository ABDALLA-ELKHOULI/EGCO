# -*- coding: utf-8 -*-
"""اختبارات ترتيب /api/v1/revenues — نفس نمط _SORT_KEYS في routes/suppliers.py."""


def _seed(api_client):
    api_client.post('/api/v1/revenues', json={
        'project': 'أ', 'client': 'باء', 'amount': 500, 'dueDate': '2026-09-01'})
    api_client.post('/api/v1/revenues', json={
        'project': 'ب', 'client': 'ألف', 'amount': 1500, 'dueDate': '2026-08-01'})
    api_client.post('/api/v1/revenues', json={
        'project': 'ج', 'client': 'جيم', 'amount': 1000, 'dueDate': '2026-07-01'})


def test_sort_by_amount_asc(api_client):
    _seed(api_client)
    r = api_client.get('/api/v1/revenues', params={'sort': 'amount', 'dir': 'asc'})
    assert r.status_code == 200
    amounts = [row['amount'] for row in r.json()['rows']]
    assert amounts == [500, 1000, 1500]


def test_sort_by_amount_desc(api_client):
    _seed(api_client)
    r = api_client.get('/api/v1/revenues', params={'sort': 'amount', 'dir': 'desc'})
    assert r.status_code == 200
    amounts = [row['amount'] for row in r.json()['rows']]
    assert amounts == [1500, 1000, 500]


def test_sort_by_client_asc_uses_client_as_tiebreak(api_client):
    _seed(api_client)
    r = api_client.get('/api/v1/revenues', params={'sort': 'client', 'dir': 'asc'})
    assert r.status_code == 200
    clients = [row['client'] for row in r.json()['rows']]
    assert clients == sorted(clients)


def test_sort_by_due_date(api_client):
    _seed(api_client)
    r = api_client.get('/api/v1/revenues', params={'sort': 'dueDate', 'dir': 'asc'})
    assert r.status_code == 200
    dates = [row['dueDate'] for row in r.json()['rows']]
    assert dates == sorted(dates)


def test_invalid_sort_key_rejected(api_client):
    r = api_client.get('/api/v1/revenues', params={'sort': 'not_a_column'})
    assert r.status_code == 422


def test_invalid_dir_rejected(api_client):
    r = api_client.get('/api/v1/revenues', params={'sort': 'amount', 'dir': 'sideways'})
    assert r.status_code == 422


def test_no_sort_falls_back_to_due_date_default(api_client):
    _seed(api_client)
    r = api_client.get('/api/v1/revenues')
    assert r.status_code == 200
    dates = [row['dueDate'] for row in r.json()['rows']]
    # newest due first — الافتراضي الحالي بلا sort
    assert dates == sorted(dates, reverse=True)
