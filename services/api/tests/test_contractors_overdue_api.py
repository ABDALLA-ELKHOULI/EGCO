# -*- coding: utf-8 -*-
"""اختبارات API لتأخر المقاولين (م-٤٦): مدة السداد على المقاول، عمود «متأخر»،
الترتيب والتصفية عليه، إفصاح الإجماليات، تنبيه اللوحة، وأحداث التقويم.

يبني بياناته عبر مسارات الـAPI نفسها — بلا اعتماد على عيّنات.
"""
import datetime as dt

import pytest

TODAY = dt.date.today()


def _iso(days_ago: int) -> str:
    return (TODAY - dt.timedelta(days=days_ago)).isoformat()


@pytest.fixture()
def seeded(api_client):
    c = api_client
    # مقاول بمدة ٣٠ يوماً: مستخلص قديم ٩٠ يوماً بمبلغ ١٠٬٠٠٠ ودفعة ٤٬٠٠٠ → متأخر ٦٬٠٠٠.
    assert c.post('/api/v1/contractors', json=dict(code='212T1', name='مقاول بمدة',
                                                   paymentTermDays=30)).status_code == 201
    c.post('/api/v1/contractors/212T1/entries', json=dict(
        date=_iso(90), credit=10000, debit=0, description='مستخلص رقم 3', project='روشن'))
    c.post('/api/v1/contractors/212T1/entries', json=dict(
        date=_iso(60), debit=4000, credit=0, description='دفعة'))
    # مستخلص حديث (٥ أيام) → يستحق خلال ٣٠ يوماً لا متأخراً.
    c.post('/api/v1/contractors/212T1/entries', json=dict(
        date=_iso(5), credit=2000, debit=0, description='مستخلص رقم 4', project='روشن'))
    # مقاول بلا مدة وله مستخلص قديم — يجب ألا يُحسب له أي تأخر.
    assert c.post('/api/v1/contractors', json=dict(code='212N1', name='مقاول بلا مدة')).status_code == 201
    c.post('/api/v1/contractors/212N1/entries', json=dict(
        date=_iso(200), credit=50000, debit=0, description='مستخلص رقم 1'))
    # مقاول بمدة ومسدَّد بالكامل.
    assert c.post('/api/v1/contractors', json=dict(code='212T2', name='مقاول مسدَّد',
                                                   paymentTermDays=15)).status_code == 201
    c.post('/api/v1/contractors/212T2/entries', json=dict(
        date=_iso(100), credit=3000, debit=0, description='مستخلص رقم 1'))
    c.post('/api/v1/contractors/212T2/entries', json=dict(
        date=_iso(80), debit=3000, credit=0, description='دفعة'))
    return c


def _rows_by_code(payload):
    return {r['code']: r for r in payload['rows']}


def test_term_validation(api_client):
    r = api_client.post('/api/v1/contractors', json=dict(code='212X', name='x', paymentTermDays=400))
    assert r.status_code == 422
    assert 'مدة السداد' in r.json()['detail']
    api_client.post('/api/v1/contractors', json=dict(code='212Y', name='y'))
    r = api_client.put('/api/v1/contractors/212Y', json=dict(paymentTermDays=-1))
    assert r.status_code == 422


def test_put_sets_and_clears_term(api_client):
    api_client.post('/api/v1/contractors', json=dict(code='212Y', name='y'))
    r = api_client.put('/api/v1/contractors/212Y', json=dict(paymentTermDays=45))
    assert r.status_code == 200 and r.json()['paymentTermDays'] == 45
    # تعديل جزئي بلا الحقل لا يمسّ المدة
    r = api_client.put('/api/v1/contractors/212Y', json=dict(name='y2'))
    assert r.json()['paymentTermDays'] == 45
    # null صريح يمسحها → يعود «غير محدّد» وoverdue=null
    r = api_client.put('/api/v1/contractors/212Y', json=dict(paymentTermDays=None))
    assert r.json()['paymentTermDays'] is None
    assert r.json()['overdue'] is None


def test_list_overdue_column_and_disclosure(seeded):
    rows = _rows_by_code(seeded.get('/api/v1/contractors').json())
    t1, n1, t2 = rows['212T1'], rows['212N1'], rows['212T2']
    assert t1['paymentTermDays'] == 30
    assert t1['overdue'] == dict(amount=6000.0, count=1, maxDays=60)
    assert t1['dueSoon']['within30'] == 2000.0 and t1['dueSoon']['within7'] == 0.0
    # بلا مدة: null لا صفر — رغم وجود مستخلص قديم بـ٥٠٬٠٠٠
    assert n1['paymentTermDays'] is None and n1['overdue'] is None and n1['dueSoon'] is None
    assert t2['overdue']['amount'] == 0.0

    totals = seeded.get('/api/v1/contractors').json()['totals']
    assert totals['overdueTotal'] == 6000.0
    assert totals['overdueContractorCount'] == 1
    assert totals['withTermCount'] == 2
    assert totals['withoutTermCount'] == 1
    assert totals['dueWithin30Total'] == 2000.0


def test_sort_by_overdue(seeded):
    r = seeded.get('/api/v1/contractors?sort=overdue&dir=desc').json()
    assert r['rows'][0]['code'] == '212T1'
    r = seeded.get('/api/v1/contractors?sort=bogus')
    assert r.status_code == 422


def test_status_overdue_filter_only_with_term(seeded):
    r = seeded.get('/api/v1/contractors?status=overdue').json()
    assert [x['code'] for x in r['rows']] == ['212T1']
    # يُركَّب بـAND مع الحالة الإدارية
    seeded.put('/api/v1/contractors/212T1', json=dict(status='paused'))
    assert seeded.get('/api/v1/contractors?status=active,overdue').json()['count'] == 0
    assert seeded.get('/api/v1/contractors?status=paused,overdue').json()['count'] == 1
    # 'overdue' لا تُقبل حالةً إدارية في PUT
    assert seeded.put('/api/v1/contractors/212T1', json=dict(status='overdue')).status_code == 422


def test_detail_delay_card(seeded):
    d = seeded.get('/api/v1/contractors/212T1').json()
    assert d['paymentTermDays'] == 30
    delay = d['delay']
    assert delay['overdue']['amount'] == 6000.0
    claims = {c['claimNo']: c for c in delay['claims']}
    c3 = claims['3']
    assert c3['dueDate'] == (TODAY - dt.timedelta(days=60)).isoformat()
    assert c3['paid'] == 4000.0 and c3['remaining'] == 6000.0 and c3['daysLate'] == 60
    c4 = claims['4']
    assert c4['daysLate'] == 0 and c4['remaining'] == 2000.0
    assert sum(delay['byBucket'].values()) == 6000.0
    assert seeded.get('/api/v1/contractors/212N1').json()['delay'] is None


def test_overview_alert(seeded):
    ov = seeded.get('/api/v1/overview').json()
    c = ov['contractors']
    assert c['overdue'] == 6000.0 and c['overdueContractorCount'] == 1
    assert c['withTermCount'] == 2 and c['withoutTermCount'] == 1
    alert = next(a for a in ov['alerts'] if a.get('kind') == 'contractors_overdue')
    assert alert['level'] == 'danger'
    assert 'متأخر للمقاولين: 6,000.00 ر.س' in alert['text']
    assert 'بلا مدة سداد خارج الحساب' in alert['text']


def test_overview_alert_info_when_nobody_has_term(api_client):
    api_client.post('/api/v1/contractors', json=dict(code='212N9', name='بلا مدة'))
    ov = api_client.get('/api/v1/overview').json()
    alert = next(a for a in ov['alerts'] if a.get('kind') == 'contractors_overdue')
    assert alert['level'] == 'info'
    assert 'بلا مدة سداد' in alert['text']


def test_calendar_claim_events(seeded):
    r = seeded.get('/api/v1/contractors/claims-due').json()
    assert r['count'] == 2            # المستخلصان المفتوحان لـ212T1؛ 212T2 مسدَّد؛ 212N1 بلا مدة
    by_no = {e['claimNo']: e for e in r['rows']}
    assert all(e['type'] == 'contractor_claim' for e in r['rows'])
    assert by_no['3']['overdue'] is True and by_no['3']['amount'] == 6000.0
    assert by_no['4']['overdue'] is False and by_no['4']['date'] == (TODAY + dt.timedelta(days=25)).isoformat()
    assert r['totals'] == dict(amount=8000.0, overdue=6000.0)
    # نطاق تاريخ: القادم فقط
    r2 = seeded.get(f'/api/v1/contractors/claims-due?date_from={TODAY.isoformat()}').json()
    assert [e['claimNo'] for e in r2['rows']] == ['4']
    # تصفية بمشروع المستخلص
    assert seeded.get('/api/v1/contractors/claims-due?project=غير موجود').json()['count'] == 0
    assert seeded.get('/api/v1/contractors/claims-due?project=روشن').json()['count'] == 2
