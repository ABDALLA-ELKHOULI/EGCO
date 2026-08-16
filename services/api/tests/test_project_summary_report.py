# -*- coding: utf-8 -*-
"""اختبارات تقرير ملخّص المشروع — GET /api/v1/reports/project-summary.

سطر واحد لكل شركة (مورد/مقاول) ضمن مشروع واحد، لا سطر لكل فاتورة/حركة. كل رقم هنا
محسوب يدوياً من الفواصل المزروعة أدناه، حتى يفشل أي تغيير في map المقاول -> تقرير
بصوت عالٍ بدل أن يعيد تسمية مبلغ بصمت.
"""
BASE = '/api/v1/reports'
PROJECT = 'السدن'
OTHER_PROJECT = 'الرسين'


def seed_supplier(client, account='9001', name='مورد التجربة', project=PROJECT,
                  term='30 يوم'):
    r = client.post('/api/v1/suppliers', json={
        'account': account, 'name': name, 'project': project, 'term': term})
    assert r.status_code in (200, 201), r.text
    return account


def seed_contractor(client, code='C1', name='مقاول أول'):
    r = client.post('/api/v1/contractors', json={'code': code, 'name': name})
    assert r.status_code in (200, 201), r.text
    return code


def test_project_summary_one_row_per_company(api_client):
    """مورد وفاتورتان + مقاول بقيدين، كلاهما في نفس المشروع -> صفّان لا أكثر."""
    seed_supplier(api_client)
    api_client.post('/api/v1/manual/invoices', json={
        'account': '9001', 'date': '2026-01-01', 'amount': 1000, 'number': 'F1'})
    api_client.post('/api/v1/manual/invoices', json={
        'account': '9001', 'date': '2026-01-15', 'amount': 500, 'number': 'F2'})
    api_client.post('/api/v1/manual/payments', json={
        'account': '9001', 'date': '2026-02-01', 'amount': 300})

    seed_contractor(api_client)
    api_client.post('/api/v1/contractors/C1/entries', json={
        'date': '2026-01-05', 'credit': 2000, 'description': 'مستخلص رقم1',
        'project': PROJECT})
    api_client.post('/api/v1/contractors/C1/entries', json={
        'date': '2026-02-05', 'debit': 800, 'description': 'دفعة نقدية',
        'project': PROJECT})

    r = api_client.get(f'{BASE}/project-summary', params={'project': PROJECT})
    assert r.status_code == 200, r.text
    d = r.json()

    assert d['project'] == PROJECT
    assert d['parties'] == 'both'
    # سطر واحد لكل شركة بغضّ النظر عن عدد فواتيرها/قيودها
    assert len(d['rows']) == 2
    accounts = {row['account'] for row in d['rows']}
    assert accounts == {'9001', 'C1'}

    supplier_row = next(row for row in d['rows'] if row['account'] == '9001')
    assert supplier_row['partyKind'] == 'supplier'
    assert supplier_row['totalInvoiced'] == 1500.0
    assert supplier_row['totalPaid'] == 300.0
    assert supplier_row['outstanding'] == 1200.0
    assert supplier_row['delay'] is not None  # كاش/أيام -> يُحسب دائماً

    contractor_row = next(row for row in d['rows'] if row['account'] == 'C1')
    assert contractor_row['partyKind'] == 'contractor'
    assert contractor_row['totalInvoiced'] == 2000.0
    assert contractor_row['totalPaid'] == 800.0
    assert contractor_row['outstanding'] == 1200.0  # balance = 800-2000 = -1200 -> نديّن به

    totals = d['totals']
    assert totals['companyCount'] == 2
    assert totals['totalInvoiced'] == 3500.0
    assert totals['totalPaid'] == 1100.0
    assert totals['outstanding'] == 2400.0


def test_contractor_delay_is_null_not_zero(api_client):
    """لا تواريخ استحقاق لدفتر المقاول -> delay=None، لا صفر يوهم بعدم التأخر."""
    seed_contractor(api_client)
    api_client.post('/api/v1/contractors/C1/entries', json={
        'date': '2026-01-01', 'credit': 1000, 'description': 'مستخلص رقم1',
        'project': PROJECT})

    r = api_client.get(f'{BASE}/project-summary',
                       params={'project': PROJECT, 'parties': 'contractors'})
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d['rows']) == 1
    assert d['rows'][0]['delay'] is None
    # إجمالي التأخر لا يعتد بمقاولين بلا تأخر قابل للحساب
    assert d['totals']['delayedAmount'] == 0.0
    assert d['totals']['maxDelayDays'] == 0


def test_only_entries_in_the_requested_project_count(api_client):
    """قيود مقاول في مشروع آخر لا تُحسب — النطاق حرفي بالمشروع المطلوب."""
    seed_contractor(api_client)
    api_client.post('/api/v1/contractors/C1/entries', json={
        'date': '2026-01-01', 'credit': 5000, 'description': 'مستخلص رقم1',
        'project': OTHER_PROJECT})

    r = api_client.get(f'{BASE}/project-summary',
                       params={'project': PROJECT, 'parties': 'contractors'})
    assert r.status_code == 404, r.text  # لا بيانات لهذا المقاول في هذا المشروع


def test_parties_filter_restricts_rows(api_client):
    seed_supplier(api_client)
    api_client.post('/api/v1/manual/invoices', json={
        'account': '9001', 'date': '2026-01-01', 'amount': 100, 'number': 'F1'})
    seed_contractor(api_client)
    api_client.post('/api/v1/contractors/C1/entries', json={
        'date': '2026-01-01', 'credit': 100, 'description': 'مستخلص رقم1',
        'project': PROJECT})

    only_suppliers = api_client.get(f'{BASE}/project-summary',
                                    params={'project': PROJECT, 'parties': 'suppliers'}).json()
    assert {r['partyKind'] for r in only_suppliers['rows']} == {'supplier'}

    only_contractors = api_client.get(f'{BASE}/project-summary',
                                      params={'project': PROJECT, 'parties': 'contractors'}).json()
    assert {r['partyKind'] for r in only_contractors['rows']} == {'contractor'}


def test_unknown_project_404s(api_client):
    r = api_client.get(f'{BASE}/project-summary', params={'project': 'مشروع لا وجود له'})
    assert r.status_code == 404


def test_invalid_parties_value_rejected(api_client):
    seed_supplier(api_client)
    r = api_client.get(f'{BASE}/project-summary',
                       params={'project': PROJECT, 'parties': 'nope'})
    assert r.status_code == 422


def test_export_xlsx_succeeds(api_client):
    seed_supplier(api_client)
    api_client.post('/api/v1/manual/invoices', json={
        'account': '9001', 'date': '2026-01-01', 'amount': 100, 'number': 'F1'})
    r = api_client.get(f'{BASE}/project-summary/export.xlsx', params={'project': PROJECT})
    assert r.status_code == 200, r.text
    assert r.headers['content-type'].startswith(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert len(r.content) > 0
