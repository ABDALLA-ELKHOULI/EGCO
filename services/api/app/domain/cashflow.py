# -*- coding: utf-8 -*-
"""التدفق النقدي — pure functions over plain data: no DB, no FastAPI.

Buckets the horizon into fixed 14-day periods anchored on `from_date`, and sums
inflow (money coming in — receivables) and outflow (money going out — supplier
invoice remainders) per bucket, then walks a running balance across buckets.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, List, Optional, Sequence

from app.domain.payables import D

PERIOD_DAYS = 14


@dataclass(frozen=True)
class CashItem:
    """One inflow or outflow event with a date and an amount."""
    date: dt.date
    amount: Decimal


@dataclass
class Period:
    label: str
    from_date: dt.date
    to_date: dt.date
    inflow: Decimal
    outflow: Decimal
    inflow_count: int
    outflow_count: int
    balance: Decimal = Decimal('0')

    @property
    def net(self) -> Decimal:
        return self.inflow - self.outflow

    @property
    def deficit(self) -> bool:
        return self.balance < 0


def _label(a: dt.date, b: dt.date) -> str:
    return f'{a.isoformat()} — {b.isoformat()}'


def bucket_count(weeks: int, period_days: int = PERIOD_DAYS) -> int:
    """عدد الدلاء المعروضة فعلاً — the single definition `build_periods` also uses."""
    return max(1, -(-(weeks * 7) // period_days))   # ceil division


def horizon_end(from_date: dt.date, weeks: int, period_days: int = PERIOD_DAYS) -> dt.date:
    """آخر يوم يغطيه آخر دلو معروض.

    Deliberately NOT `from_date + weeks*7 - 1`: the buckets are whole `period_days`
    blocks, so the rendered horizon overshoots `weeks*7` whenever the two do not divide
    evenly. Anything that classifies an amount as "inside the table" vs "beyond it" must
    use this, or the reconciliation totals stop matching what the table actually shows.
    """
    return from_date + dt.timedelta(days=bucket_count(weeks, period_days) * period_days - 1)


def build_periods(receivable_items: Sequence[CashItem],
                  payable_items: Sequence[CashItem],
                  from_date: dt.date,
                  weeks: int,
                  opening_balance: Decimal = Decimal('0'),
                  period_days: int = PERIOD_DAYS) -> List[Period]:
    """يبني الدلاء الزمنية ويحسب الرصيد التراكمي.

    `weeks` is kept as the caller-facing knob (contract: `?weeks=26`); it is converted
    to a number of `period_days`-day buckets covering roughly that many weeks.
    """
    n_periods = bucket_count(weeks, period_days)

    periods: List[Period] = []
    balance = D(opening_balance)
    for i in range(n_periods):
        p_from = from_date + dt.timedelta(days=i * period_days)
        p_to = p_from + dt.timedelta(days=period_days - 1)

        inflow_items = [it for it in receivable_items if p_from <= it.date <= p_to]
        outflow_items = [it for it in payable_items if p_from <= it.date <= p_to]
        inflow = sum((D(it.amount) for it in inflow_items), Decimal('0'))
        outflow = sum((D(it.amount) for it in outflow_items), Decimal('0'))

        balance = balance + inflow - outflow
        periods.append(Period(
            label=_label(p_from, p_to), from_date=p_from, to_date=p_to,
            inflow=inflow, outflow=outflow,
            inflow_count=len(inflow_items), outflow_count=len(outflow_items),
            balance=balance,
        ))
    return periods


def summarise(periods: Iterable[Period], has_receivables: bool) -> dict:
    periods = list(periods)
    total_inflow = sum((p.inflow for p in periods), Decimal('0'))
    total_outflow = sum((p.outflow for p in periods), Decimal('0'))
    min_balance = min((p.balance for p in periods), default=Decimal('0'))
    first_deficit = next((p for p in periods if p.deficit), None)
    return dict(
        total_inflow=total_inflow, total_outflow=total_outflow,
        net_total=total_inflow - total_outflow,
        min_balance=min_balance,
        first_deficit=first_deficit,
        has_receivables=has_receivables,
    )
