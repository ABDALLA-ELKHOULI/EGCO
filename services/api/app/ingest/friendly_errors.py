# -*- coding: utf-8 -*-
"""ترجمة أخطاء المكتبات الخام (fitz/openpyxl/xlrd/csv) إلى رسالة عربية يستطيع
المستخدم التصرف بناءً عليها.

المشكلة التي يعالجها هذا الملف: قبله كانت رسائل مثل `PDFSyntaxError`، أو
`File is not a zip file`، أو نص استثناء إنجليزي خام يُلصق داخل جملة عربية
(`f'تعذر فتح الملف: {e}'`) تصل مباشرة لمستخدم عربي لا يستطيع فعل شيء حيالها.

القاعدة: كل استثناء يخرج من طبقة فتح الملف (fitz.open / openpyxl.load_workbook /
xlrd.open_workbook / open() العادية) يمرّ من هنا قبل أن يتحوّل لرسالة `ParseError`
يراها المستخدم. النص الإنجليزي الأصلي يبقى متاحاً عبر `FriendlyFileError.technical`
(وعبر `__cause__` بفضل `raise ... from e`) لأغراض التشخيص في سجلّات الخادم فقط —
لا يُعرض في الواجهة أبداً.
"""
from __future__ import annotations

import os


class FriendlyFileError(Exception):
    """رسالة عربية فعّالة في `str(self)`، وتفصيل إنجليزي أصلي في `.technical`."""

    def __init__(self, message: str, technical: str = ''):
        super().__init__(message)
        self.technical = technical


def _size_or_none(path: str):
    try:
        return os.path.getsize(path)
    except OSError:
        return None


def check_basic_file(path: str, kind_label: str, error_cls: type = FriendlyFileError) -> None:
    """فحوصات تسبق أي محاولة تحليل متخصصة — ملف غير موجود أو فارغ تماماً (0 بايت)
    هو السبب الأكثر شيوعاً لتصدير فاشل من النظام المصدر، ورسالته يجب أن تقول ذلك
    صراحة بدل أن تسقط في رسالة تحليل عامة لاحقاً.

    `error_cls` يُتيح للمستدعي رفع نوع الاستثناء الذي تتوقعه طبقة imports.py
    (كل قارئ له `XxxParseError` خاص به) بدل `FriendlyFileError` العام — الفحص
    نفسه، فقط النوع المرفوع يطابق ما يلتقطه الـ`_PARSE_ERRORS` في الراوت."""
    if not os.path.exists(path):
        raise error_cls(f'الملف غير موجود: {path}')
    if not os.path.isfile(path):
        raise error_cls(f'المسار ليس ملفاً: {path}')
    size = _size_or_none(path)
    if size == 0:
        raise error_cls(
            f'الملف فارغ (0 بايت) — أعد تصدير {kind_label} من النظام المصدر ثم ارفعه من جديد.')


def _peek(path: str, n: int = 16) -> bytes:
    try:
        with open(path, 'rb') as f:
            return f.read(n)
    except OSError:
        return b''


def _looks_like_html(head: bytes) -> bool:
    h = head.lstrip()[:15].lower()
    return h.startswith(b'<html') or h.startswith(b'<!doctype') or h.startswith(b'<table') \
        or h.startswith(b'<?xml') and b'html' in head[:200].lower()


#: توقيع OLE2/CFBF — صيغة ملفات Office القديمة، وأيضاً صيغة ملفات xlsx/xls
#: المحمية بكلمة مرور (Office يغلّفها في حاوية OLE2 حتى لو كان المحتوى Zip أصلاً).
_OLE_MAGIC = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'


def _looks_like_ole(head: bytes) -> bool:
    return head[:8] == _OLE_MAGIC


def describe_excel_open_error(exc: Exception, path: str, expected_ext: str = 'xlsx') -> FriendlyFileError:
    """يحوّل استثناء openpyxl/xlrd الخام عند فتح ملف Excel إلى رسالة عربية فعّالة."""
    head = _peek(path)
    text = str(exc)
    low = text.lower()

    if _looks_like_html(head):
        return FriendlyFileError(
            'هذا الملف تقرير HTML محفوظ بامتداد Excel — ليس ملف Excel فعلياً. صدّر '
            'الملف بصيغة Excel صحيحة من النظام المصدر، أو تأكد أنك اخترت مصدر '
            'الاستيراد المناسب لهذا النوع من الملفات.', technical=text)

    if _looks_like_ole(head) and expected_ext == 'xlsx':
        # xlsx المحمي بكلمة مرور يُغلَّف في حاوية OLE2 بدل Zip العادي — هذا هو
        # السبب الأشيع لهذا التوقيع تحديداً على ملف بامتداد xlsx.
        return FriendlyFileError(
            'الملف محمي بكلمة مرور — أزل الحماية من الملف (احفظه بلا كلمة مرور) ثم '
            'أعد رفعه.', technical=text)

    if 'password' in low or 'encrypt' in low:
        return FriendlyFileError(
            'الملف محمي بكلمة مرور — أزل الحماية ثم أعد رفعه.', technical=text)

    if 'expected bof record' in low or 'unsupported format' in low or 'not a zip file' in low \
            or 'not supported' in low or 'invalidfileexception' in low.replace(' ', ''):
        return FriendlyFileError(
            f'تعذّرت قراءة الملف — امتداده {expected_ext} لكن محتواه ليس بصيغة Excel '
            'صحيحة أو تالف. تأكد من اختيار الملف الصحيح وأنه لم يتلف أثناء النسخ أو '
            'التنزيل، ثم أعد المحاولة.', technical=text)

    return FriendlyFileError(
        f'تعذّرت قراءة ملف Excel ({expected_ext}) — تأكد أنه سليم وغير تالف وبصيغة '
        'Excel فعلاً، ثم أعد المحاولة.', technical=text)


def describe_pdf_open_error(exc: Exception, path: str) -> FriendlyFileError:
    """يحوّل استثناء PyMuPDF (fitz) الخام عند فتح ملف PDF إلى رسالة عربية فعّالة."""
    text = str(exc)
    low = text.lower()

    if 'password' in low or 'encrypt' in low:
        return FriendlyFileError(
            'ملف الـPDF محمي بكلمة مرور — أزل الحماية (أو اطلب نسخة غير محمية من '
            'الجهة المُصدرة) ثم أعد رفعه.', technical=text)

    head = _peek(path)
    if _looks_like_html(head):
        return FriendlyFileError(
            'هذا الملف تقرير HTML محفوظ بامتداد PDF — ليس ملف PDF فعلياً. صدّر '
            'الكشف بصيغة PDF صحيحة من النظام المصدر ثم أعد رفعه.', technical=text)

    return FriendlyFileError(
        'تعذّر فتح ملف الـPDF — الملف تالف أو ليس بصيغة PDF سليمة. تأكد من اختيار '
        'الملف الصحيح وأنه لم يتلف أثناء النسخ أو التنزيل، ثم أعد المحاولة.',
        technical=text)


def describe_text_open_error(exc: Exception, path: str, kind_label: str = 'الملف') -> FriendlyFileError:
    """يحوّل استثناء فتح/قراءة نصي خام (CSV ونحوه) إلى رسالة عربية فعّالة."""
    text = str(exc)
    if isinstance(exc, FileNotFoundError):
        return FriendlyFileError(f'الملف غير موجود: {path}', technical=text)
    if isinstance(exc, PermissionError):
        return FriendlyFileError(f'لا صلاحية للوصول لهذا الملف: {path}', technical=text)
    if isinstance(exc, UnicodeDecodeError):
        return FriendlyFileError(
            f'{kind_label} ليس نصاً صالحاً — قد يكون هذا في الحقيقة ملف Excel أو PDF '
            'محفوظاً بامتداد خاطئ. تأكد من نوع الملف والمصدر المختار.', technical=text)
    return FriendlyFileError(f'تعذّرت قراءة {kind_label}: {text}', technical=text)
