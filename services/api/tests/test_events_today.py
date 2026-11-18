# -*- coding: utf-8 -*-
"""الأحداث + SSE + /today + /reports/gm — العقد في docs/next/API-CONTRACT.md."""
import asyncio
import json
from decimal import Decimal

B = '/api/v1'


def _seed(c):
    r = c.post(B + '/suppliers', json=dict(account='2110001', name='مورد متأخر',
                                          project='السدن', term='30 يوم'))
    assert r.status_code in (200, 201)
    r = c.post(B + '/manual/invoices', json=dict(account='2110001', date='2020-01-01',
                                                amount=1000, number='F1'))
    assert r.status_code == 201, r.text


def test_generator_dedupes_and_routes(api_client):
    c = api_client
    _seed(c)
    # أول توليد: ملخّص لكل نوع، لا حدث لكل بند
    first = c.post(B + '/events/generate').json()['created']
    assert first >= 1
    assert c.post(B + '/events/generate').json()['created'] == 0   # لا تكرار
    evs = c.get(B + '/events?status=unread').json()
    sm = next(e for e in evs if e['kind'] == 'overdue_new')
    assert sm['title'].startswith('فاتورة متأخرة لدى مورد واحد')
    assert sm['link'] == {'view': 'suppliers', 'params': {'filter': 'overdue'}}
    # بعده: انتقال جديد واحد = حدث لبنده
    c.post(B + '/manual/invoices', json=dict(account='2110001', date='2020-02-01',
                                            amount=7, number='F2'))
    assert c.post(B + '/events/generate').json()['created'] == 1
    od = next(e for e in c.get(B + '/events?status=unread').json()
              if e['kind'] == 'overdue_new' and e['link']['view'] == 'supplier')
    assert od['severity'] == 'danger'
    assert od['link'] == {'view': 'supplier', 'params': {'id': '2110001'}}
    assert set(od) == {'id', 'at', 'kind', 'severity', 'title', 'detail', 'link', 'read', 'archived'}
    evs = c.get(B + '/events?status=unread').json()
    n = c.get(B + '/events/unread-count').json()['count']
    assert n == len(evs)
    r = c.post(f'{B}/events/{od["id"]}/read').json()
    assert r['read'] is True
    assert c.get(B + '/events/unread-count').json()['count'] == n - 1
    r = c.post(f'{B}/events/{od["id"]}/archive').json()
    assert r['archived'] is True
    assert all(e['id'] != od['id'] for e in c.get(B + '/events?status=all').json())
    assert c.post(B + '/events/read-all').status_code == 200
    assert c.get(B + '/events/unread-count').json()['count'] == 0
    assert c.post(B + '/events/999999/read').status_code == 404


def test_first_run_groups_many_items_into_one_summary(api_client):
    c = api_client
    for k in range(4):
        acc = f'211000{k}'
        c.post(B + '/suppliers', json=dict(account=acc, name=f'م{k}', term='كاش'))
        for j in range(3):
            c.post(B + '/manual/invoices', json=dict(account=acc, date=f'2020-0{j + 1}-01',
                                                    amount=100, number=f'{k}-{j}'))
    assert c.post(B + '/events/generate').json()['created'] >= 1
    od = [e for e in c.get(B + '/events?status=all').json() if e['kind'] == 'overdue_new']
    assert len(od) == 1
    assert od[0]['title'] == '١٢ فاتورة متأخرة لدى ٤ موردين — 1,200.00 ر.س'
    # البنود المُلخَّصة لا تعود فرادى
    assert c.post(B + '/events/generate').json()['created'] == 0


def test_burst_after_first_run_is_grouped(api_client):
    c = api_client
    _seed(c)
    c.post(B + '/events/generate')
    for j in range(7):   # ٧ متأخرات جديدة دفعة واحدة > ٥ → ملخّص واحد
        c.post(B + '/manual/invoices', json=dict(account='2110001', date=f'2020-03-0{j + 1}',
                                                amount=10, number=f'N{j}'))
    from app.services import events_service
    from app.db import session as session_mod
    with session_mod.SessionLocal() as db:
        n = events_service.generate(db, context='بعد استيراد كشف.pdf')
    assert n == 1
    od = [e for e in c.get(B + '/events?status=unread').json() if e['kind'] == 'overdue_new']
    assert od[0]['title'] == '٧ فواتير متأخرة لدى مورد واحد — 70.00 ر.س بعد استيراد كشف.pdf'
    # SSE لا يعيد البنود الصامتة المؤرشفة
    with session_mod.SessionLocal() as db:
        assert all(not e.archived for e in events_service.events_after(db, 0))


def test_external_update_event(api_client):
    c = api_client
    r = c.post(B + '/events/external', json={'kind': 'update_available', 'version': '1.0.1'})
    assert r.status_code == 200 and r.json()['kind'] == 'update_available'
    r2 = c.post(B + '/events/external', json={'kind': 'update_available', 'version': '1.0.1'})
    assert r2.json()['id'] == r.json()['id']
    assert c.post(B + '/events/external', json={'kind': 'overdue_new'}).status_code == 422


def test_sse_replay_last_event_id(api_client):
    c = api_client
    c.post(B + '/events/external', json={'kind': 'update_available', 'version': '1'})
    c.post(B + '/events/external', json={'kind': 'update_available', 'version': '2'})
    ids = [e['id'] for e in c.get(B + '/events?status=all').json()]
    lo = min(ids)
    with c.stream('GET', f'{B}/events/stream?maxMessages=1', headers={'Last-Event-ID': str(lo)}) as r:
        assert r.headers['content-type'].startswith('text/event-stream')
        body = ''.join(r.iter_text())
    assert 'event: notification' in body and f'id: {max(ids)}' in body
    data = json.loads(body.split('data: ', 1)[1].split('\n', 1)[0])
    assert data['id'] == max(ids)


def test_sse_live_invalidate_and_heartbeat():
    from app.api.routes.events import stream_messages
    from app.services import sse_broker

    async def run():
        gen = stream_messages(-1, max_messages=1, heartbeat=0.05)
        assert (await gen.__anext__()).startswith('retry:')
        hb = await gen.__anext__()
        assert hb == ': heartbeat\n\n'
        sse_broker.publish_invalidate(['suppliers'])
        msg = await gen.__anext__()
        while msg.startswith(':'):
            msg = await gen.__anext__()
        await gen.aclose()
        # إشارة الإيقاف تُنهي بثاً مفتوحاً بلا مهام معلّقة
        gen2 = stream_messages(-1, heartbeat=5)
        await gen2.__anext__()
        sse_broker.broker.close_all()
        rest = [m async for m in gen2]
        assert rest == []
        return msg

    loop = asyncio.new_event_loop()
    try:
        msg = loop.run_until_complete(run())
    finally:
        loop.close()
    assert msg.startswith('event: invalidate')
    assert json.loads(msg.split('data: ')[1]) == {'keys': ['suppliers']}


def test_invalidate_keys_from_path():
    from app.api.invalidate import keys_for
    assert 'suppliers' in keys_for('POST', '/api/v1/manual/invoices')
    assert keys_for('GET', '/api/v1/suppliers') is None
    assert keys_for('POST', '/api/v1/import/preview') is None
    assert keys_for('POST', '/api/v1/events/read-all') is None
    assert keys_for('DELETE', '/api/v1/reset') == ['*']
    assert 'projects' in keys_for('PUT', '/api/v1/projects/x/parties/supplier/1')


def test_mutation_publishes_invalidate(api_client, monkeypatch):
    from app.services import sse_broker
    seen = []
    monkeypatch.setattr(sse_broker, 'publish_invalidate', lambda keys: seen.append(keys))
    api_client.post(B + '/suppliers', json=dict(account='2110005', name='م', term='كاش'))
    assert seen and 'suppliers' in seen[-1]
    n = len(seen)
    api_client.post(B + '/suppliers', json=dict(account='', name=''))   # 422 → لا بث
    api_client.get(B + '/suppliers')
    assert len(seen) == n


def test_today_shape_and_numbers_match_overview(api_client):
    c = api_client
    _seed(c)
    t = c.get(B + '/today').json()
    ov = c.get(B + '/overview').json()
    assert set(t) >= {'generatedAt', 'kpis', 'tasks', 'lastChange', 'staleness', 'quality',
                      'projects', 'aging', 'cash30', 'cashBasis'}
    k = t['kpis']
    assert Decimal(k['supplierOpen']) == Decimal(str(ov['payables']['outstanding']))
    assert Decimal(k['supplierOverdue']) == Decimal(str(ov['payables']['overdue']))
    assert k['bankBalance'] is None and t['cashBasis'] == 'no_bank_balance'
    assert len(t['cash30']) == 30
    assert t['cash30'][0]['balance'] == '-1000.00'
    assert k['firstDeficitDate'] == t['cash30'][0]['date']
    assert t['aging']['d90p'] == '1000.00'
    assert t['tasks'][0]['id'] == 'overdue:supplier:2110001'
    assert t['lastChange'] is None
    # الرصيد البنكي يدخل الإسقاط
    c.put(B + '/settings/bank-balance', json={'balance': '5000'})
    t = c.get(B + '/today').json()
    assert t['cashBasis'] == 'bank' and t['cash30'][0]['balance'] == '4000.00'
    assert t['kpis']['firstDeficitDate'] is None


def test_gm_report(api_client):
    c = api_client
    _seed(c)
    g = c.get(B + '/reports/gm').json()
    assert g['supplierOpen'] == '1000.00' and g['supplierOpenPrevMonth'] == '1000.00'
    assert g['supplierOpenChange'] == '0.00'
    assert len(g['cash30']) == 30 and 'collections' in g


def test_report_summary_split(api_client):
    c = api_client
    _seed(c)
    c.post(B + '/contractors', json=dict(code='2120001', name='مقاول'))
    c.post(B + '/contractors/2120001/entries', json=dict(date='2026-01-01', credit=500,
                                                         description='مستخلص رقم 1'))
    s = c.get(B + '/reports/analysis?parties=both').json()['summary']
    assert Decimal(str(s['outstanding'])) == (Decimal(str(s['supplierOutstanding']))
                                              + Decimal(str(s['contractorOutstanding'])))
    assert 'period_movement' in s and 'ageingTotal' in s
