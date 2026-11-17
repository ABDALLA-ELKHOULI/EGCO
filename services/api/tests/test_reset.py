# -*- coding: utf-8 -*-
"""اختبارات تصفير البيانات.

هذه الميزة الوحيدة التي يعني خللٌ فيها فقدان كل شيء، فالاختبارات تغطّي الرفض
قبل القبول: تأكيد خاطئ لا يحذف، فشل النسخة الاحتياطية لا يحذف، والإعدادات لا
تُمسّ. ثم تتحقق أن المحو فعليّ لا منطقيّ، وأن النسخة تحمل البيانات قبل المحو —
نسخةٌ فارغة أسوأ من لا نسخة، لأنها تُطمئن كذباً.
"""
import sqlite3

import pytest


def _seed(api_client):
    """مورد بفاتورة ودفعة، ومقاول بحركة، وإعداد — أقل ما يثبت السلوك."""
    api_client.post('/api/v1/suppliers', json=dict(
        account='2110999', name='مورد الاختبار', project='الرسين', term='٣٠ يوم'))
    api_client.post('/api/v1/manual/invoices', json=dict(
        account='2110999', amount=1000.0, date='2026-01-05', description='فاتورة'))
    api_client.post('/api/v1/manual/payments', json=dict(
        account='2110999', amount=400.0, date='2026-02-05', description='دفعة'))
    api_client.post('/api/v1/contractors', json=dict(
        code='2120999', name='مقاول الاختبار'))
    api_client.post('/api/v1/contractors/2120999/entries', json=dict(
        date='2026-01-10', debit=0, credit=500.0, description='مستخلص'))


def _counts(api_client):
    return dict(
        suppliers=len(api_client.get('/api/v1/suppliers').json()['rows']),
        contractors=len(api_client.get('/api/v1/contractors').json()['rows']),
    )


def test_preview_counts_what_will_be_wiped_and_kept(api_client):
    _seed(api_client)
    p = api_client.get('/api/v1/reset/preview')
    assert p.status_code == 200, p.text
    d = p.json()

    wiped = {r['table']: r['count'] for r in d['wipes']}
    assert wiped['suppliers'] == 1
    assert wiped['contractors'] == 1
    assert wiped['invoices'] == 1
    assert wiped['payments'] == 1
    assert wiped['contractor_entries'] == 1
    assert d['totalRows'] >= 5
    assert d['isEmpty'] is False

    kept = {r['table'] for r in d['keeps']}
    assert 'app_settings' in kept and 'learned_layouts' in kept
    # الإعدادات لا تُدرج ضمن ما يُحذف — خلطها هنا يعني فقدان مفتاح الذكاء
    assert 'app_settings' not in wiped


def test_wrong_confirmation_deletes_nothing(api_client):
    _seed(api_client)
    before = _counts(api_client)

    for bad in ('', 'نعم', 'reset', ' تصفير x'):
        r = api_client.post('/api/v1/reset', json=dict(confirm=bad))
        assert r.status_code == 400, 'قُبل تأكيد خاطئ: %r' % bad
        assert 'تصفير' in r.json()['detail']

    assert _counts(api_client) == before, 'حُذفت بيانات رغم رفض التأكيد'


def test_reset_wipes_data_keeps_settings_and_leaves_a_backup(api_client):
    _seed(api_client)
    # إعداد يجب أن ينجو
    api_client.put('/api/v1/backups/settings', json=dict(path=None))
    from app.db.session import SessionLocal
    from app.db import models
    db = SessionLocal()
    db.add(models.AppSetting(key='ai_provider_test', value='kept'))
    db.commit()
    db.close()

    r = api_client.post('/api/v1/reset', json=dict(confirm='تصفير'))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['reset'] is True
    assert d['totalDeleted'] >= 5
    assert d['deleted']['suppliers'] == 1
    assert d['deleted']['contractors'] == 1

    # الشاشات فارغة فعلاً
    assert _counts(api_client) == dict(suppliers=0, contractors=0)

    # حذف فعلي لا منطقي — لا شيء ينتظر في سلّة المحذوفات
    trash = api_client.get('/api/v1/trash').json()
    assert sum(len(v) for v in trash.values() if isinstance(v, list)) == 0

    # الإعداد نجا
    db = SessionLocal()
    kept = db.query(models.AppSetting).filter_by(key='ai_provider_test').one_or_none()
    db.close()
    assert kept is not None and kept.value == 'kept', 'مُحيت الإعدادات مع البيانات'

    # النسخة موجودة ومسمّاة ومذكورة في النتيجة
    assert d['backup'] and d['backup'].startswith('before-reset-')
    listed = api_client.get('/api/v1/backups').json()['items']
    names = [b['name'] for b in listed]
    assert d['backup'] in names


def test_backup_taken_before_reset_still_contains_the_data(api_client):
    """النسخة تُؤخذ قبل المحو — وإلا كانت نسخة من قاعدة فارغة تُطمئن كذباً."""
    _seed(api_client)
    r = api_client.post('/api/v1/reset', json=dict(confirm='تصفير'))
    assert r.status_code == 200, r.text
    path = r.json()['backupInfo']['path']

    conn = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
    try:
        assert conn.execute('SELECT COUNT(*) FROM suppliers').fetchone()[0] == 1
        assert conn.execute('SELECT COUNT(*) FROM invoices').fetchone()[0] == 1
        assert conn.execute('SELECT COUNT(*) FROM contractors').fetchone()[0] == 1
    finally:
        conn.close()


def test_failed_backup_aborts_and_keeps_every_row(api_client, monkeypatch):
    """إن تعذّرت النسخة لا يُمحى شيء — الرفض هو الحماية نفسها."""
    _seed(api_client)
    before = _counts(api_client)

    from app.services import backup_service
    def boom(*a, **k):
        raise OSError('القرص ممتلئ')
    monkeypatch.setattr(backup_service, 'create_backup', boom)

    r = api_client.post('/api/v1/reset', json=dict(confirm='تصفير'))
    assert r.status_code == 500
    assert 'لم يُحذف شيء' in r.json()['detail']
    assert _counts(api_client) == before, 'مُحيت البيانات رغم فشل النسخة'


def test_reset_on_empty_database_is_harmless(api_client):
    p = api_client.get('/api/v1/reset/preview').json()
    assert p['isEmpty'] is True
    r = api_client.post('/api/v1/reset', json=dict(confirm='تصفير'))
    assert r.status_code == 200
    assert r.json()['totalDeleted'] == 0
