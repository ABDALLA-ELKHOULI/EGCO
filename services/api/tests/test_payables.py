# -*- coding: utf-8 -*-
"""اختبارات طبقة الحسابات — the layer that must stay correct.

Unit tests use synthetic data. The reconciliation test at the bottom runs against the
real statement in design/samples/ and asserts the parsed figures reproduce the
statement's own printed balance.
"""
import datetime as dt
import os

import pytest

from app.domain.payables import (
    Ageing, Invoice, Payment, Supplier, allocate_fifo, compute_ageing, due_date,
    parse_term, payment_schedule, position, reconciles,
)

TODAY = dt.date(2026, 8, 7)


def sup(term_raw='60 يوم', account='2110960'):
    return Supplier(account=account, name='مورد', project='السدن', term=parse_term(term_raw))


def inv(day, amount, number=None):
    return Invoice(date=day, amount=amount, number=number)


# ---------------------------------------------------------------- terms

def test_numeric_terms_normalise_regardless_of_spacing():
    assert parse_term('45 يوم').days == 45
    assert parse_term('30يوم').days == 30
    assert parse_term('90يوم').days == 90


def test_cash_words_and_blank_are_all_cash():
    for raw in ('كاش', 'بعد التوريد', '', None, '   '):
        t = parse_term(raw)
        assert t.kind == 'cash' and t.days == 0, raw


def test_claim_terms_have_no_derivable_due_date():
    for raw in ('مستخلص', 'مستخلصات'):
        t = parse_term(raw)
        assert t.is_claim and t.days is None
    assert due_date(dt.date(2026, 5, 13), parse_term('مستخلص')) is None


def test_cash_invoice_is_due_the_same_day():
    assert due_date(dt.date(2026, 5, 13), parse_term('كاش')) == dt.date(2026, 5, 13)


def test_due_date_adds_the_term():
    assert due_date(dt.date(2026, 5, 13), parse_term('60 يوم')) == dt.date(2026, 7, 12)


# ---------------------------------------------------------------- FIFO

def test_fifo_settles_the_oldest_invoice_first():
    a = inv(dt.date(2026, 1, 1), 100)
    b = inv(dt.date(2026, 2, 1), 100)
    allocate_fifo([a, b], [Payment(date=dt.date(2026, 3, 1), amount=150)])
    assert (a.paid, a.remaining) == (100, 0)
    assert (b.paid, b.remaining) == (50, 50)


def test_fifo_leaves_everything_open_when_nothing_was_paid():
    a = inv(dt.date(2026, 1, 1), 100)
    allocate_fifo([a], [])
    assert a.remaining == 100


def test_overpayment_does_not_make_a_negative_remainder():
    a = inv(dt.date(2026, 1, 1), 100)
    allocate_fifo([a], [Payment(date=dt.date(2026, 2, 1), amount=500)])
    assert a.remaining == 0 and a.paid == 100


# ---------------------------------------------------------------- ageing

def test_ageing_buckets_run_from_the_due_date_not_the_invoice_date():
    s = sup('30 يوم')
    i = inv(dt.date(2026, 6, 1), 100)      # due 2026-07-01, i.e. 37 days late today
    p = position(s, [i], [], TODAY)
    assert p.ageing.d31_60 == 100
    assert p.ageing.d1_30 == 0


def test_not_yet_due_counts_as_current():
    s = sup('60 يوم')
    p = position(s, [inv(dt.date(2026, 7, 16), 100)], [], TODAY)   # due 2026-09-14
    assert p.ageing.current == 100
    assert p.overdue == 0


def test_paid_invoices_are_excluded_from_ageing():
    s = sup('30 يوم')
    i = inv(dt.date(2026, 1, 1), 100)
    p = position(s, [i], [Payment(date=dt.date(2026, 2, 1), amount=100)], TODAY)
    assert compute_ageing([i], TODAY) == Ageing()
    assert p.outstanding == 0


# ---------------------------------------------------------------- position

def test_due_today_includes_overdue_and_excludes_the_future():
    s = sup('60 يوم')
    past = inv(dt.date(2026, 5, 13), 100)      # due 2026-07-12 → overdue
    today_due = inv(dt.date(2026, 6, 8), 50)   # due 2026-08-07 → exactly today
    future = inv(dt.date(2026, 7, 16), 25)     # due 2026-09-14
    p = position(s, [past, today_due, future], [], TODAY)
    assert p.overdue == 100
    assert p.due_today == 150
    assert p.due_within_7 == 0


def test_due_within_7_window():
    s = sup('60 يوم')
    p = position(s, [inv(dt.date(2026, 6, 14), 100)], [], TODAY)   # due 2026-08-13
    assert p.due_within_7 == 100
    assert p.overdue == 0


def test_claim_supplier_is_flagged_for_manual_entry():
    p = position(sup('مستخلص'), [inv(dt.date(2026, 5, 1), 100)], [], TODAY)
    assert p.needs_manual_due_date
    assert p.due_today == 0        # never auto-scheduled
    assert p.outstanding == 100    # but still counted as debt


def test_schedule_groups_by_due_date_and_flags_overdue():
    s = sup('60 يوم')
    p = position(s, [inv(dt.date(2026, 6, 14), 100, '6549'),
                     inv(dt.date(2026, 6, 14), 50, '6550')], [], TODAY)
    sched = payment_schedule([p], TODAY)
    assert len(sched) == 1
    assert sched[0]['date'] == dt.date(2026, 8, 13)
    assert sched[0]['amount'] == 150
    assert sched[0]['items'][0]['overdue'] is False


# ---------------------------------------------------------------- real data

SAMPLE_PDF = os.path.join(os.path.dirname(__file__), '..', '..', '..',
                          'design', 'samples', 'statement-injaz-alsuddan.pdf')


@pytest.mark.skipif(
    not os.path.exists(SAMPLE_PDF),
    reason='sample file not present (excluded from repo)')
def test_real_statement_reconciles_to_its_printed_balance():
    """المطابقة مع رصيد الكشف المطبوع — the test that matters."""
    from app.ingest import pdf_statement

    r = pdf_statement.parse(SAMPLE_PDF)
    assert r['account'] == '2110960'
    assert len(r['invoices']) == 21
    assert len(r['payments']) == 2

    p = position(sup('60 يوم'), r['invoices'], r['payments'], TODAY)

    assert round(float(p.total_invoiced), 2) == 214565.45
    assert round(float(p.total_paid), 2) == 150000.00
    assert round(float(p.outstanding), 2) == 64565.45
    assert reconciles(p, r['statement_balance'])

    # ageing as at 2026-08-07
    assert round(float(p.overdue), 2) == 8820.17
    assert round(float(p.due_within_7), 2) == 48868.20
    assert round(float(p.ageing.d1_30), 2) == 8820.17


SAMPLE_QANBAR = os.path.join(os.path.dirname(__file__), '..', '..', '..',
                             'design', 'samples', 'statement-qanbar.pdf')


@pytest.mark.skipif(
    not os.path.exists(SAMPLE_QANBAR),
    reason='sample file not present (excluded from repo)')
def test_qanbar_statement_with_opening_balance_reconciles():
    """كشف برصيد افتتاحي وصفحتين — the second real-world statement format.

    The opening-balance line sits in the header before any CompanyCode block and
    must be captured as a carried-forward invoice, else nothing reconciles.
    """
    from decimal import Decimal
    from app.ingest import pdf_statement

    r = pdf_statement.parse(SAMPLE_QANBAR)
    assert r['account'] == '2110110'

    opening = [i for i in r['invoices'] if i.doc == 'OPENING']
    assert len(opening) == 1
    assert float(opening[0].amount) == 461453.50
    # dated from the statement's «من تاريخ» header => FIFO settles it first
    assert opening[0].date.isoformat() == '2025-01-01'

    inv = sum((i.amount for i in r['invoices']), Decimal(0))
    pay = sum((p.amount for p in r['payments']), Decimal(0))
    assert abs((inv - pay) - Decimal('80049.95')) < Decimal('0.01')
