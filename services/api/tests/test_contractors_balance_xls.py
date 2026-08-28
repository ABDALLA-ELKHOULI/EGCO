# -*- coding: utf-8 -*-
"""اختبارات قارئ «كشف المقاولين» (contractors_balance_xls) ومسار حفظه.

جزء بلا اتصال بقاعدة بيانات: استخراج فهارس الأعمدة، بلا ملف. جزء التكامل مع
الملف الحقيقي (skip إن لم يوجد — نفس نمط test_debts_report_xls.py). جزء الحفظ
عبر import_service يستعمل قاعدة بيانات مؤقتة حقيقية (api_client) مع تمويه
contractors_balance_xls.parse بنتيجة صناعية محكومة كي لا يحتاج الاختبار كاتب xls.
"""
import importlib
import os

import pytest

from conftest import sample_missing
from app.ingest import contractors_balance_xls as M

REAL_FILE = os.path.expanduser('~/Downloads/كشف المقاولين 25-8.xls')


# ---------------------------------------------------------------- fixtures (نمط test_contractors.py)

@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.contractors_service as contractors_service_mod
    importlib.reload(contractors_service_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)

    session_mod.init_db()

    class Env:
        pass

    e = Env()
    e.session = session_mod
    e.models = models_mod
    e.import_service = import_service_mod
    return e


@pytest.fixture()
def db(env):
    session = env.session.SessionLocal()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------- دوال خالصة

def test_header_indices_matches_observed_layout():
    row1 = ['تبويب', 'اجمالي الرصيد', '', 'اجمالي الحركة', '', '', '',
            'الرصيد الافتتاحي', '', '', '', 'اسم الحساب', '', '', '', '',
            'رقم الحساب', '', '', '']
    row2 = ['', 'الرصيد', '', 'دائن', '', 'مدين', '', 'دائن', '', 'مدين',
            '', '', '', '', '', '', '', '', '', '']
    idx = M._header_indices(row1, row2)
    assert idx == dict(project=0, balance=1, period_credit=3, period_debit=5,
                       opening_credit=7, opening_debit=9, name=11, account=16)


def test_header_indices_none_without_account_column():
    row1 = ['تبويب'] * 5
    row2 = ['الرصيد', 'دائن', 'مدين', 'دائن', 'مدين']
    assert M._header_indices(row1, row2) is None


# ---------------------------------------------------------------- الملف الحقيقي

pytestmark_real = pytest.mark.skipif(
    sample_missing(REAL_FILE), reason='real downloaded .xls not present in this checkout')


@pytestmark_real
def test_parse_real_file_master_sheet_only():
    res = M.parse(REAL_FILE)
    assert res['asOfDate'] and res['fromDate']
    assert len(res['rows']) == 599
    accounts = [r['account'] for r in res['rows']]
    assert len(accounts) == len(set(accounts))       # لا تكرار
    assert all(a.startswith('212') for a in accounts)
    # الأوراق الفرعية سُجّلت للمقارنة، لم تُضف صفوفها لـ rows
    assert res['sheets'][0]['role'] == 'master'
    assert res['sheets'][0]['rows'] == 599
    for s in res['sheets'][1:]:
        assert s['role'] in ('cross_check', 'skipped')


@pytestmark_real
def test_parse_real_file_sign_convention_pinned_row():
    """صفّ حقيقي من الملف — رصيد سالب يعني أننا مدينون له (owed_to_them)،
    مطابقةً لـ `_direction_of` في contractors_service.py."""
    res = M.parse(REAL_FILE)
    row = next(r for r in res['rows'] if r['account'] == '21201001')
    assert row['balance'] < 0
    # نفس منطق _direction_of: balance < 0 -> نحن ندين له
    direction = 'owed_to_them' if row['balance'] < 0 else (
        'owed_to_us' if row['balance'] > 0 else 'balanced')
    assert direction == 'owed_to_them'


@pytestmark_real
def test_accounting_equation_holds_no_issues():
    res = M.parse(REAL_FILE)
    equation_issues = [i for i in res['issues'] if i.get('kind') == 'equation_mismatch']
    assert equation_issues == []


# ---------------------------------------------------------------- مسار الحفظ

def _fake_parsed():
    return dict(
        asOfDate='2026-08-25', fromDate='2025-01-01',
        rows=[
            dict(account='21299001', name='مقاول تجريبي', project='روشن',
                openingDebit=0.0, openingCredit=1000.0,
                movementDebit=4000.0, movementCredit=2000.0,
                balance=1000.0, sheet='master'),
            dict(account='21299002', name='مقاول آخر', project='المدينة',
                openingDebit=500.0, openingCredit=0.0,
                movementDebit=0.0, movementCredit=1500.0,
                balance=-1000.0, sheet='master'),
        ],
        sheets=[dict(name='master', role='master', rows=2, duplicates=0)],
        totals=dict(accounts=2, positiveCount=1, positiveSum=1000.0,
                   negativeCount=1, negativeSum=-1000.0, zeroCount=0, net=0.0),
        issues=[])


def test_commit_creates_contractors_and_two_entries_each(env, db, monkeypatch):
    import_service = env.import_service
    monkeypatch.setattr(import_service.contractors_balance_xls, 'parse',
                        lambda path: _fake_parsed())

    res = import_service.commit_contractors_balance(db, '/fake/path.xls')
    assert res['created'] == 2
    assert res['updated'] == 0

    from app.db import models
    c1 = db.query(models.Contractor).filter_by(code='21299001').one()
    assert c1.status == 'active'
    assert c1.reported_balance == 1000.0
    entries = db.query(models.ContractorEntry).filter_by(
        contractor_id=c1.id, source='balance_snapshot').all()
    assert len(entries) == 2
    kinds = sorted(e.kind for e in entries)
    assert kinds == ['opening', 'other']
    balance = sum(e.debit - e.credit for e in entries)
    assert balance == 1000.0

    c2 = db.query(models.Contractor).filter_by(code='21299002').one()
    entries2 = db.query(models.ContractorEntry).filter_by(
        contractor_id=c2.id, source='balance_snapshot').all()
    assert sum(e.debit - e.credit for e in entries2) == -1000.0


def test_reimport_same_file_does_not_duplicate(env, db, monkeypatch):
    import_service = env.import_service
    monkeypatch.setattr(import_service.contractors_balance_xls, 'parse',
                        lambda path: _fake_parsed())

    import_service.commit_contractors_balance(db, '/fake/path.xls')
    from app.db import models
    c1 = db.query(models.Contractor).filter_by(code='21299001').one()
    before = db.query(models.ContractorEntry).filter_by(
        contractor_id=c1.id, source='balance_snapshot',
    ).filter(models.ContractorEntry.deleted_at.is_(None)).count()
    before_balance = sum(
        e.debit - e.credit for e in db.query(models.ContractorEntry).filter_by(
            contractor_id=c1.id, source='balance_snapshot').filter(
            models.ContractorEntry.deleted_at.is_(None)).all())

    res2 = import_service.commit_contractors_balance(db, '/fake/path.xls')
    after = db.query(models.ContractorEntry).filter_by(
        contractor_id=c1.id, source='balance_snapshot',
    ).filter(models.ContractorEntry.deleted_at.is_(None)).count()
    after_balance = sum(
        e.debit - e.credit for e in db.query(models.ContractorEntry).filter_by(
            contractor_id=c1.id, source='balance_snapshot').filter(
            models.ContractorEntry.deleted_at.is_(None)).all())

    assert after == before == 2
    assert after_balance == before_balance
    # الطلب الثاني: كل الحسابات كانت موجودة بالفعل، لا إنشاء جديد
    assert res2['created'] == 0


def test_newer_snapshot_replaces_old_amounts(env, db, monkeypatch):
    import_service = env.import_service
    monkeypatch.setattr(import_service.contractors_balance_xls, 'parse',
                        lambda path: _fake_parsed())
    import_service.commit_contractors_balance(db, '/fake/path.xls')

    newer = _fake_parsed()
    newer['asOfDate'] = '2026-09-25'
    newer['rows'][0]['balance'] = 5000.0
    newer['rows'][0]['movementDebit'] = 8000.0
    monkeypatch.setattr(import_service.contractors_balance_xls, 'parse',
                        lambda path: newer)
    import_service.commit_contractors_balance(db, '/fake/path2.xls')

    from app.db import models
    c1 = db.query(models.Contractor).filter_by(code='21299001').one()
    live = db.query(models.ContractorEntry).filter_by(
        contractor_id=c1.id, source='balance_snapshot').filter(
        models.ContractorEntry.deleted_at.is_(None)).all()
    assert len(live) == 2
    assert sum(e.debit - e.credit for e in live) == 5000.0
    dead = db.query(models.ContractorEntry).filter_by(
        contractor_id=c1.id, source='balance_snapshot').filter(
        models.ContractorEntry.deleted_at.isnot(None)).count()
    assert dead == 2


def test_real_statement_supersedes_snapshot_entries(env, db, monkeypatch):
    """كشف حساب حقيقي (source='statement') يصل بعد اللقطة — حركات اللقطة تُصفّى
    فوراً كي لا يُحسب المبلغ مرتين، حتى قبل أي إعادة رفع للقطة."""
    import_service = env.import_service
    models = env.models
    monkeypatch.setattr(import_service.contractors_balance_xls, 'parse',
                        lambda path: _fake_parsed())
    import_service.commit_contractors_balance(db, '/fake/path.xls')

    c1 = db.query(models.Contractor).filter_by(code='21299001').one()
    assert db.query(models.ContractorEntry).filter_by(
        contractor_id=c1.id, source='balance_snapshot').filter(
        models.ContractorEntry.deleted_at.is_(None)).count() == 2

    # كشف حساب حقيقي يصل الآن لنفس المقاول عبر _commit_contractor
    statement_parsed = dict(account='21299001', name='مقاول تجريبي',
                            rows=[dict(date=__import__('datetime').date(2026, 8, 1),
                                      debit=0.0, credit=500.0, doc='1',
                                      description='مستخلص 1', kind='claim')],
                            account_balance=500.0)
    monkeypatch.setattr(
        import_service, '_contractor_preview',
        lambda parsed, db_: dict(reconciled=True, issues=[], account=parsed['account']))
    res = import_service._commit_contractor(db, statement_parsed, '/fake/statement.pdf',
                                            allow_unreconciled=True, backup=False)
    assert res['saved'] is True

    live_snapshot = db.query(models.ContractorEntry).filter_by(
        contractor_id=c1.id, source='balance_snapshot').filter(
        models.ContractorEntry.deleted_at.is_(None)).count()
    assert live_snapshot == 0

    # ولاحقاً: استيراد نفس اللقطة مرة أخرى لا يُنشئ حركات لقطة جديدة لهذا المقاول
    # (لا شيء يُصفّى الآن لأن التصفية حدثت بالفعل أعلاه عند وصول الكشف الحقيقي)
    import_service.commit_contractors_balance(db, '/fake/path.xls')
    still_zero = db.query(models.ContractorEntry).filter_by(
        contractor_id=c1.id, source='balance_snapshot').filter(
        models.ContractorEntry.deleted_at.is_(None)).count()
    assert still_zero == 0


def test_duplicates_scanner_reports_zero_after_double_import(env, db, monkeypatch):
    """GET /api/v1/import/duplicates لا يجب أن يرى حركات balance_snapshot كتكرار —
    نفس آلية إعادة الرفع الصامتة تُبقي صفاً واحداً حياً لكل هوية."""
    import_service = env.import_service
    monkeypatch.setattr(import_service.contractors_balance_xls, 'parse',
                        lambda path: _fake_parsed())
    import_service.commit_contractors_balance(db, '/fake/path.xls')
    import_service.commit_contractors_balance(db, '/fake/path.xls')

    dup = import_service.scan_all_duplicates(db)
    assert dup['count'] == 0
