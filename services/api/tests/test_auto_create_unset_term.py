# -*- coding: utf-8 -*-
"""اختبارات إنشاء الطرف تلقائياً عند استيراد كشف حسابٍ لم نره من قبل.

القاعدة: بادئة الحساب تحسم النوع قطعاً (٢١١ مورد، ٢١٢ مقاول) — فحين تكون هذه
البادئة واضحة لا يبقى ما يُسأل عنه سوى مدة السداد، وهي تُعلَّم صراحةً «غير
محدّدة» (UNSET_TERM) بدل أن تُخمَّن. هذه الاختبارات تثبّت:
  (a) حساب مورد ٢١١ غير معروف يُنشأ تلقائياً بمدة غير محدّدة، والكشف يُحفظ كاملاً.
  (b) مدة «غير محدّدة» لا تُسهم بشيء في حساب التأخر (compute_delay/position).
  (c) بادئة ليست ٢١١ ولا ٢١٢ تبقى تُرفض بوضوح (unknown_supplier) بلا إنشاء تلقائي.
  (d) حساب مقاول ٢١٢ غير معروف يُنشأ تلقائياً (نفس معاملة المورد، بلا مدة سداد
      أصلاً — Contractor لا يحمل عمود مدة).
"""
import datetime as dt
import importlib
import os
from decimal import Decimal

import pytest

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
DIYAR_PDF = os.path.join(SAMPLES, 'contractor-diyar-alwadi.pdf')


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.domain.payables as payables_mod
    importlib.reload(payables_mod)
    import app.services.payables_service as payables_service_mod
    importlib.reload(payables_service_mod)
    import app.services.contractors_service as contractors_service_mod
    importlib.reload(contractors_service_mod)
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
    e.payables = payables_mod
    e.payables_service = payables_service_mod
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


def _csv(tmp_path, name, body, header='التاريخ,مدين,دائن,رقم المستند,الوصف,الحساب\n'):
    p = tmp_path / name
    p.write_text(header + body, encoding='utf-8-sig')
    return str(p)


UNKNOWN_211_ACCOUNT = '2119876'
UNKNOWN_299_ACCOUNT = '2999999'  # بادئة غير مصنَّفة — لا مورد ولا مقاول ولا ضمان


def test_unknown_211_account_auto_creates_supplier_with_unset_term(tmp_path, db, env):
    """(a) كشف CSV لحساب ٢١١ غير معروف: يُحفظ كاملاً، ويُنشأ مورد بمدة «غير محدّدة»."""
    body = ('01-02-2026,,1500.00,00009001,فاتورة توريد اختبار,%s\n' % UNKNOWN_211_ACCOUNT)
    path = _csv(tmp_path, 'unknown-211.csv', body)

    res = env.import_service.commit_statement(db, path, source='csv_statement')

    assert res['saved'] is True
    assert res.get('autoCreatedParty') is True
    assert res.get('needsTerm') is True
    assert res['partyAccount'] == UNKNOWN_211_ACCOUNT
    assert res['added'] == 1

    supplier = db.query(env.models.Supplier).filter_by(account=UNKNOWN_211_ACCOUNT).one()
    assert supplier.term_kind == 'unset'
    assert supplier.term_days is None
    assert supplier.term_raw == env.payables.UNSET_TERM

    assert db.query(env.models.Invoice).filter_by(supplier_id=supplier.id).count() == 1


def test_unset_term_supplier_contributes_zero_delay(tmp_path, db, env):
    """(b) مدة «غير محدّدة» لا تُدخل شيئاً في حساب التأخر — الفاتورة تبقى بلا
    تاريخ استحقاق مشتق، فتُستثنى من compute_delay/position تماماً."""
    body = ('01-01-2020,,5000.00,00009002,فاتورة قديمة جداً,%s\n' % UNKNOWN_211_ACCOUNT)
    path = _csv(tmp_path, 'unknown-211-old.csv', body)
    res = env.import_service.commit_statement(db, path, source='csv_statement')
    assert res['saved'] is True

    positions = env.payables_service.positions(db, today=dt.date(2026, 2, 1),
                                                include_empty=True)
    pos = next(p for p in positions if p.supplier.account == UNKNOWN_211_ACCOUNT)

    # فاتورة بعمر أكثر من ٦ سنوات: لو حُسبت مدتها كنقد (٠ يوم) لظهر تأخّر ضخم.
    assert pos.outstanding == Decimal('5000.00')  # المديونية نفسها لا تُخفى
    assert pos.delay.days == 0
    assert pos.delay.amount == Decimal('0')
    assert pos.needs_manual_due_date is True  # الشاشة تُطلب من المستخدم تحديد المدة


def test_non_211_212_prefix_still_refuses_without_auto_create(tmp_path, db, env):
    """(c) بادئة خارج ٢١١/٢١٢ (لا يحسمها _account_prefix_is_unambiguous):
    تبقى تُرفض صراحةً بلا أي إنشاء تلقائي — القاعدة القاطعة تشمل الرفض أيضاً."""
    body = ('01-02-2026,,1000.00,00009003,فاتورة اختبار بادئة غير معروفة,%s\n'
           % UNKNOWN_299_ACCOUNT)
    path = _csv(tmp_path, 'unknown-299.csv', body)

    res = env.import_service.commit_statement(db, path, source='csv_statement')

    assert res['saved'] is False
    assert res['reason'] == 'unknown_supplier'
    assert 'autoCreatedParty' not in res
    assert db.query(env.models.Supplier).filter_by(
        account=UNKNOWN_299_ACCOUNT).one_or_none() is None
    assert db.query(env.models.Invoice).count() == 0


@pytest.mark.skipif(not os.path.exists(DIYAR_PDF),
                    reason='design/samples/contractor-diyar-alwadi.pdf not present')
def test_unknown_212_account_auto_creates_contractor(db, env):
    """(d) حساب مقاول ٢١٢ غير معروف — نفس معاملة الموردين تماماً: يُنشأ
    تلقائياً ويُحفظ الكشف، بلا needsTerm لأن Contractor لا يحمل مدة سداد أصلاً."""
    assert db.query(env.models.Contractor).filter_by(code='21201020').one_or_none() is None

    res = env.import_service.commit_statement(db, DIYAR_PDF, source='pdf_statement')

    assert res['saved'] is True
    assert res.get('autoCreatedParty') is True
    assert res.get('needsTerm') is None  # لا مفهوم مدة سداد للمقاول في هذا المخطط
    assert res['partyAccount'] == '21201020'

    c = db.query(env.models.Contractor).filter_by(code='21201020').one()
    assert 'ديار' in c.name.replace('ی', 'ي')
