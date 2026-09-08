# -*- coding: utf-8 -*-
"""اختبارات وحدة الموازنة — التحليل من الملف الحقيقي، سلسلة التراكمي، وتعارض
المصدرين، والمسارات. انظر docs/feedback/PLAN-BUDGET.md للتعريف القاطع."""
import datetime as dt
import importlib
import os

import pytest

from conftest import sample_missing

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
BUDGET_XLSX = os.path.join(SAMPLES, 'budget-deviation-2026-07.xlsx')

pytestmark = pytest.mark.skipif(
    sample_missing(BUDGET_XLSX),
    reason='design/samples not present in this checkout')


def _by_month(sheets):
    return {s['month']: s for s in sheets}


def test_parse_sample_workbook():
    from app.ingest import budget_xlsx
    sheets = budget_xlsx.parse(BUDGET_XLSX)
    assert len(sheets) == 2
    assert all(s['project'] == 'سدايم' for s in sheets)

    by_month = _by_month(sheets)
    july = by_month[dt.date(2026, 7, 1)]
    assert july['actual_month'] == pytest.approx(1096845.76)
    assert july['planned_month'] == pytest.approx(433322)
    assert july['deviation_month'] == pytest.approx(663523.76)
    assert july['cum_actual'] == pytest.approx(49844690.75)
    assert july['cum_planned'] == pytest.approx(59312803)
    assert july['cum_prev_actual'] == pytest.approx(48747844.99)
    assert july['cum_prev_planned'] == pytest.approx(58879481)
    assert july['delay_pct'] == pytest.approx(0.1596, abs=1e-3)
    assert july['completion_pct'] == pytest.approx(0.8404)
    assert july['serial'] == 'EGCO/1607026'
    assert july['issued_on'] == dt.date(2026, 7, 16)

    claims = {c['no']: c for c in july['claims']}
    assert claims['38']['amount'] == pytest.approx(1096845.76)
    assert claims['38']['date'] == dt.date(2026, 7, 4)
    # claim 39 is planned but not yet issued — kept with amount 0 and no date
    assert claims['39']['amount'] == 0
    assert claims['39']['date'] is None

    june = by_month[dt.date(2026, 6, 1)]
    assert june['project'] == 'سدايم'
    assert june['delay_pct'] == pytest.approx(0.1708, abs=1e-3)


@pytest.fixture()
def db_env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.services.budget_service as budget_service_mod
    importlib.reload(budget_service_mod)

    session_mod.init_db()
    db = session_mod.SessionLocal()
    yield db, budget_service_mod
    db.close()


def test_import_twice_updates_not_duplicates(db_env):
    db, budget_service = db_env
    from app.db import models

    first = budget_service.import_budget(db, BUDGET_XLSX)
    assert first['imported'] == 2
    assert first['updated'] == 0
    assert first['projects'] == ['سدايم']

    second = budget_service.import_budget(db, BUDGET_XLSX)
    assert second['imported'] == 0
    assert second['updated'] == 2
    assert db.query(models.BudgetSnapshot).count() == 2


def test_api_import_and_list(api_client):
    r = api_client.post('/api/v1/budget/import', json={'path': BUDGET_XLSX})
    assert r.status_code == 200

    r = api_client.get('/api/v1/budget')
    assert r.status_code == 200
    body = r.json()
    assert body['count'] == 2
    assert body['projects'] == ['سدايم']
    rows = {row['month']: row for row in body['rows']}
    july = rows['2026-07-01']
    assert july['actualMonth'] == pytest.approx(1096845.76)
    assert july['cumActual'] == pytest.approx(49844690.75)
    assert july['delayPct'] == pytest.approx(0.1596, abs=1e-3)
    assert july['entrySource'] == 'file'
    # July delay improved vs June — اتجاه التحسّن سالب دائماً هنا (تأخر أقل)
    assert july['delayDeltaPp'] < 0
    assert july['delayDeltaPp'] == pytest.approx(-1.24, abs=0.05)
    assert july['status'] == 'behind'  # cum_actual < cum_planned

    r = api_client.get('/api/v1/budget/project/سدايم')
    assert r.status_code == 200
    detail = r.json()
    assert detail['months'][-1]['docNo'] == 'EGCO/1607026'
    assert detail['contractors'] == [] or isinstance(detail['contractors'], list)

    r = api_client.get('/api/v1/budget/project/غير-موجود')
    assert r.status_code == 404


def test_api_import_missing_file(api_client):
    r = api_client.post('/api/v1/budget/import', json={'path': '/no/such/file.xlsx'})
    assert r.status_code == 404


# ---------------------------------------------------------------- سلسلة التراكمي

def _seed_six_months(db, budget_service):
    """سلسلة ٦ أشهر يدوية بأرقام بسيطة — planned شهري ثابت 1,000,000 فيتراكمي
    مطّرد يسهل التحقق منه يدوياً."""
    project = 'مشروع الاختبار'
    for i in range(6):
        month = dt.date(2026, 1 + i, 1)
        budget_service.upsert_manual(
            db, project, month.isoformat(), actual_month=1_000_000.0 + i * 10_000,
            planned_month=1_000_000.0, claims=[], doc_no=f'EGCO/{i}',
            issued_on=None, notes='')
    return project


def test_rebuild_chain_propagates_after_editing_old_month(db_env):
    """القسم ٨ من PLAN-BUDGET: عدّل الشهر الثاني، وأكّد أن الأربعة التالية
    تغيّرت بالقيم الصحيحة — بلا أي إشارة يدوية إضافية، تلقائياً من upsert_manual."""
    db, budget_service = db_env
    from app.db import models

    project = _seed_six_months(db, budget_service)
    # قيم صريحة قبل التعديل — لا مراجع لكائنات ORM (نفس الجلسة تُحدِّثها في مكانها
    # فتُخفي الفرق لو قارنّا بالكائن ذاته بعد rebuild_chain).
    rows_before = {r.month: r.cum_actual for r in
                  db.query(models.BudgetSnapshot).filter(
                      models.BudgetSnapshot.project == project).all()}

    # الحالة قبل التعديل: تراكمي فبراير = 1,000,000 + 1,010,000 = 2,010,000
    assert rows_before[dt.date(2026, 2, 1)] == pytest.approx(2_010_000.0)
    assert rows_before[dt.date(2026, 3, 1)] == pytest.approx(2_010_000.0 + 1_020_000.0)

    # نعدّل فبراير: actual_month يرتفع بمقدار 500,000
    budget_service.upsert_manual(
        db, project, dt.date(2026, 2, 1).isoformat(), actual_month=1_010_000.0 + 500_000,
        planned_month=1_000_000.0, claims=[], doc_no='EGCO/1-edited',
        issued_on=None, notes='تعديل تجريبي')

    rows_after = {r.month: r for r in
                 db.query(models.BudgetSnapshot).filter(
                     models.BudgetSnapshot.project == project,
                     models.BudgetSnapshot.deleted_at.is_(None)).all()}

    # فبراير نفسه: تراكمي = 1,000,000 (يناير) + 1,510,000 = 2,510,000 — زاد 500,000
    feb_after = rows_after[dt.date(2026, 2, 1)]
    assert feb_after.cum_actual == pytest.approx(2_510_000.0)
    assert feb_after.cum_actual - rows_before[dt.date(2026, 2, 1)] == pytest.approx(500_000.0)

    # الأربعة التالية (مارس..يونيو) كلٌّ منها ارتفع بنفس 500,000 بالضبط —
    # لأن الفرق يُضاف مرة واحدة عند فبراير ثم يُرحَّل بلا تغيير في actual_month
    # للأشهر التالية نفسها.
    for i in range(3, 7):
        month = dt.date(2026, i, 1)
        delta = rows_after[month].cum_actual - rows_before[month]
        assert delta == pytest.approx(500_000.0), f'شهر {month}: فرق {delta} بدل 500000'
    # يناير (قبل نقطة التعديل) لم يتغيّر إطلاقاً
    assert rows_after[dt.date(2026, 1, 1)].cum_actual == pytest.approx(rows_before[dt.date(2026, 1, 1)])
    assert rows_after[dt.date(2026, 1, 1)].cum_actual == pytest.approx(1_000_000.0)

    # نسبة الإنجاز والتأخر تغيّرت أيضاً بما يطابق التراكمي الجديد لكل شهر لاحق
    for i in range(2, 7):
        month = dt.date(2026, i, 1)
        row = rows_after[month]
        expected_completion = row.cum_actual / row.cum_planned
        assert row.completion_pct == pytest.approx(expected_completion)
        assert row.delay_pct == pytest.approx(1 - expected_completion)


# ---------------------------------------------------------------- تعارض المصدرين

def test_conflict_detected_between_file_and_manual_entry(db_env):
    """حالة سدايم الحقيقية من PLAN-BUDGET §٠: ملف يوليو يقول تراكمي
    49,844,690.75، وتقرير أغسطس عن يوليو يقول 50,593,303.77 — فرق 748,613.02
    ر.س. preview() يجب أن يكتشفه ولا يكتب، وupsert_manual يرفض ما لم يُؤكَّد."""
    db, budget_service = db_env

    budget_service.import_budget(db, BUDGET_XLSX)  # يزرع سدايم يونيو ويوليو من الملف

    # قيمة actual_month التي تنتج (مع نفس سلسلة التراكمي) رقماً مخالفاً لما في الملف
    # نستعمل فرق كبير كافٍ لتجاوز أي تفاوت تقريب
    result = budget_service.preview(db, 'سدايم', dt.date(2026, 7, 1).isoformat(),
                                    actual_month=1096845.76 + 748_613.02,
                                    planned_month=433322.0)
    assert 'conflict' in result
    assert result['conflict']['currentSource'] == 'file'
    assert result['conflict']['field'] in ('cumActual', 'delayPct')

    # الكتابة بلا تأكيد تُرفض ولا تُغيّر شيئاً
    write_result = budget_service.upsert_manual(
        db, 'سدايم', dt.date(2026, 7, 1).isoformat(),
        actual_month=1096845.76 + 748_613.02, planned_month=433322.0,
        claims=[], doc_no='EGCO/manual', issued_on=None, notes='')
    assert write_result['saved'] is False
    assert 'conflict' in write_result

    from app.db import models
    row = db.query(models.BudgetSnapshot).filter(
        models.BudgetSnapshot.project == 'سدايم',
        models.BudgetSnapshot.month == dt.date(2026, 7, 1)).one()
    assert row.entry_source == 'file'  # لم يُكتب فوقه بصمت

    # بالتأكيد الصريح (force_conflict) تُقبل الكتابة
    forced = budget_service.upsert_manual(
        db, 'سدايم', dt.date(2026, 7, 1).isoformat(),
        actual_month=1096845.76 + 748_613.02, planned_month=433322.0,
        claims=[], doc_no='EGCO/manual', issued_on=None, notes='',
        force_conflict=True)
    assert forced['saved'] is True
    db.refresh(row)
    assert row.entry_source == 'manual'


def test_api_preview_does_not_write(api_client):
    api_client.post('/api/v1/budget/import', json={'path': BUDGET_XLSX})
    r = api_client.post('/api/v1/budget/preview', json={
        'project': 'سدايم', 'month': '2026-07-01',
        'actualMonth': 999999.0, 'plannedMonth': 0.0})
    assert r.status_code == 200
    assert 'conflict' in r.json()

    # لم يتغيّر شيء في القاعدة
    r2 = api_client.get('/api/v1/budget/project/سدايم')
    july = [m for m in r2.json()['months'] if m['month'] == '2026-07-01'][0]
    assert july['actualMonth'] == pytest.approx(1096845.76)


# ---------------------------------------------------------------- التحقق المرجعي

def test_dara_almadina_real_numbers(db_env):
    """تحقّق حسابي من PLAN-BUDGET §٠ على بيانات دارة المدينة الحقيقية —
    119,546,866.87 ÷ 122,025,796.00 = 97.97% ← تأخر 2.03%."""
    db, budget_service = db_env
    project = 'دارة المدينة'
    # نزرع شهراً واحداً يطابق حالة أغسطس المذكورة في PLAN (بلا شهر سابق —
    # لذا cum_prev = 0 ونضع actual_month = cum_actual المطلوب مباشرة)
    budget_service.upsert_manual(
        db, project, dt.date(2026, 8, 1).isoformat(),
        actual_month=119_546_866.87, planned_month=122_025_796.00,
        claims=[], doc_no='EGCO/dara-8', issued_on=None, notes='')

    from app.db import models
    row = db.query(models.BudgetSnapshot).filter(
        models.BudgetSnapshot.project == project).one()
    assert row.cum_actual == pytest.approx(119_546_866.87)
    assert row.cum_planned == pytest.approx(122_025_796.00)
    assert row.completion_pct == pytest.approx(0.9797, abs=1e-4)
    assert row.delay_pct == pytest.approx(0.0203, abs=1e-4)
