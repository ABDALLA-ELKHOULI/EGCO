# -*- coding: utf-8 -*-
"""مساعد الذكاء الاصطناعي — الإعدادات، الاختبار، والاستخراج (بدون شبكة إطلاقاً)."""
import json

import httpx
import pytest

from app.services import ai_service


class FakeResponse:
    def __init__(self, status_code=200, content='ok', payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {
            'choices': [{'message': {'content': content}}]}

    def json(self):
        return self._payload


# ---------------------------------------------------------------- settings

def test_settings_defaults(api_client):
    r = api_client.get('/api/v1/ai/settings')
    assert r.status_code == 200
    s = r.json()
    # cloud-first: nothing prefilled — the user pastes their own provider
    assert s == {'enabled': False, 'provider': '', 'baseUrl': '', 'apiKey': '',
                 'model': '', 'maxTokens': 2000}


def test_settings_partial_save_and_masking(api_client):
    r = api_client.put('/api/v1/ai/settings', json={'model': 'llama3.2:1b',
                                                    'apiKey': 'sk-secret'})
    assert r.status_code == 200
    s = r.json()
    assert s['model'] == 'llama3.2:1b'
    assert s['apiKey'] == '•••'          # never echoed
    assert s['provider'] == ''           # untouched keys keep defaults

    # enabling requires baseUrl + model — only the model is saved at this point
    r = api_client.put('/api/v1/ai/settings', json={'enabled': True})
    assert r.status_code == 422
    api_client.put('/api/v1/ai/settings', json={'baseUrl': 'https://api.x.ai/v1'})

    # sending the mask back keeps the stored key
    r = api_client.put('/api/v1/ai/settings', json={'apiKey': '•••', 'enabled': True})
    assert r.json()['apiKey'] == '•••'
    stored = ai_service.load_settings()
    assert stored['apiKey'] == 'sk-secret'
    assert stored['enabled'] is True

    # a real new value replaces it; empty string clears it
    api_client.put('/api/v1/ai/settings', json={'apiKey': 'sk-new'})
    assert ai_service.load_settings()['apiKey'] == 'sk-new'
    api_client.put('/api/v1/ai/settings', json={'apiKey': ''})
    assert ai_service.load_settings()['apiKey'] == ''
    assert api_client.get('/api/v1/ai/settings').json()['apiKey'] == ''


def test_settings_json_file_location(api_client):
    api_client.put('/api/v1/ai/settings', json={'model': 'x'})
    from app.core.config import settings
    p = settings.DATA_DIR / 'ai-settings.json'
    assert p.exists()
    assert json.loads(p.read_text(encoding='utf-8'))['model'] == 'x'


# ---------------------------------------------------------------- extract gating

def test_extract_disabled_409(api_client, tmp_path):
    f = tmp_path / 'stmt.csv'
    f.write_text('a,b,c', encoding='utf-8')
    r = api_client.post('/api/v1/ai/extract', json={'path': str(f)})
    assert r.status_code == 409
    assert 'غير مفعّل' in r.json()['detail']


def test_extract_missing_file_404(api_client):
    r = api_client.post('/api/v1/ai/extract', json={'path': '/nope/never.pdf'})
    assert r.status_code == 404


# ---------------------------------------------------------------- chat / test

def test_chat_sends_openai_shape(api_client, monkeypatch):
    api_client.put('/api/v1/ai/settings', json={'apiKey': 'k1', 'maxTokens': 512,
                                                'baseUrl': 'http://127.0.0.1:11434/v1',
                                                'model': 'qwen2.5:3b'})
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, body=json, headers=headers)
        return FakeResponse(content='مرحبا')

    monkeypatch.setattr(ai_service.httpx, 'post', fake_post)
    out = ai_service.chat([{'role': 'user', 'content': 'hi'}])
    assert out == 'مرحبا'
    assert seen['url'] == 'http://127.0.0.1:11434/v1/chat/completions'
    assert seen['headers']['Authorization'] == 'Bearer k1'
    assert seen['body']['temperature'] == 0
    assert seen['body']['max_tokens'] == 512
    assert seen['body']['response_format'] == {'type': 'json_object'}


def test_chat_no_auth_header_without_key(api_client, monkeypatch):
    api_client.put('/api/v1/ai/settings', json={'baseUrl': 'http://h/v1', 'model': 'm'})
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen['headers'] = headers
        return FakeResponse()

    monkeypatch.setattr(ai_service.httpx, 'post', fake_post)
    ai_service.chat([{'role': 'user', 'content': 'hi'}])
    assert 'Authorization' not in seen['headers']


def test_chat_retries_without_response_format_on_400(api_client, monkeypatch):
    api_client.put('/api/v1/ai/settings', json={'baseUrl': 'http://h/v1', 'model': 'm'})
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append(dict(json))
        if 'response_format' in json:
            return FakeResponse(status_code=400)
        return FakeResponse(content='ok2')

    monkeypatch.setattr(ai_service.httpx, 'post', fake_post)
    assert ai_service.chat([{'role': 'user', 'content': 'x'}]) == 'ok2'
    assert len(calls) == 2
    assert 'response_format' not in calls[1]


def test_test_endpoint_never_500(api_client, monkeypatch):
    api_client.put('/api/v1/ai/settings', json={'baseUrl': 'http://h/v1', 'model': 'm'})
    def boom(*a, **k):
        raise httpx.ConnectError('refused')

    monkeypatch.setattr(ai_service.httpx, 'post', boom)
    r = api_client.post('/api/v1/ai/test', json={})
    assert r.status_code == 200
    body = r.json()
    assert body['ok'] is False
    assert 'تعذّر الاتصال' in body['message']


def test_test_endpoint_ok(api_client, monkeypatch):
    api_client.put('/api/v1/ai/settings', json={'baseUrl': 'http://h/v1',
                                                'model': 'qwen2.5:3b'})
    monkeypatch.setattr(ai_service.httpx, 'post',
                        lambda *a, **k: FakeResponse(content='جاهز'))
    r = api_client.post('/api/v1/ai/test', json={})
    assert r.status_code == 200
    body = r.json()
    assert body['ok'] is True
    assert body['model'] == 'qwen2.5:3b'


# ---------------------------------------------------------------- extraction

def test_extract_end_to_end_csv(api_client, tmp_path, monkeypatch):
    api_client.put('/api/v1/ai/settings', json={'enabled': True, 'baseUrl': 'http://h/v1', 'model': 'm'})
    f = tmp_path / 'stmt.csv'
    f.write_text('2026-01-05,100,0,فاتورة توريد', encoding='utf-8')
    reply = json.dumps({'account': '2101', 'name': 'مورد اختبار', 'rows': [
        {'date': '2026-01-05', 'debit': 100, 'credit': 0, 'description': 'فاتورة توريد'}]})
    monkeypatch.setattr(ai_service.httpx, 'post',
                        lambda *a, **k: FakeResponse(content='```json\n' + reply + '\n```'))
    r = api_client.post('/api/v1/ai/extract', json={'path': str(f)})
    assert r.status_code == 200
    body = r.json()
    assert body['account'] == '2101'
    assert body['chunks'] == 1
    assert body['rows'] == [{'date': '2026-01-05', 'debit': 100.0, 'credit': 0.0,
                             'description': 'فاتورة توريد'}]


def test_extract_bad_provider_502(api_client, tmp_path, monkeypatch):
    api_client.put('/api/v1/ai/settings', json={'enabled': True, 'baseUrl': 'http://h/v1', 'model': 'm'})
    f = tmp_path / 'stmt.txt'
    f.write_text('some ledger text', encoding='utf-8')

    def boom(*a, **k):
        raise httpx.ConnectError('refused')

    monkeypatch.setattr(ai_service.httpx, 'post', boom)
    r = api_client.post('/api/v1/ai/extract', json={'path': str(f)})
    assert r.status_code == 502


# ---------------------------------------------------------------- chunking math

def test_chunking_short_text_single_chunk():
    assert ai_service.chunk_segments(['abc']) == ['abc']


def test_chunking_long_text_splits_at_limit():
    text = 'x' * 15000
    chunks = ai_service.chunk_segments([text])
    assert all(len(c) <= ai_service.MAX_CHARS for c in chunks)
    assert sum(len(c) for c in chunks) == 15000
    assert len(chunks) == 3  # 6000 + 6000 + 3000


def test_chunking_packs_pages_greedily():
    pages = ['a' * 2000, 'b' * 2000, 'c' * 2000, 'd' * 2000]
    chunks = ai_service.chunk_segments(pages)
    # 2000*3 + 2 newlines = 6002 > 6000 → first chunk holds 2 pages
    assert len(chunks) == 2
    assert all(len(c) <= ai_service.MAX_CHARS for c in chunks)


def test_chunking_drops_empty_segments():
    assert ai_service.chunk_segments(['', '  ', 'hello']) == ['hello']
