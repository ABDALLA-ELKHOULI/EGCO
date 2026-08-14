# -*- coding: utf-8 -*-
"""ذاكرة تخطيط الملفات المتعلَّمة — توفير رموز الذكاء الاصطناعي عبر استخراج حتمي محلي
لملفات لاحقة من نفس شكل الكشف (بلا شبكة إطلاقاً — كل شيء مُصطنَع أو محلي)."""
import json
from pathlib import Path

import pytest

from app.services import ai_service

SAMPLES = Path(__file__).resolve().parents[3] / 'design' / 'samples'
PDF_A = SAMPLES / 'guarantee-alquds.pdf'
PDF_B = SAMPLES / 'contractor-holol-afaq.pdf'
XLSX_C = SAMPLES / 'suppliers-terms.xlsx'


def _skip_if_missing(*paths):
    for p in paths:
        if not p.exists():
            pytest.skip(f'sample missing: {p}')


# ---------------------------------------------------------------- fingerprint

def test_fingerprint_stable_across_same_export_system_pdfs():
    _skip_if_missing(PDF_A, PDF_B)
    fp_a = ai_service.compute_fingerprint(PDF_A)
    fp_b = ai_service.compute_fingerprint(PDF_B)
    assert fp_a == fp_b


def test_fingerprint_differs_for_genuinely_different_layout():
    _skip_if_missing(PDF_A, XLSX_C)
    fp_pdf = ai_service.compute_fingerprint(PDF_A)
    fp_xlsx = ai_service.compute_fingerprint(XLSX_C)
    assert fp_pdf != fp_xlsx


# ---------------------------------------------------------------- learn + reuse

class FakeResponse:
    def __init__(self, content):
        self.status_code = 200
        self._payload = {'choices': [{'message': {'content': content}}]}

    def json(self):
        return self._payload


def _fake_reply():
    return json.dumps({'account': '21620', 'name': 'ضمان اعمال شركة القدس الكبرى',
                       'rows': [{'date': '2025-02-01', 'debit': 0, 'credit': 6022.25,
                                'description': 'مستخلص'}]})


def test_first_extraction_hits_llm_and_persists_layout(api_client, monkeypatch):
    _skip_if_missing(PDF_A)
    api_client.put('/api/v1/ai/settings', json={'enabled': True, 'baseUrl': 'http://h/v1',
                                                 'model': 'm'})
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append(1)
        return FakeResponse(_fake_reply())

    monkeypatch.setattr(ai_service.httpx, 'post', fake_post)

    r = api_client.post('/api/v1/ai/extract', json={'path': str(PDF_A)})
    assert r.status_code == 200
    body = r.json()
    assert body['source'] == 'ai'
    assert len(calls) == 1

    layouts = api_client.get('/api/v1/ai/learned-layouts').json()['items']
    assert len(layouts) == 1
    assert layouts[0]['sourceKind'] == 'pdf'
    assert layouts[0]['hitCount'] == 0


def test_second_similarly_shaped_file_uses_learned_path_zero_chat_calls(api_client, monkeypatch):
    _skip_if_missing(PDF_A, PDF_B)
    api_client.put('/api/v1/ai/settings', json={'enabled': True, 'baseUrl': 'http://h/v1',
                                                 'model': 'm'})
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append(1)
        return FakeResponse(_fake_reply())

    monkeypatch.setattr(ai_service.httpx, 'post', fake_post)

    r1 = api_client.post('/api/v1/ai/extract', json={'path': str(PDF_A)})
    assert r1.json()['source'] == 'ai'
    assert len(calls) == 1

    # second file — same accounting-system export layout, different data
    r2 = api_client.post('/api/v1/ai/extract', json={'path': str(PDF_B)})
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2['source'] == 'learned'
    assert body2['layoutHitCount'] == 1
    assert body2['rows']
    assert len(calls) == 1  # ← لم يُستدعَ chat() مرة ثانية إطلاقاً

    layouts = api_client.get('/api/v1/ai/learned-layouts').json()['items']
    assert layouts[0]['hitCount'] == 1


def test_deterministic_attempt_falling_short_falls_through_to_llm(api_client, monkeypatch, tmp_path):
    """قاعدة متعلَّمة موجودة لكن تطبيقها على ملف لاحق لا يعطي نتيجة معقولة (بصمة
    متطابقة صدفة لكن بلا أي علامة CompanyCode أو أرقام) — يجب التراجع للنموذج."""
    _skip_if_missing(PDF_A)
    api_client.put('/api/v1/ai/settings', json={'enabled': True, 'baseUrl': 'http://h/v1',
                                                 'model': 'm'})
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append(1)
        return FakeResponse(_fake_reply())

    monkeypatch.setattr(ai_service.httpx, 'post', fake_post)

    # أولاً: ملف حقيقي يتعلّم قاعدة صحيحة
    r1 = api_client.post('/api/v1/ai/extract', json={'path': str(PDF_A)})
    assert r1.json()['source'] == 'ai'
    assert len(calls) == 1

    # نفس نص الملف لكن بلا أي علامة CompanyCode ولا مبالغ رقمية — تطبيق القاعدة
    # المتعلَّمة (row_split_regex على CompanyCode=) لن يجد أي قطعة صالحة.
    stripped = tmp_path / 'stripped.pdf'
    # نسخة .txt (سيقرأها extract_text_segments كنص عادي) تحمل نفس تسميات الأعمدة
    # فقط بلا أي محتوى صفوف قابل للاستخراج الحتمي — تكفي لإثبات التراجع.
    stripped = tmp_path / 'stripped.txt'
    stripped.write_text('التاريخ الوصف مدين دائن — لا صفوف هنا إطلاقاً', encoding='utf-8')

    # نجبر البصمة على مطابقة قاعدة PDF المتعلَّمة مسبقاً عبر monkeypatch لدالة البصمة
    monkeypatch.setattr(ai_service, 'compute_fingerprint',
                        lambda p, _orig=ai_service.compute_fingerprint:
                        _orig(PDF_A) if p == stripped else _orig(p))

    r2 = api_client.post('/api/v1/ai/extract', json={'path': str(stripped)})
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2['source'] == 'ai'          # تراجع فعلي للنموذج، ليس 'learned'
    assert len(calls) == 2                  # النموذج استُدعي مرة ثانية فعلاً
