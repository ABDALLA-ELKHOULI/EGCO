# -*- coding: utf-8 -*-
"""اختبارات التحليل الدوري."""
import datetime as dt
from decimal import Decimal

from app.domain import periods as PD
from app.domain.payables import Invoice, Payment


def test_quarter_labels_use_arabic_ordinals_and_indic_digits():
    defs = PD.periods_for('quarter', 2026)
    assert [d['label'] for d in defs] == [
        'الربع الأول ٢٠٢٦', 'الربع الثاني ٢٠٢٦', 'الربع الثالث ٢٠٢٦', 'الربع الرابع ٢٠٢٦']
    assert defs[0]['from_'] == dt.date(2026, 1, 1)
    assert defs[0]['to'] == dt.date(2026, 3, 31)
    assert defs[3]['to'] == dt.date(2026, 12, 31)


def test_half_and_year_labels():
    halves = PD.periods_for('half', 2026)
    assert [h['label'] for h in halves] == ['النصف الأول ٢٠٢٦', 'النصف الثاني ٢٠٢٦']
    year = PD.periods_for('year', 2026)
    assert year[0]['label'] == '٢٠٢٦'
    assert year[0]['from_'] == dt.date(2026, 1, 1)
    assert year[0]['to'] == dt.date(2026, 12, 31)


def test_opening_balance_identity_on_synthetic_data():
    """closing = opening + invoiced - paid must hold exactly."""
    invoices = [
        Invoice(date=dt.date(2025, 12, 1), amount=1000),   # before the window
        Invoice(date=dt.date(2026, 2, 1), amount=500),     # inside the window
    ]
    payments = [
        Payment(date=dt.date(2025, 12, 15), amount=200),   # before the window
        Payment(date=dt.date(2026, 2, 10), amount=300),    # inside the window
    ]
    t = PD.period_totals(invoices, payments, dt.date(2026, 1, 1), dt.date(2026, 3, 31))
    assert t['opening'] == Decimal('800')            # 1000 - 200
    assert t['invoiced'] == Decimal('500')
    assert t['paid'] == Decimal('300')
    assert t['closing'] == t['opening'] + t['invoiced'] - t['paid']
    assert t['closing'] == Decimal('1000')


def test_avg_settlement_days_fifo_weighted():
    """Hand-computed: two invoices, one payment that spans both — the average is
    weighted by how much of the payment settled each invoice."""
    invoices = [
        Invoice(date=dt.date(2026, 1, 1), amount=100, number='A'),
        Invoice(date=dt.date(2026, 1, 11), amount=100, number='B'),
    ]
    payments = [Payment(date=dt.date(2026, 1, 31), amount=150)]

    allocs = PD.allocate_payments_fifo(invoices, payments)
    # 100 to invoice A (30 days), 50 to invoice B (20 days)
    assert len(allocs) == 2
    by_amount = sorted(allocs, key=lambda a: a.amount)
    assert by_amount[0].amount == Decimal('50')
    assert by_amount[1].amount == Decimal('100')

    avg = PD.avg_settlement_days(allocs, dt.date(2026, 1, 1), dt.date(2026, 1, 31))
    # weighted: (100*30 + 50*20) / 150 = (3000 + 1000) / 150 = 26.666...
    assert round(avg, 3) == round((100 * 30 + 50 * 20) / 150, 3)


def test_avg_settlement_days_none_when_no_allocations_in_period():
    invoices = [Invoice(date=dt.date(2026, 1, 1), amount=100)]
    payments = [Payment(date=dt.date(2026, 1, 15), amount=100)]
    allocs = PD.allocate_payments_fifo(invoices, payments)
    avg = PD.avg_settlement_days(allocs, dt.date(2026, 6, 1), dt.date(2026, 6, 30))
    assert avg is None


def test_periodic_endpoint_quarter_aggregation(api_client):
    r = api_client.post('/api/v1/suppliers', json={
        'account': '888', 'name': 'مورد التحليل الدوري', 'project': 'مشروع أ', 'term': '30 يوم'})
    assert r.status_code == 201

    api_client.post('/api/v1/manual/invoices', json={
        'account': '888', 'amount': 1000, 'date': '2026-01-10'})
    api_client.post('/api/v1/manual/payments', json={
        'account': '888', 'amount': 400, 'date': '2026-02-10'})

    r = api_client.get('/api/v1/reports/periodic', params={'granularity': 'quarter', 'year': 2026})
    assert r.status_code == 200
    body = r.json()
    assert body['granularity'] == 'quarter'
    q1 = body['periods'][0]
    assert q1['label'] == 'الربع الأول ٢٠٢٦'
    assert q1['invoiced'] == 1000.0
    assert q1['paid'] == 400.0
    assert q1['closing'] == q1['opening'] + q1['invoiced'] - q1['paid']
    assert q1['byProject'] == [{'project': 'مشروع أ', 'paid': 400.0}]
    assert q1['topSuppliers'][0]['account'] == '888'
