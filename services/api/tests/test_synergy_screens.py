# -*- coding: utf-8 -*-
"""اختبارات اتساق الأرقام بين الشاشات — cross-screen synergy guards.

Every number the app shows on two or more screens for the same account/date-window
must be numerically identical, not just "close enough after rounding". These tests
seed data specifically chosen to expose float-summation drift (many rows whose
2-decimal amounts don't sum exactly in binary floating point) and assert that every
endpoint touching the same figures agrees to the cent/piaster.
"""
from decimal import Decimal

SUPPLIERS = '/api/v1/suppliers'
PROJECTS = '/api/v1/projects'
CONTRACTORS = '/api/v1/contractors'
REPORTS = '/api/v1/reports'
OVERVIEW = '/api/v1/overview'
DASHBOARD = '/api/v1/dashboard'
COVERAGE = '/api/v1/coverage'
REVENUES = '/api/v1/revenues'


def _mk_supplier(client, account, project, term='30 يوم', name=None):
    r = client.post(SUPPLIERS, json={
        'account': account, 'name': name or f'مورد {account}', 'project': project,
        'term': term})
    assert r.status_code in (200, 201), r.text


def _mk_invoice(client, account, date, amount, number=None):
    r = client.post('/api/v1/manual/invoices', json={
        'account': account, 'date': date, 'amount': amount, 'number': number})
    assert r.status_code in (200, 201), r.text


def _mk_payment(client, account, date, amount):
    r = client.post('/api/v1/manual/payments', json={
        'account': account, 'date': date, 'amount': amount})
    assert r.status_code in (200, 201), r.text


# amounts deliberately chosen (verified empirically) so their naive float sum in
# IEEE-754 binary floating point does NOT equal the exact decimal sum — the same class
# of drift that showed up in production (Σ of already-rounded floats = 5611014.100000001
# instead of 5611014.1). Only Decimal-all-the-way-through arithmetic reproduces the
# exact total; a `sum()` over the rounded per-row floats does not.
DRIFT_AMOUNTS = [6394.63, 251.08, 2751.02, 2232.88, 7364.98, 6767.32, 8921.90, 870.30,
                 4219.80, 298.94, 2187.16, 5054.05, 266.33, 1989.18, 6499.19, 5449.87]


def _seed_drifty_suppliers(client, today='2026-08-14'):
    """Two projects, each with several suppliers carrying overdue invoices whose
    amounts are individually rounded (money() at 2dp) but whose sum is prone to
    float-summation drift if any endpoint sums the rounded floats instead of the
    underlying Decimals."""
    accounts = []
    for idx, amt in enumerate(DRIFT_AMOUNTS):
        account = f'S{idx:03d}'
        project = 'مشروع أ' if idx % 2 == 0 else 'مشروع ب'
        _mk_supplier(client, account, project, term='كاش')
        _mk_invoice(client, account, '2026-01-01', amt, number=f'F{idx}')
        accounts.append(account)
    return accounts


def _seed_drifty_contractors(client):
    codes = []
    for idx, amt in enumerate(DRIFT_AMOUNTS[:8]):
        code = f'C{idx:03d}'
        client.post(CONTRACTORS, json={'code': code, 'name': f'مقاول {code}'})
        client.post(f'{CONTRACTORS}/{code}/entries', json={
            'date': '2026-01-01', 'credit': amt, 'description': 'مستخلص'})
        codes.append(code)
    return codes


def _seed_drifty_revenues(client):
    for idx, amt in enumerate(DRIFT_AMOUNTS[:6]):
        r = client.post(REVENUES, json={
            'project': 'مشروع أ', 'client': f'عميل {idx}', 'amount': amt,
            'dueDate': '2026-08-01'})
        assert r.status_code == 201, r.text


# ---------------------------------------------------------------- suppliers totals

def test_suppliers_totals_match_exact_decimal_sum_not_float_drift(api_client):
    _seed_drifty_suppliers(api_client)
    d = api_client.get(SUPPLIERS).json()

    exact = sum((Decimal(str(a)) for a in DRIFT_AMOUNTS), Decimal('0'))
    assert Decimal(str(d['totals']['outstanding'])) == exact
    assert Decimal(str(d['totals']['overdue'])) == exact

    # also matches the pure Python float re-sum used before the fix would have
    # produced a different (drifted) number — assert equality with a fresh Decimal
    # recompute rather than the historical float sum.
    row_sum = sum((Decimal(str(r['outstanding'])) for r in d['rows']), Decimal('0'))
    assert Decimal(str(d['totals']['outstanding'])) == row_sum


def test_suppliers_totals_match_dashboard_and_overview_for_same_window(api_client):
    _seed_drifty_suppliers(api_client)

    sup_totals = api_client.get(SUPPLIERS).json()['totals']
    dash = api_client.get(DASHBOARD).json()['summary']
    overview = api_client.get(OVERVIEW).json()['payables']

    assert sup_totals['outstanding'] == dash['outstanding'] == overview['outstanding']
    assert sup_totals['overdue'] == dash['overdue'] == overview['overdue']


# ---------------------------------------------------------------- projects totals

def test_projects_totals_match_exact_decimal_sum_not_float_drift(api_client):
    _seed_drifty_suppliers(api_client)
    d = api_client.get(PROJECTS).json()

    exact = sum((Decimal(str(a)) for a in DRIFT_AMOUNTS), Decimal('0'))
    assert Decimal(str(d['totals']['outstanding'])) == exact

    row_sum = sum((Decimal(str(r['outstanding'])) for r in d['rows']), Decimal('0'))
    assert Decimal(str(d['totals']['outstanding'])) == row_sum


def test_project_totals_match_supplier_filter_and_detail_and_overview_top_projects(api_client):
    _seed_drifty_suppliers(api_client)

    projects_list = api_client.get(PROJECTS).json()['rows']
    by_name = {r['project']: r for r in projects_list}

    for project in ('مشروع أ', 'مشروع ب'):
        list_row = by_name[project]
        filtered = api_client.get(SUPPLIERS, params={'project': project}).json()
        detail = api_client.get(f'{PROJECTS}/{project}').json()
        assert list_row['outstanding'] == filtered['totals']['outstanding'] == detail['outstanding']
        assert list_row['overdue'] == filtered['totals']['overdue'] == detail['overdue']

    overview_projects = {p['project']: p for p in api_client.get(OVERVIEW).json()['projects']}
    for project in ('مشروع أ', 'مشروع ب'):
        assert overview_projects[project]['outstanding'] == by_name[project]['outstanding']
        assert overview_projects[project]['overdue'] == by_name[project]['overdue']


# ---------------------------------------------------------------- per-supplier tie-out

def test_per_supplier_outstanding_matches_list_detail_and_report_row(api_client):
    accounts = _seed_drifty_suppliers(api_client)
    account = accounts[0]

    list_row = next(r for r in api_client.get(SUPPLIERS).json()['rows']
                     if r['account'] == account)
    detail = api_client.get(f'{SUPPLIERS}/{account}').json()
    report = api_client.get(f'{REPORTS}/analysis').json()
    report_row = next(r for r in report['suppliers'] if r['account'] == account)

    assert list_row['outstanding'] == detail['outstanding'] == report_row['outstanding']
    assert list_row['overdue'] == detail['overdue'] == report_row['overdue']


# ---------------------------------------------------------------- contractors totals

def test_contractors_list_totals_match_exact_decimal_sum(api_client):
    _seed_drifty_contractors(api_client)
    d = api_client.get(CONTRACTORS).json()

    exact = sum((Decimal(str(a)) for a in DRIFT_AMOUNTS[:8]), Decimal('0'))
    # every seeded entry is a pure credit (مستخلص), so balance = -credit for each,
    # and owedToContractors sums the absolute value of the negative balances.
    assert Decimal(str(d['totals']['owedToContractors'])) == exact


def test_contractors_list_totals_match_report_contractors_section(api_client):
    _seed_drifty_contractors(api_client)

    list_totals = api_client.get(CONTRACTORS).json()['totals']
    report = api_client.get(f'{REPORTS}/analysis', params={'parties': 'contractors'}).json()
    report_totals = report['contractors']['totals']

    assert list_totals['owedToContractors'] == report_totals['outstanding']


def test_contractor_detail_balance_matches_list_row(api_client):
    codes = _seed_drifty_contractors(api_client)
    code = codes[0]

    list_row = next(r for r in api_client.get(CONTRACTORS).json()['rows']
                     if r['code'] == code)
    detail = api_client.get(f'{CONTRACTORS}/{code}').json()

    assert list_row['balance'] == detail['balance']


# ---------------------------------------------------------------- coverage

def test_coverage_withoutdata_matches_overview_alert_source(api_client):
    _seed_drifty_suppliers(api_client)
    # one supplier with zero movement stays out-of-scope for `positions()` by default,
    # but coverage/overview both use include_empty=True, so add a bare supplier row.
    _mk_supplier(api_client, 'S999', 'مشروع أ')

    coverage = api_client.get(COVERAGE).json()['totals']
    overview_coverage = api_client.get(OVERVIEW).json()['coverage']

    assert coverage['withoutData'] == overview_coverage['withoutData']
    assert coverage['stale'] == overview_coverage['stale']
    assert coverage['coveredPct'] == overview_coverage['coveredPct']


# ---------------------------------------------------------------- revenues

def test_revenues_totals_match_exact_decimal_sum_not_float_drift(api_client):
    _seed_drifty_revenues(api_client)
    d = api_client.get(REVENUES).json()

    exact = sum((Decimal(str(a)) for a in DRIFT_AMOUNTS[:6]), Decimal('0'))
    assert Decimal(str(d['totals']['open'])) == exact
    assert Decimal(str(d['totals']['all'])) == exact
    assert d['totals']['collected'] == 0.0
