# -*- coding: utf-8 -*-
"""اختبارات لوحة القيادة الرئيسية — lastPayments/lastPayment، كتلة المقاولين،
التحصيلات، والضمانات المضافة إلى /overview.

يتبع نمط test_synergy_screens.py: كل رقم يظهر على أكثر من شاشة يجب أن يتطابق حرفياً
(اتساق عبر الشاشات)، ولا يجوز أن يتغيّر أي مفتاح موجود مسبقاً في /overview.
"""
from decimal import Decimal

OVERVIEW = '/api/v1/overview'
SUPPLIERS = '/api/v1/suppliers'
CONTRACTORS = '/api/v1/contractors'
REVENUES = '/api/v1/revenues'

#: شكل /overview قبل هذه الإضافات — يجب أن تبقى هذه المفاتيح كما هي حرفياً.
PRE_EXISTING_KEYS = {'asOf', 'payables', 'coverage', 'cash', 'projects', 'alerts'}


def _mk_supplier(client, account, project='مشروع', term='30 يوم', name=None):
    r = client.post(SUPPLIERS, json={
        'account': account, 'name': name or f'مورد {account}', 'project': project,
        'term': term})
    assert r.status_code in (200, 201), r.text


def _mk_invoice(client, account, date, amount):
    r = client.post('/api/v1/manual/invoices', json={
        'account': account, 'date': date, 'amount': amount})
    assert r.status_code in (200, 201), r.text


def _mk_payment(client, account, date, amount, description=''):
    r = client.post('/api/v1/manual/payments', json={
        'account': account, 'date': date, 'amount': amount, 'description': description})
    assert r.status_code in (200, 201), r.text


def _mk_contractor(client, code, name=None):
    r = client.post(CONTRACTORS, json={'code': code, 'name': name or f'مقاول {code}'})
    assert r.status_code in (200, 201), r.text


def _mk_contractor_payment(client, code, date, debit, description=''):
    r = client.post(f'{CONTRACTORS}/{code}/entries', json={
        'date': date, 'debit': debit, 'credit': 0, 'kind': 'payment',
        'description': description})
    assert r.status_code in (200, 201), r.text
    return r.json()


def _mk_contractor_claim(client, code, date, project, gross, retention_amount, net_due):
    r = client.post(f'{CONTRACTORS}/{code}/claims', json={
        'project': project, 'date': date, 'grossCumulative': gross,
        'previousCumulative': 0, 'retentionAmount': retention_amount, 'netDue': net_due})
    assert r.status_code in (200, 201), r.text


def _mk_guarantee(client, code, project, amount, release_due=None, released_on=None):
    """ينشئ ضماناً للمشروع، أو يعدّل الموجود.

    Registering a مستخلص already derives that project's guarantee automatically
    (sync_guarantee_from_claims), so a plain POST here legitimately returns 409 for
    any project that has a claim. The app is right; the helper adapts.
    """
    body = {'project': project, 'amount': amount, 'releaseDue': release_due,
            'releasedOn': released_on}
    r = client.post(f'{CONTRACTORS}/{code}/guarantees', json=body)
    if r.status_code == 409:
        detail = client.get(f'{CONTRACTORS}/{code}').json()
        gid = next(g['id'] for g in detail['guarantees'] if g['project'] == project)
        r = client.put(f'{CONTRACTORS}/{code}/guarantees/{gid}', json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _mk_revenue(client, project, amount, status='open', collected_on=None, client_name='عميل'):
    r = client.post(REVENUES, json={
        'project': project, 'client': client_name, 'amount': amount,
        'status': status, 'collected_on': collected_on})
    assert r.status_code in (200, 201), r.text


# ---------------------------------------------------------------- existing shape

def test_pre_existing_keys_unchanged(api_client):
    """المفاتيح القديمة تبقى كما هي — لا كسر للشريط الجانبي أو البطاقات الحالية."""
    _mk_supplier(api_client, 'S1')
    _mk_invoice(api_client, 'S1', '2026-01-01', 1000)
    d = api_client.get(OVERVIEW).json()
    assert PRE_EXISTING_KEYS.issubset(d.keys())
    assert isinstance(d['payables'], dict)
    assert isinstance(d['coverage'], dict)
    assert isinstance(d['cash'], dict)
    assert isinstance(d['projects'], list)
    assert isinstance(d['alerts'], list)


def test_new_keys_present_even_with_no_data(api_client):
    d = api_client.get(OVERVIEW).json()
    for key in ('contractors', 'lastPayments', 'lastPayment', 'revenues', 'guarantees'):
        assert key in d
    assert d['lastPayments'] == []
    assert d['lastPayment'] is None
    assert d['contractors'] == dict(count=0, owedToContractors=0.0, owedToUs=0.0,
                                    retentionHeld=0.0, releaseAlerts=0)
    assert d['revenues'] == dict(open=0.0, collected=0.0)
    assert d['guarantees']['heldTotal'] == 0.0
    assert d['guarantees']['nextRelease'] is None


# ---------------------------------------------------------------- lastPayments

def test_last_payments_ordering_mixed_kinds_and_deleted_excluded(api_client):
    _mk_supplier(api_client, 'S1', name='مورد الاختبار')
    _mk_invoice(api_client, 'S1', '2026-01-01', 500000)
    _mk_payment(api_client, 'S1', '2026-07-02', 100000, description='دفعة يوليو')
    _mk_payment(api_client, 'S1', '2026-01-05', 5000, description='دفعة قديمة')

    _mk_contractor(api_client, 'C1', name='مقاول الاختبار')
    _mk_contractor_claim(api_client, 'C1', '2026-01-01', 'م1', 300000, 0, 300000)
    cp = _mk_contractor_payment(api_client, 'C1', '2026-06-01', 40000, description='دفعة يونيو')
    deleted_pay = _mk_contractor_payment(api_client, 'C1', '2026-08-01', 999999,
                                         description='ستُحذف')

    # حذف الدفعة الأحدث — يجب ألا تظهر بعد ذلك
    r = api_client.delete(f"{CONTRACTORS}/C1/entries/{deleted_pay['id']}")
    assert r.status_code == 200

    d = api_client.get(OVERVIEW).json()
    payments = d['lastPayments']
    assert len(payments) == 3
    # الأحدث أولاً
    assert payments[0]['date'] == '2026-07-02'
    assert payments[0]['partyKind'] == 'supplier'
    assert payments[0]['amount'] == 100000.0
    assert payments[1]['date'] == '2026-06-01'
    assert payments[1]['partyKind'] == 'contractor'
    assert payments[2]['date'] == '2026-01-05'

    # الرأس = أحدث دفعة فعلياً، عبر الطرفين
    assert d['lastPayment'] == payments[0]
    assert d['lastPayment']['name'] == 'مورد الاختبار'

    # لا أثر للدفعة المحذوفة
    assert all(p['amount'] != 999999.0 for p in payments)


def test_last_payments_description_trimmed(api_client):
    _mk_supplier(api_client, 'S1')
    _mk_invoice(api_client, 'S1', '2026-01-01', 1000)
    long_desc = 'وصف طويل جداً ' * 10
    _mk_payment(api_client, 'S1', '2026-01-02', 500, description=long_desc)
    d = api_client.get(OVERVIEW).json()
    assert len(d['lastPayment']['description']) <= 60


# ---------------------------------------------------------------- contractors block

def test_contractors_block_equals_contractors_endpoint_totals(api_client):
    _mk_contractor(api_client, 'C1', name='مقاول أول')
    _mk_contractor_claim(api_client, 'C1', '2026-01-01', 'م1', 200000, 20000, 180000)
    _mk_contractor_payment(api_client, 'C1', '2026-02-01', 50000)

    _mk_contractor(api_client, 'C2', name='مقاول ثانٍ')
    _mk_contractor_claim(api_client, 'C2', '2026-01-01', 'م2', 90000, 9000, 81000)
    _mk_contractor_payment(api_client, 'C2', '2026-02-01', 81000)
    _mk_contractor_payment(api_client, 'C2', '2026-03-01', 5000)  # يتجاوز المستحق -> لنا

    _mk_guarantee(api_client, 'C1', 'م1', 20000, release_due='2026-01-01')  # مستحق -> alert

    contractors_totals = api_client.get(CONTRACTORS).json()['totals']
    contractors_count = api_client.get(CONTRACTORS).json()['count']
    overview_block = api_client.get(OVERVIEW).json()['contractors']

    assert overview_block['count'] == contractors_count
    assert overview_block['owedToContractors'] == contractors_totals['owedToContractors']
    assert overview_block['owedToUs'] == contractors_totals['owedToUs']
    assert overview_block['retentionHeld'] == contractors_totals['retentionHeld']
    assert overview_block['releaseAlerts'] >= 1


# ---------------------------------------------------------------- revenues block

def test_revenues_block_matches_open_and_collected(api_client):
    _mk_revenue(api_client, 'م1', 100000, status='open')
    _mk_revenue(api_client, 'م1', 50000, status='collected', collected_on='2026-01-01')
    d = api_client.get(OVERVIEW).json()['revenues']
    assert d['open'] == 100000.0
    assert d['collected'] == 50000.0


# ---------------------------------------------------------------- guarantees block

def test_guarantees_block_matches_guarantee_release_classification(api_client):
    _mk_contractor(api_client, 'C1', name='مقاول الضمان')

    # مستحق الصرف الآن
    due = _mk_guarantee(api_client, 'C1', 'م-مستحق', 30000, release_due='2020-01-01')
    # يقترب خلال ٣٠ يوماً
    import datetime as dt
    soon = (dt.date.today() + dt.timedelta(days=10)).isoformat()
    upcoming = _mk_guarantee(api_client, 'C1', 'م-قريب', 15000, release_due=soon)
    # مصروف هذا العام بالفعل
    released = _mk_guarantee(api_client, 'C1', 'م-مصروف', 5000, release_due='2020-01-01',
                             released_on=dt.date.today().isoformat())

    d = api_client.get(OVERVIEW).json()['guarantees']
    assert d['dueCount'] == 1
    assert d['upcomingCount'] == 1
    assert d['heldTotal'] == 30000.0 + 15000.0
    assert d['releasedThisYear']['count'] == 1
    assert d['releasedThisYear']['amount'] == 5000.0
    # الأقرب استحقاقاً هو الأدق تاريخاً — هنا due (2020) قبل upcoming
    assert d['nextRelease'] is not None
    assert d['nextRelease']['date'] == '2020-01-01'
    assert d['nextRelease']['contractorName'] == 'مقاول الضمان'
    assert d['nextRelease']['project'] == 'م-مستحق'


def test_guarantees_next_release_is_soonest_unreleased(api_client):
    _mk_contractor(api_client, 'C1', name='مقاول ب')
    _mk_guarantee(api_client, 'C1', 'م-بعيد', 10000, release_due='2027-01-01')
    _mk_guarantee(api_client, 'C1', 'م-قريب', 20000, release_due='2026-09-01')
    d = api_client.get(OVERVIEW).json()['guarantees']
    assert d['nextRelease']['date'] == '2026-09-01'
    assert d['nextRelease']['amount'] == 20000.0
