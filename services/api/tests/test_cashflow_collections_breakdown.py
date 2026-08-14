# -*- coding: utf-8 -*-
"""اختبارات: (1) عرض التحصيل الفعلي في التدفق النقدي (2) درجة تتبع كل رقم لمصدره."""
import datetime as dt
import importlib
from decimal import Decimal

import pytest


@pytest.fixture()
def collections_db(tmp_path, monkeypatch):
    """أربع تحصيلات: محصَّلة داخل المدى، محصَّلة قبل بداية المدى (خارجه)، مفتوحة
    بتاريخ استحقاق (تدخل التوقع)، مفتوحة بلا تاريخ استحقاق (لا تدخل التوقع)."""
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.payables_service as payables_service_mod
    importlib.reload(payables_service_mod)
    import app.services.cashflow_service as cashflow_service_mod
    importlib.reload(cashflow_service_mod)

    session_mod.init_db()
    db = session_mod.SessionLocal()
    today = dt.date(2026, 8, 14)

    supplier = models_mod.Supplier(account='S1', name='مورد S1', project='مشروع أ',
                                   term_raw='30 يوم', term_kind='net', term_days=30)
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    # one overdue invoice (due before today), one scheduled inside horizon
    db.add(models_mod.Invoice(supplier_id=supplier.id, number='I1', date=today, amount=1000.0,
                              manual_due_date=today - dt.timedelta(days=5)))
    db.add(models_mod.Invoice(supplier_id=supplier.id, number='I2', date=today, amount=400.0,
                              manual_due_date=today + dt.timedelta(days=2)))

    db.add(models_mod.Receivable(project='مشروع أ', unit='U1', client='عميل داخل المدى',
                                 amount=15000.0, due_date=None, collected_on=today,
                                 status='collected', source='manual'))
    db.add(models_mod.Receivable(project='مشروع أ', unit='U2', client='عميل قبل المدى',
                                 amount=9000.0, due_date=None,
                                 collected_on=today - dt.timedelta(days=30),
                                 status='collected', source='manual'))
    db.add(models_mod.Receivable(project='مشروع أ', unit='U3', client='عميل مفتوح مؤرَّخ',
                                 amount=500.0, due_date=today + dt.timedelta(days=1),
                                 status='open', source='manual'))
    db.add(models_mod.Receivable(project='مشروع أ', unit='U4', client='عميل مفتوح بلا تاريخ',
                                 amount=300.0, due_date=None, status='open', source='manual'))
    db.commit()

    yield db, cashflow_service_mod, today
    db.close()


# ---------------------------------------------------------------- collections block

def test_collections_in_window_and_total(collections_db):
    db, cashflow_service, today = collections_db
    result = cashflow_service.cashflow(db, weeks=2, today=today)
    collections = result['collections']
    assert collections['inWindow'] == 15000.0
    assert collections['total'] == 15000.0 + 9000.0
    assert collections['count'] == 2
    assert collections['truncated'] is False
    dates = {r['date'] for r in collections['rows']}
    assert today.isoformat() in dates
    assert (today - dt.timedelta(days=30)).isoformat() in dates


def test_total_inflow_unchanged_forecast_only_semantics(collections_db):
    db, cashflow_service, today = collections_db
    result = cashflow_service.cashflow(db, weeks=2, today=today)
    # only the open+dated receivable (500) feeds the forecast — collections never do.
    assert result['summary']['totalInflow'] == 500.0


def test_per_bucket_collected_matches_seeded_row(collections_db):
    db, cashflow_service, today = collections_db
    result = cashflow_service.cashflow(db, weeks=2, today=today)
    first_bucket = result['periods'][0]
    assert first_bucket['collected'] == 15000.0
    # the forecast inflow in that same bucket is unaffected by the collected figure
    assert first_bucket['inflow'] == 500.0


def test_all_collected_warning_points_to_actual_figure(tmp_path, monkeypatch):
    """كل التحصيلات المسجّلة محصَّلة بالفعل (لا سجل مفتوح إطلاقاً) — التحذير يجب أن
    يشير إلى الرقم الفعلي المحصَّل خلال المدى بدل الإيحاء بغياب بيانات الدخل."""
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.cashflow_service as cashflow_service_mod
    importlib.reload(cashflow_service_mod)

    session_mod.init_db()
    db = session_mod.SessionLocal()
    today = dt.date(2026, 8, 14)
    db.add(models_mod.Receivable(project='م', unit='U1', client='ع', amount=15000.0,
                                 due_date=None, collected_on=today, status='collected',
                                 source='manual'))
    db.commit()

    result = cashflow_service_mod.cashflow(db, weeks=2, today=today)
    assert result['summary']['totalInflow'] == 0.0
    assert any('لا يوجد داخل متوقّع' in w and '15,000.00' in w for w in result['warnings'])
    db.close()


def test_other_honest_warnings_unchanged(collections_db):
    """متأخر الآن (فاتورة I1) ما زال يظهر بصيغته المعتادة رغم إضافة كتلة التحصيل."""
    db, cashflow_service, today = collections_db
    result = cashflow_service.cashflow(db, weeks=2, today=today)
    assert any('متأخر الآن' in w for w in result['warnings'])


# ---------------------------------------------------------------- breakdown endpoint

def test_breakdown_collected_rows_sum_to_headline(collections_db):
    db, cashflow_service, today = collections_db
    result = cashflow_service.cashflow(db, weeks=2, today=today)
    bd = cashflow_service.breakdown(db, term='collected', today=today, weeks=2)
    assert Decimal(str(bd['total'])) == Decimal(str(result['collections']['inWindow']))
    assert sum(Decimal(str(r['amount'])) for r in bd['rows']) == Decimal(str(bd['total']))


def test_breakdown_forecast_rows_sum_to_total_inflow(collections_db):
    db, cashflow_service, today = collections_db
    result = cashflow_service.cashflow(db, weeks=2, today=today)
    bd = cashflow_service.breakdown(db, term='forecast', today=today, weeks=2)
    assert Decimal(str(bd['total'])) == Decimal(str(result['summary']['totalInflow']))


def test_breakdown_overdue_and_scheduled_rows_sum_to_reconciliation(collections_db):
    db, cashflow_service, today = collections_db
    result = cashflow_service.cashflow(db, weeks=2, today=today, parties='suppliers')
    recon = result['reconciliation']['outflow']

    overdue_bd = cashflow_service.breakdown(db, term='overdue', today=today, weeks=2,
                                            parties='suppliers')
    scheduled_bd = cashflow_service.breakdown(db, term='scheduled', today=today, weeks=2,
                                              parties='suppliers')
    undated_bd = cashflow_service.breakdown(db, term='undated', today=today, weeks=2,
                                            parties='suppliers')

    assert Decimal(str(overdue_bd['total'])) == Decimal(str(recon['overdueNow']))
    assert Decimal(str(scheduled_bd['total'])) == Decimal(str(recon['scheduled']))
    assert Decimal(str(undated_bd['total'])) == Decimal(str(recon['undated']))
    assert overdue_bd['rows'][0]['invoiceNumber'] == 'I1'
    assert scheduled_bd['rows'][0]['invoiceNumber'] == 'I2'


def test_breakdown_project_filter_matches_main_endpoint(collections_db):
    db, cashflow_service, today = collections_db
    # narrow to a project with no data — everything should be empty/zero on both sides
    result = cashflow_service.cashflow(db, weeks=2, today=today, project='مشروع لا يوجد')
    bd = cashflow_service.breakdown(db, term='scheduled', today=today, weeks=2,
                                    project='مشروع لا يوجد', parties='suppliers')
    assert result['summary']['totalOutflow'] == 0.0
    assert bd['total'] == 0.0
    assert bd['rows'] == []
