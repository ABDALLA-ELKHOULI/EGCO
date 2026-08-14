# -*- coding: utf-8 -*-
"""تناسق الأرقام بين التدفق النقدي وبقية الشاشات — regression guards for data synergy.

Every assertion here is an EXACT tie-out between a number التدفق النقدي reports and the
number another screen reports for the same thing. They exist because the two drifted
apart silently once (overdue and undated supplier dues vanished from the cashflow table,
and collected revenues kept showing as future inflow) and nothing failed.

Money is compared as Decimal on the string form of the JSON float, so a piaster of drift
fails the test — `== 0.0` on a float would let real rounding error through.
"""
import datetime as dt
import importlib
from decimal import Decimal

import pytest

TODAY = dt.date(2026, 8, 8)


def _d(x) -> Decimal:
    """JSON float -> Decimal without binary-float noise."""
    return Decimal(str(x))


@pytest.fixture()
def synergy_db(tmp_path, monkeypatch):
    """بيانات مصمَّمة ليقع كل ريال في خانة مختلفة من معادلة المطابقة.

    الموردون (3):
      S1 «٣٠ يوم» — فاتورة مستحقة بعد يومين  ..... مجدولة داخل الأفق
      S1            — فاتورة استحقت قبل ٤٠ يوماً .. متأخرة الآن
      S2 «مستخلص»   — فاتورة بلا تاريخ استحقاق ... بلا تواريخ
      S3 «٣٠ يوم»   — فاتورة تستحق بعد سنة ....... بعد نهاية الأفق
    التحصيلات (4): مفتوحة مجدولة / مفتوحة متأخرة / مفتوحة بلا تاريخ / محصَّلة.
    المقاولون (2): C1 مدين له ٤٠٠٠ وله ضمان ١٥٠٠ داخل الأفق؛ C2 رصيده موجب.
    """
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models
    importlib.reload(models)
    import app.services.payables_service as PS
    importlib.reload(PS)
    import app.services.contractors_service as CS
    importlib.reload(CS)
    import app.services.cashflow_service as CFS
    importlib.reload(CFS)

    session_mod.init_db()
    db = session_mod.SessionLocal()

    def supplier(account, term_raw, term_kind, term_days, project='مشروع أ'):
        row = models.Supplier(account=account, name=f'مورد {account}', project=project,
                              term_raw=term_raw, term_kind=term_kind, term_days=term_days)
        db.add(row); db.commit(); db.refresh(row)
        return row

    s1 = supplier('S1', '30 يوم', 'days', 30)
    s2 = supplier('S2', 'مستخلص', 'claim', None, project='مشروع ب')
    s3 = supplier('S3', '30 يوم', 'days', 30, project='مشروع ب')

    # FIFO settles the oldest invoice first, so the overdue one must stay unpaid:
    # no payments at all on S1 keeps both its invoices fully open.
    db.add(models.Invoice(supplier_id=s1.id, number='I-SCHED', date=TODAY, amount=1000.0,
                          manual_due_date=TODAY + dt.timedelta(days=2)))
    db.add(models.Invoice(supplier_id=s1.id, number='I-OVERDUE', date=TODAY - dt.timedelta(days=70),
                          amount=700.0, manual_due_date=TODAY - dt.timedelta(days=40)))
    db.add(models.Invoice(supplier_id=s2.id, number='I-UNDATED', date=TODAY, amount=300.0))
    db.add(models.Invoice(supplier_id=s3.id, number='I-FAR', date=TODAY, amount=250.0,
                          manual_due_date=TODAY + dt.timedelta(days=365)))

    db.add(models.Receivable(project='مشروع أ', unit='U1', client='ع١', amount=500.0,
                             due_date=TODAY + dt.timedelta(days=1), status='open', source='manual'))
    db.add(models.Receivable(project='مشروع أ', unit='U2', client='ع٢', amount=90.0,
                             due_date=TODAY - dt.timedelta(days=10), status='open', source='manual'))
    db.add(models.Receivable(project='مشروع ب', unit='U3', client='ع٣', amount=40.0,
                             status='open', source='manual'))
    db.add(models.Receivable(project='مشروع أ', unit='U4', client='ع٤', amount=15000.0,
                             due_date=TODAY + dt.timedelta(days=3), status='collected',
                             collected_on=TODAY - dt.timedelta(days=1), source='manual'))

    c1 = models.Contractor(code='C1', name='مقاول واحد')
    c2 = models.Contractor(code='C2', name='مقاول اثنان')
    db.add(c1); db.add(c2); db.commit(); db.refresh(c1); db.refresh(c2)
    db.add(models.ContractorEntry(contractor_id=c1.id, date=TODAY, debit=1000.0, credit=5000.0,
                                  description='مستخلص رقم1', kind='claim', project='مشروع أ'))
    db.add(models.ContractorEntry(contractor_id=c2.id, date=TODAY, debit=800.0, credit=200.0,
                                  description='دفعة', kind='payment', project='مشروع ب'))
    db.commit()
    db.add(models.ContractorGuarantee(contractor_id=c1.id, project='مشروع أ', amount=1500.0,
                                      release_due=TODAY + dt.timedelta(days=3)))
    db.commit()

    yield db, CFS, PS, CS, models
    db.close()


# ---------------------------------------------------------------- 1. outflow vs supplier debt

def test_supplier_equation_holds_and_ties_to_suppliers_screen(synergy_db):
    """الخارج المجدول + متأخر الآن + بعد الأفق + بلا تواريخ − أرصدة دائنة = المديونية المفتوحة."""
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers')
    r = cf['reconciliation']['suppliers']

    assert _d(r['scheduled']) == Decimal('1000.00')
    assert _d(r['overdueNow']) == Decimal('700.00')
    assert _d(r['beyondHorizon']) == Decimal('250.00')
    assert _d(r['undated']) == Decimal('300.00')
    assert _d(r['credits']) == Decimal('0.00')

    # the equation itself, and the fact the server says it balances
    assert (_d(r['scheduled']) + _d(r['overdueNow']) + _d(r['beyondHorizon'])
            + _d(r['undated']) - _d(r['credits'])) == _d(r['outstanding'])
    assert _d(r['difference']) == Decimal('0.00')

    # ...and the target is the very number شاشة الموردين prints
    screen = sum(Decimal(str(p.outstanding)) for p in PS.positions(db, today=TODAY,
                                                                   include_empty=True))
    assert _d(r['outstanding']) == screen == Decimal('2250')

    # the scheduled term is exactly what the periods table adds up to — not a parallel sum
    assert _d(cf['summary']['totalOutflow']) == _d(r['scheduled'])
    assert sum(_d(p['outflow']) for p in cf['periods']) == _d(r['scheduled'])


def test_overdue_and_undated_are_reported_not_dropped(synergy_db):
    """الانحراف الأصلي: ٧٠٠ متأخرة و٣٠٠ بلا تواريخ كانتا تختفيان بصمت من الجدول."""
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers')
    hidden = _d(cf['reconciliation']['suppliers']['outstanding']) - _d(cf['summary']['totalOutflow'])
    assert hidden == Decimal('1250.00')     # 700 overdue + 300 undated + 250 beyond horizon
    # every riyal of it is named on screen rather than lost
    r = cf['reconciliation']['suppliers']
    assert _d(r['overdueNow']) + _d(r['undated']) + _d(r['beyondHorizon']) == hidden


def test_horizon_end_matches_the_rendered_buckets_not_weeks_times_seven(synergy_db):
    """حدّ الأفق = آخر يوم في آخر دلو معروض فعلاً، لا weeks*7 — وإلا اختلّت المعادلة."""
    db, CFS, PS, CS, models = synergy_db
    # 26 weeks = 182 days; with 30-day buckets that is ceil(182/30) = 7 buckets = 210 days
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers', period_days=30)
    last = cf['periods'][-1]
    assert cf['reconciliation']['horizonEnd'] == last['to']
    assert _d(cf['reconciliation']['suppliers']['difference']) == Decimal('0.00')


# ---------------------------------------------------------------- 2. inflow vs التحصيلات

def test_collected_revenue_is_not_forecast_inflow(synergy_db):
    """المحصَّل تاريخ لا توقّع — ١٥٬٠٠٠ محصَّلة يجب ألا تظهر كداخل مستقبلي."""
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY)
    assert _d(cf['summary']['totalInflow']) == Decimal('500.00')   # the open dated row only
    assert cf['summary']['receivablesStats']['collected'] == 1


def test_inflow_equation_ties_to_revenues_open_total(synergy_db):
    """الداخل المجدول + متأخر + بعد الأفق + بلا تواريخ = المستحق المفتوح."""
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY)
    r = cf['reconciliation']['inflow']
    assert _d(r['scheduled']) == Decimal('500.00')
    assert _d(r['overdueNow']) == Decimal('90.00')
    assert _d(r['undated']) == Decimal('40.00')
    assert (_d(r['scheduled']) + _d(r['overdueNow']) + _d(r['beyondHorizon'])
            + _d(r['undated'])) == _d(r['openTotal'])
    assert _d(r['difference']) == Decimal('0.00')

    # /revenues totals.open computes the same target independently
    rows = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None)).all()
    screen_open = sum(Decimal(str(x.amount)) for x in rows if x.status == 'open')
    assert _d(r['openTotal']) == screen_open == Decimal('630')

    assert _d(cf['summary']['totalInflow']) == _d(r['scheduled'])


# ---------------------------------------------------------------- 3. contractors

def test_contractor_equation_ties_to_contractors_screen(synergy_db):
    """الضمانات المجدولة + بلا تواريخ = ما ندين به للمقاولين، بالهللة."""
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='both')
    r = cf['reconciliation']['contractors']

    assert _d(r['scheduled']) == Decimal('1500.00')
    assert _d(r['undated']) == Decimal('2500.00')
    assert _d(r['excess']) == Decimal('0.00')
    assert (_d(r['scheduled']) + _d(r['overdueNow']) + _d(r['beyondHorizon'])
            + _d(r['undated']) - _d(r['excess'])) == _d(r['owedToContractors'])
    assert _d(r['difference']) == Decimal('0.00')

    screen = CS.contractors_list_json(db, today=TODAY)['totals']['owedToContractors']
    assert _d(r['owedToContractors']) == _d(screen) == Decimal('4000.00')
    # backward-compatible field must keep agreeing with the reconciliation
    assert _d(cf['undatedContractorDues']) == _d(r['undated'])


def test_contractor_totals_ignore_deleted_rows_like_the_contractors_screen(synergy_db):
    """حركة محذوفة يجب أن تختفي من الطرفين معاً — كانت تُحتسب هنا فقط."""
    db, CFS, PS, CS, models = synergy_db
    entry = db.query(models.ContractorEntry).filter(
        models.ContractorEntry.credit == 5000.0).one()
    entry.deleted_at = dt.datetime.now()
    db.commit()

    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='contractors')
    screen = CS.contractors_list_json(db, today=TODAY)['totals']['owedToContractors']
    assert _d(cf['reconciliation']['contractors']['owedToContractors']) == _d(screen)
    assert _d(cf['reconciliation']['contractors']['difference']) == Decimal('0.00')
    # the guarantee is still scheduled but now exceeds the (zero) ledger due — surfaced,
    # not silently floored away
    assert _d(cf['reconciliation']['contractors']['excess']) == Decimal('1500.00')


def test_both_parties_combined_equation_holds(synergy_db):
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='both')
    o = cf['reconciliation']['outflow']
    s, c = cf['reconciliation']['suppliers'], cf['reconciliation']['contractors']
    assert _d(o['openDebt']) == _d(s['outstanding']) + _d(c['owedToContractors'])
    assert (_d(o['scheduled']) + _d(o['overdueNow']) + _d(o['beyondHorizon'])
            + _d(o['undated']) - _d(o['credits']) - _d(o['excess'])) == _d(o['openDebt'])
    assert _d(o['difference']) == Decimal('0.00')
    assert _d(o['scheduled']) == _d(cf['summary']['totalOutflow'])


def test_suppliers_only_view_omits_the_contractor_section(synergy_db):
    """المعادلة المعروضة تصف الأطراف المشمولة فقط — لا هدف مطابقة لطرف مستبعَد."""
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers')
    assert cf['reconciliation']['contractors'] is None
    assert _d(cf['reconciliation']['outflow']['openDebt']) == \
        _d(cf['reconciliation']['suppliers']['outstanding'])


# ---------------------------------------------------------------- 4. project filter

@pytest.mark.parametrize('project', ['مشروع أ', 'مشروع ب'])
def test_project_filtered_equation_ties_to_that_project_only(synergy_db, project):
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers', project=project)
    r = cf['reconciliation']['suppliers']
    assert _d(r['difference']) == Decimal('0.00')

    screen = sum(Decimal(str(p.outstanding))
                 for p in PS.positions(db, today=TODAY, project=project, include_empty=True))
    assert _d(r['outstanding']) == screen

    assert _d(cf['summary']['totalOutflow']) == _d(r['scheduled'])


def test_project_slices_sum_back_to_the_company_wide_total(synergy_db):
    """مجموع المشروعين = الشركة كاملة — لا ريال يسقط بين الفلاتر."""
    db, CFS, PS, CS, models = synergy_db
    whole = CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers')
    parts = [CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers', project=p)
             for p in ('مشروع أ', 'مشروع ب')]
    for key in ('scheduled', 'overdueNow', 'beyondHorizon', 'undated', 'outstanding'):
        assert sum(_d(x['reconciliation']['suppliers'][key]) for x in parts) == \
            _d(whole['reconciliation']['suppliers'][key]), key


# ---------------------------------------------------------------- 5. warning coherence

def test_every_warning_matches_the_numbers_in_the_same_payload(synergy_db):
    db, CFS, PS, CS, models = synergy_db
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers')
    o = cf['reconciliation']['outflow']
    text = ' — '.join(cf['warnings'])
    assert '{:,.2f}'.format(o['overdueNow']) in text
    assert '{:,.2f}'.format(o['undated']) in text


def test_no_data_warning_is_not_claimed_when_rows_exist_but_are_all_collected(synergy_db):
    db, CFS, PS, CS, models = synergy_db
    for r in db.query(models.Receivable).all():
        r.status = 'collected'
        r.collected_on = TODAY - dt.timedelta(days=1)
    db.commit()

    cf = CFS.cashflow(db, weeks=26, today=TODAY)
    assert _d(cf['summary']['totalInflow']) == Decimal('0.00')
    assert not any('لم تُرفع بيانات التحصيلات بعد' in w for w in cf['warnings'])
    assert any('محصَّلة بالفعل' in w for w in cf['warnings'])
    assert _d(cf['reconciliation']['inflow']['openTotal']) == Decimal('0.00')


def test_zero_outflow_terms_produce_no_overdue_or_undated_warning(synergy_db):
    """لا رسالة عن مبلغ صفر — تماسك في الاتجاه الآخر أيضاً."""
    db, CFS, PS, CS, models = synergy_db
    for i in db.query(models.Invoice).all():
        if i.number in ('I-OVERDUE', 'I-UNDATED'):
            i.deleted_at = dt.datetime.now()
    db.commit()
    cf = CFS.cashflow(db, weeks=26, today=TODAY, parties='suppliers')
    assert _d(cf['reconciliation']['suppliers']['overdueNow']) == Decimal('0.00')
    assert not any('متأخر الآن' in w for w in cf['warnings'])
    assert not any('بلا تواريخ استحقاق' in w and 'ر.س' in w for w in cf['warnings'])
