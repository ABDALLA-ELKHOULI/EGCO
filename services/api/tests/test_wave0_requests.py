# -*- coding: utf-8 -*-
"""طلبات أقسام الواجهة (الموجة ٠): التدفق، التحصيلات، المقاولون."""
import datetime as dt

B = '/api/v1'


def test_cashflow_ids_inflow_and_bank_opening(api_client):
    c = api_client
    c.post(B + '/suppliers', json=dict(account='2110001', name='م', project='س', term='كاش'))
    c.post(B + '/manual/invoices', json=dict(account='2110001', date='2020-01-01', amount=100, number='F'))
    old = (dt.date.today() - dt.timedelta(days=5)).isoformat()
    r = c.post(B + '/revenues', json=dict(client='عميل', amount=50, due_date=old))
    assert r.status_code == 201 and r.json()['approval'] == 'approved'
    cf = c.get(B + '/cashflow').json()
    assert cf['openingBalanceSource'] == 'none' and cf['openingBalance'] == 0.0
    c.put(B + '/settings/bank-balance', json={'balance': '1000'})
    cf = c.get(B + '/cashflow').json()
    assert cf['openingBalanceSource'] == 'bank' and cf['openingBalance'] == 1000.0
    assert c.get(B + '/cashflow?opening_balance=7').json()['openingBalanceSource'] == 'query'
    out = c.get(B + '/cashflow/breakdown?term=overdue').json()
    assert out['side'] == 'outflow' and out['rows'][0]['id'].startswith('inv:')
    inn = c.get(B + '/cashflow/breakdown?term=overdue&side=inflow').json()
    assert inn['rows'][0]['id'].startswith('rec:') and inn['total'] == 50.0
    assert inn['total'] == cf['reconciliation']['inflow']['overdueNow']


def test_revenue_totals_and_approval(api_client):
    c = api_client
    today = dt.date.today()
    c.post(B + '/revenues', json=dict(client='أ', amount=10, due_date=(today + dt.timedelta(days=3)).isoformat()))
    r = c.post(B + '/revenues', json=dict(client='ب', amount=20, collected_on=today.isoformat(),
                                         approval='pending'))
    assert r.json()['approval'] == 'pending'
    assert c.post(B + '/revenues', json=dict(client='ج', amount=1, approval='x')).status_code == 422
    t = c.get(B + '/revenues').json()['totals']
    assert t['in30'] == 10.0 and t['collectedThisMonth'] == 20.0 and t['overdueCount'] == 0
    rid = r.json()['id']
    assert c.put(f'{B}/revenues/{rid}', json={'approval': 'approved'}).json()['approval'] == 'approved'


def test_contractor_status_and_bulk_term(api_client):
    c = api_client
    c.post(B + '/contractors', json=dict(code='2120001', name='أ'))
    c.post(B + '/contractors', json=dict(code='2120002', name='ب', paymentTermDays=15))
    d = c.get(B + '/contractors/2120001').json()
    assert d['status'] == 'active' and d['statusNote'] == ''
    r = c.post(B + '/contractors/bulk-term', json={'termDays': 30})
    assert r.json()['updated'] == 1
    assert c.get(B + '/contractors/2120002').json()['paymentTermDays'] == 15
    assert c.get(B + '/contractors/2120001').json()['paymentTermDays'] == 30
    r = c.post(B + '/contractors/bulk-term', json={'termDays': 45, 'onlyWithoutTerm': False})
    assert r.json()['updated'] == 2
    assert c.post(B + '/contractors/bulk-term', json={'termDays': -1}).status_code == 422
