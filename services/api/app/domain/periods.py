# -*- coding: utf-8 -*-
"""التحليل الدوري — pure functions over Invoice/Payment lists, no I/O.

Builds the periodic breakdown the contract describes: opening/invoiced/paid/closing per
period, avgSettlementDays via a full-history FIFO payment-to-invoice allocation, and
period-over-period / year-over-year comparison.
"""
from __future__ import annotations

import calendar
import datetime as dt
from decimal import Decimal
from typing import Dict, List, Optional, Sequence

from app.domain.payables import Invoice, Payment, money

AR_DIGITS = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')
QUARTER_NAMES = ['الأول', 'الثاني', 'الثالث', 'الرابع']
HALF_NAMES = ['الأول', 'الثاني']


def ar_num(v) -> str:
    return str(v).translate(AR_DIGITS)


# ---------------------------------------------------------------- period bounds

def quarter_bounds(year: int, q: int) -> tuple:
    start_month = (q - 1) * 3 + 1
    end_month = start_month + 2
    start = dt.date(year, start_month, 1)
    end = dt.date(year, end_month, calendar.monthrange(year, end_month)[1])
    return start, end


def half_bounds(year: int, h: int) -> tuple:
    if h == 1:
        return dt.date(year, 1, 1), dt.date(year, 6, 30)
    return dt.date(year, 7, 1), dt.date(year, 12, 31)


def year_bounds(year: int) -> tuple:
    return dt.date(year, 1, 1), dt.date(year, 12, 31)


def periods_for(granularity: str, year: int) -> List[dict]:
    """List of {label, from, to} for one calendar year at the given granularity."""
    out = []
    if granularity == 'quarter':
        for q in range(1, 5):
            start, end = quarter_bounds(year, q)
            out.append(dict(label=f'الربع {QUARTER_NAMES[q - 1]} {ar_num(year)}',
                            from_=start, to=end))
    elif granularity == 'half':
        for h in range(1, 3):
            start, end = half_bounds(year, h)
            out.append(dict(label=f'النصف {HALF_NAMES[h - 1]} {ar_num(year)}',
                            from_=start, to=end))
    elif granularity == 'year':
        start, end = year_bounds(year)
        out.append(dict(label=ar_num(year), from_=start, to=end))
    else:
        raise ValueError(f'granularity غير معروفة: {granularity}')
    return out


def shift_period(granularity: str, year: int, index: int, delta: int) -> Optional[tuple]:
    """Return (year, index) shifted by `delta` periods of the given granularity, or
    None if it would leave the supported [1..] range."""
    per_year = {'quarter': 4, 'half': 2, 'year': 1}[granularity]
    linear = year * per_year + index + delta
    ny, ni = divmod(linear, per_year)
    return ny, ni


# ---------------------------------------------------------------- FIFO allocation

class Allocation:
    __slots__ = ('invoice_date', 'payment_date', 'amount')

    def __init__(self, invoice_date, payment_date, amount):
        self.invoice_date = invoice_date
        self.payment_date = payment_date
        self.amount = amount


def allocate_payments_fifo(invoices: Sequence[Invoice],
                           payments: Sequence[Payment]) -> List[Allocation]:
    """Allocate every payment, oldest invoice first, across full history.

    Returns one Allocation per (invoice, payment) match with the amount applied — used
    to weight settlement-days by how much of each payment went to each invoice.
    """
    allocs: List[Allocation] = []
    sorted_invoices = sorted(invoices, key=lambda i: (i.date, i.number or ''))
    remaining = {id(i): Decimal(i.amount) for i in sorted_invoices}
    for pay in sorted(payments, key=lambda p: p.date):
        pool = Decimal(pay.amount)
        for inv in sorted_invoices:
            if pool <= 0:
                break
            avail = remaining[id(inv)]
            if avail <= 0:
                continue
            take = min(pool, avail)
            allocs.append(Allocation(inv.date, pay.date, take))
            remaining[id(inv)] -= take
            pool -= take
    return allocs


def avg_settlement_days(allocs: Sequence[Allocation], period_from: dt.date,
                        period_to: dt.date) -> Optional[float]:
    """Weighted average of (payment_date - invoice_date) for allocations whose payment
    falls inside the period. None if there are none."""
    total_weight = Decimal('0')
    total_weighted_days = Decimal('0')
    for a in allocs:
        if not (period_from <= a.payment_date <= period_to):
            continue
        days = (a.payment_date - a.invoice_date).days
        total_weight += a.amount
        total_weighted_days += a.amount * days
    if total_weight <= 0:
        return None
    return float(total_weighted_days / total_weight)


# ---------------------------------------------------------------- per-supplier period math

def period_totals(invoices: Sequence[Invoice], payments: Sequence[Payment],
                  period_from: dt.date, period_to: dt.date) -> dict:
    zero = Decimal('0')
    opening = (sum((Decimal(i.amount) for i in invoices if i.date < period_from), zero) -
               sum((Decimal(p.amount) for p in payments if p.date < period_from), zero))
    invoiced = sum((Decimal(i.amount) for i in invoices
                    if period_from <= i.date <= period_to), zero)
    paid = sum((Decimal(p.amount) for p in payments
                if period_from <= p.date <= period_to), zero)
    closing = opening + invoiced - paid
    return dict(opening=opening, invoiced=invoiced, paid=paid, closing=closing)
