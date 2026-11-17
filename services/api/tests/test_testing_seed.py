# -*- coding: utf-8 -*-
"""بذر بيانات الاختبار المصنوعة (م-٤٧) — الحارس ثم الأرقام الثابتة."""
from decimal import Decimal

import pytest

from app import testing_seed


@pytest.fixture()
def seed_env(monkeypatch):
    """يُطلب قبل api_client (ترتيب الوسائط) حتى يجد lifespan المتغيّر مضبوطاً."""
    monkeypatch.setenv('EGCO_SEED', '1')


def test_no_seed_without_env(monkeypatch, api_client):
    monkeypatch.delenv('EGCO_SEED', raising=False)
    assert testing_seed.seed_if_requested() is False
    assert api_client.get('/api/v1/suppliers').json()['count'] == 0


def test_seeds_on_startup_when_requested(seed_env, api_client):
    d = api_client.get('/api/v1/dashboard').json()['summary']
    assert Decimal(str(d['outstanding'])) == testing_seed.EXPECTED_OUTSTANDING
    assert Decimal(str(d['overdue'])) == testing_seed.EXPECTED_OVERDUE

    s = api_client.get('/api/v1/suppliers').json()
    assert s['count'] == len(testing_seed.SUPPLIERS)
    assert Decimal(str(s['totals']['outstanding'])) == testing_seed.EXPECTED_OUTSTANDING

    p = api_client.get('/api/v1/projects').json()
    assert Decimal(str(p['totals']['outstanding'])) == testing_seed.EXPECTED_OUTSTANDING
    assert {r['project'] for r in p['rows']} >= set(testing_seed.PROJECTS)

    c = api_client.get('/api/v1/contractors').json()
    assert len(c['rows']) == len(testing_seed.CONTRACTORS)
    kinds = {e['kind'] for e in api_client.get('/api/v1/contractors/2120001').json()['entries']}
    assert kinds == {'opening', 'claim', 'payment'}

    assert len(api_client.get('/api/v1/budget').json()['rows']) == 1


def test_never_seeds_a_non_empty_database(seed_env, api_client):
    """إقلاع ثانٍ بنفس القاعدة (المبذورة) لا يضاعف شيئاً."""
    assert testing_seed.seed_if_requested() is False
    assert api_client.get('/api/v1/suppliers').json()['count'] == len(testing_seed.SUPPLIERS)
