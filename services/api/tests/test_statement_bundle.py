# -*- coding: utf-8 -*-
"""الكشوف المجمّعة — ملف واحد بمئات الحسابات («كشوفات الموردين» ٥٠٥ صفحات / ٣٩٣ حساباً،
«كشف المقاولين» ٦٨١ / ٦٣٠، «كشف ضمان المقاولين» ٣٧٣ / ٣٧٣).

قبل هذا كان الملف كله يُقرأ حساباً واحداً: ٧٬٣٤٢ حركة من ٣٩٣ مورداً تُلصق بالحساب
الأول. كل اختبار هنا يقابل فخّاً حقيقياً ظهر عند دراسة الملفات الثلاثة، ويُبنى من
صفحات نصية بنفس تخطيط الطباعة حرفياً — لا من ملفات العيّنات، لأن design/samples
غير متتبَّع في git، واختبارٌ يتخطّى نفسه بصمت في البناء السحابي لا يحمي شيئاً.
"""
import pytest

from app.ingest import contractor_statement as CS
from app.ingest import pdf_statement as PS
from app.ingest import statement_bundle as SB

HEADER = ('تقرير كشف حساب\nشركة اعمار الخلیج المصریة للمقاولات\nالفرع الرئیسي\n'
          'مطبوع بواسطة\nمدیر النظام\n: من تاریخ2025-01-01\n: الى تاریخ2026-11-10\n'
          '01-07-1446\n30-05-1448\n{pageno}\n{account}\n: الحساب\nالتاریخ\nالوصف\n'
          'مدین\nدائن\n{name}\nالرقم\nرصید\nالفرع\n')


def page(account, name, body, pageno=1):
    return HEADER.format(pageno=pageno, account=account, name=name) + body


def opening_label_first(credit):
    """التخطيط الملتصق: التسمية أولاً ثم مدين ودائن والرصيد."""
    return 'رصید افتتاحي0.00\n%s\n(%s)\n0001\n \n \n' % (credit, credit)


def block(doc, date, desc, debit, credit, balance):
    """كتلة حركة بالتخطيط الملتصق: التاريخ والوصف والمدين في سطر واحد."""
    return ('ID=00TrxType=GLJVTrxNo=%s\n%s%s%s\n%s\n%s\n%s\n0001\n \n \n'
            % (doc, date, desc, debit, credit, doc, balance))


def footer(debit_total, credit_total, closing):
    return '%s\n%sاجمالي الحساب%sفقط لا غير\nPage 1 of 9\n' % (debit_total, credit_total, closing)


# ---------------------------------------------------------------- التقطيع

def test_consecutive_pages_of_one_account_become_one_section():
    pages = [
        page('2110101', 'شركة الأولى للخرسانة', opening_label_first('1,000.00')
             + block('00000001', '2025-02-01', 'فاتوره رقم11 للأولى', '0.00', '500.00', '(1,500.00)'),
             pageno=1),
        page('2110101', 'شركة الأولى للخرسانة',
             block('00000002', '2025-03-01', 'دفعة للأولى', '300.00', '0.00', '(1,200.00)')
             + footer('300.00', '1,500.00', '(1,200.00)'), pageno=2),
        page('2110102', 'مؤسسة الثانية للحديد', opening_label_first('50.00')
             + footer('0.00', '50.00', '(50.00)'), pageno=3),
    ]
    secs = SB.split_pages(pages)
    assert [s.account for s in secs] == ['2110101', '2110102']
    assert secs[0].pages == [1, 2] and secs[1].pages == [3]


def test_repeated_header_does_not_leak_into_a_description():
    """الترويسة المكرَّرة في صفحة الاستمرار تُحذف — لو بقيت لالتصقت بآخر حركة قبلها."""
    pages = [
        page('2110101', 'شركة الأولى',
             block('00000001', '2025-02-01', 'فاتوره رقم11', '0.00', '500.00', '(500.00)')),
        page('2110101', 'شركة الأولى',
             block('00000002', '2025-03-01', 'دفعة', '100.00', '0.00', '(400.00)')
             + footer('100.00', '500.00', '(400.00)'), pageno=2),
    ]
    text = SB.split_pages(pages)[0].text
    assert text.count('تقرير كشف حساب') == 1


def test_hierarchical_code_of_fifteen_digits_is_its_own_account():
    """رموز هرمية: 216217121621722 = 21621712 + 1621722 — شركة مختلفة تماماً.

    سقف ١٤ رقماً كان يُسقطها فتُلحَق بالحساب السابق: سبعة ضمانات لشركات مختلفة طُويت
    في حساب واحد. الرمز يُؤخذ كاملاً — قصّه يخترع رقم حساب غير موجود في الدفاتر.
    """
    pages = [
        page('21621712', 'ضمان رواسي نجران', opening_label_first('100.00')
             + footer('0.00', '100.00', '(100.00)')),
        page('216217121621722', 'ضمان شركة رتبة البناء', opening_label_first('250.00')
             + footer('0.00', '250.00', '(250.00)'), pageno=2),
    ]
    secs = SB.split_pages(pages)
    assert [s.account for s in secs] == ['21621712', '216217121621722']
    assert CS.parse_text(secs[1].text)['account'] == '216217121621722'


def test_pages_before_any_account_are_dropped_not_invented():
    secs = SB.split_pages(['صفحة غلاف بلا رقم حساب', page('2110101', 'شركة', footer('0', '0', '0.00'))])
    assert [s.account for s in secs] == ['2110101']


# ---------------------------------------------------------------- محلّل الموردين

def _supplier_balance(text):
    from decimal import Decimal as D
    r = PS.parse_text(text)
    inv = sum((D(str(i.amount)) for i in r['invoices']), D(0))
    pay = sum((D(str(p.amount)) for p in r['payments']), D(0))
    return inv - pay, r


def test_parenthesised_negative_total_is_read_and_reconciles():
    """«اجمالي الحساب(1,200.00)» — النمط القديم كان يقبل إشارة الناقص فقط، فكان
    ١٤٠ حساباً من ٣٩٣ يُقرأ «بلا إجمالي»."""
    text = page('2110101', 'شركة الأولى', opening_label_first('1,000.00')
                # الوصف لا ينتهي برقم ملتصق بالمبلغ: النظام ينقل المبلغ لسطر تالٍ في
                # تلك الحالة («جزء من حوالھ25»)، فالنص الواقعي يحمل كلمة بعد الرقم.
                + block('00000001', '2025-02-01', 'فاتوره رقم11 للأولى', '0.00', '500.00', '(1,500.00)')
                + block('00000002', '2025-03-01', 'دفعة', '300.00', '0.00', '(1,200.00)')
                + footer('300.00', '1,500.00', '(1,200.00)'))
    computed, r = _supplier_balance(text)
    assert r['statement_balance'] == -1200.0
    assert computed == 1200            # اصطلاح الإشارة: المحسوب == −المطبوع


def test_missing_opening_parenthesis_is_still_negative():
    """في الحسابات الطويلة جداً يُسقط الاستخراج القوس الافتتاحي («3,848,020.98)» في
    شركة مدار) فانقلب الرصيد كله موجباً."""
    assert PS._money('3,848,020.98)') == -3848020.98
    assert PS._money('(3.19)') == -3.19
    assert PS._money('1,000.00') == 1000.0


def test_row_with_both_debit_and_credit_records_both():
    """صفٌّ يحمل مديناً ودائناً معاً (تسوية جزء فاتورة وجزء دفعة). كانت «elif» تُسقط
    المدين صامتةً — «سمو البناء» نقصت دفعته ١٣٬٧٩٩٫٠٧."""
    text = page('2110101', 'شركة الأولى',
                block('00000001', '2025-02-01', 'تسويه', '600.00', '20,000.00', '(19,400.00)')
                + footer('600.00', '20,000.00', '(19,400.00)'))
    computed, r = _supplier_balance(text)
    assert len(r['invoices']) == 1 and len(r['payments']) == 1
    assert computed == 19400


# ---------------------------------------------------------------- محلّل المقاولين والضمانات

def test_contractor_label_first_opening_is_captured():
    """لم يُنقل الرصيد الافتتاحي «التسمية أولاً» إلى محلّل المقاولين، فكان ١٥٨ حساباً
    من ٦٣٠ يبدأ رصيده من الصفر — ومنها ٦٢ حساباً بلا حركات يُرفض كلياً."""
    text = page('21201001', 'مشعل البركاني مشروع المدينة', opening_label_first('56,358.74')
                + footer('0.00', '56,358.74', '(56,358.74)'))
    r = CS.parse_text(text)
    assert r['opening_credit'] == 56358.74
    bal = sum(x['debit'] - x['credit'] for x in r['rows'])
    assert round(bal, 2) == round(r['printed_balance'], 2) == -56358.74


# ---------------------------------------------------------------- الحفظ

def _bundle_pages():
    return [
        page('2110101', 'شركة الأولى للخرسانة', opening_label_first('1,000.00')
             + block('00000001', '2025-02-01', 'فاتوره رقم11 للأولى', '0.00', '500.00', '(1,500.00)')
             + footer('0.00', '1,500.00', '(1,500.00)')),
        page('2110102', 'مؤسسة الثانية للحديد', opening_label_first('50.00')
             + footer('0.00', '50.00', '(50.00)'), pageno=2),
        # إجمالي مطبوع لا يطابق — يجب ألا يُحفظ هذا الحساب وحده، ولا يوقف البقية
        page('2110103', 'شركة الثالثة', opening_label_first('10.00')
             + footer('0.00', '10.00', '(99.00)'), pageno=3),
    ]


@pytest.fixture()
def fake_bundle(monkeypatch):
    from app.services import import_service as IS
    pages = _bundle_pages()
    monkeypatch.setattr(SB, 'read_pages', lambda path: pages)
    monkeypatch.setattr(SB, 'is_bundle', lambda path, sample_pages=40: True)
    monkeypatch.setattr(IS, 'check_scanned_pdf', lambda *a, **k: None)
    return '/virtual/كشوفات الموردين.pdf'


def test_bundle_saves_each_account_and_holds_back_the_unreconciled(api_client, fake_bundle):
    from app.db.session import SessionLocal
    from app.db import models
    from app.services import import_service as IS

    db = SessionLocal()
    pv = IS.preview_statement(fake_bundle, 'pdf_statement', db)
    assert pv['bundle'] is True and pv['accounts'] == 3
    assert pv['counts'] == {'reconciled': 2, 'not_reconciled': 1}

    res = IS.commit_statement(db, fake_bundle)
    assert res['bundle'] is True
    assert res['saved'] == 2
    assert [p['account'] for p in res['problems']] == ['2110103']

    db2 = SessionLocal()
    accounts = {s.account for s in db2.query(models.Supplier).all()}
    assert {'2110101', '2110102'} <= accounts
    assert '2110103' not in accounts, 'حُفظ حساب لا يطابق إجماليه'
    # كل حساب على حساب صاحبه — لا شيء يُلصق بالحساب الأول
    first = db2.query(models.Supplier).filter_by(account='2110101').one()
    assert db2.query(models.Invoice).filter_by(supplier_id=first.id).count() == 2  # افتتاحي + فاتورة


def test_bundle_reupload_adds_nothing(api_client, fake_bundle):
    from app.db.session import SessionLocal
    from app.db import models
    from app.services import import_service as IS
    IS.commit_statement(SessionLocal(), fake_bundle)
    before = SessionLocal().query(models.Invoice).count()
    IS.commit_statement(SessionLocal(), fake_bundle)
    assert SessionLocal().query(models.Invoice).count() == before
