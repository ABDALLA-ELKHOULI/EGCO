# -*- coding: utf-8 -*-
"""ثوابت بيانات من docs/next/PARITY.md لم يكن لها اختبار صريح — انظر PARITY-backend.md."""
from decimal import Decimal

B = '/api/v1'


def _d(x):
    return Decimal(str(x))


def test_p583_outstanding_is_invoiced_minus_paid_fifo(api_client):
    c = api_client
    c.post(B + '/suppliers', json=dict(account='2110001', name='أ', term='30 يوم'))
    c.post(B + '/suppliers', json=dict(account='2110002', name='ب', term='30 يوم'))
    for n, amt in (('F1', 100.10), ('F2', 200.20)):
        c.post(B + '/manual/invoices', json=dict(account='2110001', date='2026-01-01', amount=amt, number=n))
    c.post(B + '/manual/payments', json=dict(account='2110001', date='2026-02-01', amount=150.15))
    # مورد مدفوع له أكثر من فواتيره — رصيده الدائن خارج «المديونية المفتوحة»
    c.post(B + '/manual/invoices', json=dict(account='2110002', date='2026-01-01', amount=10, number='X'))
    c.post(B + '/manual/payments', json=dict(account='2110002', date='2026-01-02', amount=15))
    d = c.get(B + '/suppliers/2110001').json()
    assert _d(d['outstanding']) == _d(d['totalInvoiced']) - _d(d['totalPaid']) == Decimal('150.15')
    assert sum(_d(i['remaining']) for i in d['invoices']) == Decimal('150.15')
    assert d['invoices'][0]['remaining'] == 0.0          # FIFO: الأقدم سُدّد أولاً
    assert c.get(B + '/suppliers/2110002').json()['outstanding'] == 0.0
    t = c.get(B + '/suppliers').json()['totals']
    assert _d(t['outstanding']) == Decimal('150.15')


def test_p590_contractor_balance_sign_and_owed(api_client):
    c = api_client
    c.post(B + '/contractors', json=dict(code='2120001', name='له'))
    c.post(B + '/contractors', json=dict(code='2120002', name='لنا'))
    c.post(B + '/contractors/2120001/entries', json=dict(date='2026-01-01', credit=1000, description='مستخلص رقم 1'))
    c.post(B + '/contractors/2120001/entries', json=dict(date='2026-01-05', debit=300, description='دفعة'))
    c.post(B + '/contractors/2120002/entries', json=dict(date='2026-01-05', debit=50, description='دفعة'))
    rows = {r['code']: r for r in c.get(B + '/contractors').json()['rows']}
    assert rows['2120001']['balance'] == -700.0          # سالب = نحن مدينون له
    assert rows['2120002']['balance'] == 50.0            # موجب = يدين لنا
    t = c.get(B + '/contractors').json()['totals']
    assert t['owedToContractors'] == 700.0 and t['owedToUs'] == 50.0


def test_p599_revenues_total_is_open_plus_collected_and_undated_not_forecast(api_client):
    c = api_client
    c.post(B + '/revenues', json=dict(client='أ', amount=10.5))                       # بلا تاريخ
    c.post(B + '/revenues', json=dict(client='ب', amount=20.25, collected_on='2026-01-01'))
    t = c.get(B + '/revenues').json()['totals']
    assert _d(t['all']) == _d(t['open']) + _d(t['collected'])
    cf = c.get(B + '/cashflow').json()
    assert cf['summary']['totalInflow'] == 0.0           # غير المؤرخ لا يدخل التوقع
    assert cf['reconciliation']['inflow']['undated'] == 10.5
