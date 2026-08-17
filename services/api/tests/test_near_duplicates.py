# -*- coding: utf-8 -*-
"""اختبارات «التكرار المحتمل» — الحركة نفسها بسند مختلف.

القيد الفريد يمنع الصف المطابق حرفياً فقط؛ حركة أُعيد إصدار سندها تمرّ منه ومن
فلترة التكرار معاً فتُضاعف المبلغ بصمت. هذه الاختبارات تثبّت أن الرصد يظهر في
المعاينة وفي نتيجة الاستيراد وفي سجل الرفع، وأنه **معلوماتي بحت**: لا يحذف صفاً،
ولا يغيّر عدد الصفوف المحفوظة، ولا يمسّ بوابة المطابقة في أي اتجاه.
"""
import datetime as dt
import importlib
import json
import os
from decimal import Decimal

import pytest

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
SUPPLIERS_XLSX = os.path.join(SAMPLES, 'suppliers-terms.xlsx')


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.payables_service as payables_service_mod
    importlib.reload(payables_service_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)
    import app.api.routes.imports as imports_route
    importlib.reload(imports_route)

    session_mod.init_db()

    class Env:
        pass

    e = Env()
    e.session = session_mod
    e.models = models_mod
    e.import_service = import_service_mod
    e.imports_route = imports_route
    return e


@pytest.fixture()
def db(env):
    session = env.session.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(env):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(env.imports_route.router, prefix='/import')
    with TestClient(app) as c:
        yield c


ACCOUNT = '2119999'


def _supplier(db, env, account=ACCOUNT):
    s = env.models.Supplier(account=account, name='مورد الاختبار', project='روشن',
                            term_raw='كاش', term_kind='cash', term_days=0)
    db.add(s)
    db.commit()
    return s


def _csv(tmp_path, name, body):
    p = tmp_path / name
    p.write_text('التاريخ,مدين,دائن,رقم المستند,الوصف,الحساب\n' + body,
                 encoding='utf-8-sig')
    return str(p)


#: كشف يحمل الحركة نفسها مرتين بسندين مختلفين — نفس التاريخ ونفس المبلغ ونفس الوصف
REISSUED_VOUCHER = (
    '01-02-2026,,1000.00,00001111,فاتورة توريد حديد مشروع روشن,%s\n'
    '01-02-2026,,1000.00,00002222,فاتورة توريد حديد مشروع روشن,%s\n' % (ACCOUNT, ACCOUNT)
)

#: فاتورتان مستقلتان بنفس اليوم والمبلغ — تختلفان في رقم الفاتورة داخل الوصف.
#: هذه هي الحالة المشروعة الشائعة فعلاً في قاعدة المستخدم (شركة مدار، ارتك).
TWO_REAL_INVOICES = (
    '01-02-2026,,1000.00,00001111,فاتورة14553760 مشروع روشن,%s\n'
    '01-02-2026,,1000.00,00001111,فاتورة14553761 مشروع روشن,%s\n' % (ACCOUNT, ACCOUNT)
)


# ---------------------------------------------------------------- القاعدة نفسها

def _row(env, **kw):
    kw.setdefault('kind', 'invoice')
    kw.setdefault('date', dt.date(2026, 2, 1))
    kw.setdefault('amount', Decimal('1000.00'))
    return env.import_service._nd_row(
        kw['kind'], kw['date'], kw['amount'], kw.get('doc', ''),
        kw.get('description', ''), kw.get('number'))


def test_same_invoice_number_different_doc_is_flagged(env):
    rows = [_row(env, doc='00001111', description='فاتورة رقم 5501', number='5501'),
            _row(env, doc='00002222', description='فاتورة رقم 5501', number='5501')]
    pairs = env.import_service.find_near_duplicates(rows)
    assert len(pairs) == 1
    assert pairs[0]['kind'] == 'near_duplicate'
    assert pairs[0]['scope'] == 'file'
    assert 'حركتان بنفس التاريخ والمبلغ ويختلف سندهما' in pairs[0]['message']
    # الوصفان والسندان يظهران معاً — المستخدم يحكم بعينه
    assert '00001111' in pairs[0]['message'] and '00002222' in pairs[0]['message']
    assert pairs[0]['a']['doc'] == '00001111' and pairs[0]['b']['doc'] == '00002222'


def test_different_invoice_numbers_are_not_flagged(env):
    """مورد واحد يصدر عدة فواتير بنفس اليوم والقيمة — حالة مشروعة تماماً."""
    rows = [_row(env, doc='00001111', description='فاتورة رقم 5501', number='5501'),
            _row(env, doc='00001111', description='فاتورة رقم 5502', number='5502')]
    assert env.import_service.find_near_duplicates(rows) == []


def test_descriptions_with_different_numbers_are_not_flagged(env):
    """بلا رقم فاتورة: أرقام الوصف هي الفاصل (حالة «شركة مدار» الحقيقية)."""
    rows = [_row(env, doc='00000359', description='0001فاتورة14553760 شركة مدار'),
            _row(env, doc='00000359', description='0001فاتورة14553761 شركة مدار')]
    assert env.import_service.find_near_duplicates(rows) == []


def test_identical_rows_are_not_flagged_here(env):
    """التطابق الحرفي شأن القيد الفريد وفلترة التكرار، لا شأن هذا التحذير."""
    rows = [_row(env, doc='00001111', description='نفس الوصف', number='5501'),
            _row(env, doc='00001111', description='نفس الوصف', number='5501')]
    assert env.import_service.find_near_duplicates(rows) == []


def test_different_amount_or_date_is_not_flagged(env):
    rows = [_row(env, doc='00001111', description='دفعة', kind='payment'),
            _row(env, doc='00002222', description='دفعة', kind='payment',
                 amount=Decimal('1000.01'))]
    assert env.import_service.find_near_duplicates(rows) == []
    rows = [_row(env, doc='00001111', description='دفعة', kind='payment'),
            _row(env, doc='00002222', description='دفعة', kind='payment',
                 date=dt.date(2026, 2, 2))]
    assert env.import_service.find_near_duplicates(rows) == []


def test_invoice_and_payment_of_same_amount_never_match(env):
    rows = [_row(env, doc='00001111', description='حديد', kind='invoice'),
            _row(env, doc='00002222', description='حديد', kind='payment')]
    assert env.import_service.find_near_duplicates(rows) == []


def test_existing_db_rows_are_compared_as_scope_db(env):
    incoming = [_row(env, doc='00002222', description='فاتورة رقم 5501', number='5501')]
    existing = [_row(env, doc='00001111', description='فاتورة رقم 5501', number='5501')]
    pairs = env.import_service.find_near_duplicates(incoming, existing)
    assert len(pairs) == 1 and pairs[0]['scope'] == 'db'


def test_pair_list_is_capped_with_a_summary_line(env):
    rows = []
    for i in range(60):
        rows.append(_row(env, doc='doc%d' % i, description='فاتورة رقم 5501',
                         number='5501'))
    pairs = env.import_service.find_near_duplicates(rows)
    assert len(pairs) == env.import_service._NEAR_DUP_LIMIT + 1
    assert pairs[-1]['kind'] == 'near_duplicate_more'


# ---------------------------------------------------------------- المعاينة والحفظ

def test_preview_surfaces_near_duplicate_in_arabic(tmp_path, db, env):
    _supplier(db, env)
    path = _csv(tmp_path, 'reissued.csv', REISSUED_VOUCHER)
    pre = env.import_service.preview_statement(path, 'csv_statement', db)
    assert len(pre['nearDuplicates']) == 1
    assert 'تأكّد أنهما ليستا حركة واحدة' in pre['nearDuplicates'][0]['message']
    # يظهر أيضاً ضمن issues العامة التي تُخزَّن مع سجل الرفع
    assert any(i.get('kind') == 'near_duplicate' for i in pre['issues'])


def test_warning_never_changes_the_saved_row_count(tmp_path, db, env):
    """الرصد لا يحذف ولا يدمج — الصفّان يُحفظان كما هما ويُعدّان كما حُفظا."""
    _supplier(db, env)
    path = _csv(tmp_path, 'reissued.csv', REISSUED_VOUCHER)
    res = env.import_service.commit_statement(db, path, source='csv_statement',
                                              backup=False)
    assert res['saved'] is True
    assert res['added'] == 2 and res['skipped'] == 0
    supplier = db.query(env.models.Supplier).filter_by(account=ACCOUNT).one()
    live = db.query(env.models.Invoice).filter(
        env.models.Invoice.supplier_id == supplier.id,
        env.models.Invoice.deleted_at.is_(None)).count()
    assert live == res['added'] == 2
    log = db.query(env.models.ImportLog).filter_by(path=path).one()
    assert log.imported == 2
    assert len(res['nearDuplicates']) == 1


def test_warning_is_stored_in_the_import_log_issues(tmp_path, db, env):
    _supplier(db, env)
    path = _csv(tmp_path, 'reissued.csv', REISSUED_VOUCHER)
    env.import_service.commit_statement(db, path, source='csv_statement', backup=False)
    log = db.query(env.models.ImportLog).filter_by(path=path).one()
    stored = json.loads(log.issues)
    flagged = [i for i in stored if i.get('kind') == 'near_duplicate']
    assert len(flagged) == 1
    assert 'حركتان بنفس التاريخ والمبلغ' in flagged[0]['message']


def test_second_file_repeating_a_saved_transaction_is_flagged(tmp_path, db, env):
    """التصديران المتداخلان: ملف اليوم يعيد حركة محفوظة أمس بسند آخر."""
    _supplier(db, env)
    first = _csv(tmp_path, 'day1.csv',
                 '01-02-2026,,1000.00,00001111,فاتورة توريد حديد مشروع روشن,%s\n' % ACCOUNT)
    env.import_service.commit_statement(db, first, source='csv_statement', backup=False)
    second = _csv(tmp_path, 'day2.csv',
                  '01-02-2026,,1000.00,00002222,فاتورة توريد حديد مشروع روشن,%s\n' % ACCOUNT)
    res = env.import_service.commit_statement(db, second, source='csv_statement',
                                              backup=False)
    assert res['saved'] is True and res['added'] == 1
    assert [p['scope'] for p in res['nearDuplicates']] == ['db']


def test_legitimate_same_day_invoices_produce_no_warning(tmp_path, db, env):
    _supplier(db, env)
    path = _csv(tmp_path, 'legit.csv', TWO_REAL_INVOICES)
    res = env.import_service.commit_statement(db, path, source='csv_statement',
                                              backup=False)
    assert res['saved'] is True and res['added'] == 2
    assert res['nearDuplicates'] == []


# ---------------------------------------------------------------- بوابة المطابقة

def test_reconciliation_gate_is_untouched(tmp_path, db, env, monkeypatch):
    """الملف غير المطابق يبقى مرفوضاً ولو حمل تحذير تكرار، والمطابق يبقى مقبولاً."""
    _supplier(db, env)
    path = _csv(tmp_path, 'reissued.csv', REISSUED_VOUCHER)
    pre = env.import_service.preview_statement(path, 'csv_statement', db)
    assert pre['reconciled'] is True and pre['nearDuplicates']

    # نفرض عدم مطابقة (كشف CSV لا يطبع رصيداً) بتزييف رصيد مطبوع مخالف
    import app.ingest.csv_statement as csv_mod
    real_parse = csv_mod.parse

    def unreconciled_parse(p):
        out = real_parse(p)
        out['statement_balance'] = -999999.0
        return out

    monkeypatch.setattr(csv_mod, 'parse', unreconciled_parse)
    monkeypatch.setitem(env.import_service._PARSERS, 'csv_statement', unreconciled_parse)
    res = env.import_service.commit_statement(db, path, source='csv_statement',
                                              backup=False)
    assert res['saved'] is False and res['reason'] == 'not_reconciled'
    assert res['nearDuplicates']          # التحذير يُعرض ولا يُنقذ الملف


# ---------------------------------------------------------------- المسارات

def test_preview_route_returns_near_duplicates(tmp_path, db, env, client):
    _supplier(db, env)
    path = _csv(tmp_path, 'reissued.csv', REISSUED_VOUCHER)
    r = client.post('/import/preview', json=dict(path=path, source='csv_statement'))
    assert r.status_code == 200
    body = r.json()
    assert len(body['nearDuplicates']) == 1
    assert 'ليستا حركة واحدة' in body['nearDuplicates'][0]['message']


def test_near_duplicates_route_after_the_fact(tmp_path, db, env, client):
    """بعد الرفع بأيام: تُطلب بالحساب لا بالملف، وتشمل ما امتدّ بين ملفين."""
    _supplier(db, env)
    path = _csv(tmp_path, 'reissued.csv', REISSUED_VOUCHER)
    env.import_service.commit_statement(db, path, source='csv_statement', backup=False)

    r = client.get('/import/near-duplicates', params=dict(account=ACCOUNT))
    assert r.status_code == 200
    body = r.json()
    assert body['kind'] == 'supplier' and body['name'] == 'مورد الاختبار'
    assert len(body['pairs']) == 1
    assert 'حركتان بنفس التاريخ والمبلغ' in body['pairs'][0]['message']
    # وأيضاً كما سُجّلت وقت الرفع، عبر آلية ملاحظات سجل الرفع نفسها
    assert len(body['logged']) == 1
    assert body['logged'][0]['fileName'] == os.path.basename(path)


def test_near_duplicates_route_unknown_account_is_empty(client, env, db):
    r = client.get('/import/near-duplicates', params=dict(account='2119000'))
    assert r.status_code == 200
    assert r.json()['pairs'] == [] and r.json()['kind'] is None


def test_truncated_description_updates_instead_of_duplicating(db, tmp_path):
    """وصفٌ قديم مقتطع + وصفٌ كامل لنفس الحركة = تحديث، لا صفٌّ ثانٍ.

    هذا الطرف المقابل لاختبار الفاتورتين المشروعتين أعلاه: القاعدة نفسها يجب
    أن تفرّق بين نصٍّ هو بدايةُ الآخر (نسخة أقدم من المحلّل) ونصّين مختلفين
    (حركتان). كسْرُ أيّ الطرفين يكلّف مالاً: الأول تكراراً، والثاني محواً.
    """
    from app.services.import_service import _match_ignoring_description
    from app.db import models

    sup = models.Supplier(name='مدار', account='2110808')
    db.add(sup); db.flush()
    inv = models.Invoice(supplier_id=sup.id, number='6966', date=dt.date(2025, 5, 5),
                         amount=100.0, doc='00000496', description='فاتوره رقم6966')
    db.add(inv); db.flush()

    keys = dict(supplier_id=sup.id, date=inv.date, amount=inv.amount, doc=inv.doc)
    # الوصف الكامل يبدأ بالمقتطع ← نفس الحركة
    assert _match_ignoring_description(
        db, models.Invoice,
        new_description='فاتوره رقم6966 ( لشركة مدار لمواد البناء )', **keys) is inv
    # وصف مختلف تماماً ← حركة أخرى، لا تُدمج
    assert _match_ignoring_description(
        db, models.Invoice, new_description='فاتوره رقم6967', **keys) is None


def test_old_stored_description_with_branch_prefix_is_not_a_new_row(db):
    """وصفٌ مخزَّن يحمل رمز الفرع + وصفٌ جديد بدونه = نفس الحركة.

    هذا عطب v0.9.2 الذي رآه المستخدم: النسخ الأقدم كانت تُبقي «0001» في بداية
    الوصف على التخطيط الملتصق. القاعدة السابقة قارنت النصّين خاماً وقبلت
    «الأقدم بدايةُ الأحدث» فقط — و«0001فاتوره…» ليس بدايةَ «فاتوره…»، فأُضيفت
    الحركة من جديد مع كل رفع. المقارنة يجب أن تجري على نصٍّ مُطبَّع: بلا رمز
    فرع، وبتطبيع عربي موحّد، وبلا مسافات.
    """
    from app.services.import_service import _match_ignoring_description
    from app.db import models

    sup = models.Supplier(name='ارتك', account='2110099')
    db.add(sup); db.flush()
    inv = models.Invoice(supplier_id=sup.id, number='3508', date=dt.date(2025, 1, 26),
                         amount=8249.82, doc='00000123',
                         description='0001فاتوره رقم3508 لشركھ ارتك للبلاط')
    db.add(inv); db.flush()

    keys = dict(supplier_id=sup.id, date=inv.date, amount=inv.amount, doc=inv.doc)
    assert _match_ignoring_description(
        db, models.Invoice,
        new_description='فاتوره رقم3508 لشركه ارتك للبلاط', **keys) is inv
    # وفاتورة أخرى برقم مختلف تبقى حركة مستقلة
    assert _match_ignoring_description(
        db, models.Invoice,
        new_description='فاتوره رقم3509 لشركه ارتك للبلاط', **keys) is None
