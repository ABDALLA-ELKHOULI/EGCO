# -*- coding: utf-8 -*-
"""اختبارات «حساب جديد لم نره من قبل» — الخلل الذي أبلغ عنه المستخدم فعلياً:
كشف «شركة تداين للخرسانة اليرموك.pdf» يقرأ ويطابق رصيده تماماً (٧ فواتير،
دفعة واحدة، ٥١٬٥٠٧٫٠٠ ر.س) لكن حسابه 2110124 غير موجود في ملف مدة مديونية
الموردين، فكان يُرفض صمتاً — الشاشة تقول «تم» ولا رقم يتغيّر. هذه الاختبارات
تثبّت أن commit_statement() يرفض بوضوح بلا create_supplier، ويحفظ بنجاح معه،
تماماً كما تعرضه شاشة الرفع الآن (Import.tsx / NewSupplierPanel)."""
import importlib
import os

import pytest

SAMPLES_DIR = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
# الملف الحقيقي الذي أبلغ عنه المستخدم — ليس ضمن عينات المستودع لأن حسابه
# (2110124) غير معروف بتصميمه؛ الاختبار يُتخطى بأمان إن لم يوجد في هذا الجهاز.
REAL_STATEMENT = os.path.expanduser(
    '~/Downloads/شركة تداين للخرسانة اليرموك.pdf')

pytestmark = pytest.mark.skipif(
    not os.path.exists(REAL_STATEMENT),
    reason='الملف الحقيقي غير موجود في هذا الجهاز — انظر ~/Downloads')


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


def test_unknown_account_is_refused_not_silently_dropped(db, env):
    """بلا create_supplier: يُرفض بوضوح، ولا يُكتب شيء في القاعدة."""
    res = env.import_service.commit_statement(db, REAL_STATEMENT, source='pdf_statement')

    assert res['saved'] is False
    assert res['reason'] == 'unknown_supplier'
    # الاسم المقترح يأتي من ترويسة الكشف — خام وقابل للتعديل في الشاشة، وليس فارغاً
    assert res['suggestedName']
    # أرقام الملف نفسها ظاهرة في رد الرفض كي تُعرض للمستخدم قبل أن يقرر
    assert res['account'] == '2110124'
    assert res['invoiceCount'] == 7
    assert res['paymentCount'] == 1
    assert res['reconciled'] is True

    assert db.query(env.models.Supplier).filter_by(account='2110124').one_or_none() is None
    assert db.query(env.models.Invoice).count() == 0
    assert db.query(env.models.Payment).count() == 0


def test_confirming_create_supplier_saves_the_statement(db, env):
    """مع create_supplier (بعد أن يملأ المستخدم الاسم/المشروع/مدة السداد):
    يُنشأ المورد ويُحفظ الكشف كاملاً برصيد ٥١٬٥٠٧٫٠٠ ر.س."""
    res = env.import_service.commit_statement(
        db, REAL_STATEMENT, source='pdf_statement',
        create_supplier=dict(name='شركة تداين للخرسانة',
                             project='اليرموك', term='60 يوم'))

    assert res['saved'] is True
    assert res['reconciled'] is True
    assert res['added'] == 8  # 7 فواتير + دفعة واحدة
    assert res['computedBalance'] == pytest.approx(51507.00)
    assert res['statementBalance'] == pytest.approx(51507.00)

    supplier = db.query(env.models.Supplier).filter_by(account='2110124').one()
    assert supplier.name == 'شركة تداين للخرسانة'
    assert supplier.project == 'اليرموك'
    assert supplier.term_raw == '60 يوم'
    assert supplier.term_kind == 'days'
    assert supplier.term_days == 60

    assert db.query(env.models.Invoice).filter_by(supplier_id=supplier.id).count() == 7
    assert db.query(env.models.Payment).filter_by(supplier_id=supplier.id).count() == 1


def test_second_confirm_is_idempotent_no_duplicate_rows(db, env):
    """إعادة الاستيراد بعد الإنشاء (كما يحدث لو أعاد المستخدم رفع نفس الملف)
    لا تضيف حركات مكررة — نفس عقد كل مسارات الرفع الأخرى."""
    env.import_service.commit_statement(
        db, REAL_STATEMENT, source='pdf_statement',
        create_supplier=dict(name='شركة تداين للخرسانة', project='اليرموك', term='60 يوم'))

    res2 = env.import_service.commit_statement(db, REAL_STATEMENT, source='pdf_statement')

    assert res2['saved'] is True
    assert res2['added'] == 0
    assert res2['skipped'] == 8
