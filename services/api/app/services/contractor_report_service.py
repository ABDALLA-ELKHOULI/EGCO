# -*- coding: utf-8 -*-
"""قسم المقاولين في التقرير التحليلي — contractor figures in report vocabulary.

The report was born supplier-shaped (فواتير → FIFO → أعمار الديون). Contractors keep a
plain running ledger instead, so the two can only be shown side by side once the ledger
is mapped onto the same three words the report uses. The mapping below is deliberate and
is the contract the frontend labels against:

    invoiced  := Σ credit  (كل ما حُمّل للمقاول: المستخلصات والفواتير المعاد تحميلها
                 والتأمينات المحتجزة) — the credit side is, by the statement's own sign
                 convention, everything he earned/was credited with.
    paid      := Σ debit WHERE kind == 'payment' — real money out only. Every other
                 debit (خصومات، ردّ تأمين، مرتجعات) is NOT called "paid": it is reported
                 separately as `deductions`, because calling a back-charge a payment
                 would overstate cash actually disbursed in the executive summary.
    deductions:= Σ debit WHERE kind != 'payment' — the remainder of the debit side.
                 Therefore, by construction: paid + deductions == Σ debit.
    balance   := Σ debit − Σ credit  (the statement's own signed balance; negative = we
                 owe him).
    outstanding := −balance when balance < 0 else 0 — the report's "المديونية القائمة"
                 means money WE owe, so a contractor who owes US contributes 0 here and
                 shows up only through his signed `balance`.

Contractors have NO due dates in the ledger, so this module deliberately produces no
ageing buckets and no payment schedule: faking them would invent overdue amounts that
no document supports.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain import contractors as C
from app.domain.payables import D, money
from app.services import contractors_service as CS

ZERO = Decimal('0')


def _figures(entries) -> dict:
    """Decimal figures for one contractor's live ledger entries.

    Reuses `domain.contractors.position()` — the same breakdown the contractor's
    own screen is built from — instead of a separate ad-hoc definition, so
    "deductions" never means two different things on two screens for the same
    data (previously this function computed `deductions = Σdebit − paid`, which
    silently folded retention AND the "other" debit bucket into "deductions",
    disagreeing with the contractor detail page).

    `deductions` is defined as whatever remains of the debit side once payments,
    retention, and "other" are accounted for, so by construction:
        paid + deductions + retention + other == debit_total
    """
    pos = C.position([dict(debit=e.debit, credit=e.credit, kind=e.kind) for e in entries])
    debit, credit = pos['debit_total'], pos['credit_total']
    paid = pos['payments_total']
    retention = pos['retention_total']
    other = pos['other_debits']
    deductions = debit - paid - retention - other
    balance = pos['balance']
    return dict(invoiced=credit, paid=paid, deductions=deductions,
                retention=retention, other=other,
                debit=debit, credit=credit, balance=balance,
                outstanding=(-balance if balance < 0 else ZERO))


def _row(row: models.Contractor, today: Optional[dt.date] = None) -> dict:
    entries = [e for e in row.entries if e.deleted_at is None]
    f = _figures(entries)
    return dict(
        partyKind='contractor',
        code=row.code,
        name=row.name,
        account=row.code,          # same key the supplier rows use, for uniform tables
        projects=sorted({e.project for e in entries if e.project}),
        invoiced=money(f['invoiced']),
        paid=money(f['paid']),
        deductions=money(f['deductions']),
        outstanding=money(f['outstanding']),
        balance=money(f['balance']),
        entryCount=len(entries),
        lastActivity=max(e.date for e in entries).isoformat() if entries else None,
        lastPayment=CS._last_payment(entries),
        _dec=f,                    # stripped before the payload leaves `section()`
    )


def rows(db: Session, today: Optional[dt.date] = None,
         code: Optional[str] = None) -> List[dict]:
    q = db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None))
    if code:
        q = q.filter(models.Contractor.code == code)
    out = [_row(r, today) for r in q.all()]
    # الأشد سالبية أولاً — the contractors we owe most come first, as on their screen.
    out.sort(key=lambda r: r['balance'])
    return out


def section(db: Session, today: Optional[dt.date] = None,
            code: Optional[str] = None) -> dict:
    """payload['contractors'] — rows + totals, plus Decimal totals for exact rolling.

    Returns dict(rows=[...], totals={...}, totals_dec={...}); the caller drops
    `totals_dec` from the wire payload after using it for the executive summary.
    """
    rs = rows(db, today, code)
    dec = dict(invoiced=ZERO, paid=ZERO, deductions=ZERO, outstanding=ZERO, balance=ZERO)
    for r in rs:
        for k in dec:
            dec[k] += r['_dec'][k]
    for r in rs:
        r.pop('_dec', None)
    totals = dict(count=len(rs), invoiced=money(dec['invoiced']), paid=money(dec['paid']),
                  deductions=money(dec['deductions']),
                  outstanding=money(dec['outstanding']), balance=money(dec['balance']))
    return dict(rows=rs, totals=totals, totals_dec=dec)


def entries_by_project(row: models.Contractor) -> List[dict]:
    """حركات مقاول واحد مجمّعة بالمشروع — the single-contractor report body."""
    entries = [e for e in row.entries if e.deleted_at is None]
    per: dict = {}
    for e in entries:
        b = per.setdefault(e.project or '', [])
        b.append(e)
    out = []
    for project, es in sorted(per.items()):
        f = _figures(es)
        out.append(dict(
            project=project,
            invoiced=money(f['invoiced']), paid=money(f['paid']),
            deductions=money(f['deductions']), balance=money(f['balance']),
            entryCount=len(es),
            entries=[dict(CS.entry_json(e), partyKind='contractor',
                          code=row.code, name=row.name)
                     for e in sorted(es, key=lambda x: x.date)],
        ))
    return out
