# -*- coding: utf-8 -*-
"""اختبارات المديونية المستحقة اليدوية."""


def _make_supplier(api_client, account='777', term='30 يوم'):
    r = api_client.post('/api/v1/suppliers', json={
        'account': account, 'name': 'مورد يدوي', 'project': 'م', 'term': term})
    assert r.status_code == 201, r.text
    return r.json()


def test_manual_invoice_lifecycle(api_client):
    _make_supplier(api_client)
    r = api_client.post('/api/v1/manual/invoices', json={
        'account': '777', 'amount': 500, 'date': '2026-01-01', 'description': 'فاتورة يدوية'})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body['source'] == 'manual'
    assert body['dueDate'] is None       # derived at read time, not stored
    inv_id = body['id']

    d = api_client.get('/api/v1/suppliers/777').json()
    assert d['invoices'][0]['source'] == 'manual'
    assert d['invoices'][0]['dueDate'] == '2026-01-31'   # 30 يوم from invoice date

    r = api_client.put(f'/api/v1/manual/invoices/{inv_id}', json={'amount': 600})
    assert r.status_code == 200
    assert r.json()['amount'] == 600

    r = api_client.delete(f'/api/v1/manual/invoices/{inv_id}')
    assert r.status_code == 200 and r.json() == {'deleted': True}

    # المورد بلا حركة الآن — وصفحته يجب أن تبقى تعمل. القاعدة القديمة (٤٠٤) كانت
    # تقول «لا يوجد مورد بالحساب ٧٧٧» وهو موجود، فيبدو الحذف وكأنه محا المورد نفسه.
    # هذا ما رآه المستخدم بعد حذف ملف: صفحة المورد تنفي وجوده.
    r = api_client.get('/api/v1/suppliers/777')
    assert r.status_code == 200
    body = r.json()
    assert body['account'] == '777'
    assert body['outstanding'] == 0
    assert body['invoices'] == []


def test_manual_payment_lifecycle(api_client):
    _make_supplier(api_client, account='778')
    r = api_client.post('/api/v1/manual/payments', json={
        'account': '778', 'amount': 250, 'date': '2026-02-01'})
    assert r.status_code == 201
    pay_id = r.json()['id']
    assert r.json()['source'] == 'manual'

    r = api_client.delete(f'/api/v1/manual/payments/{pay_id}')
    assert r.status_code == 200 and r.json() == {'deleted': True}


def test_claim_term_requires_due_date_on_manual_invoice(api_client):
    _make_supplier(api_client, account='779', term='مستخلص')
    r = api_client.post('/api/v1/manual/invoices', json={
        'account': '779', 'amount': 1000, 'date': '2026-01-01'})
    assert r.status_code == 422
    assert 'مستخلص' in r.json()['detail']

    r = api_client.post('/api/v1/manual/invoices', json={
        'account': '779', 'amount': 1000, 'date': '2026-01-01', 'due_date': '2026-03-01'})
    assert r.status_code == 201
    assert r.json()['dueDate'] == '2026-03-01'


def test_editing_or_deleting_statement_rows_is_forbidden(api_client):
    _make_supplier(api_client, account='780')
    # Simulate a statement-sourced invoice by importing directly is heavier than needed
    # here — create via manual endpoint then flip source in the DB to mimic a statement
    # row, the way a real PDF/CSV import would have created it.
    r = api_client.post('/api/v1/manual/invoices', json={
        'account': '780', 'amount': 100, 'date': '2026-01-01'})
    inv_id = r.json()['id']

    from app.db.session import SessionLocal
    from app.db import models
    db = SessionLocal()
    try:
        row = db.query(models.Invoice).filter_by(id=inv_id).one()
        row.source = 'statement'
        db.commit()
    finally:
        db.close()

    r = api_client.put(f'/api/v1/manual/invoices/{inv_id}', json={'amount': 999})
    assert r.status_code == 403

    r = api_client.delete(f'/api/v1/manual/invoices/{inv_id}')
    assert r.status_code == 403
