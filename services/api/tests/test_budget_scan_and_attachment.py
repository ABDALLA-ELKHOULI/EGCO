# -*- coding: utf-8 -*-
"""تغطية م-٥-٥ من PLAN-BUDGET.md: تمييز الملف الممسوح ضوئياً، إرفاق الملف
الأصلي، والتأكد أن مسار xlsx القائم لم يُكسر.

الأربع عيّنات الحقيقية (~/Downloads) هي التي كشفت المشكلة أصلاً — صور ممسوحة
بصفر نص — لكنها ليست في المستودع (مسارات مطلقة على جهاز المستخدم)، فتُختبر هنا
عبر `require_sample`/`sample_missing` (تُخطّى محلياً إن غابت، وتُفشل صراحة في
CI الصارم). إلى جانبها: ملف PDF نصّي حقيقي (اختبار سلبي — يجب ألا يُصنَّف
ممسوحاً) وملف مصنوع صناعياً بـfitz (صفحة صورة بلا نص) يعمل في أي بيئة بلا
اعتماد على عيّنات المستخدم."""
import glob
import importlib
import os

import pytest

from conftest import sample_missing

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
STATEMENT_QANBAR = os.path.join(SAMPLES, 'statement-qanbar.pdf')

DOWNLOADS = os.path.expanduser('~/Downloads')
SCANNED_BUDGET_PDFS = sorted(glob.glob(
    os.path.join(DOWNLOADS, 'تقرير انحراف موازنة اعمال مشروع *شهر ٨*.pdf')))


def _make_synthetic_scanned_pdf(path) -> str:
    """صفحة PDF واحدة بصورة فقط، بلا أي نص — تحاكي شكل العيّنات الأربع بلا
    الاعتماد على وجودها فعلياً على القرص."""
    fitz = pytest.importorskip('fitz')
    doc = fitz.open()
    page = doc.new_page()
    # صورة PNG أحادية اللون ١×١ — كافية ليحسبها fitz "صورة" في الصفحة
    png_1x1 = (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00'
              b'\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc```'
              b'\x00\x00\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82')
    page.insert_image(fitz.Rect(0, 0, 200, 200), stream=png_1x1)
    doc.save(str(path))
    doc.close()
    return str(path)


def _make_text_pdf(path) -> str:
    fitz = pytest.importorskip('fitz')
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), 'كشف حساب نصّي عادي — لا صور ولا مسح ضوئي هنا.')
    doc.save(str(path))
    doc.close()
    return str(path)


# ---------------------------------------------------------------- الاكتشاف بالقياس

def test_synthetic_image_only_pdf_is_scanned(tmp_path):
    from app.ingest.friendly_errors import is_scanned_pdf
    p = _make_synthetic_scanned_pdf(tmp_path / 'scan.pdf')
    assert is_scanned_pdf(p) is True


def test_synthetic_text_pdf_is_not_scanned(tmp_path):
    from app.ingest.friendly_errors import is_scanned_pdf
    p = _make_text_pdf(tmp_path / 'text.pdf')
    assert is_scanned_pdf(p) is False


@pytest.mark.skipif(sample_missing(STATEMENT_QANBAR),
                    reason='design/samples not present in this checkout')
def test_real_text_statement_pdf_not_flagged_scanned():
    """PDF نصّي حقيقي (كشف حساب) — لا يجوز أن يُصنَّف ممسوحاً ولا يُوجَّه لرسالة
    الموازنة الممسوحة."""
    from app.ingest.friendly_errors import is_scanned_pdf
    assert is_scanned_pdf(STATEMENT_QANBAR) is False


@pytest.mark.skipif(not SCANNED_BUDGET_PDFS,
                    reason='عيّنات الموازنة الممسوحة غير موجودة على هذا الجهاز')
def test_real_scanned_budget_samples_detected():
    from app.ingest.friendly_errors import is_scanned_pdf
    assert len(SCANNED_BUDGET_PDFS) >= 3
    for p in SCANNED_BUDGET_PDFS:
        assert is_scanned_pdf(p) is True, p


# ---------------------------------------------------------------- الرسالة عبر preview_statement

@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)
    return import_service_mod


def test_preview_statement_rejects_scanned_pdf_with_arabic_guidance(env, tmp_path):
    from app.ingest.budget_xlsx import BudgetParseError
    p = _make_synthetic_scanned_pdf(tmp_path / 'scan.pdf')
    with pytest.raises(BudgetParseError) as exc:
        env.preview_statement(p, 'pdf_statement', None)
    msg = str(exc.value)
    assert 'ممسوح' in msg
    assert 'يدوي' in msg
    assert 'أرفق' in msg
    # لا رسالة Excel غامضة قديمة
    assert 'ملف Excel' not in msg


def test_commit_statement_also_rejects_scanned_pdf(env, tmp_path):
    from app.ingest.budget_xlsx import BudgetParseError
    from app.db import session as session_mod
    importlib.reload(session_mod)
    session_mod.init_db()
    db = session_mod.SessionLocal()
    try:
        p = _make_synthetic_scanned_pdf(tmp_path / 'scan.pdf')
        with pytest.raises(BudgetParseError):
            env.commit_statement(db, p, source='pdf_statement', backup=False)
    finally:
        db.close()


def test_text_pdf_not_routed_to_scanned_budget_message(env, tmp_path):
    """PDF نصّي غير موازنة يجب ألا يُرفض برسالة الموازنة الممسوحة — يستمر لمسار
    كشف الحساب العادي (وقد يفشل لاحقاً لأسباب أخرى، لكن ليس بهذه الرسالة)."""
    from app.ingest.budget_xlsx import BudgetParseError
    p = _make_text_pdf(tmp_path / 'text.pdf')
    try:
        env.preview_statement(p, 'pdf_statement', None)
    except BudgetParseError as e:
        assert 'ممسوح' not in str(e)
    except Exception as e:
        assert 'ممسوح' not in str(e)


# ---------------------------------------------------------------- الإرفاق

def test_save_budget_attachment_copies_file_and_returns_readable_path(env, tmp_path):
    src = tmp_path / 'مشروع الرسين شهر ٨.pdf'
    src.write_bytes(b'%PDF-1.4 fake budget report bytes')
    stored = env.save_budget_attachment(str(src))
    assert os.path.exists(stored)
    assert os.path.isfile(stored)
    with open(stored, 'rb') as f:
        assert f.read() == b'%PDF-1.4 fake budget report bytes'
    # يُخزَّن تحت مجلد بيانات التطبيق المعزول لهذا الاختبار، لا مسار المصدر نفسه
    assert stored != str(src)


def test_save_budget_attachment_handles_name_collision(env, tmp_path):
    src = tmp_path / 'تقرير.pdf'
    src.write_bytes(b'one')
    first = env.save_budget_attachment(str(src))
    second = env.save_budget_attachment(str(src))
    assert first != second
    assert os.path.exists(first) and os.path.exists(second)


def test_save_budget_attachment_sanitizes_traversal_and_slashes(env):
    name = env._sanitize_attachment_name('../../etc/passwd')
    assert '/' not in name and '..' not in name


def test_save_budget_attachment_rejects_unsupported_extension(env, tmp_path):
    from app.ingest.friendly_errors import FriendlyFileError
    src = tmp_path / 'ملف.exe'
    src.write_bytes(b'MZ')
    with pytest.raises(FriendlyFileError):
        env.save_budget_attachment(str(src))


def test_save_budget_attachment_missing_file_raises_friendly_error(env, tmp_path):
    from app.ingest.friendly_errors import FriendlyFileError
    with pytest.raises(FriendlyFileError):
        env.save_budget_attachment(str(tmp_path / 'لا يوجد.pdf'))


# ---------------------------------------------------------------- مسار xlsx لم يُكسر

BUDGET_XLSX_GLOB = glob.glob(os.path.join(DOWNLOADS, '*انحراف الموازنه*.xlsx'))


@pytest.mark.skipif(not BUDGET_XLSX_GLOB,
                    reason='ملف موازنة xlsx الحقيقي غير موجود على هذا الجهاز')
def test_real_budget_xlsx_still_parses_after_scanned_pdf_changes():
    from app.ingest.budget_xlsx import parse
    sheets = parse(BUDGET_XLSX_GLOB[0])
    assert sheets
    assert all(s['project'] == 'سدايم' for s in sheets)
    assert any(s['month'].month == 7 for s in sheets)
