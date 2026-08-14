# -*- coding: utf-8 -*-
"""خدمة الموازنة — استيراد لقطات تقارير الانحراف وعرضها حسب المشروع."""
from __future__ import annotations

import json
import os
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.ingest import budget_xlsx


def import_budget(db: Session, path: str) -> dict:
    """Parse the workbook and upsert one snapshot per (project, month).

    Re-importing the same workbook updates rows in place — the real file gains a
    new sheet every month, so updates are the normal case, not an error.
    """
    sheets = budget_xlsx.parse(path)
    source = os.path.basename(path)

    imported = 0
    updated = 0
    projects = set()
    issues: List[dict] = []

    for s in sheets:
        projects.add(s['project'])
        issues.extend(s['issues'])
        row = (db.query(models.BudgetSnapshot)
                 .filter(models.BudgetSnapshot.project == s['project'],
                         models.BudgetSnapshot.month == s['month'])
                 .one_or_none())
        if row is None:
            row = models.BudgetSnapshot(project=s['project'], month=s['month'])
            db.add(row)
            imported += 1
        else:
            updated += 1

        row.serial = s['serial']
        row.issued_on = s['issued_on']
        row.actual_month = s['actual_month']
        row.planned_month = s['planned_month']
        row.deviation_month = s['deviation_month']
        row.cum_actual = s['cum_actual']
        row.cum_planned = s['cum_planned']
        row.cum_prev_actual = s['cum_prev_actual']
        row.cum_prev_planned = s['cum_prev_planned']
        row.delay_pct = s['delay_pct']
        row.completion_pct = s['completion_pct']
        row.claims = json.dumps(
            [dict(no=c['no'], amount=c['amount'],
                  date=c['date'].isoformat() if c['date'] else None)
             for c in s['claims']], ensure_ascii=False)
        row.notes = s['notes']
        row.source = source

    db.commit()
    return dict(imported=imported, updated=updated,
                projects=sorted(projects), issues=issues)


def _snapshot_json(row: models.BudgetSnapshot) -> dict:
    try:
        claims = json.loads(row.claims or '[]')
    except ValueError:
        claims = []
    return dict(
        project=row.project,
        month=row.month.isoformat(),
        serial=row.serial,
        issuedOn=row.issued_on.isoformat() if row.issued_on else None,
        actualMonth=row.actual_month,
        plannedMonth=row.planned_month,
        deviationMonth=row.deviation_month,
        cumActual=row.cum_actual,
        cumPlanned=row.cum_planned,
        cumPrevActual=row.cum_prev_actual,
        cumPrevPlanned=row.cum_prev_planned,
        delayPct=row.delay_pct,
        completionPct=row.completion_pct,
        claims=claims,
        notes=row.notes,
    )


def _project_row(project: str, rows: List[models.BudgetSnapshot]) -> dict:
    rows = sorted(rows, key=lambda r: r.month)
    months = [_snapshot_json(r) for r in rows]
    latest = months[-1]

    # trend: delay delta in percentage points vs the previous month (negative = improved)
    delay_delta = None
    if len(rows) >= 2 and rows[-1].delay_pct is not None and rows[-2].delay_pct is not None:
        delay_delta = (rows[-1].delay_pct - rows[-2].delay_pct) * 100.0

    return dict(project=project, months=months, latest=latest,
                trend=dict(delayDeltaPp=delay_delta, monthsBehind=None))


def overview(db: Session) -> dict:
    rows = db.query(models.BudgetSnapshot).all()
    groups: dict = {}
    for r in rows:
        groups.setdefault(r.project, []).append(r)
    projects = [_project_row(p, rs) for p, rs in groups.items()]
    projects.sort(key=lambda p: p['project'])
    return dict(projects=projects)


def project_detail(db: Session, project: str) -> Optional[dict]:
    rows = (db.query(models.BudgetSnapshot)
              .filter(models.BudgetSnapshot.project == project).all())
    if not rows:
        return None
    return _project_row(project, rows)
