# -*- coding: utf-8 -*-
"""اختبارات وحدة المقاولين — التصنيف، قراءة الكشف، الاستيراد، والمسارات.

Follows the test_intake.py pattern: a standalone FastAPI app mounting only the
contractors router on top of a reloaded, temp-dir-backed session — router.py itself
is never touched.
"""
import datetime as dt
import importlib
import os
from decimal import Decimal

import pytest

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')
DIYAR_PDF = os.path.join(SAMPLES, 'contractor-diyar-alwadi.pdf')
SUPPLIERS_XLSX = os.path.join(SAMPLES, 'suppliers-terms.xlsx')

#: the four newer one-page contractor statements — (file, account, printed closing)
EXTRA_STATEMENTS = [
    ('contractor-harmony.pdf', '2111636', Decimal('-20276.50')),
    ('contractor-maysan.pdf', '2110605', Decimal('-22261.16')),
    ('contractor-zawaya.pdf', '2111806', Decimal('-1972.50')),
    ('contractor-holol-afaq.pdf', '2110308', Decimal('-69415.00')),
]

pytestmark = pytest.mark.skipif(
    not os.path.exists(DIYAR_PDF),
    reason='design/samples not present in this checkout')


# ---------------------------------------------------------------- fixtures

@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.contractors_service as contractors_service_mod
    importlib.reload(contractors_service_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)
    import app.api.routes.contractors as contractors_route
    importlib.reload(contractors_route)

    session_mod.init_db()

    class Env:
        pass

    e = Env()
    e.session = session_mod
    e.models = models_mod
    e.contractors_service = contractors_service_mod
    e.import_service = import_service_mod
    e.contractors_route = contractors_route
    return e


@pytest.fixture()
def db(env):
    session = env.session.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(env):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(env.contractors_route.router, prefix='/contractors')
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------- classification

def test_classify_entry_real_descriptions():
    from app.domain.contractors import classify_entry
    assert classify_entry('مستخلص رقم6 لشركه ديار الوادي') == 'claim'
    assert classify_entry('دفعه تحت الحساب شركة ديار الوادى') == 'payment'
    assert classify_entry('دفعة مقدمه اعمال هاندري مصنع الزوايا المتحده') == 'payment'
    assert classify_entry('زياره تأمين تخصم على ديار الوادي') == 'retention'
    assert classify_entry('فاتورة تامين') == 'retention'
    assert classify_entry('خصم اعمال مبانى بلوك645') == 'deduction'
    assert classify_entry('فاتوره رقم5310 ( لشركه مدار لمواد البناء)روشن') == 'invoice'
    assert classify_entry('فتوره رقم641') == 'invoice'  # real typo variant
    assert classify_entry('فاتورة2500829') == 'invoice'  # glued number
    assert classify_entry('رصيد افتتاحي (مُرحَّل من الكشف)') == 'opening'
    assert classify_entry('تحويل بنكي غير موصوف') == 'other'


def test_extract_claim_no():
    from app.domain.contractors import extract_claim_no
    assert extract_claim_no('مستخلص رقم6 لشركه ديار الوادي') == '6'
    assert extract_claim_no('مستخلص رقم 14 لشركة ديار الوادي') == '14'
    assert extract_claim_no('دفعه تحت الحساب') is None


def test_detect_project_normalises_both_sides():
    from app.domain.contractors import detect_project
    known = ['روشن', 'القصر ستون']
    assert detect_project('فاتوره رقم5310 ( لشركه مدار لمواد البناء)روشن', known) == 'روشن'
    assert detect_project('دفعه تحت الحساب بدون مشروع', known) == ''
    # yeh/teh-marbuta variants must still match
    assert detect_project('اعمال مبانى القصر ستون', ['القصر ستون']) == 'القصر ستون'
    # ambiguity returns '' rather than guessing
    assert detect_project('روشن القصر ستون معا', known) == ''


def test_position_sums_are_decimal():
    from app.domain.contractors import position
    entries = [
        dict(debit=0, credit='100.10', kind='claim'),
        dict(debit='40.05', credit=0, kind='payment'),
        dict(debit='10.00', credit=0, kind='retention'),
        dict(debit='5.00', credit=0, kind='deduction'),
    ]
    pos = position(entries)
    assert pos['balance'] == Decimal('-45.05')
    assert pos['claims_total'] == Decimal('100.10')
    assert pos['payments_total'] == Decimal('40.05')
    assert pos['retention_total'] == Decimal('10.00')
    assert pos['deductions_total'] == Decimal('5.00')


# ---------------------------------------------------------------- PDF parse

def test_parse_diyar_reconciles_exactly():
    from app.ingest import contractor_statement
    from app.domain.payables import D
    p = contractor_statement.parse(DIYAR_PDF)
    assert p['account'] == '21201020'
    assert len(p['rows']) >= 70
    assert p['rows'][0]['kind'] == 'opening'
    computed = sum((D(r['debit']) - D(r['credit']) for r in p['rows']), Decimal('0'))
    assert computed == Decimal('-56651.99')
    assert D(p['printed_balance']) == Decimal('-56651.99')


@pytest.mark.parametrize('fname,account,closing', EXTRA_STATEMENTS)
def test_parse_extra_statements_reconcile(fname, account, closing):
    from app.ingest import contractor_statement
    from app.domain.payables import D
    path = os.path.join(SAMPLES, fname)
    if not os.path.exists(path):
        pytest.skip('sample missing')
    p = contractor_statement.parse(path)
    assert p['account'] == account
    computed = sum((D(r['debit']) - D(r['credit']) for r in p['rows']), Decimal('0'))
    assert computed == closing
    assert D(p['printed_balance']) == closing
    assert p['name']  # contractor auto-created from this header name


STATEMENTS_BATCH = os.path.join(SAMPLES, 'statements-batch')

#: filename → (account, printed closing) for the company's full statement book.
#: بيت الاباء روشن is POSITIVE (they owe us) — signs are the ledger's, not abs().
BATCH_EXPECTED = {
    'شركة ارتك.pdf': ('2111609', Decimal('-79526.93')),
    'شركة الانشاء والتعمير روشن.pdf': ('2110203', Decimal('-9303.40')),
    'شركة الهضبة روشن.pdf': ('2111724', Decimal('-752824.33')),
    'شركة انابيب المنار روشن.pdf': ('2110915', Decimal('-85841.32')),
    'شركة بي سي في جلوبال.pdf': ('2110602', Decimal('-327700.91')),
    'شركة بيت الاباء روشن.pdf': ('2110919', Decimal('474147.10')),
    'شركة بيت الاباء مواد سباكة روشن.pdf': ('2110963', Decimal('-999775.13')),
    'شركة تداين.pdf': ('2110118', Decimal('-6284.50')),
    'شركة تيسير الخدمات.pdf': ('2110920', Decimal('-150466.83')),
    'شركة ديار الوادي.pdf': ('21201020', Decimal('-56651.99')),
    'شركة سادن روشن.pdf': ('2110603', Decimal('-900.05')),
    'شركة سافيتو روشن.pdf': ('2111767', Decimal('-54444.95')),
    'شركة عصام قباني.pdf': ('2111102', Decimal('-1762.67')),
    'شركة فاروس عقد 1.pdf': ('2111741', Decimal('-36778.36')),
    'شركة فاروس عقد 2.pdf': ('2111810', Decimal('-116878.30')),
    'شركة قنبر.pdf': ('2110110', Decimal('-80049.95')),
    'شركة مدار.pdf': ('2110808', Decimal('-3230100.39')),
    'شركة مدى الاسناد روشن.pdf': ('2111738', Decimal('-6077.00')),
}


#: the real statement book is EXCLUDED from the transfer bundle (real financial
#: data) — these tests must skip cleanly on machines without it, while the shipped
#: contractor-*.pdf single-file tests above keep running.
_HAS_BATCH = (os.path.isdir(STATEMENTS_BATCH) and
              any(f.endswith('.pdf') for f in os.listdir(STATEMENTS_BATCH)))
_needs_batch = pytest.mark.skipif(not _HAS_BATCH,
                                  reason='statements-batch not present')


@_needs_batch
def test_full_statement_book_reconciles():
    """One sweep over the whole statements-batch folder: multi-page files, multi-line
    descriptions, the opening-balance-only statement (بي سي في جلوبال, zero
    CompanyCode blocks), a positive closing, and the 594-block مدار file — computed
    closing must equal the printed «اجمالي الحساب» EXACTLY for every one."""
    from app.ingest import contractor_statement
    from app.domain.payables import D
    if not os.path.isdir(STATEMENTS_BATCH):
        pytest.skip('statements-batch not present')
    for fname in sorted(os.listdir(STATEMENTS_BATCH)):
        if not fname.endswith('.pdf'):
            continue
        p = contractor_statement.parse(os.path.join(STATEMENTS_BATCH, fname))
        computed = sum((D(r['debit']) - D(r['credit']) for r in p['rows']), Decimal('0'))
        assert D(p['printed_balance']) == computed, fname
        if fname in BATCH_EXPECTED:
            account, closing = BATCH_EXPECTED[fname]
            assert p['account'] == account, fname
            assert computed == closing, fname


@_needs_batch
def test_batch_dispatch_over_representative_statement_book(db, env):
    """قاعدة البادئة المطلقة على ملفات حقيقية: ٢١١ مورد، ٢١٢ مقاول.

    Rewritten for the user-stated chart-of-accounts rule. Previously dispatch was by
    ownership + structural fallbacks, which sent بي سي في جلوبال (opening-only) and
    بيت الاباء (positive closing — they owe us) into the contractor ledger. Both are
    211 accounts, i.e. suppliers, so the SUPPLIER flow must now represent them:
    zero-transaction statements and overpaid (credit) balances included.
    """
    if not os.path.exists(SUPPLIERS_XLSX):
        pytest.skip('samples missing')
    reps = ['شركة ديار الوادي.pdf', 'شركة بي سي في جلوبال.pdf',
            'شركة بيت الاباء روشن.pdf', 'شركة فاروس عقد 1.pdf', 'شركة قنبر.pdf']
    paths = [SUPPLIERS_XLSX] + [os.path.join(STATEMENTS_BATCH, f) for f in reps]
    out = env.import_service.batch_import(db, paths)
    by_name = {os.path.basename(r['path']): r for r in out['results']}

    # ---- 211* → supplier flow, always. None of them may become a contractor.
    for fname, code in [('شركة قنبر.pdf', '2110110'),
                        ('شركة فاروس عقد 1.pdf', '2111741'),
                        ('شركة بي سي في جلوبال.pdf', '2110602'),
                        ('شركة بيت الاباء روشن.pdf', '2110919')]:
        row = by_name[fname]
        assert row['status'] == 'saved', fname
        assert row['message'] == 'تم الحفظ بنجاح', fname
        assert db.query(env.models.Contractor).filter_by(
            code=code).one_or_none() is None, fname

    # ---- 212* → contractor ledger, always.
    row = by_name['شركة ديار الوادي.pdf']
    assert row['status'] == 'saved'
    assert row['message'] == 'تم حفظ كشف مقاول/متعامل'
    c = db.query(env.models.Contractor).filter_by(code='21201020').one()
    detail = env.contractors_service.contractor_detail_json(c)
    assert abs(detail['balance'] - (-56651.99)) < 0.005


# ---------------------------------------------------------------- import dispatch

def test_batch_import_creates_contractor_and_is_idempotent(db, env):
    out = env.import_service.batch_import(db, [DIYAR_PDF])
    row = out['results'][0]
    assert row['status'] == 'saved'
    assert row['account'] == '21201020'
    assert row['message'] == 'تم حفظ كشف مقاول/متعامل'
    assert row['supplierName']  # contractor name surfaced in the same column
    assert row['added'] >= 70

    c = db.query(env.models.Contractor).filter_by(code='21201020').one()
    assert 'ديار' in c.name.replace('ی', 'ي')

    # re-import must add nothing (unique-identity dedup) and be FLAGGED as duplicate
    out2 = env.import_service.batch_import(db, [DIYAR_PDF])
    row2 = out2['results'][0]
    assert row2['status'] == 'duplicate'
    assert row2['added'] == 0
    assert row2['skipped'] >= 70


def test_211_account_takes_supplier_flow_even_when_unknown(db, env):
    """قاعدة العميل المطلقة: البادئة ٢١١ = مورد دائماً.

    Rewritten (was `test_unknown_211_account_takes_contractor_flow`): dispatch used
    to be by ownership, so a 211* account missing from the Supplier table fell into
    the contractor ledger. The user states the chart of accounts is absolute —
    211 is ALWAYS a supplier — so an unknown 211 must create/serve a SUPPLIER and
    must never appear among المقاولون.
    """
    path = os.path.join(SAMPLES, 'contractor-harmony.pdf')   # account 2111636
    if not os.path.exists(path):
        pytest.skip('sample missing')
    out = env.import_service.batch_import(db, [path])
    row = out['results'][0]
    assert row['account'] == '2111636'
    # whatever the save outcome, it must NOT have become a contractor
    assert db.query(env.models.Contractor).filter_by(code='2111636').one_or_none() is None
    assert row['message'] != 'تم حفظ كشف مقاول/متعامل'


def test_known_supplier_pdf_still_takes_supplier_flow(db, env):
    if not os.path.exists(SUPPLIERS_XLSX):
        pytest.skip('sample missing')
    qanbar = os.path.join(SAMPLES, 'statement-qanbar.pdf')
    out = env.import_service.batch_import(db, [qanbar, SUPPLIERS_XLSX])
    by_path = {r['path']: r for r in out['results']}
    row = by_path[qanbar]
    assert row['status'] == 'saved'
    assert row['message'] == 'تم الحفظ بنجاح'  # supplier flow, unchanged
    assert db.query(env.models.Contractor).filter_by(code='2110110').one_or_none() is None


def test_preview_statement_reports_contractor_kind(env):
    pre = env.import_service.preview_statement(DIYAR_PDF, 'pdf_statement')
    assert pre['kind'] == 'contractor'
    assert pre['account'] == '21201020'
    assert abs(pre['computedBalance'] - (-56651.99)) < 0.005
    assert abs(pre['statementBalance'] - (-56651.99)) < 0.005
    assert pre['reconciled'] is True


def test_balance_endpoint_after_import(db, env, client):
    env.import_service.batch_import(db, [DIYAR_PDF])
    r = client.get('/contractors/21201020')
    assert r.status_code == 200
    body = r.json()
    assert abs(body['balance'] - (-56651.99)) < 0.005
    assert body['entries'][0]['date'] >= body['entries'][-1]['date']  # newest first

    lst = client.get('/contractors').json()
    assert lst['count'] == 1
    assert abs(lst['rows'][0]['balance'] - (-56651.99)) < 0.005
    assert abs(lst['totals']['owedToContractors'] - 56651.99) < 0.005
    assert lst['totals']['owedToUs'] == 0


# ---------------------------------------------------------------- CRUD

def test_contractor_crud(client):
    r = client.post('/contractors', json=dict(code='C1', name='مقاول تجريبي',
                                              phone='0500000000',
                                              defaultRetentionRate=0.05,
                                              defaultGuaranteeDays=365))
    assert r.status_code == 201
    assert r.json()['code'] == 'C1'

    # duplicate live code
    assert client.post('/contractors', json=dict(code='C1', name='آخر')).status_code == 409

    r = client.put('/contractors/C1', json=dict(phone='0555555555'))
    assert r.status_code == 200
    assert r.json()['phone'] == '0555555555'

    assert client.delete('/contractors/C1').json()['deleted'] is True
    assert client.get('/contractors/C1').status_code == 404

    # soft-deleted code is resurrected, not 409
    r = client.post('/contractors', json=dict(code='C1', name='عاد من جديد'))
    assert r.status_code == 201


def test_manual_entry_validation_and_crud(client):
    client.post('/contractors', json=dict(code='C2', name='مقاول'))

    # both sides > 0 → 422; both zero → 422
    bad = client.post('/contractors/C2/entries',
                      json=dict(date='2026-01-01', debit=10, credit=10, description='x'))
    assert bad.status_code == 422
    bad2 = client.post('/contractors/C2/entries',
                       json=dict(date='2026-01-01', debit=0, credit=0, description='x'))
    assert bad2.status_code == 422

    ok = client.post('/contractors/C2/entries',
                     json=dict(date='2026-01-01', credit=1000,
                               description='مستخلص رقم3 اعمال حفر'))
    assert ok.status_code == 201
    e = ok.json()
    assert e['kind'] == 'claim'       # auto-classified
    assert e['claimNo'] == '3'        # auto-extracted
    assert e['source'] == 'manual'

    upd = client.put(f"/contractors/C2/entries/{e['id']}",
                     json=dict(project='روشن', kind='other'))
    assert upd.status_code == 200
    assert upd.json()['project'] == 'روشن'
    assert upd.json()['kind'] == 'other'

    assert client.delete(f"/contractors/C2/entries/{e['id']}").json()['deleted'] is True
    assert client.get('/contractors/C2').json()['entries'] == []


def test_claims_accumulate_into_guarantee(client):
    client.post('/contractors', json=dict(code='C3', name='مقاول'))
    r1 = client.post('/contractors/C3/claims',
                     json=dict(project='روشن', number='1', date='2026-01-01',
                               grossCumulative=100000, previousCumulative=0,
                               retentionAmount=5000, otherDeductions=0, netDue=95000))
    assert r1.status_code == 201
    r2 = client.post('/contractors/C3/claims',
                     json=dict(project='روشن', number='2', date='2026-02-01',
                               grossCumulative=200000, previousCumulative=100000,
                               retentionAmount=5000, otherDeductions=0, netDue=95000))
    assert r2.status_code == 201

    detail = client.get('/contractors/C3').json()
    g = [g for g in detail['guarantees'] if g['project'] == 'روشن'][0]
    assert g['amount'] == 10000.0  # Σ retention of the project's claims

    # explicit PUT wins ...
    client.put(f"/contractors/C3/guarantees/{g['id']}", json=dict(amount=12345.0))
    assert client.get('/contractors/C3').json()['guarantees'][0]['amount'] == 12345.0
    # ... until the next claim change re-derives it
    client.put(f"/contractors/C3/claims/{r2.json()['id']}", json=dict(retentionAmount=7000))
    assert client.get('/contractors/C3').json()['guarantees'][0]['amount'] == 12000.0

    # deleting a claim re-derives again
    client.delete(f"/contractors/C3/claims/{r1.json()['id']}")
    assert client.get('/contractors/C3').json()['guarantees'][0]['amount'] == 7000.0


def test_guarantee_release_status_transitions(env, monkeypatch):
    """released > due > upcoming > scheduled, with a pinned today."""
    CS = env.contractors_service
    models = env.models
    today = dt.date(2026, 8, 14)

    def g(**kw):
        return models.ContractorGuarantee(contractor_id='x', project='p', **kw)

    assert CS.guarantee_release(g(released_on=dt.date(2026, 1, 1)), today)[1] == 'released'
    assert CS.guarantee_release(g(release_due=dt.date(2026, 8, 14)), today)[1] == 'due'
    assert CS.guarantee_release(g(release_due=dt.date(2026, 9, 1)), today)[1] == 'upcoming'
    assert CS.guarantee_release(g(release_due=dt.date(2027, 1, 1)), today)[1] == 'scheduled'
    assert CS.guarantee_release(g(), today)[1] == 'scheduled'  # no date derivable

    # release_due derived from finished_on + guarantee_days
    due, status = CS.guarantee_release(
        g(finished_on=dt.date(2026, 8, 1), guarantee_days=20), today)
    assert due == dt.date(2026, 8, 21)
    assert status == 'upcoming'


def test_guarantee_crud_and_duplicate_project(client):
    client.post('/contractors', json=dict(code='C4', name='مقاول',
                                          defaultGuaranteeDays=365))
    r = client.post('/contractors/C4/guarantees',
                    json=dict(project='روشن', amount=5000, finishedOn='2026-01-01'))
    assert r.status_code == 201
    body = r.json()
    assert body['guaranteeDays'] == 365          # default flows in
    assert body['releaseDue'] == '2027-01-01'    # finished_on + days
    assert body['dueStatus'] in ('scheduled', 'upcoming', 'due')

    dup = client.post('/contractors/C4/guarantees', json=dict(project='روشن'))
    assert dup.status_code == 409

    upd = client.put(f"/contractors/C4/guarantees/{body['id']}",
                     json=dict(releasedOn='2026-06-01'))
    assert upd.json()['dueStatus'] == 'released'

    assert client.delete(f"/contractors/C4/guarantees/{body['id']}").json()['deleted'] is True
    assert client.get('/contractors/C4').json()['guarantees'] == []
