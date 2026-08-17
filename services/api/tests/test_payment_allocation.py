# -*- coding: utf-8 -*-
"""اختبارات «تخصيص الدفعات» — ميزة اختيارية (افتراضياً متوقفة).

يغطي هذا الملف طبقتين:
  1) domain/payables.allocate_smart مباشرة (بيانات صناعية، بلا قاعدة بيانات) —
     FIFO افتراضياً، والتعليق فقط عند إشارة تناقض حقيقية (انظر شرح الإشارات
     الثلاث في docstring الدالة نفسها)، والحالتان اللتان تبقيان بلا بديل، وتطبيق
     القرارات المحفوظة مسبقاً.
  2) المسار الكامل عبر API — إعداد التفعيل الافتراضي متوقف، تفعيله وإيقافه،
     ظهور دفعة معلَّقة في المراجعة مع سببها، حفظ قرار (فاتورة واحدة / تقسيم /
     على الحساب)، تعديله لاحقاً، وأن outstanding يبقى صحيحاً في كل الحالات.

allocate_fifo نفسها مغطاة بكثير من الاختبارات في test_payables.py وتبقى كما
هي بلا أي تعديل هنا — هذا الملف لا يمسّها.
"""
import datetime as dt

from app.domain.payables import (
    D, Invoice, Payment, Supplier, allocate_smart, parse_term, position,
)

TODAY = dt.date(2026, 8, 17)


def sup(term_raw='30 يوم', account='999'):
    return Supplier(account=account, name='مورد اختبار', project='م', term=parse_term(term_raw))


def inv(day, amount, number=None, id_=None):
    return Invoice(date=day, amount=amount, number=number, id=id_)


def pay(day, amount, id_=None, description=''):
    return Payment(date=day, amount=amount, id=id_, description=description)


# ---------------------------------------------------------------- domain: allocate_smart

def test_single_open_invoice_never_ambiguous_even_if_amount_differs():
    """فاتورة مفتوحة واحدة فقط — لا بديل تُخصَّص له، فتُطبَّق الدفعة عليها
    مهما كان مبلغها (جزئياً أو زائداً)، دون سؤال."""
    a = inv(dt.date(2026, 1, 1), 1000, id_='i1')
    p = pay(dt.date(2026, 2, 1), 400, id_='p1')
    held = allocate_smart([a], [p])
    assert held == []
    assert a.paid == D('400') and a.remaining == D('600')


def test_amount_exactly_clears_oldest_invoice_not_ambiguous():
    a = inv(dt.date(2026, 1, 1), 1000, id_='i1')
    b = inv(dt.date(2026, 2, 1), 500, id_='i2')
    p = pay(dt.date(2026, 3, 1), 1000, id_='p1')
    held = allocate_smart([a, b], [p])
    assert held == []
    assert a.remaining == D('0') and b.remaining == D('500')


def test_no_signal_multiple_open_invoices_applies_fifo_not_ambiguous():
    """لا تطابق تام، لا وصف يذكر فاتورة، لا نمط مضاد — القاعدة المقلوبة: FIFO
    يُطبَّق مباشرة (الجزء يسدد الأقدم) بلا سؤال. هذا هو صلب الإصلاح: الغياب
    التام لأي إشارة تناقض لم يعد سبباً للتعليق، فيما كان سابقاً هو القاعدة."""
    a = inv(dt.date(2026, 1, 1), 1000, id_='i1')
    b = inv(dt.date(2026, 2, 1), 500, id_='i2')
    p = pay(dt.date(2026, 3, 1), 400, id_='p1')
    held = allocate_smart([a, b], [p])
    assert held == []
    assert a.remaining == D('600') and b.remaining == D('500')   # FIFO الجزئي على الأقدم


def test_description_references_non_oldest_invoice_holds_with_reason():
    """الوصف يذكر رقم فاتورة غير الأقدم — تناقض مباشر ضد FIFO، تُعلَّق الدفعة
    بسبب واضح بدل تخمين الأقدم."""
    a = inv(dt.date(2026, 1, 1), 1000, number='7856', id_='i1')
    b = inv(dt.date(2026, 2, 1), 500, number='9001', id_='i2')
    p = pay(dt.date(2026, 3, 1), 300, id_='p1', description='مرتجع لفاتوره رقم9001')
    held = allocate_smart([a, b], [p])
    assert len(held) == 1
    assert held[0].reason == 'الوصف يذكر فاتورة 9001 لا الأقدم'
    assert a.remaining == D('1000') and b.remaining == D('500')   # كلتاهما بقيتا مفتوحتين


def test_exact_match_to_newer_invoice_while_oldest_not_covered_holds_with_reason():
    """مبلغ يطابق تماماً فاتورة أحدث بينما الأقدم لن تُغطّى كاملة بـFIFO — تطابق
    تام هو دليل أقوى من الترتيب الزمني، فتُعلَّق الدفعة بدل تخمين الأقدم."""
    a = inv(dt.date(2026, 1, 1), 1000, id_='i1')
    b = inv(dt.date(2026, 2, 1), 300, id_='i2')
    p = pay(dt.date(2026, 3, 1), 300, id_='p1')
    held = allocate_smart([a, b], [p])
    assert len(held) == 1
    assert held[0].reason == 'المبلغ يطابق فاتورة أحدث تماماً'
    assert a.remaining == D('1000') and b.remaining == D('300')   # لم تُمسّا


def test_exact_match_to_oldest_amount_is_just_fifo_not_a_signal():
    """المبلغ يطابق فاتورة أحدث، لكنه يطابق أيضاً تغطية الأقدم بالكامل (لأنه
    مساوٍ لمتبقي الأقدم) — لا تناقض هنا: FIFO والتطابق التام يتفقان، فلا داعي
    للسؤال."""
    a = inv(dt.date(2026, 1, 1), 300, id_='i1')
    b = inv(dt.date(2026, 2, 1), 300, id_='i2')
    p = pay(dt.date(2026, 3, 1), 300, id_='p1')
    held = allocate_smart([a, b], [p])
    assert held == []
    assert a.remaining == D('0') and b.remaining == D('300')     # الأقدم أُخذت عبر FIFO


def test_no_open_invoice_holds_with_reason_and_empty_candidates():
    """لا فاتورة مفتوحة أصلاً وقت الدفعة — تُعلَّق بسبب واضح، لا بلا تفسير."""
    a = inv(dt.date(2026, 1, 1), 500, id_='i1')
    p1 = pay(dt.date(2026, 2, 1), 500, id_='p1')       # يسدد الفاتورة الوحيدة بالكامل
    p2 = pay(dt.date(2026, 3, 1), 200, id_='p2')       # لا شيء مفتوح بعد الآن
    held = allocate_smart([a], [p1, p2])
    assert len(held) == 1
    assert held[0].payment.id == 'p2'
    assert held[0].candidates == []
    assert held[0].reason == 'لا توجد فاتورة مفتوحة لهذا المورد وقت هذه الدفعة'


def test_stored_decision_applies_without_asking_again():
    a = inv(dt.date(2026, 1, 1), 1000, id_='i1')
    b = inv(dt.date(2026, 2, 1), 500, id_='i2')
    p = pay(dt.date(2026, 3, 1), 400, id_='p1')
    decisions = {'p1': [('i2', D('400'))]}
    held = allocate_smart([a, b], [p], decisions)
    assert held == []
    assert a.remaining == D('1000')
    assert b.remaining == D('100')


def test_stored_decision_on_account_touches_no_invoice():
    a = inv(dt.date(2026, 1, 1), 1000, id_='i1')
    p = pay(dt.date(2026, 3, 1), 400, id_='p1')
    decisions = {'p1': [(None, D('400'))]}
    held = allocate_smart([a], [p], decisions)
    assert held == []
    assert a.remaining == D('1000')     # على الحساب — لا فاتورة تأثرت


def test_split_decision_across_two_invoices():
    a = inv(dt.date(2026, 1, 1), 300, id_='i1')
    b = inv(dt.date(2026, 2, 1), 300, id_='i2')
    p = pay(dt.date(2026, 3, 1), 300, id_='p1')
    decisions = {'p1': [('i1', D('150')), ('i2', D('150'))]}
    held = allocate_smart([a, b], [p], decisions)
    assert held == []
    assert a.remaining == D('150') and b.remaining == D('150')


def test_held_payment_does_not_reduce_outstanding_but_leaves_invoice_open():
    """الأصل ٤: دفعة معلَّقة تُخفِّض رصيد المورد الإجمالي (outstanding) دون أن
    تقرر أي فاتورة سُدِّدت — الفاتورة المرشَّحة تبقى مفتوحة ومتأخرة إن كانت كذلك.
    نستخدم هنا سيناريو تطابق تام لفاتورة أحدث (إشارة تناقض حقيقية) لأنه هو ما
    يُعلَّق فعلياً تحت القاعدة الجديدة."""
    supplier = sup()
    a = inv(dt.date(2026, 1, 1), 1000, id_='i1')
    b = inv(dt.date(2026, 2, 1), 300, id_='i2')
    p = pay(dt.date(2026, 3, 1), 300, id_='p1')
    pos = position(supplier, [a, b], [p], TODAY, smart=True)
    assert len(pos.unallocated_payments) == 1
    # outstanding = مجموع الفواتير - مجموع الدفعات، بمعزل عن التخصيص تماماً
    assert pos.outstanding == D('1300') - D('300') == D('1000')
    # لكن مجموع remaining على الفواتير (١٣٠٠) أكبر من outstanding — فرق الدفعة
    # المعلَّقة، وهو مقصود: الفاتورتان بقيتا «مفتوحتين» فتُحسبان في التأخر.
    assert a.remaining == D('1000') and b.remaining == D('300')


def test_smart_false_is_pure_fifo_no_holds_regardless_of_data():
    """الإعداد متوقف (الافتراضي) — نفس بيانات الحالة الغامضة أعلاه، لكن بلا
    smart=True يجب ألا تظهر أي دفعة معلَّقة، والسلوك يطابق allocate_fifo تماماً."""
    supplier = sup()
    a = inv(dt.date(2026, 1, 1), 1000, id_='i1')
    b = inv(dt.date(2026, 2, 1), 300, id_='i2')
    p = pay(dt.date(2026, 3, 1), 300, id_='p1')
    pos = position(supplier, [a, b], [p], TODAY)     # smart=False افتراضياً
    assert pos.unallocated_payments == []
    assert a.remaining == D('700')      # FIFO الجزئي طُبِّق كالمعتاد على الأقدم


# ---------------------------------------------------------------- API: end to end

def _make_supplier(api_client, account='991', term='30 يوم'):
    r = api_client.post('/api/v1/suppliers', json={
        'account': account, 'name': 'مورد تخصيص', 'project': 'م', 'term': term})
    assert r.status_code == 201, r.text
    return r.json()


def _add_invoice(api_client, account, amount, date, number=None):
    r = api_client.post('/api/v1/manual/invoices', json={
        'account': account, 'amount': amount, 'date': date, 'reference': number or ''})
    assert r.status_code == 201, r.text
    return r.json()


def _add_payment(api_client, account, amount, date):
    r = api_client.post('/api/v1/manual/payments', json={
        'account': account, 'amount': amount, 'date': date})
    assert r.status_code == 201, r.text
    return r.json()


def test_setting_defaults_off_and_toggles(api_client):
    r = api_client.get('/api/v1/suppliers/settings/payment-allocation')
    assert r.status_code == 200
    assert r.json()['enabled'] is False

    r = api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    assert r.status_code == 200 and r.json()['enabled'] is True

    r = api_client.get('/api/v1/suppliers/settings/payment-allocation')
    assert r.json()['enabled'] is True

    r = api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': False})
    assert r.json()['enabled'] is False


def test_off_by_default_supplier_detail_unchanged(api_client):
    """الإعداد متوقف افتراضياً — كشف المورد يجب ألا يحمل أي دفعة معلَّقة، وحساب
    الفواتير يطابق allocate_fifo القديم بلا أي تغيير ملحوظ."""
    _make_supplier(api_client)
    _add_invoice(api_client, '991', 1000, '2026-01-01')
    _add_invoice(api_client, '991', 500, '2026-02-01')
    _add_payment(api_client, '991', 400, '2026-03-01')

    d = api_client.get('/api/v1/suppliers/991').json()
    assert d.get('unallocatedCount', 0) == 0
    assert d['unallocatedPayments'] == []
    # FIFO: ٤٠٠ من الدفعة تخفض أقدم فاتورة (١٠٠٠) إلى ٦٠٠
    open_amounts = sorted(i['remaining'] for i in d['invoices'])
    assert open_amounts == [500, 600]


def test_enabled_ambiguous_payment_held_and_reviewable(api_client):
    """دفعة تحمل إشارة تناقض حقيقية (تطابق تام لفاتورة أحدث، والأقدم لن تُغطّى
    كاملة بـFIFO) — تُعلَّق مع سبب واضح، لا كل دفعة بلا تطابق كما كان سابقاً."""
    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    _make_supplier(api_client, account='992')
    _add_invoice(api_client, '992', 1000, '2026-01-01')
    _add_invoice(api_client, '992', 300, '2026-02-01')
    _add_payment(api_client, '992', 300, '2026-03-01')     # يطابق الأحدث تماماً، لا الأقدم

    d = api_client.get('/api/v1/suppliers/992').json()
    assert d['unallocatedCount'] == 1
    assert len(d['unallocatedPayments']) == 1
    held = d['unallocatedPayments'][0]
    assert held['payment']['amount'] == 300
    assert held['reason'] == 'المبلغ يطابق فاتورة أحدث تماماً'
    assert {c['remaining'] for c in held['candidates']} == {1000, 300}
    # الفاتورتان بقيتا مفتوحتين بالكامل — لم تُخفَّض أي منهما تخميناً
    for i in d['invoices']:
        assert i['remaining'] == i['amount']
    # outstanding يبقى صحيحاً رغم التعليق: ١٣٠٠ - ٣٠٠
    assert d['outstanding'] == 1000

    count = api_client.get('/api/v1/suppliers/payment-allocation/pending-count').json()
    assert count['count'] == 1


def test_assign_held_payment_to_one_invoice_then_it_stops_appearing(api_client):
    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    _make_supplier(api_client, account='993')
    i1 = _add_invoice(api_client, '993', 1000, '2026-01-01')
    _add_invoice(api_client, '993', 300, '2026-02-01')
    p1 = _add_payment(api_client, '993', 300, '2026-03-01')

    r = api_client.post(f"/api/v1/suppliers/993/payments/{p1['id']}/allocate",
                        json={'lines': [{'invoiceId': i1['id'], 'amount': 300}]})
    assert r.status_code == 200, r.text

    d = api_client.get('/api/v1/suppliers/993').json()
    assert d['unallocatedCount'] == 0
    inv1 = next(i for i in d['invoices'] if i['id'] == i1['id'])
    assert inv1['remaining'] == 700
    assert d['outstanding'] == 1000     # لم يتغيّر — التخصيص لا يغيّر الإجمالي


def test_assign_on_account_leaves_invoices_open_but_reduces_outstanding(api_client):
    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    _make_supplier(api_client, account='994')
    _add_invoice(api_client, '994', 1000, '2026-01-01')
    p1 = _add_payment(api_client, '994', 400, '2026-03-01')

    r = api_client.post(f"/api/v1/suppliers/994/payments/{p1['id']}/allocate",
                        json={'lines': [{'invoiceId': None, 'amount': 400}]})
    assert r.status_code == 200, r.text

    d = api_client.get('/api/v1/suppliers/994').json()
    assert d['unallocatedCount'] == 0
    assert d['invoices'][0]['remaining'] == 1000     # لم تُمسّ — على الحساب فقط
    assert d['outstanding'] == 600                    # لكن الإجمالي انخفض


def test_split_allocation_across_two_invoices(api_client):
    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    _make_supplier(api_client, account='995')
    i1 = _add_invoice(api_client, '995', 300, '2026-01-01')
    i2 = _add_invoice(api_client, '995', 300, '2026-02-01')
    p1 = _add_payment(api_client, '995', 300, '2026-03-01')

    r = api_client.post(f"/api/v1/suppliers/995/payments/{p1['id']}/allocate", json={
        'lines': [{'invoiceId': i1['id'], 'amount': 150}, {'invoiceId': i2['id'], 'amount': 150}]})
    assert r.status_code == 200, r.text

    d = api_client.get('/api/v1/suppliers/995').json()
    remaining = {i['id']: i['remaining'] for i in d['invoices']}
    assert remaining[i1['id']] == 150 and remaining[i2['id']] == 150


def test_allocation_sum_mismatch_rejected(api_client):
    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    _make_supplier(api_client, account='996')
    i1 = _add_invoice(api_client, '996', 1000, '2026-01-01')
    p1 = _add_payment(api_client, '996', 400, '2026-03-01')

    r = api_client.post(f"/api/v1/suppliers/996/payments/{p1['id']}/allocate",
                        json={'lines': [{'invoiceId': i1['id'], 'amount': 250}]})
    assert r.status_code == 422


def test_decision_editable_afterward(api_client):
    """قرار يمكن تعديله — يُخصَّص أولاً لفاتورة، ثم يُمحى ويُعاد تخصيصه لأخرى."""
    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    _make_supplier(api_client, account='997')
    i1 = _add_invoice(api_client, '997', 1000, '2026-01-01')
    i2 = _add_invoice(api_client, '997', 500, '2026-02-01')
    p1 = _add_payment(api_client, '997', 400, '2026-03-01')

    api_client.post(f"/api/v1/suppliers/997/payments/{p1['id']}/allocate",
                    json={'lines': [{'invoiceId': i1['id'], 'amount': 400}]})
    d = api_client.get('/api/v1/suppliers/997').json()
    assert next(i for i in d['invoices'] if i['id'] == i1['id'])['remaining'] == 600

    # يُغيّر رأيه — يخصصها لفاتورة أخرى بدلاً من الأولى (استبدال كامل، لا دمج)
    r = api_client.post(f"/api/v1/suppliers/997/payments/{p1['id']}/allocate",
                        json={'lines': [{'invoiceId': i2['id'], 'amount': 400}]})
    assert r.status_code == 200
    d = api_client.get('/api/v1/suppliers/997').json()
    assert next(i for i in d['invoices'] if i['id'] == i1['id'])['remaining'] == 1000
    assert next(i for i in d['invoices'] if i['id'] == i2['id'])['remaining'] == 100

    # حذف القرار — الدفعة تعود تُحسب من جديد بلا قرار محفوظ: ٤٠٠ لا يحمل أي
    # إشارة تناقض ضد الفاتورتين (لا وصف، لا تطابق تام، لا نمط)، فـFIFO يُطبَّق
    # تلقائياً من جديد — لم تعد غامضة تحت القاعدة الجديدة.
    r = api_client.delete(f"/api/v1/suppliers/997/payments/{p1['id']}/allocate")
    assert r.status_code == 200 and r.json() == {'cleared': True}
    d = api_client.get('/api/v1/suppliers/997').json()
    assert d['unallocatedCount'] == 0
    assert next(i for i in d['invoices'] if i['id'] == i1['id'])['remaining'] == 600


def test_disabling_setting_ignores_saved_decisions_and_reverts_to_fifo(api_client):
    """إيقاف الإعداد بعد اتخاذ قرارات يعيد الحساب لـ allocate_fifo القديم فوراً —
    الجدول الجديد يُتجاهل كلياً، لا يُحذف، فتفعيل الإعداد مجدداً يستعيد القرارات."""
    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    _make_supplier(api_client, account='998')
    i1 = _add_invoice(api_client, '998', 1000, '2026-01-01')
    _add_invoice(api_client, '998', 500, '2026-02-01')
    p1 = _add_payment(api_client, '998', 400, '2026-03-01')
    api_client.post(f"/api/v1/suppliers/998/payments/{p1['id']}/allocate",
                    json={'lines': [{'invoiceId': None, 'amount': 400}]})

    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': False})
    d = api_client.get('/api/v1/suppliers/998').json()
    assert d.get('unallocatedCount', 0) == 0
    # FIFO يعمل الآن كأن القرار غير موجود: أقدم فاتورة تُخفَّض مباشرة
    assert next(i for i in d['invoices'] if i['id'] == i1['id'])['remaining'] == 600

    api_client.put('/api/v1/suppliers/settings/payment-allocation', json={'enabled': True})
    d = api_client.get('/api/v1/suppliers/998').json()
    assert next(i for i in d['invoices'] if i['id'] == i1['id'])['remaining'] == 1000
