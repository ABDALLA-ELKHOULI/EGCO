# -*- coding: utf-8 -*-
"""معادلة التقرير يجب أن تتوازن — opening + invoiced_in_period − paid_in_period ==
net_outstanding، بالضبط، حتى عندما يوجد مورد دفعنا له أكثر من فواتيره (رصيد لنا).

قبل هذا الإصلاح: summary.outstanding يجمع فقط outstanding الموجب لكل مورد (position()
يُصفّر الفائض إلى credit_balance)، بينما افتتاحي+حركة الفترة يصافي الفائض ضمنياً — رقمان
لا يتصالحان على نفس الوثيقة. الإصلاح: summary.credit_balances + summary.net_outstanding،
والهوية أعلاه يجب أن تتحقق تماماً.
"""
from decimal import Decimal

BASE = '/api/v1/reports'
D = lambda v: Decimal(str(v))


def _identity_holds(payload) -> None:
    m = payload['meta']
    s = payload['summary']
    lhs = D(m['opening_balance']) + D(m['invoiced_in_period']) - D(m['paid_in_period'])
    assert lhs == D(s['net_outstanding']), (lhs, s['net_outstanding'], m, s)
    assert D(s['net_outstanding']) == D(s['outstanding']) - D(s['credit_balances'])


def seed_supplier(client, account, term='30 يوم', project='السدن'):
    r = client.post('/api/v1/suppliers', json={
        'account': account, 'name': f'مورد {account}', 'project': project, 'term': term})
    assert r.status_code in (200, 201), r.text


def _invoice(client, account, date, amount, number):
    r = client.post('/api/v1/manual/invoices', json={
        'account': account, 'date': date, 'amount': amount, 'number': number})
    assert r.status_code in (200, 201), r.text


def _payment(client, account, date, amount):
    r = client.post('/api/v1/manual/payments', json={
        'account': account, 'date': date, 'amount': amount})
    assert r.status_code in (200, 201), r.text


def _seed(client):
    # normal supplier: invoiced 1000, paid 400 → outstanding 600, no credit balance
    seed_supplier(client, '9001')
    _invoice(client, '9001', '2026-01-10', 1000, 'F1')
    _payment(client, '9001', '2026-02-10', 400)

    # overpaid supplier: invoiced 800, paid 1300 → outstanding 0, credit_balance 500
    seed_supplier(client, '2110919', project='مشروع آخر')
    _invoice(client, '2110919', '2026-01-05', 800, 'F2')
    _payment(client, '2110919', '2026-01-20', 1300)


DATE_FROM = '2026-01-01'
DATE_TO = '2026-08-13'


def test_identity_holds_company_scope(api_client):
    _seed(api_client)
    p = api_client.get(f'{BASE}/analysis?date_from={DATE_FROM}&date_to={DATE_TO}').json()
    s = p['summary']
    assert D(s['credit_balances']) == D('500')
    assert D(s['outstanding']) == D('600')
    assert D(s['net_outstanding']) == D('100')
    _identity_holds(p)


def test_identity_holds_single_supplier_scope_normal(api_client):
    _seed(api_client)
    p = api_client.get(
        f'{BASE}/analysis?account=9001&date_from={DATE_FROM}&date_to={DATE_TO}').json()
    assert D(p['summary']['credit_balances']) == D('0')
    _identity_holds(p)


def test_identity_holds_single_supplier_scope_overpaid(api_client):
    """The exact case that broke: a single overpaid supplier's own report."""
    _seed(api_client)
    p = api_client.get(
        f'{BASE}/analysis?account=2110919&date_from={DATE_FROM}&date_to={DATE_TO}').json()
    s = p['summary']
    assert D(s['outstanding']) == D('0')
    assert D(s['credit_balances']) == D('500')
    assert D(s['net_outstanding']) == D('-500')
    _identity_holds(p)


def test_identity_holds_project_scope(api_client):
    _seed(api_client)
    p = api_client.get(
        f'{BASE}/analysis?project=السدن&date_from={DATE_FROM}&date_to={DATE_TO}').json()
    assert D(p['summary']['credit_balances']) == D('0')
    _identity_holds(p)


def test_identity_holds_scope_with_overpaid_supplier_mixed_in(api_client):
    """Company-wide scope containing the overpaid supplier alongside a normal one —
    this is exactly the live-reported bug (بيت الاباء style credit netted into the
    period math but excluded from summary.outstanding)."""
    _seed(api_client)
    p = api_client.get(f'{BASE}/analysis?date_from={DATE_FROM}&date_to={DATE_TO}').json()
    _identity_holds(p)


def test_no_period_given_identity_still_holds(api_client):
    """Without date_from/date_to the report falls back to all-time totals — the
    identity (0 + total_invoiced − total_paid == net_outstanding) must still hold."""
    _seed(api_client)
    p = api_client.get(f'{BASE}/analysis').json()
    _identity_holds(p)
