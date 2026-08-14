# -*- coding: utf-8 -*-
"""اختبارات وحدة الموازنة — التحليل من الملف الحقيقي، الاستيراد المتكرر، والمسارات."""
import datetime as dt
import importlib
import os

import pytest

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
BUDGET_XLSX = os.path.join(SAMPLES, 'budget-deviation-2026-07.xlsx')

pytestmark = pytest.mark.skipif(
    not os.path.exists(BUDGET_XLSX),
    reason='design/samples not present in this checkout')


def _by_month(sheets):
    return {s['month']: s for s in sheets}


def test_parse_sample_workbook():
    from app.ingest import budget_xlsx
    sheets = budget_xlsx.parse(BUDGET_XLSX)
    assert len(sheets) == 2
    assert all(s['project'] == 'سدايم' for s in sheets)

    by_month = _by_month(sheets)
    july = by_month[dt.date(2026, 7, 1)]
    assert july['actual_month'] == pytest.approx(1096845.76)
    assert july['planned_month'] == pytest.approx(433322)
    assert july['deviation_month'] == pytest.approx(663523.76)
    assert july['cum_actual'] == pytest.approx(49844690.75)
    assert july['cum_planned'] == pytest.approx(59312803)
    assert july['cum_prev_actual'] == pytest.approx(48747844.99)
    assert july['cum_prev_planned'] == pytest.approx(58879481)
    assert july['delay_pct'] == pytest.approx(0.1596, abs=1e-3)
    assert july['completion_pct'] == pytest.approx(0.8404)
    assert july['serial'] == 'EGCO/1607026'
    assert july['issued_on'] == dt.date(2026, 7, 16)

    claims = {c['no']: c for c in july['claims']}
    assert claims['38']['amount'] == pytest.approx(1096845.76)
    assert claims['38']['date'] == dt.date(2026, 7, 4)
    # claim 39 is planned but not yet issued — kept with amount 0 and no date
    assert claims['39']['amount'] == 0
    assert claims['39']['date'] is None

    june = by_month[dt.date(2026, 6, 1)]
    assert june['project'] == 'سدايم'
    assert june['delay_pct'] == pytest.approx(0.1708, abs=1e-3)


@pytest.fixture()
def db_env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.services.budget_service as budget_service_mod
    importlib.reload(budget_service_mod)

    session_mod.init_db()
    db = session_mod.SessionLocal()
    yield db, budget_service_mod
    db.close()


def test_import_twice_updates_not_duplicates(db_env):
    db, budget_service = db_env
    from app.db import models

    first = budget_service.import_budget(db, BUDGET_XLSX)
    assert first['imported'] == 2
    assert first['updated'] == 0
    assert first['projects'] == ['سدايم']

    second = budget_service.import_budget(db, BUDGET_XLSX)
    assert second['imported'] == 0
    assert second['updated'] == 2
    assert db.query(models.BudgetSnapshot).count() == 2


def test_api_overview_and_trend(api_client):
    r = api_client.post('/api/v1/budget/import', json={'path': BUDGET_XLSX})
    assert r.status_code == 200

    r = api_client.get('/api/v1/budget')
    assert r.status_code == 200
    projects = r.json()['projects']
    assert len(projects) == 1
    p = projects[0]
    assert p['project'] == 'سدايم'
    assert len(p['months']) == 2
    assert p['latest']['month'] == '2026-07-01'
    assert p['latest']['actualMonth'] == pytest.approx(1096845.76)
    # July delay 15.96% vs June 17.08% → improved by ~1.12 percentage points
    assert p['trend']['delayDeltaPp'] == pytest.approx(-1.12, abs=0.05)
    assert p['trend']['monthsBehind'] is None

    r = api_client.get('/api/v1/budget/project/سدايم')
    assert r.status_code == 200
    assert r.json()['latest']['serial'] == 'EGCO/1607026'

    r = api_client.get('/api/v1/budget/project/غير-موجود')
    assert r.status_code == 404


def test_api_import_missing_file(api_client):
    r = api_client.post('/api/v1/budget/import', json={'path': '/no/such/file.xlsx'})
    assert r.status_code == 404
