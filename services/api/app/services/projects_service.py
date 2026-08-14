# -*- coding: utf-8 -*-
"""تجميع الموردين حسب المشروع."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.domain import payables as P
from app.domain.payables import money
from app.services import payables_service as PS

UNKNOWN_PROJECT = 'غير محدد'


def _project_of(p) -> str:
    return p.supplier.project.strip() if p.supplier.project and p.supplier.project.strip() else UNKNOWN_PROJECT


def _group(db: Session, today: Optional[dt.date] = None) -> dict:
    today = today or dt.date.today()
    ps = PS.positions(db, today=today, include_empty=True)
    groups: dict = {}
    for p in ps:
        proj = _project_of(p)
        groups.setdefault(proj, []).append(p)
    return groups


def _row_for(project: str, positions: list) -> dict:
    zero = Decimal('0')
    outstanding = sum((p.outstanding for p in positions), zero)
    overdue = sum((p.overdue for p in positions), zero)
    due_within_7 = sum((p.due_within_7 for p in positions), zero)
    total_invoiced = sum((p.total_invoiced for p in positions), zero)
    total_paid = sum((p.total_paid for p in positions), zero)
    open_invoice_count = sum(len([i for i in p.invoices if i.remaining > 0]) for p in positions)
    with_data = len([p for p in positions if p.invoices or p.payments])

    top = sorted(positions, key=lambda p: -p.outstanding)[:3]
    top_suppliers = [dict(account=p.supplier.account, name=p.supplier.name,
                          outstanding=money(p.outstanding)) for p in top]

    return dict(
        project=project,
        supplierCount=len(positions),
        suppliersWithData=with_data,
        outstanding=money(outstanding),
        overdue=money(overdue),
        dueWithin7=money(due_within_7),
        totalInvoiced=money(total_invoiced),
        totalPaid=money(total_paid),
        openInvoiceCount=open_invoice_count,
        topSuppliers=top_suppliers,
        contractorCount=None,
    )


def list_projects(db: Session, today: Optional[dt.date] = None,
                  q: Optional[str] = None, date_from: Optional[dt.date] = None,
                  date_to: Optional[dt.date] = None,
                  min_outstanding: Optional[float] = None) -> dict:
    today = today or dt.date.today()
    groups = _group(db, today)

    # contractor counts per project — cheap: one query, grouped in Python.
    from app.db import models
    contractor_counts: dict = {}
    for row in db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None)).all():
        projs = {e.project for e in row.entries if e.deleted_at is None and e.project}
        for pj in projs:
            contractor_counts[pj] = contractor_counts.get(pj, 0) + 1

    rows = []
    for proj, positions in groups.items():
        if q and q.strip() not in proj:
            continue
        row = _row_for(proj, positions)
        row['contractorCount'] = contractor_counts.get(proj, 0)
        if date_from is not None or date_to is not None:
            zero = Decimal('0')
            opening = invoiced_p = paid_p = closing = zero
            for p in positions:
                b = PS.period_breakdown(p, date_from, date_to)
                opening += b['opening']
                invoiced_p += b['invoiced_in_period']
                paid_p += b['paid_in_period']
                closing += b['closing']
            row['openingBalance'] = money(opening)
            row['invoicedInPeriod'] = money(invoiced_p)
            row['paidInPeriod'] = money(paid_p)
            row['closingBalance'] = money(closing)
        if min_outstanding is not None and row['outstanding'] < min_outstanding:
            continue
        rows.append(row)
    rows.sort(key=lambda r: -r['outstanding'])

    # Sum the Decimal positions across ALL matched groups directly, not the
    # already-rounded per-project floats — summing money()-rounded floats can drift by
    # fractions of a piaster from the exact total, disagreeing with dashboard/overview/
    # suppliers which all sum Decimals before rounding once at the boundary.
    zero = Decimal('0')
    matched_projects = {r['project'] for r in rows}
    all_positions = [p for proj, positions in groups.items()
                     if proj in matched_projects for p in positions]
    totals = dict(
        count=len(rows),
        invoiced=money(sum((p.total_invoiced for p in all_positions), zero)),
        paid=money(sum((p.total_paid for p in all_positions), zero)),
        outstanding=money(sum((p.outstanding for p in all_positions), zero)),
        overdue=money(sum((p.overdue for p in all_positions), zero)),
        dueWithin7=money(sum((p.due_within_7 for p in all_positions), zero)),
        supplierCount=sum(r['supplierCount'] for r in rows),
    )
    filters_applied = dict(q=q, dateFrom=date_from.isoformat() if date_from else None,
                           dateTo=date_to.isoformat() if date_to else None,
                           minOutstanding=min_outstanding)
    return dict(asOf=today.isoformat(), totals=totals, rows=rows, filtersApplied=filters_applied)


def project_detail(db: Session, project: str, today: Optional[dt.date] = None) -> Optional[dict]:
    today = today or dt.date.today()
    groups = _group(db, today)
    key = project if project in groups else None
    if key is None:
        # allow lookup by the display label even if caller passed it verbatim
        for g in groups:
            if g == project:
                key = g
                break
    if key is None:
        return None

    positions = groups[key]
    row = _row_for(key, positions)
    row['suppliers'] = [PS.position_json(p) for p in positions]
    row['schedule'] = [
        dict(date=b['date'].isoformat(), amount=money(b['amount']), count=len(b['items']))
        for b in P.payment_schedule(positions, today, 90)
    ]
    return row
