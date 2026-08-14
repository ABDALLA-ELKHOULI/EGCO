# -*- coding: utf-8 -*-
"""يربط قاعدة البيانات بحسابات المقاولين.

Loads rows, hands them to app/domain/contractors.py, and shapes JSON for the wire —
no arithmetic lives here beyond calling the domain layer, same rule as
payables_service.py.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain import contractors as C
from app.domain.payables import D, money


# ---------------------------------------------------------------- known projects

def known_projects(db: Session) -> List[str]:
    """أسماء المشاريع المعروفة — from suppliers and budget snapshots."""
    names = set()
    for (p,) in db.query(models.Supplier.project).filter(
            models.Supplier.deleted_at.is_(None)).distinct().all():
        if p:
            names.add(p)
    for (p,) in db.query(models.BudgetSnapshot.project).filter(
            models.BudgetSnapshot.deleted_at.is_(None)).distinct().all():
        if p:
            names.add(p)
    return sorted(names)


# ---------------------------------------------------------------- statement upsert

def upsert_from_statement(db: Session, parsed: dict, path: str,
                          import_log_id: Optional[str] = None) -> dict:
    """حفظ كشف مقاول — creates the contractor when the code is new, inserts ledger
    rows idempotently (duplicate identity rows are skipped, so re-import adds 0).

    `import_log_id` stamps every row this call creates or resurrects so the
    uploaded-files screen can later delete exactly this import's rows. A soft-deleted
    row matching an incoming row's identity is resurrected (un-deleted, re-stamped)
    rather than skipped — otherwise upload -> delete -> re-upload adds 0 rows.
    """
    code = parsed['account']
    row = db.query(models.Contractor).filter_by(code=code).one_or_none()
    if row is None:
        row = models.Contractor(code=code, name=parsed.get('name') or code)
        db.add(row)
        db.flush()
    else:
        if row.deleted_at is not None:
            row.deleted_at = None
        if parsed.get('name'):
            row.name = parsed['name']

    projects = known_projects(db)
    added = skipped = 0
    for r in parsed['rows']:
        desc = r.get('description') or ''
        kind = r.get('kind') or C.classify_entry(desc)
        exists = db.query(models.ContractorEntry).filter_by(
            contractor_id=row.id, doc=r.get('doc') or '', date=r['date'],
            debit=r['debit'], credit=r['credit'], description=desc).one_or_none()
        if exists is not None:
            if exists.deleted_at is not None:
                exists.deleted_at = None
                exists.import_log_id = import_log_id
                added += 1
            else:
                skipped += 1
            continue
        db.add(models.ContractorEntry(
            contractor_id=row.id, date=r['date'], debit=r['debit'], credit=r['credit'],
            doc=r.get('doc') or '', description=desc, kind=kind,
            claim_no=C.extract_claim_no(desc),
            project=C.detect_project(desc, projects), source='statement',
            import_log_id=import_log_id))
        added += 1

    db.commit()
    return dict(contractor=dict(code=row.code, name=row.name),
                added=added, skipped=skipped)


# ---------------------------------------------------------------- guarantees

def guarantee_release(g: models.ContractorGuarantee, today: Optional[dt.date] = None):
    """موعد فك الضمان وحالته.

    release_due = the explicit date when set, otherwise finished_on + guarantee_days.
    status: released > due (release_due <= today) > upcoming (within 30 days)
    > scheduled (later, or no date derivable yet).
    """
    today = today or dt.date.today()
    due = g.release_due
    if due is None and g.finished_on is not None and g.guarantee_days is not None:
        due = g.finished_on + dt.timedelta(days=g.guarantee_days)
    if g.released_on is not None:
        status = 'released'
    elif due is None:
        status = 'scheduled'
    elif due <= today:
        status = 'due'
    elif due <= today + dt.timedelta(days=30):
        status = 'upcoming'
    else:
        status = 'scheduled'
    return due, status


def guarantee_json(g: models.ContractorGuarantee, today: Optional[dt.date] = None) -> dict:
    due, status = guarantee_release(g, today)
    return dict(id=g.id, project=g.project, amount=money(g.amount or 0),
                retentionRate=g.retention_rate,
                finishedOn=g.finished_on.isoformat() if g.finished_on else None,
                guaranteeDays=g.guarantee_days,
                releaseDue=due.isoformat() if due else None,
                releasedOn=g.released_on.isoformat() if g.released_on else None,
                dueStatus=status, notes=g.notes or '')


def sync_guarantee_from_claims(db: Session, contractor: models.Contractor,
                               project: str) -> None:
    """ضمان المشروع = مجموع تأمينات مستخلصاته.

    Always recomputed on any claim create/update/delete. The guarantees PUT sets the
    amount explicitly and that value wins until the NEXT claim change re-derives it —
    a deliberate, simple rule documented for the frontend too.
    """
    total = sum((D(c.retention_amount or 0)
                 for c in db.query(models.ContractorClaim).filter_by(
                     contractor_id=contractor.id, project=project, deleted_at=None).all()),
                Decimal('0'))
    # identity is (contractor, project) including soft-deleted rows — inserting a new
    # row next to a soft-deleted one would violate the unique constraint, so a
    # soft-deleted guarantee is resurrected by the claim change instead.
    g = db.query(models.ContractorGuarantee).filter_by(
        contractor_id=contractor.id, project=project).one_or_none()
    if g is None:
        g = models.ContractorGuarantee(contractor_id=contractor.id, project=project)
        db.add(g)
    g.deleted_at = None
    g.amount = money(total)


# ---------------------------------------------------------------- serialisation

def entry_json(e: models.ContractorEntry) -> dict:
    return dict(id=e.id, date=e.date.isoformat(), debit=money(e.debit or 0),
                credit=money(e.credit or 0), doc=e.doc or '',
                description=e.description or '', kind=e.kind or 'other',
                claimNo=e.claim_no, project=e.project or '',
                source=e.source or 'statement')


def claim_json(c: models.ContractorClaim) -> dict:
    return dict(id=c.id, project=c.project or '', number=c.number or '',
                date=c.date.isoformat(),
                grossCumulative=money(c.gross_cumulative or 0),
                previousCumulative=money(c.previous_cumulative or 0),
                retentionRate=c.retention_rate,
                retentionAmount=money(c.retention_amount or 0),
                otherDeductions=money(c.other_deductions or 0),
                netDue=money(c.net_due or 0),
                description=c.description or '', source=c.source or 'manual')


def _live_entries(row: models.Contractor) -> list:
    return [e for e in row.entries if e.deleted_at is None]


def _entry_dicts(entries) -> List[dict]:
    return [dict(debit=e.debit or 0, credit=e.credit or 0, kind=e.kind or 'other')
            for e in entries]


def contractor_row_json(row: models.Contractor, today: Optional[dt.date] = None) -> dict:
    """سطر شاشة القائمة — one dict per contractor."""
    entries = _live_entries(row)
    pos = C.position(_entry_dicts(entries))
    guarantees = [g for g in row.guarantees if g.deleted_at is None]
    retention_held = sum((D(g.amount or 0) for g in guarantees
                          if g.released_on is None), Decimal('0'))
    alerts = 0
    for g in guarantees:
        _, status = guarantee_release(g, today)
        if status in ('due', 'upcoming'):
            alerts += 1
    return dict(
        code=row.code, name=row.name, phone=row.phone or '',
        projects=sorted({e.project for e in entries if e.project}),
        balance=money(pos['balance']),
        duesTotal=money(pos['claims_total']),
        paidTotal=money(pos['payments_total']),
        deductionsTotal=money(pos['deductions_total']),
        retentionHeld=money(retention_held),
        entryCount=len(entries),
        lastActivity=max(e.date for e in entries).isoformat() if entries else None,
        lastPayment=_last_payment(entries),
        releaseAlerts=alerts,
    )


def _last_payment(entries) -> object:
    """آخر دفعة فعلية للمقاول — أساسية في القائمة مثل نظيرتها عند الموردين."""
    pays = [e for e in entries if e.kind == 'payment' and (e.debit or 0) > 0]
    if not pays:
        return None
    last = max(pays, key=lambda e: e.date)
    return dict(date=last.date.isoformat(), amount=money(D(last.debit)))


def _direction_of(balance: float) -> str:
    if balance < 0:
        return 'owed_to_them'
    if balance > 0:
        return 'owed_to_us'
    return 'balanced'


def contractors_list_json(db: Session, today: Optional[dt.date] = None,
                          q: Optional[str] = None, project: Optional[str] = None,
                          direction: Optional[str] = None,
                          has_guarantees: Optional[bool] = None) -> dict:
    all_rows = [contractor_row_json(r, today) for r in
               db.query(models.Contractor).filter(
                   models.Contractor.deleted_at.is_(None)).all()]

    rows = []
    for r in all_rows:
        if q:
            needle = q.strip()
            if needle not in r['name'] and needle not in r['code']:
                continue
        if project and project not in r['projects']:
            continue
        if direction and _direction_of(r['balance']) != direction:
            continue
        if has_guarantees is not None:
            row_has = r['retentionHeld'] > 0
            if row_has != has_guarantees:
                continue
        rows.append(r)

    # الأشد سالبية أولاً — the contractors we owe the most come first.
    rows.sort(key=lambda r: r['balance'])
    zero = Decimal('0')
    claims_total = sum((D(r['duesTotal']) for r in rows), zero)
    paid_total = sum((D(r['paidTotal']) for r in rows), zero)
    deductions_total = sum((D(r['deductionsTotal']) for r in rows), zero)
    owed_to_contractors = sum((abs(D(r['balance'])) for r in rows if r['balance'] < 0), zero)
    owed_to_us = sum((D(r['balance']) for r in rows if r['balance'] > 0), zero)
    balance = sum((D(r['balance']) for r in rows), zero)
    retention = sum((D(r['retentionHeld']) for r in rows), zero)
    totals = dict(count=len(rows),
                 claimsTotal=money(claims_total),
                 paidTotal=money(paid_total),
                 deductionsTotal=money(deductions_total),
                 balance=money(balance),
                 owedToContractors=money(owed_to_contractors),
                 owedToUs=money(owed_to_us),
                 retentionHeld=money(retention))
    filters_applied = dict(q=q, project=project, direction=direction,
                           hasGuarantees=has_guarantees)
    return dict(count=len(rows), rows=rows, totals=totals, filtersApplied=filters_applied)


def contractor_detail_json(row: models.Contractor, today: Optional[dt.date] = None) -> dict:
    entries = _live_entries(row)
    pos = C.position(_entry_dicts(entries))

    # ---- per-project breakdown ('' = unassigned; frontend labels it).
    per: dict = {}
    for e in entries:
        b = per.setdefault(e.project or '', dict(debit=Decimal('0'), credit=Decimal('0'),
                                                 count=0))
        b['debit'] += D(e.debit or 0)
        b['credit'] += D(e.credit or 0)
        b['count'] += 1
    per_project = [dict(project=p, debit=money(b['debit']), credit=money(b['credit']),
                        balance=money(b['debit'] - b['credit']), entryCount=b['count'])
                   for p, b in sorted(per.items())]

    return dict(
        code=row.code, name=row.name, phone=row.phone or '', notes=row.notes or '',
        defaultRetentionRate=row.default_retention_rate,
        defaultGuaranteeDays=row.default_guarantee_days,
        balance=money(pos['balance']),
        debitTotal=money(pos['debit_total']), creditTotal=money(pos['credit_total']),
        duesTotal=money(pos['claims_total']), paidTotal=money(pos['payments_total']),
        retentionTotal=money(pos['retention_total']),
        deductionsTotal=money(pos['deductions_total']),
        # حركات لا تندرج تحت البنود أعلاه (فواتير محمّلة · رصيد افتتاحي · أخرى).
        # كانت تُحتسب في الرصيد وتختفي من العرض، فتبدو الأرقام غير متسقة.
        otherDebits=money(pos['other_debits']),
        otherCredits=money(pos['other_credits']),
        lastPayment=_last_payment(entries),
        perProject=per_project,
        entries=[entry_json(e) for e in
                 sorted(entries, key=lambda e: (e.date, e.created_at), reverse=True)],
        claims=[claim_json(c) for c in
                sorted((c for c in row.claims if c.deleted_at is None),
                       key=lambda c: c.date, reverse=True)],
        guarantees=[guarantee_json(g, today) for g in row.guarantees
                    if g.deleted_at is None],
    )
