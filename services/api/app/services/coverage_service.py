# -*- coding: utf-8 -*-
"""تغطية البيانات — which suppliers have no statement/manual activity yet, and which
ones have gone quiet for too long. Powers the intake checklist screen.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy.orm import Session

from app.domain.payables import money
from app.services import payables_service as PS


_VALID_STATES = ('none', 'stale', 'ok')


def coverage(db: Session, today: Optional[dt.date] = None, stale_days: int = 90,
            q: Optional[str] = None, project: Optional[str] = None,
            state: Optional[str] = None) -> dict:
    today = today or dt.date.today()
    ps = PS.positions(db, today=today, include_empty=True)

    all_rows = []
    for p in ps:
        dates = [i.date for i in p.invoices] + [x.date for x in p.payments]
        first_activity = min(dates) if dates else None
        last_activity = max(dates) if dates else None
        days_since_last = (today - last_activity).days if last_activity else None

        if last_activity is None:
            row_state = 'none'
        elif days_since_last is not None and days_since_last > stale_days:
            row_state = 'stale'
        else:
            row_state = 'ok'

        all_rows.append(dict(
            account=p.supplier.account, name=p.supplier.name, project=p.supplier.project,
            firstActivity=first_activity.isoformat() if first_activity else None,
            lastActivity=last_activity.isoformat() if last_activity else None,
            daysSinceLast=days_since_last,
            invoiceCount=len(p.invoices),
            outstanding=money(p.outstanding),
            state=row_state,
        ))

    rows = []
    for r in all_rows:
        if q:
            needle = q.strip()
            if needle not in r['name'] and needle not in r['account']:
                continue
        if project and r['project'] != project:
            continue
        if state and r['state'] != state:
            continue
        rows.append(r)

    order = dict(none=0, stale=1, ok=2)
    rows.sort(key=lambda r: (
        order[r['state']],
        -(r['daysSinceLast'] or 0) if r['state'] == 'stale' else 0,
        r['name'],
    ))

    suppliers = len(rows)
    with_data = len([r for r in rows if r['state'] != 'none'])
    without_data = suppliers - with_data
    stale = len([r for r in rows if r['state'] == 'stale'])
    covered_pct = round(with_data / suppliers * 100, 1) if suppliers else 0

    filters_applied = dict(q=q, project=project, state=state, staleDays=stale_days)
    return dict(
        totals=dict(suppliers=suppliers, withData=with_data, withoutData=without_data,
                    stale=stale, coveredPct=covered_pct),
        asOf=today.isoformat(),
        staleDays=stale_days,
        rows=rows,
        filtersApplied=filters_applied,
    )
