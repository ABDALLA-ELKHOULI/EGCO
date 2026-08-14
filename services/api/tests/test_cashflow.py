# -*- coding: utf-8 -*-
"""اختبارات التدفق النقدي — حسابات يدوية على بيانات صناعية."""
import datetime as dt
import importlib
from decimal import Decimal

import pytest

from app.domain.cashflow import CashItem, build_periods, summarise

FROM = dt.date(2026, 1, 1)


def test_two_periods_basic_inflow_outflow_and_balance():
    receivables = [
        CashItem(date=dt.date(2026, 1, 3), amount=Decimal('1000')),
        CashItem(date=dt.date(2026, 1, 20), amount=Decimal('500')),
    ]
    payables = [
        CashItem(date=dt.date(2026, 1, 5), amount=Decimal('300')),
    ]
    periods = build_periods(receivables, payables, FROM, weeks=4, opening_balance=Decimal('0'))
    # 4 weeks = 28 days -> 2 buckets of 14 days
    assert len(periods) == 2

    p0 = periods[0]
    assert p0.from_date == dt.date(2026, 1, 1)
    assert p0.to_date == dt.date(2026, 1, 14)
    assert p0.inflow == Decimal('1000')
    assert p0.outflow == Decimal('300')
    assert p0.net == Decimal('700')
    assert p0.balance == Decimal('700')
    assert p0.deficit is False

    p1 = periods[1]
    assert p1.from_date == dt.date(2026, 1, 15)
    assert p1.inflow == Decimal('500')
    assert p1.outflow == Decimal('0')
    # cumulative: 700 + 500
    assert p1.balance == Decimal('1200')


def test_deficit_case_when_outflow_exceeds_opening_and_inflow():
    receivables = [
        CashItem(date=dt.date(2026, 1, 2), amount=Decimal('100')),
    ]
    payables = [
        CashItem(date=dt.date(2026, 1, 10), amount=Decimal('5000')),
    ]
    periods = build_periods(receivables, payables, FROM, weeks=2, opening_balance=Decimal('0'))
    assert len(periods) == 1
    p0 = periods[0]
    assert p0.balance == Decimal('100') - Decimal('5000')
    assert p0.deficit is True

    summary = summarise(periods, has_receivables=True)
    assert summary['first_deficit'] is p0
    assert summary['min_balance'] == p0.balance
    assert summary['has_receivables'] is True


def test_opening_balance_carries_through():
    periods = build_periods([], [], FROM, weeks=2, opening_balance=Decimal('1000'))
    assert periods[0].balance == Decimal('1000')
    assert periods[0].deficit is False


def test_no_receivables_means_zero_inflow_and_flag_is_false():
    payables = [CashItem(date=dt.date(2026, 1, 5), amount=Decimal('200'))]
    periods = build_periods([], payables, FROM, weeks=2, opening_balance=Decimal('0'))
    summary = summarise(periods, has_receivables=False)
    assert summary['total_inflow'] == Decimal('0')
    assert summary['has_receivables'] is False
    assert periods[0].inflow == Decimal('0')


def test_cashflow_service_warns_when_no_receivables(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import importlib
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.services.cashflow_service as cashflow_service
    importlib.reload(cashflow_service)

    session_mod.init_db()
    db = session_mod.SessionLocal()
    try:
        result = cashflow_service.cashflow(db, weeks=2, today=dt.date(2026, 8, 8))
    finally:
        db.close()

    assert result['summary']['hasReceivables'] is False
    assert result['summary']['totalInflow'] == 0.0
    assert any('التحصيلات' in w for w in result['warnings'])


@pytest.fixture()
def two_project_db(tmp_path, monkeypatch):
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

    today = dt.date(2026, 8, 8)

    def add_supplier(account, project, term_days=30):
        row = models_mod.Supplier(account=account, name=f'مورد {account}', project=project,
                                  term_raw=f'{term_days} يوم', term_kind='net', term_days=term_days)
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    s1 = add_supplier('S1', 'مشروع الرسين')
    s2 = add_supplier('S2', 'مشروع النخيل')

    # invoice due dates land inside the first 14-day bucket from `today`.
    db.add(models_mod.Invoice(supplier_id=s1.id, number='I1', date=today, amount=1000.0,
                              manual_due_date=today + dt.timedelta(days=2)))
    db.add(models_mod.Invoice(supplier_id=s2.id, number='I2', date=today, amount=2000.0,
                              manual_due_date=today + dt.timedelta(days=2)))
    db.add(models_mod.Receivable(project='مشروع الرسين', unit='U1', client='عميل أ',
                                 amount=500.0, due_date=today + dt.timedelta(days=1),
                                 status='open', source='manual'))
    db.add(models_mod.Receivable(project='مشروع النخيل', unit='U2', client='عميل ب',
                                 amount=300.0, due_date=today + dt.timedelta(days=1),
                                 status='open', source='manual'))
    db.commit()

    yield db, cashflow_service_mod, today
    db.close()


def test_cashflow_project_filter_scopes_outflow_and_inflow(two_project_db):
    db, cashflow_service, today = two_project_db

    result = cashflow_service.cashflow(db, weeks=2, today=today, project='مشروع الرسين')
    assert result['summary']['totalOutflow'] == 1000.0
    assert result['summary']['totalInflow'] == 500.0
    assert result['summary']['receivablesStats'] == dict(total=1, dated=1, undated=0)

    other = cashflow_service.cashflow(db, weeks=2, today=today, project='مشروع النخيل')
    assert other['summary']['totalOutflow'] == 2000.0
    assert other['summary']['totalInflow'] == 300.0

    company_wide = cashflow_service.cashflow(db, weeks=2, today=today)
    assert company_wide['summary']['totalOutflow'] == 3000.0
    assert company_wide['summary']['totalInflow'] == 800.0


def test_cashflow_projects_list_is_company_wide_union(two_project_db):
    db, cashflow_service, today = two_project_db
    result = cashflow_service.cashflow(db, weeks=2, today=today, project='مشروع الرسين')
    assert result['projects'] == ['مشروع الرسين', 'مشروع النخيل']


def test_cashflow_warnings_scoped_to_filtered_project(two_project_db):
    db, cashflow_service, today = two_project_db
    # a project with a supplier invoice but no receivables at all must warn locally,
    # even though the company as a whole has receivables.
    from app.db import models as models_mod
    s3 = models_mod.Supplier(account='S3', name='مورد S3', project='مشروع فارغ',
                             term_raw='30 يوم', term_kind='net', term_days=30)
    db.add(s3)
    db.commit()
    db.refresh(s3)
    db.add(models_mod.Invoice(supplier_id=s3.id, number='I3', date=today, amount=700.0,
                              manual_due_date=today + dt.timedelta(days=2)))
    db.commit()

    result = cashflow_service.cashflow(db, weeks=2, today=today, project='مشروع فارغ')
    assert result['summary']['hasReceivables'] is False
    assert any('التحصيلات' in w for w in result['warnings'])

    # meanwhile the company-wide view still has usable receivables.
    company_wide = cashflow_service.cashflow(db, weeks=2, today=today)
    assert company_wide['summary']['hasReceivables'] is True
    assert company_wide['warnings'] == []


# ---------------------------------------------------------------- parties (suppliers/contractors/both)

@pytest.fixture()
def contractor_cashflow_db(tmp_path, monkeypatch):
    """مورد واحد بفاتورة (خارج مؤرَّخ)، ومقاولان: أحدهما بضمان داخل الأفق ورصيد سالب
    أكبر من الضمان (فيبقى جزء غير مؤرَّخ)، والآخر برصيد موجب لا يظهر في المستحق."""
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
    today = dt.date(2026, 8, 8)

    supplier = models_mod.Supplier(account='S1', name='مورد S1', project='مشروع أ',
                                   term_raw='30 يوم', term_kind='net', term_days=30)
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    db.add(models_mod.Invoice(supplier_id=supplier.id, number='I1', date=today, amount=1000.0,
                              manual_due_date=today + dt.timedelta(days=2)))

    c1 = models_mod.Contractor(code='C1', name='مقاول واحد')
    c2 = models_mod.Contractor(code='C2', name='مقاول اثنان')
    db.add(c1); db.add(c2)
    db.commit()
    db.refresh(c1); db.refresh(c2)

    # C1: claims (credit) 5000 > payments (debit) 1000 -> balance = -4000 (we owe him)
    db.add(models_mod.ContractorEntry(contractor_id=c1.id, date=today, debit=1000.0, credit=5000.0,
                                      description='مستخلص رقم1', project='مشروع أ'))
    # C2: paid more than claimed -> positive balance, not owed anything
    db.add(models_mod.ContractorEntry(contractor_id=c2.id, date=today, debit=800.0, credit=200.0,
                                      description='دفعة', project='مشروع ب'))
    db.commit()

    # C1 guarantee for 1500, unreleased, release_due inside the 2-week horizon
    db.add(models_mod.ContractorGuarantee(contractor_id=c1.id, project='مشروع أ', amount=1500.0,
                                          release_due=today + dt.timedelta(days=3)))
    db.commit()

    yield db, cashflow_service_mod, today
    db.close()


def test_parties_default_and_suppliers_are_identical_to_baseline(contractor_cashflow_db):
    """parties omitted == parties='suppliers' == pre-change numbers (no regression)."""
    db, cashflow_service, today = contractor_cashflow_db
    omitted = cashflow_service.cashflow(db, weeks=2, today=today)
    explicit = cashflow_service.cashflow(db, weeks=2, today=today, parties='suppliers')
    assert omitted['summary']['totalOutflow'] == explicit['summary']['totalOutflow'] == 1000.0
    assert omitted.get('undatedContractorDues', 0.0) == 0.0
    assert 'undatedContractorDues' in omitted


def test_parties_contractors_only_buckets_dated_guarantee_and_reports_undated(contractor_cashflow_db):
    db, cashflow_service, today = contractor_cashflow_db
    result = cashflow_service.cashflow(db, weeks=2, today=today, parties='contractors')
    # only the guarantee (1500) counts as outflow — no supplier invoice included
    assert result['summary']['totalOutflow'] == 1500.0
    # C1 negative balance is 4000; 1500 of it is already scheduled via the guarantee
    assert result['undatedContractorDues'] == 2500.0


def test_parties_both_includes_supplier_and_contractor_outflow(contractor_cashflow_db):
    db, cashflow_service, today = contractor_cashflow_db
    result = cashflow_service.cashflow(db, weeks=2, today=today, parties='both')
    assert result['summary']['totalOutflow'] == 1000.0 + 1500.0
    assert result['undatedContractorDues'] == 2500.0
    # exact Decimal bucket math: both items fall in the first 14-day period
    p0 = result['periods'][0]
    assert p0['outflow'] == 2500.0


def test_parties_project_filter_scopes_contractor_attribution(contractor_cashflow_db):
    db, cashflow_service, today = contractor_cashflow_db
    # C2 belongs to 'مشروع ب' only and has no negative balance / guarantee, so
    # filtering to 'مشروع أ' must include only C1's guarantee and undated dues.
    result = cashflow_service.cashflow(db, weeks=2, today=today, parties='contractors',
                                       project='مشروع أ')
    assert result['summary']['totalOutflow'] == 1500.0
    assert result['undatedContractorDues'] == 2500.0

    other = cashflow_service.cashflow(db, weeks=2, today=today, parties='contractors',
                                      project='مشروع ب')
    assert other['summary']['totalOutflow'] == 0.0
    assert other['undatedContractorDues'] == 0.0
