# -*- coding: utf-8 -*-
"""م-٥٠ — أطراف المشروع بمبالغ: كثير-لكثير، مبلغ مختلف لكل مشروع، null ≠ صفر،
حذف منطقي يحفظ المبلغ، الدمج لا يُيتّم مبلغاً، وقيمة العقد تغذّي الهامش."""
from urllib.parse import quote

B = '/api/v1'


def _sup(c, account, project, name=None):
    r = c.post(B + '/suppliers', json=dict(account=account, name=name or f'مورد {account}',
                                          project=project, term='30 يوم'))
    assert r.status_code in (200, 201), r.text


def _con(c, code, name=None):
    r = c.post(B + '/contractors', json=dict(code=code, name=name or f'مقاول {code}'))
    assert r.status_code in (200, 201), r.text


def _pid(c, name):
    reg = c.get(B + '/projects/registry').json()
    return next(x['id'] for x in reg if x['name'] == name or name in x['aliases'])


def test_link_amounts_many_to_many(api_client):
    c = api_client
    _sup(c, '2110001', 'السدن')
    _sup(c, '2110002', 'المدينة')
    _con(c, '2120001')
    sdn, mdn = _pid(c, 'السدن'), _pid(c, 'المدينة')

    r = c.put(f'{B}/projects/{sdn}/parties/contractor/2120001', json={'amount': '500000.50'})
    assert r.status_code == 201, r.text
    assert r.json()['amount'] == '500000.50'
    r = c.put(f'{B}/projects/{mdn}/parties/contractor/2120001', json={'amount': 120000})
    assert r.status_code == 201
    # تعديل لا إنشاء
    r = c.put(f'{B}/projects/{mdn}/parties/contractor/2120001',
              json={'amount': '125000', 'notes': 'ملحق'})
    assert r.status_code == 200 and r.json()['amount'] == '125000.00'
    assert r.json()['notes'] == 'ملحق'

    projs = c.get(f'{B}/contractors/2120001/projects').json()
    amounts = {p['name']: p['amount'] for p in projs}
    assert amounts == {'السدن': '500000.50', 'المدينة': '125000.00'}

    # المورد مربوط بمشروعه تلقائياً بلا مبلغ → null لا صفر
    parties = c.get(f'{B}/projects/{sdn}/parties').json()
    sup = next(p for p in parties if p['partyId'] == '2110001')
    assert sup['amount'] is None and sup['linked'] is True
    assert sup['attribution'] == 'single' and sup['invoiced'] == '0.00'

    row = next(r for r in c.get(B + '/projects').json()['rows'] if r['project'] == 'السدن')
    assert row['id'] == sdn
    assert row['assignedTotal'] == '500000.50'
    assert row['contractValue'] is None and row['margin'] is None


def test_shared_supplier_numbers_are_null_not_guessed(api_client):
    c = api_client
    _sup(c, '2110001', 'السدن')
    _sup(c, '2110009', 'المدينة')
    sdn = _pid(c, 'السدن')
    r = c.put(f'{B}/projects/{sdn}/parties/supplier/2110009', json={'amount': '1000'})
    assert r.status_code == 201
    item = r.json()
    assert item['attribution'] == 'shared'
    assert item['invoiced'] is None and item['open'] is None
    # العمود المفرد للمورد لم يتغيّر (أول مشروع يبقى المدينة)
    assert c.get(f'{B}/suppliers/2110009').json()['project'] == 'المدينة'


def test_unlink_is_soft_and_relink_revives(api_client):
    c = api_client
    _sup(c, '2110001', 'السدن')
    _con(c, '2120001')
    sdn = _pid(c, 'السدن')
    c.put(f'{B}/projects/{sdn}/parties/contractor/2120001', json={'amount': '700'})
    r = c.delete(f'{B}/projects/{sdn}/parties/contractor/2120001')
    assert r.status_code == 200 and r.json() == {'deleted': True}
    assert all(p['partyId'] != '2120001' for p in c.get(f'{B}/projects/{sdn}/parties').json())
    assert c.delete(f'{B}/projects/{sdn}/parties/contractor/2120001').status_code == 404
    r = c.put(f'{B}/projects/{sdn}/parties/contractor/2120001', json={'amount': '800'})
    assert r.status_code == 201 and r.json()['amount'] == '800.00'


def test_supplier_edit_keeps_amount(api_client):
    """نموذج تعديل المورد كان يحذف الروابط ويعيد إنشاءها فيمحو المبلغ."""
    c = api_client
    _sup(c, '2110001', 'السدن')
    sdn = _pid(c, 'السدن')
    c.put(f'{B}/projects/{sdn}/parties/supplier/2110001', json={'amount': '999'})
    r = c.put(f'{B}/suppliers/2110001', json=dict(name='اسم جديد', projects=['السدن', 'المدينة']))
    assert r.status_code == 200, r.text
    item = next(p for p in c.get(f'{B}/projects/{sdn}/parties').json() if p['partyId'] == '2110001')
    assert item['amount'] == '999.00'


def test_contract_value_and_margin(api_client):
    c = api_client
    _sup(c, '2110001', 'السدن')
    c.post(B + '/manual/invoices', json=dict(account='2110001', date='2026-01-01',
                                            amount=1000, number='F1'))
    sdn = _pid(c, 'السدن')
    r = c.put(f'{B}/projects/{sdn}', json={'contractValue': '5000'})
    assert r.status_code == 200 and r.json()['contractValue'] == '5000.00'
    row = next(r for r in c.get(B + '/projects').json()['rows'] if r['project'] == 'السدن')
    assert row['executed'] == '1000.00' and row['margin'] == '4000.00'
    d = c.get(f'{B}/projects/{sdn}').json()      # بالمعرّف
    assert d['project'] == 'السدن' and d['margin'] == '4000.00' and 'parties' in d
    d2 = c.get(f'{B}/projects/' + quote('السدن', safe='')).json()  # بالاسم
    assert d2['id'] == sdn
    r = c.put(f'{B}/projects/{sdn}', json={'contractValue': None})
    assert r.json()['contractValue'] is None
    assert c.put(f'{B}/projects/{sdn}', json={'contractValue': '-5'}).status_code == 422


def test_merge_keeps_amounts_and_id(api_client):
    c = api_client
    _sup(c, '2110001', 'سدن')
    _sup(c, '2110002', 'السدن')
    _con(c, '2120001')
    pid = _pid(c, 'السدن')
    # الاسمان مفتاح مطابقة واحد → معرّف واحد
    assert _pid(c, 'سدن') == pid
    c.put(f'{B}/projects/{pid}/parties/contractor/2120001', json={'amount': '300'})
    r = c.post(B + '/project-admin/merge', json=dict(fromName='سدن', intoName='السدن'))
    assert r.status_code == 200, r.text
    assert _pid(c, 'السدن') == pid
    items = c.get(f'{B}/projects/{pid}/parties').json()
    assert {p['partyId'] for p in items} >= {'2110001', '2110002', '2120001'}
    assert next(p for p in items if p['partyId'] == '2120001')['amount'] == '300.00'


def test_errors_and_search(api_client):
    c = api_client
    _sup(c, '2110001', 'السدن', name='شركة الحديد الموحدة')
    sdn = _pid(c, 'السدن')
    assert c.get(B + '/projects/لا-يوجد/parties').status_code == 404
    assert c.put(f'{B}/projects/{sdn}/parties/supplier/0000', json={}).status_code == 404
    assert c.put(f'{B}/projects/{sdn}/parties/x/2110001', json={}).status_code == 422
    assert c.put(f'{B}/projects/{sdn}/parties/supplier/2110001',
                 json={'amount': 'abc'}).status_code == 422
    res = c.get(B + '/parties/search', params={'q': 'الحديد'}).json()
    assert res[0]['partyId'] == '2110001' and res[0]['projects'] == ['السدن']
    assert c.get(B + '/parties/search', params={'type': 'x'}).status_code == 422
    assert c.get(B + '/suppliers/0000/projects').status_code == 404


def test_bank_balance_setting(api_client):
    c = api_client
    assert c.get(B + '/settings/bank-balance').json() == {'balance': None, 'at': None}
    r = c.put(B + '/settings/bank-balance', json={'balance': '820000.5'})
    assert r.json()['balance'] == '820000.50' and r.json()['at']
    assert c.put(B + '/settings/bank-balance', json={'balance': 'x'}).status_code == 422
    assert c.put(B + '/settings/bank-balance', json={'balance': None}).json()['balance'] is None


def test_create_and_delete_project(api_client):
    c = api_client
    _sup(c, '2110001', 'السدن')
    r = c.post(B + '/projects', json={'name': 'برج الواحة', 'contractValue': '1000000'})
    assert r.status_code == 201 and r.json()['contractValue'] == '1000000.00'
    pid = r.json()['id']
    assert c.post(B + '/projects', json={'name': 'سدن'}).status_code == 409
    assert c.post(B + '/projects', json={'name': 'البرج الواحة'}).status_code in (201, 409)
    rows = c.get(B + '/projects').json()
    row = next(x for x in rows['rows'] if x['project'] == 'برج الواحة')
    assert row['id'] == pid and row['outstanding'] == 0
    assert rows['totals']['count'] == len(rows['rows'])
    # مشروع عليه بيانات → 409 بالأعداد
    r = c.delete(f'{B}/projects/{_pid(c, "السدن")}')
    assert r.status_code == 409 and r.json()['detail']['linked']['suppliers'] == 1
    assert c.delete(f'{B}/projects/{pid}').json()['deleted'] is True
    assert all(x['id'] != pid for x in c.get(B + '/projects/registry').json())
