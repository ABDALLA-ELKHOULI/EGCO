# -*- coding: utf-8 -*-
"""خدمة التقويم — استحقاقات المستخلصات للمقاولين ذوي مدة السداد (م-٤٦).

ملف جديد مستقل عن routes/dashboard.py (الذي يبني جدول الموردين والضمانات) حتى لا
يُلمس ملف خارج ملكية هذه الموجة. الواجهة (Calendar.tsx) تجلب هذه الأحداث عبر
GET /api/v1/contractors/claims-due وتدمجها مع جدول الموردين محلياً بالعدّ والجمع
فقط — كل مبلغ هنا محسوب في domain/contractors.py، لا في المتصفح.

نوع الحدث `contractor_claim`، والمبلغ هو **المتبقي** من المستخلص بعد FIFO الدفعات
لا مبلغه الأصلي — مستخلص مسدَّد بالكامل لا يظهر (لا شيء يُستحق منه).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session, selectinload

from app.db import models
from app.domain.payables import D, money
from app.services import contractors_service as CS

CONTRACTOR_CLAIM_EVENT = 'contractor_claim'


def contractor_claim_events(db: Session, date_from: Optional[dt.date] = None,
                            date_to: Optional[dt.date] = None,
                            today: Optional[dt.date] = None,
                            project: Optional[str] = None) -> List[dict]:
    """أحداث استحقاق المستخلصات ضمن [date_from, date_to] — للمقاولين ذوي المدة فقط.

    بلا حدود تاريخ تعود كل الاستحقاقات المفتوحة (متأخرة وقادمة). التصفية بالمشروع
    على مشروع المستخلص نفسه (ContractorEntry.project) لا على لائحة مشاريع المقاول —
    التقويم يجيب «ماذا يستحق على هذا المشروع» لا «من يعمل فيه».
    """
    today = today or dt.date.today()
    rows = (db.query(models.Contractor)
            .filter(models.Contractor.deleted_at.is_(None),
                    models.Contractor.payment_term_days.isnot(None))
            .options(selectinload(models.Contractor.entries)).all())
    out: List[dict] = []
    for row in rows:
        delay = CS.contractor_delay(row, CS._live_entries(row), today)
        if delay is None:
            continue
        for c in delay.claims:
            if c.remaining <= 0:
                continue
            if date_from is not None and c.due_date < date_from:
                continue
            if date_to is not None and c.due_date > date_to:
                continue
            if project and (c.project or '') != project:
                continue
            out.append(dict(type=CONTRACTOR_CLAIM_EVENT, date=c.due_date.isoformat(),
                            code=row.code, name=row.name, claimNo=c.claim_no, doc=c.doc,
                            project=c.project, claimDate=c.date.isoformat(),
                            amount=money(c.remaining), daysLate=c.days_late,
                            overdue=c.days_late > 0))
    out.sort(key=lambda e: (e['date'], e['name']))
    return out


def contractor_claim_events_json(db: Session, date_from: Optional[dt.date] = None,
                                 date_to: Optional[dt.date] = None,
                                 project: Optional[str] = None) -> dict:
    events = contractor_claim_events(db, date_from, date_to, project=project)
    total = sum((D(e['amount']) for e in events), Decimal('0'))
    overdue = sum((D(e['amount']) for e in events if e['overdue']), Decimal('0'))
    return dict(rows=events, count=len(events),
                totals=dict(amount=money(total), overdue=money(overdue)))
