# -*- coding: utf-8 -*-
"""اختبارات: (1) بند العربية موجود في كل نداء نصي للمساعد (2) تنظيف تسريبات نموذج
التفكير (chain-of-thought/مقدمة إنجليزية) قبل وصول الرد للواجهة."""
import datetime as dt
import json

from app.services import ai_service
from app.services import ai_features_service as F


def _capture():
    calls = []

    def fake_chat(messages, json_mode=True):
        calls.append(messages)
        if json_mode:
            return '{}'
        return 'رد'
    return calls, fake_chat


# ---------------------------------------------------------------- clause presence

def test_extract_rows_system_prompt_has_arabic_clause():
    assert ai_service.ARABIC_CLAUSE in ai_service.SYSTEM_PROMPT


def test_ask_both_steps_have_arabic_clause(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import importlib
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    session_mod.init_db()

    calls = []

    def fake_chat(messages, json_mode=True):
        calls.append(messages)
        if json_mode:
            return json.dumps({'sql': 'SELECT COUNT(*) FROM suppliers'})
        return 'رد'
    F.ask(fake_chat, 'كم عدد الموردين؟')
    assert len(calls) == 2
    for messages in calls:
        assert ai_service.ARABIC_CLAUSE in messages[0]['content']


def test_remind_message_has_arabic_clause():
    calls, fake_chat = _capture()
    facts = dict(partyKind='supplier', name='مورد', account='S1', outstanding=100.0,
                overdue=0.0, overdueCount=0, oldestOverdue=None)
    F.remind_message(fake_chat, facts)
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


def test_budget_notes_has_arabic_clause():
    calls, fake_chat = _capture()
    F.budget_notes(fake_chat, dict(project='م'))
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


def test_executive_summary_has_arabic_clause():
    calls, fake_chat = _capture()
    F.executive_summary(fake_chat, dict(a=1))
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


def test_brief_text_has_arabic_clause():
    calls, fake_chat = _capture()
    F.brief_text(fake_chat, dict(a=1))
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


def test_phrase_anomalies_has_arabic_clause():
    calls, fake_chat = _capture()
    F.phrase_anomalies(fake_chat, [dict(kind='x', link='#')])
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


def test_parse_text_proposal_has_arabic_clause(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import importlib
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    session_mod.init_db()
    db = session_mod.SessionLocal()
    calls, fake_chat = _capture()
    F.parse_text_proposal(fake_chat, db, 'نص حر')
    db.close()
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


def test_what_if_narrative_has_arabic_clause():
    calls, fake_chat = _capture()
    F.what_if_narrative(fake_chat, dict(), dict(), 5)
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


def test_priorities_narrative_has_arabic_clause():
    calls, fake_chat = _capture()
    F.priorities_narrative(fake_chat, dict(items=[]))
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


def test_suggest_account_kind_has_arabic_clause(monkeypatch):
    monkeypatch.setattr(ai_service, 'load_settings', lambda: {'enabled': True})
    calls, fake_chat = _capture()

    def fake_chat_json(messages, json_mode=True):
        calls.append(messages)
        return json.dumps({'kind': 'supplier', 'reason': 'سبب'})
    monkeypatch.setattr(ai_service, 'chat', fake_chat_json)
    F.suggest_account_kind('999', 'اسم', 'مقتطف')
    assert ai_service.ARABIC_CLAUSE in calls[0][0]['content']


# ---------------------------------------------------------------- leak stripping

def test_strip_leak_removes_think_block_prose():
    raw = '<think>reasoning in English about the answer</think>\nالإجابة النهائية بالعربية.'
    out = ai_service._strip_leak(raw, json_mode=False)
    assert 'reasoning' not in out
    assert 'الإجابة النهائية بالعربية.' in out


def test_strip_leak_removes_english_preamble_lines():
    raw = "Let's think about this step by step.\nOkay here is my answer.\nهذا هو الرد النهائي بالعربية."
    out = ai_service._strip_leak(raw, json_mode=False)
    assert out == 'هذا هو الرد النهائي بالعربية.'


def test_strip_leak_json_mode_trims_to_object():
    raw = 'Sure, here is the JSON:\n```json\n{"a": 1, "b": "قيمة"}\n```\nHope this helps!'
    out = ai_service._strip_leak(raw, json_mode=True)
    assert out.strip().startswith('{')
    assert out.strip().endswith('}')
    data = json.loads(out)
    assert data == {'a': 1, 'b': 'قيمة'}


def test_strip_leak_json_mode_with_think_block():
    raw = '<think>internal english reasoning</think>{"kind": "supplier", "reason": "سبب عربي"}'
    out = ai_service._strip_leak(raw, json_mode=True)
    data = json.loads(out)
    assert data == {'kind': 'supplier', 'reason': 'سبب عربي'}


def test_chat_applies_strip_leak(monkeypatch):
    """chat() نفسها تطبّق التنظيف على رد المزود قبل إعادته للمستدعي."""
    class FakeResponse:
        status_code = 200

        def json(self):
            return {'choices': [{'message': {'content':
                '<think>thinking...</think>Here you go:\nالنتيجة النهائية بالعربية.'}}]}

    monkeypatch.setattr(ai_service, 'load_settings', lambda: {
        'baseUrl': 'http://h/v1', 'apiKey': '', 'model': 'm', 'maxTokens': 100})
    monkeypatch.setattr(ai_service.httpx, 'post', lambda *a, **k: FakeResponse())
    out = ai_service.chat([{'role': 'user', 'content': 'سؤال'}], json_mode=False)
    assert out == 'النتيجة النهائية بالعربية.'
