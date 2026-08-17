# -*- coding: utf-8 -*-
"""يتأكد أن كل الوحدات التي يحتاجها البناء المُعبَّأ (PyInstaller) قابلة
للاستيراد فعلياً.

السبب: PyInstaller لا يرى الاستيراد الديناميكي (import داخل دالة، أو استيراد
تفعله مكتبة أخرى بنفسها في وقت التشغيل) إلا إن أُدرج صراحة في `hidden` بملف
egco-api.spec. هذا حدث مرتين فعلاً في هذا المشروع: PyInstaller نفسه كان ناقصاً
من requirements.txt، ثم Pillow — مرّ الاثنان محلياً (مثبَّتان يدوياً على جهاز
التطوير) وفشلا على بيئة نظيفة (GitHub Actions / جهاز المستخدم على ويندوز).

هذا الاختبار لا يُثبت أن PyInstaller سيُدرجها فعلاً (ذلك يحتاج بناءً حقيقياً
وتشغيل الملف التنفيذي الناتج — انظر تقرير المهمة) لكنه يمنع الانحدار الأرخص:
لو حُذفت xlrd أو PIL من requirements.txt سيفشل هذا الاختبار في نفس اللحظة على
أي بيئة، محلية أو CI، بدل أن يُكتشف لاحقاً في PyInstaller أو عند المستخدم.
"""
import importlib

import pytest

#: كل وحدة هنا مذكورة صراحة في hidden بملف services/api/egco-api.spec —
#: القائمتان يجب أن تبقيا متطابقتين؛ إن أُضيفت وحدة هناك أضفها هنا أيضاً.
PACKAGED_HIDDEN_IMPORTS = [
    'anyio',
    'openpyxl',
    'xlrd',
    'PIL',
    'PIL.Image',
    'fitz',
    'email.mime.multipart',
    'email.mime.text',
]


@pytest.mark.parametrize('module_name', PACKAGED_HIDDEN_IMPORTS)
def test_hidden_import_is_importable(module_name):
    """لو فشل هذا لوحدة معينة، فالحزمة المُعبَّأة ستفشل بنفس الطريقة على جهاز
    المستخدم — استيراد فاشل هنا يعني حزمة ناقصة في requirements.txt، لا مجرد
    اختبار عابر."""
    importlib.import_module(module_name)


def test_xlrd_reads_biff_debts_report_real_file():
    """xlrd هو ما يقرأ فعلياً ملف .xls القديم (تقرير المديونيات المجمّع) —
    استيراد الوحدة وحده لا يكفي؛ نتأكد أنها تستطيع فتح ملف BIFF حقيقي عبر نفس
    قارئ المشروع (app.ingest.debts_report_xls) لا مجرد xlrd مباشرة. نفس ملف
    الاختبار وشرط التجاوز في tests/test_debts_report_xls.py (REAL_FILE) — لا
    fixture ثنائي مُضاف لهذا المستودع."""
    import os

    from app.ingest import debts_report_xls

    real_file = os.path.expanduser(
        '~/Downloads/تقرير مديونيات المقاولين والموردين للمشاريع حتى 07-13.xls')
    if not os.path.exists(real_file):
        pytest.skip('real downloaded .xls not present in this checkout')
    parsed = debts_report_xls.parse(real_file)
    assert parsed['rows']
