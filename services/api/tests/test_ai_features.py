# -*- coding: utf-8 -*-
"""اختبارات ميزات المساعد الذكي (v0.5) — بلا أي اتصال شبكة حقيقي إطلاقاً.

كل الاختبارات تستبدل ai_service.chat مباشرة (لا httpx) لأن هذه تدفقات أعلى
مستوى تستدعي chat مرتين أحياناً بترتيب محدد.
"""
import datetime as dt
import json

import pytest

from app.services import ai_features_service as F
from app.services import ai_service


def _enable(api_client):
    api_client.put('/api/v1/ai/settings', json={
        'enabled': True, 'baseUrl': 'http://h/v1', 'model': 'm'})


def _supplier(api_client, account='9001', name='مورد تجريبي', term='30 يوم'):
    r = api_client.post('/api/v1/suppliers', json={
        'account': account, 'name': name, 'project': 'م1', 'term': term})
    assert r.status_code == 201, r.text
    return account


def _contractor(api_client, code='c1', name='مقاول تجريبي'):
    r = api_client.post('/api/v1/contractors', json={'code': code, 'name': name})
    assert r.status_code == 201, r.text
    return code


def _invoice(api_client, account, amount, date, doc=None, description=''):
    r = api_client.post('/api/v1/manual/invoices', json={
        'account': account, 'amount': amount, 'date': date,
        'reference': doc or '', 'description': description})
    assert r.status_code == 201, r.text
    return r.json()


def _payment(api_client, account, amount, date, doc=None):
    r = api_client.post('/api/v1/manual/payments', json={
        'account': account, 'amount': amount, 'date': date, 'reference': doc or ''})
    assert r.status_code == 201, r.text
    return r.json()


def _entry(api_client, code, date, debit=0, credit=0, description='', kind=None):
    r = api_client.post(f'/api/v1/contractors/{code}/entries', json={
        'date': date, 'debit': debit, 'credit': credit, 'description': description,
        'kind': kind})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- disabled gate

ENDPOINTS = [
    ('/api/v1/ai/ask', {'question': 'كم عدد الموردين؟'}),
    ('/api/v1/ai/remind', {'partyKind': 'supplier', 'key': 'x'}),
    ('/api/v1/ai/budget-notes', {'project': 'x'}),
    ('/api/v1/ai/summary', {}),
    ('/api/v1/ai/brief', {}),
    ('/api/v1/ai/anomalies', {}),
    ('/api/v1/ai/parse-text', {'text': 'hello'}),
    ('/api/v1/ai/what-if', {'partyKind': 'supplier', 'key': 'x', 'shiftDays': 7}),
    ('/api/v1/ai/priorities', {}),
]


@pytest.mark.parametrize('path,body', ENDPOINTS)
def test_all_endpoints_409_when_disabled(api_client, path, body):
    r = api_client.post(path, json=body)
    assert r.status_code == 409
    assert 'غير مفعّل' in r.json()['detail']


# ---------------------------------------------------------------- SQL guard

def test_guard_rejects_update():
    with pytest.raises(ValueError):
        F.guard_select_sql('UPDATE suppliers SET name = "x"')


def test_guard_rejects_multi_statement():
    with pytest.raises(ValueError):
        F.guard_select_sql('SELECT * FROM suppliers; DROP TABLE suppliers')


def test_guard_adds_limit_when_missing():
    sql = F.guard_select_sql('SELECT * FROM suppliers')
    assert 'LIMIT 200' in sql


def test_guard_keeps_existing_limit():
    sql = F.guard_select_sql('SELECT * FROM suppliers LIMIT 5')
    assert sql.count('LIMIT') == 1


def test_ask_refuses_before_execution_when_model_returns_update(api_client, monkeypatch):
    _enable(api_client)
    calls = []

    def fake_chat(messages, json_mode=True):
        calls.append(1)
        return json.dumps({'sql': 'UPDATE suppliers SET name = "x"'})

    monkeypatch.setattr(ai_service, 'chat', fake_chat)
    r = api_client.post('/api/v1/ai/ask', json={'question': 'غيّر اسم المورد'})
    assert r.status_code == 200
    body = r.json()
    assert body['sql'] is None
    assert body['rows'] == []
    assert len(calls) == 1          # never reached the second (answer) call


# ---------------------------------------------------------------- /ask happy path

def test_ask_happy_path(api_client, monkeypatch):
    _enable(api_client)
    _supplier(api_client, account='9001', name='مورد تجريبي')

    replies = [
        json.dumps({'sql': 'SELECT account, name FROM suppliers'}),
        'يوجد مورد واحد اسمه مورد تجريبي',
    ]

    def fake_chat(messages, json_mode=True):
        return replies.pop(0)

    monkeypatch.setattr(ai_service, 'chat', fake_chat)
    r = api_client.post('/api/v1/ai/ask', json={'question': 'ما هي أسماء الموردين؟'})
    assert r.status_code == 200
    body = r.json()
    assert body['answer'] == 'يوجد مورد واحد اسمه مورد تجريبي'
    assert body['sql'].startswith('SELECT account, name FROM suppliers')
    assert any(row['account'] == '9001' for row in body['rows'])


# ---------------------------------------------------------------- /remind

def test_remind_404_unknown_party(api_client, monkeypatch):
    _enable(api_client)
    monkeypatch.setattr(ai_service, 'chat', lambda *a, **k: 'رسالة')
    r = api_client.post('/api/v1/ai/remind', json={'partyKind': 'supplier', 'key': 'nope'})
    assert r.status_code == 404


def test_remind_happy_path(api_client, monkeypatch):
    _enable(api_client)
    acc = _supplier(api_client, account='9002')
    _invoice(api_client, acc, 1000, '2026-01-01')

    seen = {}

    def fake_chat(messages, json_mode=True):
        seen['messages'] = messages
        return '  رسالة متابعة مهذبة  '

    monkeypatch.setattr(ai_service, 'chat', fake_chat)
    r = api_client.post('/api/v1/ai/remind', json={'partyKind': 'supplier', 'key': acc})
    assert r.status_code == 200
    assert r.json()['message'] == 'رسالة متابعة مهذبة'
    # the computed amount must appear as text in the prompt sent to the model
    assert '1,000.00' in seen['messages'][1]['content']


# ---------------------------------------------------------------- /anomalies

def test_anomalies_detects_duplicate_payment_and_future_entry(api_client, monkeypatch):
    _enable(api_client)
    acc = _supplier(api_client, account='9003')
    _payment(api_client, acc, 500, '2026-01-01', doc='P1')
    _payment(api_client, acc, 500, '2026-01-02', doc='P2')   # near-duplicate

    code = _contractor(api_client, code='c9')
    future_date = (dt.date.today() + dt.timedelta(days=30)).isoformat()
    _entry(api_client, code, future_date, debit=1000, description='دفعة مقدمة')

    def fake_chat(messages, json_mode=True):
        items = json.loads(messages[1]['content'])
        return json.dumps({'items': [
            {'title': 't{}'.format(i), 'detail': 'd{}'.format(i)} for i in range(len(items))]})

    monkeypatch.setattr(ai_service, 'chat', fake_chat)
    r = api_client.post('/api/v1/ai/anomalies', json={})
    assert r.status_code == 200
    assert len(r.json()['items']) >= 2


def test_anomalies_empty_skips_model_call(api_client, monkeypatch):
    _enable(api_client)
    calls = []
    monkeypatch.setattr(ai_service, 'chat', lambda *a, **k: calls.append(1) or '{}')
    r = api_client.post('/api/v1/ai/anomalies', json={})
    assert r.status_code == 200
    assert r.json() == {'items': []}
    assert calls == []


# ---------------------------------------------------------------- /what-if

def test_what_if_min_balance_shift(api_client, monkeypatch):
    _enable(api_client)
    today = dt.date.today()
    acc = _supplier(api_client, account='9004', term='0 يوم')  # due same day as invoice
    due_in_5 = (today + dt.timedelta(days=5)).isoformat()
    _invoice(api_client, acc, 2000, due_in_5)

    monkeypatch.setattr(ai_service, 'chat', lambda *a, **k: 'نص توضيحي')
    r = api_client.post('/api/v1/ai/what-if', json={
        'partyKind': 'supplier', 'key': acc, 'shiftDays': 10})
    assert r.status_code == 200
    body = r.json()
    # before: the 2000 outflow falls inside the first 14-day bucket -> min balance -2000
    assert body['before']['minBalance'] == '-2000.0'
    # after: shifted 10 days later (day 15) -> falls into bucket 2, first bucket balance 0
    assert body['after']['minBalance'] == '0.0'
    assert body['narrative'] == 'نص توضيحي'


# ---------------------------------------------------------------- /priorities

def test_priorities_deterministic_ordering(api_client, monkeypatch):
    _enable(api_client)
    today = dt.date.today()
    acc_a = _supplier(api_client, account='9005', term='0 يوم')
    acc_b = _supplier(api_client, account='9006', term='0 يوم')
    old_due = (today - dt.timedelta(days=100)).isoformat()
    recent_due = (today - dt.timedelta(days=5)).isoformat()
    _invoice(api_client, acc_a, 1000, old_due)     # very overdue, small amount
    _invoice(api_client, acc_b, 1000000, recent_due)  # less overdue, huge amount

    monkeypatch.setattr(ai_service, 'chat', lambda *a, **k: 'شرح')
    r = api_client.post('/api/v1/ai/priorities', json={})
    assert r.status_code == 200
    items = r.json()['items']
    # score_a = 1000*1 + 100*50 = 6000; score_b = 1e6*1 + 5*50 = 1000250 -> b first
    assert items[0]['key'] == acc_b


# ---------------------------------------------------------------- commit-extract

def _rows_ok():
    return [
        {'date': '2026-01-01', 'debit': 0, 'credit': 1000, 'description': 'مستخلص 1'},
        {'date': '2026-01-15', 'debit': 500, 'credit': 0, 'description': 'دفعة'},
    ]


def test_commit_extract_new_contractor_happy_path(api_client):
    # ai disabled by default here (no _enable call) — proves no AI-enabled gate server-side
    r = api_client.post('/api/v1/ai/commit-extract', json={
        'partyKind': 'contractor',
        'newContractor': {'code': 'ai-c1', 'name': 'مقاول جديد'},
        'rows': _rows_ok(),
        'sourceFile': '/tmp/statement.pdf',
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['saved'] is True
    assert body['added'] == 2
    assert body['contractor'] == {'code': 'ai-c1', 'name': 'مقاول جديد'}
    assert body['balance'] == -500  # 500 debit - 1000 credit

    detail = api_client.get('/api/v1/contractors/ai-c1').json()
    assert len(detail['entries']) == 2

    hist = api_client.get('/api/v1/import/history').json()['rows']
    row = next(x for x in hist if x['fileName'] == 'statement.pdf')
    assert row['source'] == 'ai_extract'
    assert row['linkedRows'] == 2
    assert row['canDelete'] is True

    del_res = api_client.delete(f"/api/v1/import/history/{row['id']}")
    assert del_res.status_code == 200
    assert del_res.json()['deleted']['entries'] == 2
    detail2 = api_client.get('/api/v1/contractors/ai-c1').json()
    assert len(detail2['entries']) == 0


def test_commit_extract_existing_contractor(api_client):
    code = _contractor(api_client, code='ai-c2')
    r = api_client.post('/api/v1/ai/commit-extract', json={
        'partyKind': 'contractor', 'code': code,
        'rows': _rows_ok(), 'sourceFile': '/tmp/s2.pdf',
    })
    assert r.status_code == 200, r.text
    assert r.json()['contractor']['code'] == code


def test_commit_extract_validation_bad_rows(api_client):
    rows = [
        {'date': 'not-a-date', 'debit': 100, 'credit': 0, 'description': 'x'},   # 1: bad date
        {'date': '2026-01-01', 'debit': 100, 'credit': 50, 'description': 'y'},  # 2: both
        {'date': '2026-01-01', 'debit': 0, 'credit': 0, 'description': 'z'},     # 3: neither
        {'date': '2026-01-01', 'debit': 100, 'credit': 0, 'description': 'ok'},  # 4: fine
    ]
    r = api_client.post('/api/v1/ai/commit-extract', json={
        'partyKind': 'contractor',
        'newContractor': {'code': 'ai-bad', 'name': 'x'},
        'rows': rows, 'sourceFile': '/tmp/bad.pdf',
    })
    assert r.status_code == 422
    detail = r.json()['detail']
    assert '1' in detail and '2' in detail and '3' in detail


def test_commit_extract_malformed_date_returns_422_arabic(api_client):
    """A non-ISO date (e.g. dd/mm/yyyy from a model or user paste) must 422, not 500,
    with an Arabic detail naming the offending row — see fromisoformat guard in
    ai.commit_extract."""
    rows = [
        {'date': '2026-01-01', 'debit': 100, 'credit': 0, 'description': 'ok'},   # 1: fine
        {'date': '14/08/2026', 'debit': 200, 'credit': 0, 'description': 'bad'},  # 2: bad date
    ]
    r = api_client.post('/api/v1/ai/commit-extract', json={
        'partyKind': 'contractor',
        'newContractor': {'code': 'ai-baddate', 'name': 'x'},
        'rows': rows, 'sourceFile': '/tmp/baddate.pdf',
    })
    assert r.status_code == 422, r.text
    detail = r.json()['detail']
    assert any('؀' <= ch <= 'ۿ' for ch in detail)  # Arabic text present
    assert '2' in detail  # names the offending row index


def test_commit_extract_409_existing_code(api_client):
    _contractor(api_client, code='ai-dup')
    r = api_client.post('/api/v1/ai/commit-extract', json={
        'partyKind': 'contractor',
        'newContractor': {'code': 'ai-dup', 'name': 'x'},
        'rows': _rows_ok(), 'sourceFile': '/tmp/dup.pdf',
    })
    assert r.status_code == 409


def test_commit_extract_404_missing_code(api_client):
    r = api_client.post('/api/v1/ai/commit-extract', json={
        'partyKind': 'contractor', 'code': 'no-such-code',
        'rows': _rows_ok(), 'sourceFile': '/tmp/missing.pdf',
    })
    assert r.status_code == 404


def test_commit_extract_rejects_supplier_party_kind(api_client):
    r = api_client.post('/api/v1/ai/commit-extract', json={
        'partyKind': 'supplier', 'code': '9001',
        'rows': _rows_ok(), 'sourceFile': '/tmp/x.pdf',
    })
    assert r.status_code == 422
