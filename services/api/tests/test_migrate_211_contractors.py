# -*- coding: utf-8 -*-
"""اختبار الترحيل لمرة واحدة: حسابات 211* كانت تُفلتَر كمقاولين تحت التوجيه القديم
(قبل قاعدة البادئة الصارمة) إن لم توجد في ملف مدد الموردين — فيصححها init_db()
بنقلها إلى الموردين، تلقائياً وبأمان عند التكرار."""
import datetime as dt
import importlib

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)

    class Env:
        pass

    e = Env()
    e.session = session_mod
    e.models = models_mod
    return e


def _seed_misfiled_contractors(env):
    """يزرع مباشرة (قبل أي init_db) مقاولَين برمز 211* يمثلان الحالة الحقيقية —
    بي سي في جلوبال وبيت الاباء — كل واحد بقيود تُنتج رصيداً معروفاً."""
    from app.db import models

    models.Base.metadata.create_all(env.session.engine)
    db = env.session.SessionLocal()
    try:
        bcv = models.Contractor(code='2110602', name='شركة بي سي في جلوبال')
        db.add(bcv)
        db.flush()
        db.add(models.ContractorEntry(
            contractor_id=bcv.id, date=dt.date(2025, 1, 10), debit=0, credit=50000,
            doc='D1', description='مستخلص 1', kind='claim', source='statement'))
        db.add(models.ContractorEntry(
            contractor_id=bcv.id, date=dt.date(2025, 2, 10), debit=20000, credit=0,
            doc='D2', description='دفعة 1', kind='payment', source='statement'))

        byt = models.Contractor(code='2110919', name='بيت الاباء')
        db.add(byt)
        db.flush()
        # credit (invoice) 500000, debit (payment) 25852.90 -> نحن دفعنا مقدماً؛
        # الفاتورة تصبح credit وrsulting Supplier position: outstanding negative i.e.
        # credit_balance = 474,147.10 (نحن مدينون لهم، حسب اصطلاح رصيد الموردين).
        db.add(models.ContractorEntry(
            contractor_id=byt.id, date=dt.date(2025, 1, 1), debit=0, credit=500000,
            doc='B1', description='فاتورة', kind='invoice', source='statement'))
        db.add(models.ContractorEntry(
            contractor_id=byt.id, date=dt.date(2025, 2, 1), debit=974147.10, credit=0,
            doc='B2', description='دفعة', kind='payment', source='statement'))

        # a genuinely-still-a-contractor account (212*) must be untouched.
        diyar = models.Contractor(code='21201020', name='ديار الوادي')
        db.add(diyar)
        db.commit()
    finally:
        db.close()


def test_migration_moves_211_contractors_to_suppliers(env):
    _seed_misfiled_contractors(env)
    env.session.init_db()

    db = env.session.SessionLocal()
    try:
        contractors = db.query(env.models.Contractor).filter(
            env.models.Contractor.deleted_at.is_(None)).all()
        codes = {c.code for c in contractors}
        assert codes == {'21201020'}  # only ديار الوادي remains a contractor

        suppliers = {s.account: s for s in db.query(env.models.Supplier).filter(
            env.models.Supplier.deleted_at.is_(None)).all()}
        assert '2110602' in suppliers
        assert '2110919' in suppliers
        assert suppliers['2110919'].name == 'بيت الاباء'
        assert suppliers['2110919'].term_kind == 'cash'

        from app.services import payables_service as P
        ps = P.positions(db, today=dt.date(2026, 8, 14), account='2110919')
        assert len(ps) == 1
        assert round(float(ps[0].credit_balance), 2) == 474147.10
    finally:
        db.close()


def test_migration_is_idempotent(env):
    _seed_misfiled_contractors(env)
    env.session.init_db()
    env.session.init_db()  # second call must be a strict no-op

    db = env.session.SessionLocal()
    try:
        suppliers = db.query(env.models.Supplier).filter(
            env.models.Supplier.account == '2110919',
            env.models.Supplier.deleted_at.is_(None)).all()
        assert len(suppliers) == 1
        invoices = db.query(env.models.Invoice).filter(
            env.models.Invoice.supplier_id == suppliers[0].id,
            env.models.Invoice.deleted_at.is_(None)).all()
        assert len(invoices) == 1
        payments = db.query(env.models.Payment).filter(
            env.models.Payment.supplier_id == suppliers[0].id,
            env.models.Payment.deleted_at.is_(None)).all()
        assert len(payments) == 1
    finally:
        db.close()
