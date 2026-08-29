# -*- coding: utf-8 -*-
"""م-٢٠ — قارئ الموردين يجب أن يرفض أي ملف Excel لا يطابق شكل ملف مدد الموردين
الحقيقي، لا أن يقبله بصمت وينتج موردين وهميين.

يثبت هذا الملف الطبقتين المطلوبتين مستقلّتين: تحقّق الترويسة (عمودان بالاسم
الصحيح) وتحقّق بادئة الحساب (٢١١ فقط)، ثم يتأكد أن ملفاً حقيقياً سليماً لا يزال
يمر بلا مشاكل.
"""
import openpyxl
import pytest

from app.ingest import suppliers_excel


def _write(path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    wb.save(path)


def test_employee_list_lookalike_is_rejected(tmp_path):
    """اسم في العمود D ورقم في I (نفس مواضع اسم/رقم حساب المورد بالصدفة) — لكن
    الترويسة لا تحمل «اسم الحساب»/«رقم الحساب» فيُرفض الملف صراحة."""
    path = tmp_path / 'قائمة موظفين.xlsx'
    _write(path, [
        ['قائمة الموظفين'],
        ['تقرير الموارد البشرية'],
        ['م', 'القسم', 'الوظيفة', 'اسم الموظف', None, None, None, None, 'الرقم الوظيفي'],
        [1, 'الإدارة', 'محاسب', 'أحمد محمد', None, None, None, None, 100234],
        [2, 'الإدارة', 'مهندس', 'سارة عبدالله', None, None, None, None, 100235],
    ])
    with pytest.raises(suppliers_excel.SuppliersParseError) as exc:
        suppliers_excel.parse(str(path))
    assert 'ترويسة' in str(exc.value)


def test_wrong_account_prefix_is_rejected_even_with_matching_header(tmp_path):
    """طبقة مستقلة: الترويسة صحيحة حرفياً لكن كل الحسابات ببادئة غير ٢١١."""
    path = tmp_path / 'حسابات غير موردين.xlsx'
    _write(path, [
        ['شركة'],
        ['تقرير'],
        ['تبويب', 'المدة بالشهر', None, 'اسم الحساب', None, None, None, None, 'رقم الحساب'],
        ['مشروع أ', '45 يوم', None, 'أحمد محمد', None, None, None, None, '212100'],
        ['مشروع أ', '45 يوم', None, 'سارة عبدالله', None, None, None, None, '212101'],
    ])
    with pytest.raises(suppliers_excel.SuppliersParseError) as exc:
        suppliers_excel.parse(str(path))
    assert '211' in str(exc.value)


def test_valid_suppliers_file_still_parses(tmp_path):
    """ملف سليم — ترويسة صحيحة وبادئة ٢١١ — يمر بلا اعتراض، بمورد واحد فقط."""
    path = tmp_path / 'مدة مديونية الموردين.xlsx'
    _write(path, [
        ['شركة اعمار الخليج المصرية للمقاولات'],
        ['مدة مديونية فواتير الموردين للمشاريع'],
        ['تبويب', 'المدة بالشهر', None, 'اسم الحساب', None, None, None, None, 'رقم الحساب'],
        ['الرسين', '45 يوم', None, 'شركة قنبر للخرسانة الجاهزه', None, None, None, None, '2110110'],
    ])
    result = suppliers_excel.parse(str(path))
    assert len(result['suppliers']) == 1
    assert result['suppliers'][0].account == '2110110'
    assert result['issues'] == []


# ---------------------------------------------------------------- م-٢٧د: ملف مختلط
#
# كل اختبارات البادئة أعلاه أحادية النوع (كل الصفوف صحيحة أو كل الصفوف خاطئة)،
# فلو انقلب الشرط سهواً (`if account.startswith(...)` بدل `if not
# account.startswith(...)`) لن يفشل أي اختبار قائم — لأن كلا الحالتين المتطرفتين
# (الكل أو لا شيء) تعطي نفس النتيجة الظاهرية (SuppliersParseError أو قائمة كاملة).
# فقط ملف مختلط (بعض الصفوف صحيحة وبعضها لا) يكشف الانقلاب: الشرط المعكوس سيقبل
# الصف الخاطئ ويرفض الصحيح، فيتغيّر عدد الموردين المستوردين لا رسالة الخطأ فقط.
def test_mixed_file_keeps_valid_rows_and_flags_the_rest(tmp_path):
    """ملف فيه صفّان صحيحان (٢١١)، صفّ ببادئة خاطئة (٦xxx)، وصفّ بحساب مكرر —
    يجب أن يُستورَد الصفّان الصحيحان فقط، وتُسجَّل ٣ إشعارات issues (خطأ البادئة
    وخطأ التكرار)، لا أن يُرفض الملف كله أو يُقبل بصمت."""
    path = tmp_path / 'ملف مختلط.xlsx'
    _write(path, [
        ['شركة اعمار الخليج المصرية للمقاولات'],
        ['مدة مديونية فواتير الموردين للمشاريع'],
        ['تبويب', 'المدة بالشهر', None, 'اسم الحساب', None, None, None, None, 'رقم الحساب'],
        ['الرسين', '45 يوم', None, 'مورد صحيح أول', None, None, None, None, '2110110'],
        ['مشروع ب', '60 يوم', None, 'حساب موظف بالخطأ', None, None, None, None, '600123'],
        ['السدن', '30 يوم', None, 'مورد صحيح ثاني', None, None, None, None, '2110222'],
        ['مشروع ج', '90 يوم', None, 'مورد صحيح ثاني مكرر', None, None, None, None, '2110222'],
    ])
    result = suppliers_excel.parse(str(path))

    # فقط الصفان بالبادئة الصحيحة وغير المكررة دخلا — لا الصف الخاطئ ولا التكرار
    accounts = sorted(s.account for s in result['suppliers'])
    assert accounts == ['2110110', '2110222']
    assert len(result['suppliers']) == 2

    issue_kinds = [i.get('kind') for i in result['issues']]
    assert issue_kinds.count('wrong_prefix') == 1
    # صف التكرار لا يحمل kind خاص لكن رسالته تذكر «مكرر» صراحة
    dup_messages = [i['message'] for i in result['issues'] if 'مكرر' in i['message']]
    assert len(dup_messages) == 1
    assert '600123' in next(i['message'] for i in result['issues']
                            if i.get('kind') == 'wrong_prefix')


def test_real_downloads_sample_still_parses_if_present():
    """تحقّق على بيانات حقيقية — إن وُجد الملف الفعلي على جهاز المطوّر (~/Downloads)
    يجب ألا يتأثر بإصلاح م-٢٠: ١٠٣ مورداً كما كان قبل الإصلاح."""
    import os
    path = os.path.expanduser('~/Downloads/مدة مديونية الموردين.xlsx')
    if not os.path.exists(path):
        pytest.skip('العيّنة الحقيقية غير موجودة على هذا الجهاز')
    result = suppliers_excel.parse(path)
    assert len(result['suppliers']) == 103
