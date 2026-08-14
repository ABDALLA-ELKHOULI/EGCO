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

    ga = db.query(models.GuaranteeAccount).filter_by(account=account).one_or_none()
    if ga is None:
        ga = models.GuaranteeAccount(account=account, name=name)
        db.add(ga)
        db.flush()
    else:
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
