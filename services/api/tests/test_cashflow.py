# -*- coding: utf-8 -*-
"""اختبارات التدفق النقدي — حسابات يدوية على بيانات صناعية."""
import datetime as dt
from decimal import Decimal

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
