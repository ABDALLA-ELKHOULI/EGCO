# -*- coding: utf-8 -*-
"""اختبارات سلّة المحذوفات (م-٣١) — الاسترجاع يجب أن يُعيد الرقم بالهللة، لا
تقريباً. يبني بيانات مصغّرة (لا كشف حقيقي هنا — انظر التحقق اليدوي في التقرير
على ~/Downloads لملف حقيقي) لإثبات أن حذف مورد مدار force ثم استرجاعه يُعيد
مديونيته الدقيقة."""


def _make_supplier(api_client, account='991', term='30 يوم'):
    r = api_client.post('/api/v1/suppliers', json={
        'account': account, 'name': 'مورد اختبار السلة', 'project': 'م', 'term': term})
    assert r.status_code == 201, r.text
    return r.json()


def test_delete_supplier_response_lists_dependents(api_client):
    _make_supplier(api_client, account='991')
    api_client.post('/api/v1/manual/invoices', json={
        'account': '991', 'amount': '5938715.01', 'date': '2026-01-01', 'description': 'ف'})

    r = api_client.delete('/api/v1/suppliers/991', params={'force': 'true'})
    assert r.status_code == 200, r.text
    deleted = r.json()['deleted']
    assert deleted == dict(kind='supplier', id='991', dependents=dict(invoices=1, payments=0))


def test_restore_supplier_brings_back_exact_amount(api_client):
    _make_supplier(api_client, account='992')
    api_client.post('/api/v1/manual/invoices', json={
        'account': '992', 'amount': '5938715.01', 'date': '2026-01-01', 'description': 'ف'})

    # قبل الحذف: المديونية بالهللة كما أُدخلت.
    before = api_client.get('/api/v1/suppliers/992').json()
    assert before['outstanding'] == 5938715.01

    api_client.delete('/api/v1/suppliers/992', params={'force': 'true'})
    assert api_client.get('/api/v1/suppliers/992').status_code == 404

    # يظهر في السلّة
    trash = api_client.get('/api/v1/trash', params={'kind': 'supplier'}).json()
    row = next(r for r in trash['rows'] if r['id'] == '992')
    assert row['summary']['invoices'] == 1

    r = api_client.post('/api/v1/trash/supplier/992/restore')
    assert r.status_code == 200, r.text

    after = api_client.get('/api/v1/suppliers/992').json()
    assert after['outstanding'] == 5938715.01           # نفس الرقم بالهللة


def test_restore_unknown_id_404s(api_client):
    r = api_client.post('/api/v1/trash/supplier/does-not-exist/restore')
    assert r.status_code == 404


def test_purge_requires_explicit_confirm(api_client):
    _make_supplier(api_client, account='993')
    api_client.delete('/api/v1/suppliers/993', params={'force': 'true'})

    r = api_client.delete('/api/v1/trash/supplier/993')
    assert r.status_code == 400        # لا confirm=true

    r = api_client.delete('/api/v1/trash/supplier/993', params={'confirm': 'true'})
    assert r.status_code == 200, r.text
    assert api_client.get('/api/v1/trash', params={'kind': 'supplier'}).json()['count'] == 0

    # حذف نهائي حقيقي — لا يعود حتى محاولة إعادة الإنشاء بنفس الحساب تجده
    r = api_client.post('/api/v1/trash/supplier/993/restore')
    assert r.status_code == 404


def test_delete_contractor_response_and_restore(api_client):
    r = api_client.post('/api/v1/contractors', json={
        'code': '2129001', 'name': 'مقاول اختبار'})
    assert r.status_code == 201, r.text
    r = api_client.post('/api/v1/contractors/2129001/entries', json={
        'date': '2026-01-01', 'debit': 100, 'credit': 0, 'description': 'حركة'})
    assert r.status_code == 201, r.text

    r = api_client.delete('/api/v1/contractors/2129001', params={'force': 'true'})
    assert r.json()['deleted'] == dict(kind='contractor', id='2129001',
                                       dependents=dict(entries=1))

    assert api_client.get('/api/v1/contractors/2129001').status_code == 404
    r = api_client.post('/api/v1/trash/contractor/2129001/restore')
    assert r.status_code == 200, r.text
    detail = api_client.get('/api/v1/contractors/2129001').json()
    assert len(detail['entries']) == 1

