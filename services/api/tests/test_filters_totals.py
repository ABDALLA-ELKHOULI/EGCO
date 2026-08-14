# -*- coding: utf-8 -*-
"""اختبارات الفلاتر والإجماليات — v0.5.4.

For each richly-filterable list endpoint: filtered totals must equal an independent
Decimal recomputation over the same filtered rows, combining filters must narrow
correctly, an empty result must return zeroed totals (never 500), invalid params must
422 with an Arabic detail, and the no-params response must keep its pre-existing keys
and values (additive-only backward compatibility).
"""
from decimal import Decimal

# ---------------------------------------------------------------- suppliers

def _make_supplier(api_client, account, name='مورد', project='م', term='30 يوم'):
    r = api_client.post('/api/v1/suppliers', json={
        'account': account, 'name': name, 'project': project, 'term': term})
    assert r.status_code == 201, r.text


def _inv(api_client, account, amount, date, description=''):
    r = api_client.post('/api/v1/manual/invoices', json={
        'account': account, 'amount': amount, 'date': date, 'description': description})
    assert r.status_code == 201, r.text


def _pay(api_client, account, amount, date):
    r = api_client.post('/api/v1/manual/payments', json={
        'account': account, 'amount': amount, 'date': date})
    assert r.status_code == 201, r.text


def _setup_suppliers(api_client):
    _make_supplier(api_client, '901', name='مورد أ', project='مشروع1')
    _inv(api_client, '901', 1000, '2026-01-01')
    _pay(api_client, '901', 400, '2026-01-15')

    _make_supplier(api_client, '902', name='مورد ب', project='مشروع2')
    _inv(api_client, '902', 500, '2020-01-01')   # overdue (term 30 يوم, long past)

    _make_supplier(api_client, '903', name='مورد ج', project='مشروع1')
    # no movement at all


def test_suppliers_no_params_keeps_existing_keys(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/suppliers')
    assert r.status_code == 200
    d = r.json()
    for k in ('count', 'rows', 'projects', 'totals'):
        assert k in d
    for k in ('outstanding', 'overdue'):
        assert k in d['totals']


def test_suppliers_filtered_totals_match_independent_recomputation(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/suppliers', params={'project': 'مشروع1'})
    assert r.status_code == 200
    d = r.json()
    rows = d['rows']
    assert all(row['project'] == 'مشروع1' for row in rows)

    expected_outstanding = sum(Decimal(str(row['outstanding'])) for row in rows)
    expected_invoiced = sum(Decimal(str(row['totalInvoiced'])) for row in rows)
    expected_paid = sum(Decimal(str(row['totalPaid'])) for row in rows)
    assert Decimal(str(d['totals']['outstanding'])) == expected_outstanding
    assert Decimal(str(d['totals']['invoiced'])) == expected_invoiced
    assert Decimal(str(d['totals']['paid'])) == expected_paid
    assert d['totals']['count'] == len(rows)
    assert d['filtersApplied']['project'] == 'مشروع1'


def test_suppliers_combining_filters_narrows(api_client):
    _setup_suppliers(api_client)
    r_all = api_client.get('/api/v1/suppliers', params={'project': 'مشروع1'})
    r_narrow = api_client.get('/api/v1/suppliers',
                              params={'project': 'مشروع1', 'has_data': True})
    assert r_narrow.status_code == 200
    assert len(r_narrow.json()['rows']) <= len(r_all.json()['rows'])
    assert all(row['invoiceCount'] > 0 or row['lastPayment'] is not None
              for row in r_narrow.json()['rows'])


def test_suppliers_overdue_only_filter(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/suppliers', params={'overdue_only': True})
    assert r.status_code == 200
    d = r.json()
    assert all(row['overdue'] > 0 for row in d['rows'])
    assert d['totals']['count'] == len(d['rows'])


def test_suppliers_empty_result_zero_totals(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/suppliers', params={'q': 'لا يوجد مورد بهذا الاسم'})
    assert r.status_code == 200
    d = r.json()
    assert d['rows'] == []
    assert d['totals']['outstanding'] == 0
    assert d['totals']['overdue'] == 0
    assert d['totals']['count'] == 0


def test_suppliers_invalid_date_422_arabic(api_client):
    r = api_client.get('/api/v1/suppliers', params={'date_from': 'not-a-date'})
    assert r.status_code == 422
    assert 'تاريخ' in r.json()['detail']


def test_suppliers_min_gt_max_422(api_client):
    r = api_client.get('/api/v1/suppliers',
                       params={'min_outstanding': 100, 'max_outstanding': 10})
    assert r.status_code == 422


def test_suppliers_invalid_status_422(api_client):
    r = api_client.get('/api/v1/suppliers', params={'status': 'not_a_status'})
    assert r.status_code == 422


def test_suppliers_date_window_gives_opening_closing(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/suppliers',
                       params={'date_from': '2026-01-01', 'date_to': '2026-01-31'})
    assert r.status_code == 200
    d = r.json()
    t = d['totals']
    for k in ('openingBalance', 'invoicedInPeriod', 'paidInPeriod', 'closingBalance'):
        assert k in t
    assert Decimal(str(t['closingBalance'])) == (
        Decimal(str(t['openingBalance'])) + Decimal(str(t['invoicedInPeriod'])) -
        Decimal(str(t['paidInPeriod'])))


# ---------------------------------------------------------------- contractors

def _make_contractor(api_client, code, name='مقاول'):
    r = api_client.post('/api/v1/contractors', json={'code': code, 'name': name})
    assert r.status_code == 201, r.text


def _entry(api_client, code, debit=0, credit=0, date='2026-01-01', kind=None, project=None):
    body = {'date': date, 'debit': debit, 'credit': credit, 'description': 'حركة'}
    if kind:
        body['kind'] = kind
    if project:
        body['project'] = project
    r = api_client.post(f'/api/v1/contractors/{code}/entries', json=body)
    assert r.status_code == 201, r.text


def _setup_contractors(api_client):
    _make_contractor(api_client, 'C1', name='مقاول أول')
    _entry(api_client, 'C1', credit=1000, kind='claim', project='مشروعA')  # balance -1000
    _make_contractor(api_client, 'C2', name='مقاول ثاني')
    _entry(api_client, 'C2', debit=500, kind='payment', project='مشروعB')   # balance +500
    _make_contractor(api_client, 'C3', name='مقاول ثالث')  # no entries -> balanced


def test_contractors_no_params_keeps_existing_keys(api_client):
    _setup_contractors(api_client)
    r = api_client.get('/api/v1/contractors')
    assert r.status_code == 200
    d = r.json()
    for k in ('count', 'rows', 'totals'):
        assert k in d
    for k in ('owedToContractors', 'owedToUs', 'retentionHeld'):
        assert k in d['totals']


def test_contractors_direction_filter_matches_recomputation(api_client):
    _setup_contractors(api_client)
    r = api_client.get('/api/v1/contractors', params={'direction': 'owed_to_them'})
    assert r.status_code == 200
    d = r.json()
    assert all(row['balance'] < 0 for row in d['rows'])
    expected_balance = sum(Decimal(str(row['balance'])) for row in d['rows'])
    assert Decimal(str(d['totals']['balance'])) == expected_balance
    assert d['totals']['count'] == len(d['rows'])


def test_contractors_combining_q_and_project_narrows(api_client):
    _setup_contractors(api_client)
    r_project = api_client.get('/api/v1/contractors', params={'project': 'مشروعA'})
    r_narrow = api_client.get('/api/v1/contractors',
                              params={'project': 'مشروعA', 'q': 'مقاول أول'})
    assert len(r_narrow.json()['rows']) <= len(r_project.json()['rows'])


def test_contractors_empty_result_zero_totals(api_client):
    _setup_contractors(api_client)
    r = api_client.get('/api/v1/contractors', params={'q': 'لا يوجد بهذا الاسم'})
    assert r.status_code == 200
    d = r.json()
    assert d['rows'] == []
    assert d['totals']['balance'] == 0
    assert d['totals']['count'] == 0


def test_contractors_invalid_direction_422(api_client):
    r = api_client.get('/api/v1/contractors', params={'direction': 'sideways'})
    assert r.status_code == 422
    assert 'اتجاه' in r.json()['detail'] or 'صالح' in r.json()['detail']


# ---------------------------------------------------------------- projects

def test_projects_no_params_keeps_existing_keys(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/projects')
    assert r.status_code == 200
    d = r.json()
    for k in ('asOf', 'totals', 'rows'):
        assert k in d
    for k in ('outstanding', 'overdue', 'dueWithin7', 'supplierCount'):
        assert k in d['totals']


def test_projects_q_filter_and_totals_match(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/projects', params={'q': 'مشروع1'})
    assert r.status_code == 200
    d = r.json()
    assert all('مشروع1' in row['project'] for row in d['rows'])
    expected = sum(Decimal(str(row['outstanding'])) for row in d['rows'])
    assert Decimal(str(d['totals']['outstanding'])) == expected


def test_projects_empty_result_zero_totals(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/projects', params={'q': 'مشروع_غير_موجود'})
    assert r.status_code == 200
    d = r.json()
    assert d['rows'] == []
    assert d['totals']['outstanding'] == 0
    assert d['totals']['count'] == 0


def test_projects_invalid_date_422(api_client):
    r = api_client.get('/api/v1/projects', params={'date_from': 'xx'})
    assert r.status_code == 422


# ---------------------------------------------------------------- revenues

def _revenue(api_client, project, amount, due_date=None, collected_on=None, status=None):
    body = {'project': project, 'amount': amount, 'client': 'عميل', 'unit': 'وحدة'}
    if due_date:
        body['due_date'] = due_date
    if collected_on:
        body['collected_on'] = collected_on
    if status:
        body['status'] = status
    r = api_client.post('/api/v1/revenues', json=body)
    assert r.status_code == 201, r.text


def _setup_revenues(api_client):
    _revenue(api_client, 'مشروعR', 1000, due_date='2026-02-01')                  # open
    _revenue(api_client, 'مشروعR', 2000, collected_on='2026-01-10')              # collected
    _revenue(api_client, 'مشروعR', 500, due_date='2020-01-01')                   # overdue open


def test_revenues_no_params_keeps_existing_keys(api_client):
    _setup_revenues(api_client)
    r = api_client.get('/api/v1/revenues')
    assert r.status_code == 200
    d = r.json()
    for k in ('count', 'rows', 'totals', 'projects', 'clients'):
        assert k in d
    for k in ('open', 'collected', 'all'):
        assert k in d['totals']


def test_revenues_amount_filter_totals_match(api_client):
    _setup_revenues(api_client)
    r = api_client.get('/api/v1/revenues', params={'min_amount': 900})
    assert r.status_code == 200
    d = r.json()
    assert all(row['amount'] >= 900 for row in d['rows'])
    expected_all = sum(Decimal(str(row['amount'])) for row in d['rows'])
    assert Decimal(str(d['totals']['all'])) == expected_all


def test_revenues_overdue_open_total(api_client):
    _setup_revenues(api_client)
    r = api_client.get('/api/v1/revenues')
    d = r.json()
    assert d['totals']['overdueOpen'] == 1500.0


def test_revenues_empty_result_zero_totals(api_client):
    _setup_revenues(api_client)
    r = api_client.get('/api/v1/revenues', params={'min_amount': 999999})
    assert r.status_code == 200
    d = r.json()
    assert d['rows'] == []
    assert d['totals']['all'] == 0
    assert d['totals']['count'] == 0


def test_revenues_invalid_date_field_422(api_client):
    r = api_client.get('/api/v1/revenues', params={'date_field': 'bogus'})
    assert r.status_code == 422


def test_revenues_min_gt_max_422(api_client):
    r = api_client.get('/api/v1/revenues', params={'min_amount': 100, 'max_amount': 10})
    assert r.status_code == 422


# ---------------------------------------------------------------- coverage

def test_coverage_no_params_keeps_existing_keys(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/coverage')
    assert r.status_code == 200
    d = r.json()
    for k in ('totals', 'asOf', 'staleDays', 'rows'):
        assert k in d


def test_coverage_state_filter_narrows(api_client):
    _setup_suppliers(api_client)
    r = api_client.get('/api/v1/coverage', params={'state': 'none'})
    assert r.status_code == 200
    d = r.json()
    assert all(row['state'] == 'none' for row in d['rows'])


def test_coverage_invalid_state_422(api_client):
    r = api_client.get('/api/v1/coverage', params={'state': 'unknown_state'})
    assert r.status_code == 422


def test_coverage_empty_result_no_500(api_client):
    r = api_client.get('/api/v1/coverage', params={'q': 'غير موجود إطلاقاً'})
    assert r.status_code == 200
    d = r.json()
    assert d['rows'] == []
    assert d['totals']['suppliers'] == 0
