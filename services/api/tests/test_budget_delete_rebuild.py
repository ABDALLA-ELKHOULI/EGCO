# -*- coding: utf-8 -*-
"""BUG-001 — حذف/إضافة/نقل شهر موازنة يجب أن يُعيد التراكمي = مجموع الأشهر
الحيّة بالترتيب (+ الأساس الخارجي للمشروع إن وُجد)، بدقة الهللة."""
import datetime as dt
from decimal import Decimal

import pytest

P = 'السدن'
SEED = dt.date(2026, 11, 1)


def _body(month, actual, planned=1500000.0, **kw):
    b = dict(project=P, month=month.isoformat(), actualMonth=actual,
             plannedMonth=planned, forceConflict=True)
    b.update(kw)
    return b


def _months(client):
    rows = client.get('/api/v1/budget/project/' + P).json()['months']
    return {r['month']: r for r in rows}


def _id(client, month):
    return _months(client)[month.isoformat()]['id']


def test_api_add_earlier_month_edit_delete_restores_seed(api_client):
    c = api_client
    assert c.post('/api/v1/budget', json=_body(SEED, 1200000.0)).json()['saved']
    early = dt.date(2026, 8, 1)
    assert c.post('/api/v1/budget', json=_body(early, 1234.0, 0.0)).json()['saved']
    r = c.put('/api/v1/budget/' + _id(c, early), json=_body(early, 5678.0, 0.0))
    assert r.json()['saved']
    assert Decimal(str(_months(c)[SEED.isoformat()]['cumActual'])) == Decimal('1205678.00')

    assert c.delete('/api/v1/budget/' + _id(c, early)).status_code == 200
    seed = _months(c)[SEED.isoformat()]
    assert Decimal(str(seed['cumActual'])) == Decimal('1200000.00')
    assert Decimal(str(seed['cumPlanned'])) == Decimal('1500000.00')


def test_api_add_later_month_then_delete(api_client):
    c = api_client
    c.post('/api/v1/budget', json=_body(SEED, 1200000.0))
    later = dt.date(2026, 12, 1)
    c.post('/api/v1/budget', json=_body(later, 5678.0, 0.0))
    assert c.delete('/api/v1/budget/' + _id(c, later)).status_code == 200
    m = _months(c)
    assert list(m) == [SEED.isoformat()]
    assert Decimal(str(m[SEED.isoformat()]['cumActual'])) == Decimal('1200000.00')


def test_api_delete_middle_month(api_client):
    c = api_client
    for mo, a in ((8, 100.10), (9, 200.20), (10, 300.30)):
        c.post('/api/v1/budget', json=_body(dt.date(2026, mo, 1), a, 0.0))
    c.delete('/api/v1/budget/' + _id(c, dt.date(2026, 9, 1)))
    m = _months(c)
    assert Decimal(str(m['2026-10-01']['cumActual'])) == Decimal('400.40')


def test_api_edit_moving_month_rebuilds_old_position(api_client):
    c = api_client
    c.post('/api/v1/budget', json=_body(SEED, 1200000.0))
    c.post('/api/v1/budget', json=_body(dt.date(2026, 8, 1), 5678.0, 0.0))
    rid = _id(c, dt.date(2026, 8, 1))
    # نقل الشهر إلى ما بعد شهر البذرة — يجب أن يُعاد حساب البذرة أيضاً
    c.put('/api/v1/budget/' + rid, json=_body(dt.date(2026, 12, 1), 5678.0, 0.0))
    m = _months(c)
    assert Decimal(str(m[SEED.isoformat()]['cumActual'])) == Decimal('1200000.00')
    assert Decimal(str(m['2026-12-01']['cumActual'])) == Decimal('1205678.00')


def test_service_external_baseline_survives_insert_and_delete_before_it(api_client):
    """ملف مستورد يبدأ منتصف المشروع (cum_prev_actual حقيقي من خارج القاعدة):
    إضافة شهر قبله ثم حذفه يجب ألّا تمحو الأساس ولا تُضاعفه."""
    import app.db.session as session_mod
    from app.db import models
    from app.services import budget_service as bs
    db = session_mod.SessionLocal()
    try:
        row = models.BudgetSnapshot(project=P, month=SEED, actual_month=100.0,
                                    planned_month=50.0, entry_source='file',
                                    cum_prev_actual=1000.0, cum_prev_planned=500.0)
        db.add(row)
        db.flush()
        bs.rebuild_chain(db, P)
        db.commit()
        assert Decimal(str(row.cum_actual)) == Decimal('1100.00')

        early = dt.date(2026, 8, 1)
        bs.upsert_manual(db, P, early.isoformat(), 7.0, 0.0, [], '', None, '',
                         force_conflict=True)
        db.refresh(row)
        assert Decimal(str(row.cum_actual)) == Decimal('1107.00')

        eid = bs._find_row(db, P, early).id
        assert bs.delete_snapshot(db, eid)
        db.refresh(row)
        assert Decimal(str(row.cum_actual)) == Decimal('1100.00')
        assert Decimal(str(row.cum_planned)) == Decimal('550.00')
    finally:
        db.close()
