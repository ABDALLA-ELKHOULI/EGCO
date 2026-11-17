# -*- coding: utf-8 -*-
"""اختبارات النسخ الاحتياطي (م-٤٥ · م-١٣) — النسخة تُفتح فعلاً بـsqlite وفيها
الجداول، التقليم يحترم السقف، اليومية لا تتكرر خلال ٢٤ ساعة، الحذف يرفض أي اسم
خارج النمط، والمجلد الخارجي يستقبل نسخته."""
import datetime as dt
import sqlite3

import pytest


@pytest.fixture()
def bs(api_client):
    """الخدمة بعد أن ضبط api_client مجلد EGCO_DATA_DIR مؤقتاً وأنشأ القاعدة."""
    from app.services import backup_service
    return backup_service


def _tables(path):
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    try:
        return {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()


def test_manual_backup_is_valid_sqlite_with_tables(api_client, bs):
    r = api_client.post('/api/v1/backups')
    assert r.status_code == 200, r.text
    b = r.json()['backup']
    assert b['kind'] == 'manual'
    assert b['name'].startswith('manual-') and b['name'].endswith('.db')
    assert b['size_bytes'] > 0
    tables = _tables(b['path'])
    assert {'suppliers', 'invoices', 'payments', 'contractors', 'app_settings'} <= tables

    listed = api_client.get('/api/v1/backups').json()
    assert [x['name'] for x in listed['items']] == [b['name']]
    assert listed['keep']['daily'] == 30


def test_backup_reflects_committed_rows(api_client, bs):
    """النسخة لقطة حقيقية: صف أُدخل قبلها يظهر فيها."""
    r = api_client.post('/api/v1/suppliers', json={
        'account': '2119', 'name': 'مورد نسخة', 'project': 'م', 'term': '30 يوم'})
    assert r.status_code == 201, r.text
    b = bs.create_backup('manual')
    conn = sqlite3.connect(f"file:{b['path']}?mode=ro", uri=True)
    try:
        n = conn.execute("SELECT count(*) FROM suppliers WHERE account='2119'").fetchone()[0]
    finally:
        conn.close()
    assert n == 1


def test_prune_keeps_limit_per_kind(bs):
    base = dt.datetime(2026, 1, 1, 9, 0, 0)
    for i in range(25):
        bs.create_backup('manual', now=base + dt.timedelta(minutes=i))
    names = [b['name'] for b in bs.list_backups() if b['kind'] == 'manual']
    assert len(names) == 20
    # الأقدم خمسة حُذفت والأحدث بقي
    assert 'manual-2026-01-01T09-00-00.db' not in names
    assert 'manual-2026-01-01T09-24-00.db' in names

    # نوع آخر لا يتأثر بتقليم غيره
    for i in range(12):
        bs.create_backup('before-import', now=base + dt.timedelta(hours=1, minutes=i))
    kinds = {}
    for b in bs.list_backups():
        kinds[b['kind']] = kinds.get(b['kind'], 0) + 1
    assert kinds == {'manual': 20, 'before-import': 10}


def test_daily_if_due_does_not_repeat_within_24h(bs):
    t0 = dt.datetime(2026, 3, 1, 8, 0, 0)
    first = bs.daily_if_due(now=t0)
    assert first is not None and first['kind'] == 'daily'
    # الملف يحمل mtime الآن الحقيقي؛ «الآن» للحساب = mtime + ساعات
    created = dt.datetime.fromisoformat(first['created_at'])
    assert bs.daily_if_due(now=created + dt.timedelta(hours=23)) is None
    second = bs.daily_if_due(now=created + dt.timedelta(hours=25))
    assert second is not None and second['name'] != first['name']
    assert sum(1 for b in bs.list_backups() if b['kind'] == 'daily') == 2


def test_daily_if_due_route(api_client):
    r = api_client.post('/api/v1/backups/daily-if-due')
    assert r.status_code == 200, r.text
    assert r.json()['taken'] is True
    r2 = api_client.post('/api/v1/backups/daily-if-due')
    assert r2.json()['taken'] is False
    assert r2.json()['lastDaily']['kind'] == 'daily'


@pytest.mark.parametrize('bad', [
    '../egco.db', '..%2Fegco.db', 'manual-..%2F..%2Fx.db', 'manual-x.db.txt',
    'evil-2026.db', 'manual-a%2Fb.db', 'manual-x.sqlite',
])
def test_delete_rejects_traversal_and_unknown_names(api_client, bad):
    r = api_client.delete('/api/v1/backups/' + bad)
    assert r.status_code in (400, 404), (bad, r.status_code, r.text)
    assert r.status_code != 200


def test_delete_service_rejects_dotdot_even_if_prefixed(bs, tmp_path):
    with pytest.raises(ValueError):
        bs.delete_backup('manual-../../x.db')
    # ملف حقيقي خارج المجلد لا يُمسّ
    outside = bs.backup_dir().parent / 'manual-outside.db'
    outside.write_bytes(b'x')
    with pytest.raises(ValueError):
        bs.delete_backup('../manual-outside.db')
    assert outside.exists()


def test_delete_existing_backup(api_client, bs):
    b = bs.create_backup('manual')
    r = api_client.delete('/api/v1/backups/' + b['name'])
    assert r.status_code == 200, r.text
    assert bs.list_backups() == []
    assert api_client.delete('/api/v1/backups/' + b['name']).status_code == 404


def test_external_dir_receives_copy_and_missing_dir_is_only_a_warning(api_client, bs, tmp_path):
    ext = tmp_path / 'icloud'
    ext.mkdir()
    r = api_client.put('/api/v1/backups/settings', json={'path': str(ext)})
    assert r.json() == {'externalDir': str(ext)}
    assert api_client.get('/api/v1/backups/settings').json() == {'externalDir': str(ext)}

    b = api_client.post('/api/v1/backups').json()['backup']
    assert 'warning' not in b
    assert (ext / b['name']).exists()
    assert _tables(ext / b['name']) == _tables(b['path'])

    # مجلد غير موجود: النسخة المحلية تنجح والتحذير يُذكر في الاستجابة
    api_client.put('/api/v1/backups/settings', json={'path': str(tmp_path / 'gone')})
    b2 = api_client.post('/api/v1/backups').json()['backup']
    assert 'warning' in b2 and 'غير موجود' in b2['warning']
    assert bs.verify_backup(bs.backup_dir() / b2['name'])

    # الإزالة
    assert api_client.put('/api/v1/backups/settings', json={'path': ''}).json() == {'externalDir': None}


def test_import_backup_uses_before_import_prefix_and_cap(api_client, bs, monkeypatch):
    """م-١٣: backup_db في import_service تكتب before-import-* بسقف ١٠."""
    from app.services import import_service
    base = dt.datetime(2026, 5, 1, 12, 0, 0)
    # نُثبّت الطابع لتفادي تصادم الأسماء في نفس الثانية
    for i in range(12):
        monkeypatch.setattr(bs, '_stamp', lambda now=None, i=i: (base + dt.timedelta(seconds=i)).strftime('%Y-%m-%dT%H-%M-%S'))
        import_service.backup_db()
    items = [b for b in bs.list_backups() if b['kind'] == 'before-import']
    assert len(items) == 10
    assert not list(bs.backup_dir().glob('egco-*.db'))
