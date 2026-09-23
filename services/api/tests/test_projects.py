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


def _add_contractor_entry(db, models_mod, code, name, project, credit=0.0, debit=0.0,
                          date=TODAY):
    contractor = db.query(models_mod.Contractor).filter_by(code=code).one_or_none()
    if contractor is None:
        contractor = models_mod.Contractor(code=code, name=name)
        db.add(contractor)
        db.commit()
        db.refresh(contractor)
    db.add(models_mod.ContractorEntry(contractor_id=contractor.id, date=date,
                                      debit=debit, credit=credit, project=project,
                                      kind='claim' if credit else 'payment'))
    db.commit()
    return contractor


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


def test_project_row_shows_contractor_debt_not_just_suppliers(db_session):
    """م-٢٩: صفّ المشروع كان يُخفي مديونية المقاولين كلياً — outstanding=0.00
    بينما مقاولو المشروع مدينون بمبلغ كبير. الآن يظهران معاً في نفس الصفّ."""
    db, payables_service_mod, projects_service_mod = db_session
    from app.db import models

    _add_supplier(db, models, '3001', 'مورد سدايم', 'سدايم')
    # مقاولان على نفس المشروع، مستحق لهما (رصيد سالب) — لا فواتير موردين إطلاقاً.
    _add_contractor_entry(db, models, '2120001', 'مقاول أ', 'سدايم', credit=1500000.0)
    _add_contractor_entry(db, models, '2120002', 'مقاول ب', 'سدايم', credit=585958.76)

    result = projects_service_mod.list_projects(db, today=TODAY)
    row = next(r for r in result['rows'] if r['project'] == 'سدايم')

    assert row['outstanding'] == pytest.approx(0.0)  # موردون: لا فواتير
    assert row['contractorsOwed'] == pytest.approx(2085958.76)
    assert row['contractorCount'] == 2
    assert row['totalCommitment'] == pytest.approx(2085958.76)

    # المجموع الكلي يطابق /contractors دون ازدواج
    from app.services import contractors_service as CS
    contractors_totals = CS.contractors_list_json(db, TODAY)['totals']
    assert result['totals']['contractorsOwed'] == pytest.approx(
        contractors_totals['owedToContractors'])


def test_project_merges_spelling_variants_with_and_without_al(db_session):
    """م-٣٠: «سدن» (مقاولون، بلا أل) و«السدن» (موردون، بأل) نفس المشروع — يجب أن
    يجتمعا في صفّ واحد لا صفّين، مع إظهار الصيغتين للمستخدم."""
    db, payables_service_mod, projects_service_mod = db_session
    from app.db import models

    _add_supplier(db, models, '4001', 'مورد السدن', 'السدن')
    _add_contractor_entry(db, models, '2120010', 'مقاول السدن', 'سدن', credit=212850.74)

    result = projects_service_mod.list_projects(db, today=TODAY)
    matching = [r for r in result['rows'] if r['project'] in ('السدن', 'سدن')]
    assert len(matching) == 1, 'يجب ألا ينقسم مشروع واحد إلى صفّين بسبب أل التعريف'
    row = matching[0]
    assert row['contractorsOwed'] == pytest.approx(212850.74)
    assert row['mergedSpellingAlert'] is True
    assert set(row['contractorProjectNames']) == {'سدن'}

    detail = projects_service_mod.project_detail(db, 'السدن', today=TODAY)
    assert detail is not None
    assert detail['contractorsOwed'] == pytest.approx(212850.74)
    assert len(detail['contractors']) == 1
    assert detail['contractors'][0]['code'] == '2120010'


def test_project_only_contractor_project_still_appears(db_session):
    """مشروع بلا موردين إطلاقاً لكن له مقاولون — لا يجوز أن يختفي من الشاشة."""
    db, payables_service_mod, projects_service_mod = db_session
    from app.db import models

    _add_contractor_entry(db, models, '2120020', 'مقاول جـ', 'المدينة', credit=2391112.39)

    result = projects_service_mod.list_projects(db, today=TODAY)
    row = next(r for r in result['rows'] if r['project'] == 'المدينة')
    assert row['outstanding'] == pytest.approx(0.0)
    assert row['contractorsOwed'] == pytest.approx(2391112.39)

    detail = projects_service_mod.project_detail(db, 'المدينة', today=TODAY)
    assert detail is not None
    assert detail['contractorsOwed'] == pytest.approx(2391112.39)
