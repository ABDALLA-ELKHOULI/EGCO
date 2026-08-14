# -*- coding: utf-8 -*-
"""يربط قاعدة البيانات بقارئات التحصيلات (report4.html / Excel).

Wiring note for the integrator (import_service.py owns the shared preview/commit flow
and is NOT touched by this agent). To plug receivables into `POST /api/v1/import`, add:

    from app.ingest import receivables_legacy, receivables_excel
    from app.services import receivables_service

    # in the source->parser dispatch table:
    'receivables_legacy_html': receivables_legacy.parse,
    'receivables_excel': receivables_excel.parse,

    # and route commit for these two sources to:
    receivables_service.import_receivables(db, path, source)
    # (reconciliation is not applicable — the returned dict already sets
    # reconciled=True with an informational issue, matching the statement contract)
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import money
from app.ingest import receivables_legacy, receivables_excel

_PARSERS = {
    'receivables_legacy_html': receivables_legacy.parse,
    'receivables_excel': receivables_excel.parse,
}


def import_receivables(db: Session, path: str, source: str = 'receivables_legacy_html') -> dict:
    """يقرأ ملف تحصيلات ويحفظه — نفس عقد preview/commit الخاص بالكشوفات، لكن بلا مطابقة."""
    parser = _PARSERS.get(source)
    if parser is None:
        raise ValueError(f'unknown receivables source: {source}')

    parsed = parser(path)
    rows = parsed['receivables']
    issues = list(parsed['issues'])
    issues.append(dict(severity='info', row=None,
                       message='لا تنطبق المطابقة على بيانات التحصيلات — تُحفظ كما هي'))

    from app.services.import_service import backup_db
    backup_db()

    added = skipped = 0
    for r in rows:
        exists = db.query(models.Receivable).filter_by(
            unit=r.unit, client=r.client, amount=r.amount,
            status=r.status, source=source).one_or_none()
        if exists is not None:
            skipped += 1
            continue
        db.add(models.Receivable(
            project=getattr(r, 'project', '') or '',
            unit=r.unit, client=r.client, amount=r.amount,
            due_date=getattr(r, 'due_date', None),
            collected_on=getattr(r, 'collected_on', None),
            status=r.status, source=source,
        ))
        added += 1

    db.add(models.ImportLog(source=source, path=path, imported=added, skipped=skipped,
                            reconciled=1, issues=json.dumps(issues, ensure_ascii=False)))
    db.commit()

    return dict(saved=True, added=added, skipped=skipped, reconciled=True,
                imported=added, issues=issues,
                totalCollected=money(sum((r.amount for r in rows if r.status == 'collected'), 0)))
