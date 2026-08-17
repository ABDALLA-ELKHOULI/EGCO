# -*- coding: utf-8 -*-
"""رمز الفرع الملتصق بالوصف — سبب تكرار الدفعات الذي أبلغ عنه المستخدم.

القصة كاملة، لأنها كلّفت وقتاً طويلاً وتستحق ألا تتكرر:

النظام المحاسبي يطبع رمز الفرع ملتصقاً ببداية الوصف في التخطيط «المفكوك»:
«0001دفعة بيت الاباء روشن». والوصف جزءٌ من هوية الحركة (وهذا قرار صحيح — كشوف
حقيقية تحمل حركتين تختلفان في الوصف فقط). فحين تغيّرت طريقة استخراج الوصف بين
نسختي المحلّل، صار نفس السطر يُقرأ بهويتين:

    [0001دفعة بیت الاباء روشن]   ← الصف القديم المخزَّن
    [دفعة بیت الاباء روشن]        ← ما ينتجه المحلّل بعد التحديث

فرآهما الترميز حركتين مختلفتين وأدخل الثانية. أُعيد إنتاج هذا على نسخة من قاعدة
المستخدم الحقيقية: ١٤ زوجاً مكرراً، كل زوج بنفس التاريخ والمبلغ **ونفس رقم
السند** — ولا فرق إلا هذه الأرقام الأربعة في أول الوصف.

The fix has two halves and BOTH are required:
  1. the parser stops emitting the branch code (`_clean_desc`), and
  2. a one-time migration strips it from the ~1219 already-stored rows.
Fixing only the parser makes every future upload duplicate against the old rows;
fixing only the data lets the parser dirty them again. That is why both are tested.
"""
from app.ingest.pdf_statement import _clean_desc


def test_branch_prefix_is_stripped():
    assert _clean_desc('0001دفعة بيت الاباء روشن') == 'دفعة بيت الاباء روشن'
    assert _clean_desc('0001دفعة تاتكو خرسانه') == 'دفعة تاتكو خرسانه'


def test_clean_description_is_left_alone():
    """الوصف النظيف لا يُمسّ — وإلا صار الإصلاح نفسه سبب اختلاف هوية جديد."""
    assert _clean_desc('دفعة بيت الاباء روشن') == 'دفعة بيت الاباء روشن'
    assert _clean_desc('') == ''


def test_real_numbers_inside_description_survive():
    """أرقام الفواتير داخل الوصف ليست رمز فرع — إزالتها تُفقد معلومة حقيقية.

    «مرتجع لفاتوره رقم481…» يجب أن يبقى كما هو: رقم الفاتورة هنا هو ما يميّز
    مرتجعاً عن آخر بنفس المبلغ والسند (حالة حقيقية في حساب انظمة الطلاء).
    """
    s = 'مرتجع لفاتوره رقم481 لمؤسسة انظمة الطلاء'
    assert _clean_desc(s) == s


def test_prefix_only_stripped_at_the_start():
    """الرقم في وسط الوصف ليس رمز فرع."""
    s = 'دفعة 0001 مقدمة'
    assert _clean_desc(s) == s


def test_both_forms_normalise_to_one_identity():
    """جوهر الخلل: الصيغتان يجب أن تنتهيا إلى وصف واحد، وإلا تكرّرت الحركة."""
    old_stored = '0001دفعة مصنع فاروس لزجاج السیكوریت'
    newly_parsed = 'دفعة مصنع فاروس لزجاج السیكوریت'
    assert _clean_desc(old_stored) == _clean_desc(newly_parsed)
