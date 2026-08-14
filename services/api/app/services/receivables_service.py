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

    # created FIRST so every row this import creates/resurrects can be stamped —
    # see import_service.commit_statement for the same pattern.
    log = models.ImportLog(source=source, path=path, imported=0, skipped=0,
                           reconciled=1, issues=json.dumps(issues, ensure_ascii=False))
    db.add(log)
    db.flush()

    added = skipped = 0
    for r in rows:
        exists = db.query(models.Receivable).filter_by(
            unit=r.unit, client=r.client, amount=r.amount,
            status=r.status, source=source).one_or_none()
        if exists is not None:
            # a soft-deleted row matching this identity is resurrected, not skipped —
            # otherwise upload -> delete -> re-upload silently imports 0 rows.
            if exists.deleted_at is not None:
                exists.deleted_at = None
                exists.import_log_id = log.id
                added += 1
            else:
                skipped += 1
            continue
        db.add(models.Receivable(
            project=getattr(r, 'project', '') or '',
            unit=r.unit, client=r.client, amount=r.amount,
            due_date=getattr(r, 'due_date', None),
            collected_on=getattr(r, 'collected_on', None),
            status=r.status, source=source, import_log_id=log.id,
        ))
        added += 1

    log.imported = added
    log.skipped = skipped
    db.commit()

    return dict(saved=True, added=added, skipped=skipped, reconciled=True,
                imported=added, issues=issues,
                totalCollected=money(sum((r.amount for r in rows if r.status == 'collected'), 0)))
