# -*- coding: utf-8 -*-
"""حسابات الضمانات (بادئة 216) — «ضمان اعمال X».

New service for the 216 guarantee-statement flow. Reuses the same generic
statement reader as the contractor ledger (app/ingest/contractor_statement.py —
identical CompanyCode=/block format), then:
  * extracts the contractor/supplier name from the header pattern «ضمان اعمال X»,
  * fuzzy-matches it against Contractor and Supplier names,
  * persists a standalone GuaranteeAccount (+ GuaranteeEntry rows) always, and
  * ALSO upserts a ContractorGuarantee when a contractor match is found (amount =
    abs(printed closing), notes recording the source account/file) so the existing
    Contractors UI keeps working without changes.

Reconciliation bar is the same exactness used everywhere else in this codebase:
sum(credit) - sum(debit) + opening (signed as printed) must equal
abs(printed closing) to the cent (Decimal), not an approximation.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import D, money
from app.services.contractors_service import guarantee_json

_NAME_PATTERN = re.compile(r'ضمان\s+اعمال\s+(.+)')


def extract_contractor_name(header_name: str) -> str:
    """«ضمان اعمال القدس للمقاولات» -> «القدس للمقاولات». Falls back to the raw
    header when the pattern isn't found (still usable as a standalone name)."""
    m = _NAME_PATTERN.search(header_name or '')
    return (m.group(1).strip() if m else (header_name or '').strip())


def _normalize(name: str) -> str:
    return re.sub(r'\s+', ' ', (name or '')).strip()


def find_match(db: Session, name: str):
    """Fuzzy match by substring, either direction, against contractors then
    suppliers. Returns ('contractor'|'supplier', row) or (None, None)."""
    norm = _normalize(name)
    if not norm:
        return None, None
    for row in db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None)).all():
        rn = _normalize(row.name)
        if rn and (rn in norm or norm in rn):
            return 'contractor', row
    for row in db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None)).all():
        rn = _normalize(row.name)
        if rn and (rn in norm or norm in rn):
            return 'supplier', row
    return None, None


def preview(parsed: dict) -> dict:
    rows = parsed['rows']
    debit_total = sum((D(r['debit']) for r in rows), Decimal('0'))
    credit_total = sum((D(r['credit']) for r in rows), Decimal('0'))
    opening = sum((D(r['credit']) - D(r['debit']) for r in rows if r.get('kind') == 'opening'),
                  Decimal('0'))
    computed = credit_total - debit_total
    stated = D(parsed['printed_balance']) if parsed['printed_balance'] is not None else None
    ok = stated is None or abs(computed - abs(stated)) <= Decimal('0.01')
    name = extract_contractor_name(parsed['name'])
    return dict(
        kind='guarantee',
        account=parsed['account'], name=name, rawName=parsed['name'],
        rowCount=len(rows),
        totalCredit=money(credit_total), totalDebit=money(debit_total),
        computedBalance=money(computed),
        statementBalance=money(abs(stated)) if stated is not None else None,
        reconciled=bool(ok),
        difference=money(computed - abs(stated)) if stated is not None else None,
        issues=list(parsed['issues']),
    )


def commit(db: Session, parsed: dict, path: str, import_log_id: str) -> dict:
    account = parsed['account']
    name = extract_contractor_name(parsed['name'])
    kind, matched = find_match(db, name)

    # Look up including soft-deleted rows (the `account` column is unique, so an
    # insert would collide with a soft-deleted match) — resurrect it in place if
    # deleted, mirroring the pattern used for GuaranteeEntry/ContractorGuarantee
    # below and for Supplier/Contractor elsewhere in this codebase.
    ga = db.query(models.GuaranteeAccount).filter_by(account=account).one_or_none()
    if ga is None:
        ga = models.GuaranteeAccount(account=account, name=name)
        db.add(ga)
        db.flush()
    else:
        ga.deleted_at = None
        ga.name = name
    if kind == 'contractor':
        ga.linked_contractor_code = matched.code

    added = skipped = 0
    for r in parsed['rows']:
        desc = r.get('description') or ''
        exists = db.query(models.GuaranteeEntry).filter_by(
            guarantee_account_id=ga.id, doc=r.get('doc') or '', date=r['date'],
            debit=r['debit'], credit=r['credit'], description=desc).one_or_none()
        if exists is not None:
            if exists.deleted_at is not None:
                exists.deleted_at = None
                exists.import_log_id = import_log_id
                added += 1
            else:
                skipped += 1
            continue
        db.add(models.GuaranteeEntry(
            guarantee_account_id=ga.id, date=r['date'], debit=r['debit'], credit=r['credit'],
            doc=r.get('doc') or '', description=desc, source='statement',
            import_log_id=import_log_id))
        added += 1

    closing = D(parsed['printed_balance']) if parsed['printed_balance'] is not None else None
    ga.balance = money(abs(closing)) if closing is not None else ga.balance

    contractor_row = None
    if kind == 'contractor':
        g = db.query(models.ContractorGuarantee).filter_by(
            contractor_id=matched.id, project='').one_or_none()
        if g is None:
            g = models.ContractorGuarantee(contractor_id=matched.id, project='')
            db.add(g)
        g.deleted_at = None
        g.amount = money(abs(closing)) if closing is not None else g.amount
        g.notes = ('كشف ضمان 216 — حساب %s — ملف %s' % (account, path))
        contractor_row = dict(code=matched.code, name=matched.name)

    db.commit()
    return dict(added=added, skipped=skipped,
                guaranteeAccount=dict(account=ga.account, name=ga.name,
                                      linkedContractorCode=ga.linked_contractor_code,
                                      balance=ga.balance),
                matchedContractor=contractor_row)


# ---------------------------------------------------------------- صفحة الضمانات

def _entry_json(e: models.GuaranteeEntry) -> dict:
    return dict(id=e.id, date=e.date.isoformat(), debit=money(e.debit or 0),
                credit=money(e.credit or 0), doc=e.doc or '', description=e.description or '',
                source=e.source or 'statement')


def account_row(db: Session, ga: models.GuaranteeAccount) -> dict:
    """صف حساب ضمان للائحة — بلا تفاصيل الحركات."""
    entries = db.query(models.GuaranteeEntry).filter_by(
        guarantee_account_id=ga.id).filter(models.GuaranteeEntry.deleted_at.is_(None)).all()
    last = max((e.date for e in entries), default=None)
    contractor_name = None
    if ga.linked_contractor_code:
        c = db.query(models.Contractor).filter_by(
            code=ga.linked_contractor_code).filter(models.Contractor.deleted_at.is_(None)).one_or_none()
        contractor_name = c.name if c else None
    return dict(id=ga.id, account=ga.account, name=ga.name,
                linkedContractorCode=ga.linked_contractor_code,
                linkedContractorName=contractor_name,
                balance=money(ga.balance or 0), entryCount=len(entries),
                lastActivity=last.isoformat() if last else None)


def _tracked_amount_for(db: Session, contractor: models.Contractor) -> Decimal:
    total = Decimal('0')
    for g in contractor.guarantees:
        if g.deleted_at is not None or g.released_on is not None:
            continue
        total += D(g.amount or 0)
    return total


def reconcile(balance: float, tracked: Decimal) -> dict:
    diff = D(balance) - tracked
    return dict(difference=money(diff), matches=bool(abs(diff) <= Decimal('0.01')))


def list_page(db: Session) -> dict:
    """GET /guarantees — الحسابات + الضمانات المتتبَّعة + المطابقة والإجماليات."""
    accounts = db.query(models.GuaranteeAccount).filter(
        models.GuaranteeAccount.deleted_at.is_(None)).order_by(models.GuaranteeAccount.account).all()
    account_rows = []
    statements_held = Decimal('0')
    for ga in accounts:
        row = account_row(db, ga)
        account_rows.append(row)
        statements_held += D(ga.balance or 0)

    contractors = db.query(models.Contractor).filter(
        models.Contractor.deleted_at.is_(None)).order_by(models.Contractor.name).all()
    contractor_guarantees = []
    tracked_held = Decimal('0')
    due_soon = overdue = 0
    for c in contractors:
        for g in c.guarantees:
            if g.deleted_at is not None:
                continue
            gj = guarantee_json(g)
            gj['contractorCode'] = c.code
            gj['contractorName'] = c.name
            contractor_guarantees.append(gj)
            if g.released_on is None:
                tracked_held += D(g.amount or 0)
                if gj['dueStatus'] == 'due':
                    overdue += 1
                elif gj['dueStatus'] == 'upcoming':
                    due_soon += 1

    # attach reconciliation info to each linked account row
    for row in account_rows:
        code = row['linkedContractorCode']
        if not code:
            row['matches'] = None
            row['difference'] = None
            continue
        c = next((c for c in contractors if c.code == code), None)
        tracked = _tracked_amount_for(db, c) if c else Decimal('0')
        rec = reconcile(row['balance'], tracked)
        row.update(rec)

    return dict(
        accounts=account_rows,
        contractorGuarantees=contractor_guarantees,
        totals=dict(
            statementsHeld=money(statements_held),
            trackedHeld=money(tracked_held),
            dueSoonCount=due_soon,
            overdueCount=overdue,
        ),
    )


def account_detail(db: Session, account: str) -> dict:
    """GET /guarantees/{account} — سجل حركات الحساب + مقارنة بالمقاول المرتبط."""
    ga = db.query(models.GuaranteeAccount).filter_by(account=account).filter(
        models.GuaranteeAccount.deleted_at.is_(None)).one_or_none()
    if ga is None:
        return None
    entries = db.query(models.GuaranteeEntry).filter_by(
        guarantee_account_id=ga.id).filter(models.GuaranteeEntry.deleted_at.is_(None)).order_by(
        models.GuaranteeEntry.date.desc()).all()
    row = account_row(db, ga)
    linked_guarantees = []
    if ga.linked_contractor_code:
        c = db.query(models.Contractor).filter_by(
            code=ga.linked_contractor_code).filter(models.Contractor.deleted_at.is_(None)).one_or_none()
        if c is not None:
            tracked = _tracked_amount_for(db, c)
            row.update(reconcile(row['balance'], tracked))
            linked_guarantees = [guarantee_json(g) for g in c.guarantees if g.deleted_at is None]
    else:
        row['matches'] = None
        row['difference'] = None
    return dict(account=row, entries=[_entry_json(e) for e in entries],
                linkedGuarantees=linked_guarantees)
