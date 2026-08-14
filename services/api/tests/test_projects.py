# -*- coding: utf-8 -*-
"""اختبارات تجميع المشاريع — totals identity: sum of project outstanding == overall."""
import datetime as dt
import importlib

import pytest

TODAY = dt.date(2026, 8, 8)


@pytest.fixture()
def db_session(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.services.payables_service as payables_service_mod
    importlib.reload(payables_service_mod)
    import app.services.projects_service as projects_service_mod
    importlib.reload(projects_service_mod)

    session_mod.init_db()
    db = session_mod.SessionLocal()
    yield db, payables_service_mod, projects_service_mod
    db.close()


def _add_supplier(db, models_mod, account, name, project, term_raw='30 يوم'):
    from app.domain.payables import parse_term
    term = parse_term(term_raw)
    row = models_mod.Supplier(account=account, name=name, project=project,
                              term_raw=term.raw, term_kind=term.kind, term_days=term.days)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_projects_group_and_totals_match_overall(db_session):
    db, payables_service_mod, projects_service_mod = db_session
    from app.db import models

    s1 = _add_supplier(db, models, '1001', 'مورد أ', 'مشروع الأمل')
    s2 = _add_supplier(db, models, '1002', 'مورد ب', 'مشروع الأمل')
    s3 = _add_supplier(db, models, '1003', 'مورد ج', '')   # empty project -> غير محدد

    db.add(models.Invoice(supplier_id=s1.id, date=TODAY, amount=1000.0, number='A1'))
    db.add(models.Invoice(supplier_id=s2.id, date=TODAY, amount=500.0, number='B1'))
    db.add(models.Invoice(supplier_id=s3.id, date=TODAY, amount=250.0, number='C1'))
    db.commit()

    result = projects_service_mod.list_projects(db, today=TODAY)
    rows = result['rows']
    assert len(rows) == 2

    by_name = {r['project']: r for r in rows}
    assert 'مشروع الأمل' in by_name
    assert 'غير محدد' in by_name
    assert by_name['مشروع الأمل']['outstanding'] == pytest.approx(1500.0)
    assert by_name['غير محدد']['outstanding'] == pytest.approx(250.0)

    # sum of project outstanding must equal the overall payables outstanding
    overall = payables_service_mod.dashboard(db, today=TODAY)['summary']['outstanding']
    assert sum(r['outstanding'] for r in rows) == pytest.approx(overall)
    assert result['totals']['outstanding'] == pytest.approx(overall)

    # sorted by outstanding desc
    assert rows[0]['project'] == 'مشروع الأمل'

    # topSuppliers capped at 3 and account/name/outstanding present
    top = by_name['مشروع الأمل']['topSuppliers']
    assert len(top) <= 3
    assert set(top[0].keys()) == {'account', 'name', 'outstanding'}


def test_project_detail_includes_suppliers_and_schedule(db_session):
    db, payables_service_mod, projects_service_mod = db_session
    from app.db import models

    s1 = _add_supplier(db, models, '2001', 'مورد س', 'مشروع النور')
    db.add(models.Invoice(supplier_id=s1.id, date=TODAY, amount=800.0, number='X1'))
    db.commit()

    detail = projects_service_mod.project_detail(db, 'مشروع النور', today=TODAY)
    assert detail is not None
    assert detail['project'] == 'مشروع النور'
    assert len(detail['suppliers']) == 1
    assert detail['suppliers'][0]['account'] == '2001'
    assert 'schedule' in detail

    assert projects_service_mod.project_detail(db, 'لا يوجد', today=TODAY) is None
