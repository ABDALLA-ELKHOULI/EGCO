# -*- coding: utf-8 -*-
"""رسائل الخطأ العربية عند رفع ملفات تالفة/فارغة/محمية — بلا اتصال بقاعدة بيانات
ولا مسارات API، فقط قارئات app/ingest نفسها.

المشكلة التي يختبرها هذا الملف: كانت رسائل مثل PDFSyntaxError أو
`File is not a zip file` (نصوص مكتبات إنجليزية خام) تصل للمستخدم العربي كما هي.
كل اختبار هنا يبني ملفاً تالفاً حقيقياً (لا يُحاكي الاستثناء) ويتأكد أن الرسالة
النهائية عربية بالكامل وتخبر المستخدم بما يفعله، لا أنها تحمل نص استثناء خام.
"""
import re

import pytest

from app.ingest import (budget_xlsx, csv_statement, debts_report_xls, pdf_statement,
                        receivables_excel, suppliers_excel)
from app.ingest.debts_report_xls import DebtsReportParseError
from app.ingest.budget_xlsx import BudgetParseError
from app.ingest.csv_statement import CsvStatementParseError
from app.ingest.pdf_statement import StatementParseError
from app.ingest.receivables_excel import ReceivablesExcelParseError
from app.ingest.suppliers_excel import SuppliersParseError

#: توقيعات استثناءات المكتبات الخام (pdfminer/fitz/openpyxl/xlrd/pathlib) التي لا
#: يجوز أن تصل بلا ترجمة — لا نمنع كل حرف لاتيني (مسار الملف نفسه إنجليزي، وكلمات
#: مثل Excel/PDF/HTML مصطلحات تقنية مقبولة عربياً) بل نمنع تحديداً أسماء الأصناف
#: واستثناءات المكتبات الخام التي كانت تتسرّب قبل هذا الإصلاح.
_LEAKED_LIBRARY_SIGNATURES = (
    'traceback', 'exception', 'syntaxerror', 'badzipfile', 'zipfile',
    'invalidfileexception', 'compdocerror', 'xlrderror', 'runtimeerror',
    'valueerror', 'keyerror', 'typeerror', 'attributeerror', 'filedataerror',
    'pdfsyntaxerror', 'is not a zip file', 'expected bof record',
    'no module named', 'traceback (most recent call last)',
)


def _assert_arabic_actionable(message: str) -> None:
    assert message, 'الرسالة يجب ألا تكون فارغة'
    low = message.lower()
    leaked = [sig for sig in _LEAKED_LIBRARY_SIGNATURES if sig in low]
    assert not leaked, f'رسالة تحمل توقيع استثناء مكتبة خام لم يُترجم: {leaked} — {message!r}'
    assert re.search(r'[؀-ۿ]', message), f'الرسالة يجب أن تكون عربية: {message!r}'
    # رسالة فعّالة تحتوي غالباً فعل أمر يوجّه المستخدم (أعد/أزل/تأكد/صدّر) أو تشرح
    # حالة واضحة (الملف فارغ/غير موجود/محمي)
    assert any(kw in message for kw in
              ('أعد', 'أزل', 'تأكد', 'صدّر', 'غير موجود', 'فارغ', 'محمي', 'تعذّر', 'تعذر')), (
        f'الرسالة لا تبدو فعّالة (لا تُرشد المستخدم): {message!r}')


@pytest.fixture()
def fx(tmp_path):
    return tmp_path


def _write_zero_byte(path):
    path.write_bytes(b'')
    return str(path)


def _write_html(path):
    path.write_text('<html><body><table><tr><td>a</td></tr></table></body></html>',
                    encoding='utf-8')
    return str(path)


def _write_garbage(path):
    path.write_bytes(b'not a real file, just noise' * 5)
    return str(path)


# ---------------------------------------------------------------- PDF (كشف حساب مورد)

def test_pdf_zero_byte(fx):
    path = _write_zero_byte(fx / 'empty.pdf')
    with pytest.raises(StatementParseError) as ei:
        pdf_statement.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'فارغ' in str(ei.value)


def test_pdf_corrupt_not_a_pdf(fx):
    path = _write_garbage(fx / 'garbage.pdf')
    with pytest.raises(StatementParseError) as ei:
        pdf_statement.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'تالف' in str(ei.value) or 'PDF' in str(ei.value)


def test_pdf_html_disguised_as_pdf(fx):
    path = _write_html(fx / 'report.pdf')
    with pytest.raises(StatementParseError) as ei:
        pdf_statement.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'HTML' in str(ei.value)


def test_pdf_missing_file(fx):
    path = str(fx / 'does-not-exist.pdf')
    with pytest.raises(StatementParseError) as ei:
        pdf_statement.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'غير موجود' in str(ei.value)


def test_pdf_password_protected(fx):
    fitz = pytest.importorskip('fitz')
    path = str(fx / 'encrypted.pdf')
    doc = fitz.open()
    doc.new_page()
    doc.save(path, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='owner123', user_pw='user123')
    doc.close()

    with pytest.raises(StatementParseError) as ei:
        pdf_statement.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'محمي' in str(ei.value) and 'كلمة مرور' in str(ei.value)


# ---------------------------------------------------------------- Excel (موردون/تحصيلات/موازنة)

def test_suppliers_zero_byte(fx):
    path = _write_zero_byte(fx / 'empty.xlsx')
    with pytest.raises(SuppliersParseError) as ei:
        suppliers_excel.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'فارغ' in str(ei.value)


def test_suppliers_html_disguised_as_xlsx(fx):
    path = _write_html(fx / 'export.xlsx')
    with pytest.raises(SuppliersParseError) as ei:
        suppliers_excel.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'HTML' in str(ei.value)


def test_suppliers_corrupt_zip(fx):
    path = _write_garbage(fx / 'garbage.xlsx')
    with pytest.raises(SuppliersParseError) as ei:
        suppliers_excel.parse(path)
    _assert_arabic_actionable(str(ei.value))


def test_receivables_excel_zero_byte(fx):
    path = _write_zero_byte(fx / 'empty.xlsx')
    with pytest.raises(ReceivablesExcelParseError) as ei:
        receivables_excel.parse(path)
    _assert_arabic_actionable(str(ei.value))


def test_budget_xlsx_zero_byte(fx):
    path = _write_zero_byte(fx / 'empty.xlsx')
    with pytest.raises(BudgetParseError) as ei:
        budget_xlsx.parse(path)
    _assert_arabic_actionable(str(ei.value))


def test_debts_report_xls_zero_byte(fx):
    path = _write_zero_byte(fx / 'empty.xls')
    with pytest.raises(DebtsReportParseError) as ei:
        debts_report_xls.parse(path)
    _assert_arabic_actionable(str(ei.value))


def test_debts_report_html_disguised_as_xls(fx):
    path = _write_html(fx / 'export.xls')
    with pytest.raises(DebtsReportParseError) as ei:
        debts_report_xls.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'HTML' in str(ei.value)


# ---------------------------------------------------------------- CSV

def test_csv_zero_byte(fx):
    path = _write_zero_byte(fx / 'empty.csv')
    with pytest.raises(CsvStatementParseError) as ei:
        csv_statement.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'فارغ' in str(ei.value)


def test_csv_binary_garbage_is_not_a_raw_traceback(fx):
    # ملف xlsx حقيقي (ثنائي، Zip) بامتداد csv خاطئ — يجب ألا يُسقط UnicodeDecodeError خاماً
    openpyxl = pytest.importorskip('openpyxl')
    path = str(fx / 'wrong-type.csv')
    wb = openpyxl.Workbook()
    wb.save(path)
    with pytest.raises(CsvStatementParseError) as ei:
        csv_statement.parse(path)
    _assert_arabic_actionable(str(ei.value))


def test_csv_missing_file(fx):
    path = str(fx / 'does-not-exist.csv')
    with pytest.raises(CsvStatementParseError) as ei:
        csv_statement.parse(path)
    _assert_arabic_actionable(str(ei.value))
    assert 'غير موجود' in str(ei.value)


# ---------------------------------------------------------------- friendly_errors مباشرة

def test_check_basic_file_raises_requested_error_class(tmp_path):
    from app.ingest.friendly_errors import check_basic_file

    class _MyError(Exception):
        pass

    missing = tmp_path / 'nope.xlsx'
    with pytest.raises(_MyError):
        check_basic_file(str(missing), 'ملف تجريبي', _MyError)

    empty = tmp_path / 'empty.xlsx'
    empty.write_bytes(b'')
    with pytest.raises(_MyError) as ei:
        check_basic_file(str(empty), 'ملف تجريبي', _MyError)
    assert 'فارغ' in str(ei.value)


def test_technical_detail_preserved_for_diagnostics(tmp_path):
    """الرسالة العربية لا تحمل النص الإنجليزي، لكنه يبقى متاحاً عبر __cause__/.technical
    لأغراض التشخيص في السجلّات — لا يُفقد، فقط لا يُعرض للمستخدم."""
    path = _write_garbage(tmp_path / 'garbage.xlsx')
    try:
        suppliers_excel.parse(path)
        assert False, 'expected SuppliersParseError'
    except SuppliersParseError as e:
        assert e.__cause__ is not None
        assert str(e.__cause__)  # النص الإنجليزي الأصلي محفوظ في السبب الأصلي
