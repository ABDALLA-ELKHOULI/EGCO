# -*- coding: utf-8 -*-
"""تغطية البيانات — which suppliers have no statement/manual activity yet, and which
ones have gone quiet for too long. Powers the intake checklist screen.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import money
from app.services import contractors_service as CS
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


def contractor_coverage(db: Session, today: Optional[dt.date] = None, stale_days: int = 90,
                        q: Optional[str] = None, project: Optional[str] = None,
                        state: Optional[str] = None) -> dict:
    """تغطية المقاولين — نظير coverage() أعلاه، بنفس المنطق (none/stale/ok) بدل
    تجاهل هذا الطرف كلياً كما كان الحال (grep contractor في هذا الملف كان يعيد صفر
    نتيجة). المصدر هنا حركات دفتر المقاول (ContractorEntry) لا فواتير/دفعات
    الموردين — لا يوجد PS.positions مكافئ للمقاولين فالاستعلام مباشر على الجدول.

    الحالة (none/stale/ok) تُقاس على حركات **الكشف الحقيقي فقط** (source='statement')
    لا كل الحركات — حركتا اللقطة (balance_snapshot) اللتان يُنشئهما
    commit_contractors_balance لكل مقاول مستورَد تجعلان last_activity/entryCount
    ممتلئين حتى بلا أي كشف حقيقي، فتُبلّغ 'ok' كاذبة (م-٢٦). anyone يريد تاريخ آخر
    حركة (بما فيها اللقطة) يجده في lastActivity على شاشة القائمة، لا هنا.
    """
    today = today or dt.date.today()
    rows_q = db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None)).all()

    all_rows = []
    for c in rows_q:
        entries = [e for e in c.entries if e.deleted_at is None]
        statement_entries = CS._statement_entries(entries)
        dates = [e.date for e in statement_entries]
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
            code=c.code, name=c.name,
            firstActivity=first_activity.isoformat() if first_activity else None,
            lastActivity=last_activity.isoformat() if last_activity else None,
            daysSinceLast=days_since_last,
            entryCount=len(entries),
            hasStatement=len(statement_entries) > 0,
            statementEntryCount=len(statement_entries),
            # الرصيد المُبلَّغ من تقرير المديونيات — موجود حتى بلا حركة دفتر، فيبقى
            # صفّ «none» ذا معنى مالي بدل رقم فارغ (انظر _reported_without_ledger
            # في contractors_service.py).
            reportedBalance=money(c.reported_balance) if c.reported_balance is not None else None,
            state=row_state,
        ))

    rows = []
    for r in all_rows:
        if q:
            needle = q.strip()
            if needle not in r['name'] and needle not in r['code']:
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

    contractors = len(rows)
    with_data = len([r for r in rows if r['state'] != 'none'])
    without_data = contractors - with_data
    stale = len([r for r in rows if r['state'] == 'stale'])
    covered_pct = round(with_data / contractors * 100, 1) if contractors else 0

    filters_applied = dict(q=q, project=project, state=state, staleDays=stale_days)
    return dict(
        totals=dict(contractors=contractors, withData=with_data, withoutData=without_data,
                    stale=stale, coveredPct=covered_pct),
        asOf=today.isoformat(),
        staleDays=stale_days,
        rows=rows,
        filtersApplied=filters_applied,
    )
