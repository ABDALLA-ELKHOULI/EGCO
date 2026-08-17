# -*- coding: utf-8 -*-
"""اختبارات قارئ تقرير المديونيات المجمّع (xls) ومسار حفظه.

جزء بلا اتصال بقاعدة بيانات: دوال التصنيف/العناوين الخالصة في debts_report_xls،
تُختبر مباشرة بلا ملف. جزء التكامل مع الملف الحقيقي (skip إن لم يوجد — نفس نمط
tests/test_guarantee_import.py مع design/samples). جزء الحفظ عبر import_service
يُموّه debts_report_xls.parse() بنتيجة صناعية محكومة، فيختبر منطق الإنشاء/التحديث/
المطابقة بلا حاجة لكاتب xls (xlwt غير متاح في هذه البيئة).
"""
import importlib
import os

import pytest

from app.ingest import debts_report_xls as D

REAL_FILE = os.path.expanduser(
    '~/Downloads/تقرير مديونيات المقاولين والموردين للمشاريع حتى 07-13.xls')


# ---------------------------------------------------------------- دوال خالصة

def test_classify_sheet_prefers_guarantee_over_contractor():
    # اسم يحمل الكلمتين معاً — «ضمان المقاولين» يجب أن يُصنَّف ضماناً لا مقاولين
    assert D.classify_sheet('مديونية ضمان المقاولين حتى 13-7') == 'guarantee'
    assert D.classify_sheet('مديونية المقاولين حتى 13-7') == 'contractor'
    assert D.classify_sheet('مديونية الموردين 13-7') == 'supplier'
    assert D.classify_sheet('Report') is None


def test_sheet_project_hint():
    assert D._sheet_project_hint('الرسين مقاولين  13-7') == 'الرسين'
    assert D._sheet_project_hint('الرسين ضمان المقاولين 13-7') == 'الرسين'
    assert D._sheet_project_hint('بريمان المقاولين 13-7') == 'بريمان'
    # الأوراق المجمّعة تبدأ بـ«مديونية» ولا تحمل مشروعاً في اسمها
    assert D._sheet_project_hint('مديونية المقاولين حتى 13-7') == ''


def test_header_indices_contractor_layout():
    row1 = ['تبويب', 'الرصيد', '', 'اجمالي الحركة', '', '', '', 'الرصيد الافتتاحي',
            '', '', '', 'اسم الحساب', '', '', '', '', 'رقم الحساب']
    row2 = ['', 'الرصيد', '', 'دائن', '', 'مدين', '', 'دائن', '', 'مدين',
            '', '', '', '', '', '', '']
    idx = D._header_indices(row1, row2)
    assert idx == dict(account=16, name=11, project=0, balance=1,
                       period_credit=3, opening_credit=7,
                       period_debit=5, opening_debit=9)


def test_header_indices_guarantee_layout_no_spacer_column():
    row1 = ['تبويب', 'الرصيد', 'اجمالي الحركة', '', '', '', 'الرصيد الافتتاحي',
            '', '', '', 'اسم الحساب', '', '', '', '', 'رقم الحساب']
    row2 = ['', 'الرصيد', 'دائن', '', 'مدين', '', 'دائن', '', 'مدين',
            '', '', '', '', '', '', '']
    idx = D._header_indices(row1, row2)
    assert idx == dict(account=15, name=10, project=0, balance=1,
                       period_credit=2, opening_credit=6,
                       period_debit=4, opening_debit=8)


def test_header_indices_none_when_no_account_column():
    # أوراق Report/المحورية — بلا «رقم الحساب» — لا تخطيط معروف
    row1 = ['', '', '', 'المبلغ ', '', '', 'المشروع', 'أسماء الموردين']
    row2 = [''] * 8
    assert D._header_indices(row1, row2) is None


def test_row_project_falls_back_to_sheet_hint_when_column_is_zero():
    # عمود المشروع يصل أحياناً 0.0 رقمياً (لا نصاً فارغاً) في بعض صفوف الضمان
    assert D._row_project(0.0, 'الرسين') == 'الرسين'
    assert D._row_project('', 'الرسين') == 'الرسين'
    assert D._row_project('سدايم', 'الرسين') == 'سدايم'


# ---------------------------------------------------------------- الملف الحقيقي (اختياري)

pytestmark_real = pytest.mark.skipif(
    not os.path.exists(REAL_FILE), reason='real downloaded .xls not present in this checkout')


@pytestmark_real
def test_parse_real_file_row_counts_and_no_silent_loss():
    res = D.parse(REAL_FILE)
    from collections import Counter
    counts = Counter(r['kind'] for r in res['rows'])
    # الأوراق المجمّعة الثلاث وحدها تحدد هذه الأعداد؛ أوراق المشاريع مكرِّرة ومُستبعدة بالحذف
    assert counts['contractor'] == 322
    assert counts['supplier'] == 104
    assert counts['guarantee'] == 338
    assert res['issues'] == []      # لا صفوف بلا رقم حساب في هذا الملف

    by_account = {r['account']: r for r in res['rows']}
    row = by_account['21201018']
    assert row['name'] == 'مؤسسة سحاب الخير للمقاولات'
    assert row['project'] == 'سدايم'
    assert row['balance'] == pytest.approx(-5947.29, abs=0.01)


# ---------------------------------------------------------------- مسار الحفظ (مموَّه)

def _fake_parsed():
    return dict(
        sheets=[dict(name='مديونية المقاولين حتى 1-1', kind='contractor', project=None,
                     rowsFound=2, rowsSkipped=0, rowsDuplicate=0, skipReasons={})],
        issues=[],
        rows=[
            dict(kind='contractor', account='21200001', name='مقاول جديد',
                project='سدايم', balance=-100.0, periodCredit=100.0, periodDebit=0.0,
                openingCredit=0.0, openingDebit=0.0, sheet='s'),
            dict(kind='supplier', account='21100001', name='مورد جديد',
                project='الرسين', balance=-50.0, periodCredit=50.0, periodDebit=0.0,
                openingCredit=0.0, openingDebit=0.0, sheet='s'),
            dict(kind='guarantee', account='21600001', name='ضمان اعمال شركة تجريبية',
                project='', balance=-300.0, periodCredit=300.0, periodDebit=0.0,
                openingCredit=0.0, openingDebit=0.0, sheet='s'),
            # بادئة غير معروفة (217) — يجب أن تُرفض ولا تُحفظ أبداً
            dict(kind='guarantee', account='21700001', name='حساب غامض',
                project='', balance=-9.0, periodCredit=9.0, periodDebit=0.0,
                openingCredit=0.0, openingDebit=0.0, sheet='s'),
        ],
    )


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
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


def test_commit_creates_missing_records_and_skips_unknown_prefix(env, db, monkeypatch, tmp_path):
    monkeypatch.setattr(env.import_service.debts_report_xls, 'parse',
                        lambda path: _fake_parsed())
    fake_path = str(tmp_path / 'report.xls')

    res = env.import_service.commit_debts_report(db, fake_path)

    assert res['created'] == 3          # مقاول + مورد + ضمان، لا حساب 217 الغامض
    assert res['updated'] == 0
    assert res['skipped'] == 1          # 21700001 يحتاج تصنيفاً يدوياً
    assert res['needsClassification'][0]['account'] == '21700001'

    contractor = db.query(env.models.Contractor).filter_by(code='21200001').one()
    assert contractor.name == 'مقاول جديد'
    supplier = db.query(env.models.Supplier).filter_by(account='21100001').one()
    assert supplier.name == 'مورد جديد'
    assert supplier.project == 'الرسين'
    ga = db.query(env.models.GuaranteeAccount).filter_by(account='21600001').one()
    assert ga.balance == pytest.approx(300.0)   # abs() — عمود الضمان يخزّن المقدار

    # لم يُنشأ أي سجل للحساب المصنَّف يدوياً (217) — «اسأل، لا تخمّن»
    assert db.query(env.models.Contractor).filter_by(code='21700001').count() == 0
    assert db.query(env.models.GuaranteeAccount).filter_by(account='21700001').count() == 0

    log = db.query(env.models.ImportLog).filter_by(source='debts_report_xls').one()
    assert log.imported == 3
    assert log.skipped == 1


def test_commit_is_idempotent_and_flags_balance_mismatch(env, db, monkeypatch, tmp_path):
    monkeypatch.setattr(env.import_service.debts_report_xls, 'parse',
                        lambda path: _fake_parsed())
    fake_path = str(tmp_path / 'report.xls')

    env.import_service.commit_debts_report(db, fake_path)

    # حركة فعلية على المقاول لا تطابق رصيد الملف (−100) — يجب أن يُبلَّغ عن الفرق
    # لا أن يُكتب رصيد الملف فوق المحسوب (لا عمود رصيد على Contractor أصلاً)
    contractor = db.query(env.models.Contractor).filter_by(code='21200001').one()
    db.add(env.models.ContractorEntry(contractor_id=contractor.id,
                                      date=__import__('datetime').date(2026, 1, 1),
                                      debit=500.0, credit=0.0, doc='d1',
                                      description='دفعة', kind='payment',
                                      source='manual'))
    db.commit()

    res = env.import_service.commit_debts_report(db, fake_path)

    # الاستيراد الثاني: لا سجلات جديدة، الثلاثة موجودة أصلاً فتُحدَّث لا تُنشأ
    assert res['created'] == 0
    assert res['updated'] == 3

    mismatches = [w for w in res['reconcileWarnings'] if w['account'] == '21200001']
    assert len(mismatches) == 1
    assert 'يختلف عن الرصيد المحسوب' in mismatches[0]['message']

    # الرصيد المشتق يبقى محسوباً من الحركات فقط — الملف لم يكتب فوقه شيئاً
    assert not hasattr(contractor, 'balance')
