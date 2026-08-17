# -*- coding: utf-8 -*-
"""ربط الحركات القديمة بملفاتها — حتى لا يمحو حذفُ ملفٍ حركاتِ ملفٍ آخر.

الخلل الذي يحرسه هذا الاختبار، وقد وقع على بيانات المستخدم الحقيقية:

الحركات المرفوعة قبل ميزة إدارة الملفات لا تحمل `import_log_id`. فكان الحذف
يعمل بالتقريب — «نفس الحساب، وأي حركة أُنشئت خلال ٣ دقائق من وقت الرفع» — وهذا
يمحو حركات ملفٍ ثانٍ رُفع لنفس المورد بفارق دقيقة، وهو سير عمل طبيعي تماماً
(ترفع كشفاً، تلاحظ خطأ، ترفع المصحّح).

The backfill claims every non-manual row for exactly ONE log — the closest in time
among that account's logs — so the approximate path stops being reachable.

فخٌّ وقعتُ فيه أثناء الإصلاح ويستحق التثبيت: المصدر في القاعدة الحقيقية
'pdf_statement' لا 'statement'. ترشيحٌ بقيمة بعينها أغفل ١٠٦٤ فاتورة من ١٠٩٥
بصمت. لذلك الاستثناء هنا بالنفي (كل ما ليس يدوياً) لا بالتعداد.
"""
import datetime as dt

from sqlalchemy import text


def _seed(client, account='2110001'):
    client.post('/api/v1/suppliers', json=dict(
        account=account, name='مورد الاختبار', project='الرسين', term='30 يوم'))


def _rows_without_log(session_mod, table):
    with session_mod.engine.begin() as conn:
        return conn.execute(text(
            "SELECT COUNT(*) FROM %s WHERE import_log_id IS NULL "
            "AND source <> 'manual'" % table)).scalar()


def test_backfill_claims_every_non_manual_row(api_client):
    """لا حركة غير يدوية تبقى بلا ملف بعد البذر."""
    import app.db.session as session_mod

    _seed(api_client)
    sup_id = None
    with session_mod.engine.begin() as conn:
        sup_id = conn.execute(text(
            "SELECT id FROM suppliers WHERE account = '2110001'")).scalar()
        now = dt.datetime.now(dt.timezone.utc).isoformat(sep=' ')
        conn.execute(text(
            "INSERT INTO import_logs (id, source, path, account, imported, skipped, "
            "reconciled, issues, created_at, updated_at) VALUES "
            "('log-a', 'pdf_statement', 'a.pdf', '2110001', 2, 0, 1, '[]', :now, :now)"),
            {'now': now})
        # المصدر 'pdf_statement' كما في القاعدة الحقيقية — لا 'statement'
        for i, amt in enumerate((100.0, 200.0)):
            conn.execute(text(
                "INSERT INTO invoices (id, supplier_id, number, date, amount, doc, "
                "description, source, created_at, updated_at) VALUES "
                "(:id, :sid, :num, '2026-01-0%d', :amt, 'D%d', 'وصف', 'pdf_statement', "
                ":now, :now)" % (i + 1, i)),
                {'id': 'inv-%d' % i, 'sid': sup_id, 'num': str(i), 'amt': amt, 'now': now})
        conn.execute(text(
            "DELETE FROM schema_flags WHERE key = 'backfill_import_log_id_v1'"))

    assert _rows_without_log(session_mod, 'invoices') == 2
    session_mod._backfill_import_log_id()
    assert _rows_without_log(session_mod, 'invoices') == 0, (
        'حركات بلا ملف بعد البذر — الحذف سيعود تقريبياً وسيمحو ملفات أخرى')


def test_manual_rows_are_never_claimed(api_client):
    """الإدخال اليدوي لا يخصّ ملفاً — وحذف ملفٍ يجب ألا يمسّه أبداً."""
    import app.db.session as session_mod

    _seed(api_client, '2110002')
    r = api_client.post('/api/v1/manual/invoices', json=dict(
        account='2110002', amount=500, date='2026-02-01', description='يدوي'))
    assert r.status_code in (200, 201), r.text

    with session_mod.engine.begin() as conn:
        conn.execute(text(
            "DELETE FROM schema_flags WHERE key = 'backfill_import_log_id_v1'"))
    session_mod._backfill_import_log_id()

    with session_mod.engine.begin() as conn:
        claimed = conn.execute(text(
            "SELECT COUNT(*) FROM invoices WHERE source = 'manual' "
            "AND import_log_id IS NOT NULL")).scalar()
    assert claimed == 0, 'حركة يدوية نُسبت إلى ملف — حذف الملف سيمحوها'


def test_backfill_runs_once(api_client):
    """العلم يمنع التكرار — والتكرار هنا يعيد نسب حركات نُقلت عمداً."""
    import app.db.session as session_mod

    with session_mod.engine.begin() as conn:
        conn.execute(text(
            "DELETE FROM schema_flags WHERE key = 'backfill_import_log_id_v1'"))
    session_mod._backfill_import_log_id()
    with session_mod.engine.begin() as conn:
        flagged = conn.execute(text(
            "SELECT COUNT(*) FROM schema_flags "
            "WHERE key = 'backfill_import_log_id_v1'")).scalar()
    assert flagged == 1
