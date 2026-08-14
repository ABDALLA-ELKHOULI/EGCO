# -*- coding: utf-8 -*-
"""التحليل الدوري — assembles the /reports/periodic payload from the database."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain import periods as PD
from app.domain.payables import money


def _load(db: Session, account: Optional[str] = None):
    """Returns list of (supplier_row, invoices, payments) for non-deleted suppliers."""
    q = db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None))
    if account:
        q = q.filter(models.Supplier.account == account)
    out = []
    for row in q.all():
        invs = [i for i in row.invoices if i.deleted_at is None]
        pays = [p for p in row.payments if p.deleted_at is None]
        if not invs and not pays:
            continue
        out.append((row, invs, pays))
    return out


def _coverage(loaded) -> dict:
    dates = []
    for _, invs, pays in loaded:
        dates += [i.date for i in invs] + [p.date for p in pays]
    if not dates:
        return dict(first=None, last=None)
    return dict(first=min(dates).isoformat(), last=max(dates).isoformat())


def periodic(db: Session, granularity: str, year: int,
            account: Optional[str] = None) -> dict:
    loaded = _load(db, account)
    coverage = _coverage(loaded)
    cov_first = dt.date.fromisoformat(coverage['first']) if coverage['first'] else None
    cov_last = dt.date.fromisoformat(coverage['last']) if coverage['last'] else None

    # full-history FIFO allocation, per supplier (mixes across suppliers is meaningless,
    # so we allocate per supplier and pool all allocations together for the weighting).
    all_allocs = []
    for row, invs, pays in loaded:
        all_allocs += PD.allocate_payments_fifo(invs, pays)

    zero = Decimal('0')
    period_defs = PD.periods_for(granularity, year)

    periods_out = []
    cumulative = zero
    for idx, pdef in enumerate(period_defs):
        pf, pt = pdef['from_'], pdef['to']

        opening = zero
        invoiced = zero
        paid = zero
        by_project: dict = {}
        by_supplier_paid: dict = {}

        for row, invs, pays in loaded:
            t = PD.period_totals(invs, pays, pf, pt)
            opening += t['opening']
            invoiced += t['invoiced']
            paid += t['paid']
            if t['paid'] > 0:
                proj = row.project or ''
                by_project[proj] = by_project.get(proj, zero) + t['paid']
                by_supplier_paid[row.account] = (row.name, by_supplier_paid.get(
                    row.account, (row.name, zero))[1] + t['paid'])

        closing = opening + invoiced - paid
        cumulative += paid

        avg_days = PD.avg_settlement_days(all_allocs, pf, pt)

        complete = bool(cov_first and cov_last and pf >= cov_first and pt <= cov_last)

        top_suppliers = sorted(
            [dict(account=acc, name=name, paid=money(amt))
             for acc, (name, amt) in by_supplier_paid.items()],
            key=lambda r: -r['paid'])[:5]

        periods_out.append(dict(
            label=pdef['label'], from_=pf.isoformat(), to=pt.isoformat(),
            opening=money(opening), invoiced=money(invoiced), paid=money(paid),
            net=money(invoiced - paid), closing=money(closing),
            cumulativePaid=money(cumulative),
            byProject=[dict(project=k, paid=money(v)) for k, v in
                      sorted(by_project.items(), key=lambda kv: -kv[1])],
            topSuppliers=top_suppliers,
            avgSettlementDays=avg_days,
            complete=complete,
        ))
        # rename from_/to keys to from/to for JSON (python keyword clash)
        periods_out[-1]['from'] = periods_out[-1].pop('from_')

    # ---- comparison
    comparison = []
    for idx, prow in enumerate(periods_out):
        paid_val = prow['paid']
        prev = None
        shifted = PD.shift_period(granularity, year, idx, -1)
        if shifted is not None:
            py, pidx = shifted
            prev_defs = PD.periods_for(granularity, py)
            if 0 <= pidx < len(prev_defs):
                ppf, ppt = prev_defs[pidx]['from_'], prev_defs[pidx]['to']
                if cov_first and cov_last and not (ppt < cov_first or ppf > cov_last):
                    prev = float(sum(
                        (PD.period_totals(invs, pays, ppf, ppt)['paid'] for _, invs, pays in loaded),
                        zero))

        yoy = None
        per_year_count = {'quarter': 4, 'half': 2, 'year': 1}[granularity]
        yidx = idx
        yoy_defs = PD.periods_for(granularity, year - 1)
        if 0 <= yidx < len(yoy_defs):
            ypf, ypt = yoy_defs[yidx]['from_'], yoy_defs[yidx]['to']
            if cov_first and cov_last and not (ypt < cov_first or ypf > cov_last):
                yoy = float(sum(
                    (PD.period_totals(invs, pays, ypf, ypt)['paid'] for _, invs, pays in loaded),
                    zero))

        prev_pct = ((paid_val - prev) / prev * 100) if prev else None
        yoy_pct = ((paid_val - yoy) / yoy * 100) if yoy else None

        comparison.append(dict(label=prow['label'], paid=paid_val,
                               prevPaid=prev, prevPct=prev_pct,
                               yoyPaid=yoy, yoyPct=yoy_pct))

    return dict(granularity=granularity, year=year, coverage=coverage,
                periods=periods_out, comparison=comparison)
