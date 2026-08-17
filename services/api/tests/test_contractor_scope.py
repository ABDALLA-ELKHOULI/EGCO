# -*- coding: utf-8 -*-
"""نطاق مستحق المقاول: شاشة التدفق النقدي مقابل ملخّص المشروع.

الخلل الموثَّق: `_scoped_contractors`/`_contractor_flow` في cashflow_service.py يضمّان
المقاول إلى مشروع مفلتَر إن حملت أي حركة من حركاته ذلك المشروع، ثم يستعملان رصيده
**الكامل** عبر كل مشاريعه كـ owedToContractors — بينما report_service._project_
contractor_row يُغذّى بحركات ذلك المشروع فقط (نطاق حقيقي). لمقاول يعمل في أكثر من
مشروع، الرقمان يختلفان بصمت.

القياس على بيانات الإنتاج الحقيقية (وليس هنا): 0 من 74 حركة دفتر مقاولين تحمل مشروعاً
غير فارغ، فلا يوجد حالياً مقاول متعدد المشاريع في الواقع — الخلل كامن لا فعّال. لذلك
اختير الإبقاء على الرصيد الكامل (تجنّباً لإسقاط مستحقات حقيقية من التوقع لو ضُيِّق
بالمشروع بينما أغلب الحركات بلا مشروع) + تعليمه صراحة بدل تضييقه. هذا الاختبار يبني
حالة متعددة المشاريع صناعياً ليثبت السلوك ويحرس رسالتي التعليم على الشاشتين.
"""
import datetime as dt
import importlib
from decimal import Decimal

import pytest

TODAY = dt.date(2026, 8, 8)


def _d(x) -> Decimal:
    return Decimal(str(x))


@pytest.fixture()
def multi_project_contractor_db(tmp_path, monkeypatch):
    """مقاول واحد C1 له حركات في مشروعين: «أ» (مدين له صافي) و«ب» (دائن له صافي)."""
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models
    importlib.reload(models)
    import app.services.cashflow_service as CFS
    importlib.reload(CFS)
    import app.services.report_service as RS
    importlib.reload(RS)

    session_mod.init_db()
    db = session_mod.SessionLocal()

    c1 = models.Contractor(code='C1', name='مقاول متعدد المشاريع')
    db.add(c1); db.commit(); db.refresh(c1)

    # مشروع «أ»: مدين له 5000 (دفعة) مقابل دائن 1000 (مستخلص) -> صافي مستحق له 4000 هنا فقط
    db.add(models.ContractorEntry(contractor_id=c1.id, date=TODAY, debit=5000.0, credit=1000.0,
                                  description='دفعة أ', kind='payment', project='مشروع أ'))
    # مشروع «ب»: دائن له 3000 إضافية (مستخلص) بلا أي دفعة -> صافي مستحق له 3000 هنا فقط
    db.add(models.ContractorEntry(contractor_id=c1.id, date=TODAY, debit=0.0, credit=3000.0,
                                  description='مستخلص ب', kind='claim', project='مشروع ب'))
    db.commit()

    yield db, CFS, RS, models
    db.close()


def test_cashflow_owed_is_the_whole_balance_not_project_scoped(multi_project_contractor_db):
    """owedToContractors لمشروع «أ» يساوي رصيد المقاول الكامل (4000-1000+3000... بالمعادلة
    المحاسبية: مدين-دائن)، لا الجزء الخاص بمشروع «أ» وحده."""
    db, CFS, RS, models = multi_project_contractor_db

    # الفكستشر الافتراضي يعطي رصيداً موجباً إجمالاً (owed=0)؛ نخفّض مدين مشروع «أ» ليصير
    # رصيد المقاول الكامل سالباً (مستحق له) فتظهر owedToContractors > 0 في كلا الفلترين.
    row = db.query(models.ContractorEntry).filter_by(project='مشروع أ').first()
    row.debit = 500.0   # مدين قليل مقابل دائن 1000 في نفس المشروع -> هذا المشروع وحده سالب أيضاً
    db.commit()

    cf_a = CFS.cashflow(db, weeks=26, today=TODAY, project='مشروع أ', parties='contractors')
    cf_b = CFS.cashflow(db, weeks=26, today=TODAY, project='مشروع ب', parties='contractors')

    owed_a = _d(cf_a['reconciliation']['contractors']['owedToContractors'])
    owed_b = _d(cf_b['reconciliation']['contractors']['owedToContractors'])

    # نفس الرقم في كلا الفلترين — لأنه رصيد المقاول الكامل، لا رصيد المشروع المفلتَر
    assert owed_a == owed_b
    # صافي الرصيد الكامل: مدين (500+0) - دائن (1000+3000) = -3500 -> owed = 3500
    assert owed_a == Decimal('3500.00')

    # بينما ملخّص المشروع «أ» يعطي رصيداً مختلفاً محسوباً من حركات «أ» فقط
    entries_a = [dict(debit=e.debit, credit=e.credit, kind=e.kind, date=e.date)
                for e in row.contractor.entries if e.deleted_at is None and e.project == 'مشروع أ']
    row_a = RS._project_contractor_row('C1', 'مقاول متعدد المشاريع', entries_a)
    assert _d(row_a['outstanding']) == Decimal('500.00')   # مدين500-دائن1000 -> |سالب|=500
    assert _d(row_a['outstanding']) != owed_a               # التعارض الموثَّق، غير صامت الآن


def test_cashflow_response_carries_honest_scope_note(multi_project_contractor_db):
    db, CFS, RS, models = multi_project_contractor_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY, project='مشروع أ', parties='contractors')
    assert cf['contractorBalanceScopeNote']
    assert 'الكامل' in cf['contractorBalanceScopeNote']

    # لا تُعرض حين لا يشارك المقاولون في الطلب أصلاً
    cf_suppliers_only = CFS.cashflow(db, weeks=26, today=TODAY, project='مشروع أ',
                                     parties='suppliers')
    assert cf_suppliers_only['contractorBalanceScopeNote'] is None


def test_project_summary_scope_note_present_and_distinct(multi_project_contractor_db):
    db, CFS, RS, models = multi_project_contractor_db
    c1 = db.query(models.Contractor).filter_by(code='C1').one()
    entries_a = [dict(debit=e.debit, credit=e.credit, kind=e.kind, date=e.date)
                for e in c1.entries if e.deleted_at is None and e.project == 'مشروع أ']
    payload = RS.project_summary([], [('C1', c1.name, entries_a)], 'مشروع أ', TODAY,
                                 parties='contractors')
    assert payload['contractorScopeNote']
    assert 'هذا المشروع فقط' in payload['contractorScopeNote']

    payload_suppliers = RS.project_summary([], [], 'مشروع أ', TODAY, parties='suppliers')
    assert payload_suppliers['contractorScopeNote'] is None
