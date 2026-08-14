# -*- coding: utf-8 -*-
"""استخراج التحليل — على مستوى الشركة أو مورد واحد أو مشروع واحد."""
from typing import List, Optional
import datetime as dt
import hashlib
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import parse_date
from app.db import models
from app.db.session import get_session
from app.services import (contractor_report_service, export_service, payables_service,
                          periods_service, report_service)

router = APIRouter()

UNASSIGNED = 'غير محدد'

PARTIES = ('suppliers', 'contractors', 'both')

#: عنوان النطاق حسب الأطراف — the header must never overstate what it covers.
PARTY_LABELS = dict(suppliers='كل الموردين', contractors='كل المقاولين',
                    both='الموردون والمقاولون')


def _parties(value: Optional[str]) -> str:
    """'suppliers' (default, backward compatible) | 'contractors' | 'both'."""
    if value is None or value == '':
        return 'suppliers'
    if value not in PARTIES:
        raise HTTPException(422, detail=f'قيمة parties غير صالحة: {value}')
    return value


def _contractor_row(db: Session, code: str) -> models.Contractor:
    row = db.query(models.Contractor).filter_by(code=code).filter(
        models.Contractor.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مقاول بالكود {code}')
    return row


def _scoped(db: Session, today: dt.date,
            account: Optional[str], project: Optional[str],
            parties: str = 'suppliers',
            contractor: Optional[str] = None) -> tuple:
    """Positions narrowed to the requested scope, plus a label for the report header.

    Scope is part of the document: a report covering one project — or one contractor —
    must say so on the page, otherwise a printed copy is indistinguishable from the
    company-wide one.

    A `contractor` code forces the report to that single contractor (parties becomes
    'contractors' and no supplier position is loaded).
    """
    if contractor:
        row = _contractor_row(db, contractor)
        return [], dict(kind='contractor', label=f'المقاول: {row.name}',
                        key=contractor, parties='contractors')

    ps = [] if parties == 'contractors' else payables_service.positions(
        db, today, account=account)
    if project:
        ps = [p for p in ps if (p.supplier.project or UNASSIGNED) == project]

    if account:
        name = ps[0].supplier.name if ps else account
        return ps, dict(kind='supplier', label=f'المورد: {name}', key=account,
                        parties=parties)
    if project:
        return ps, dict(kind='project', label=f'المشروع: {project}', key=project,
                        parties=parties)
    return ps, dict(kind='company', label=PARTY_LABELS[parties], key=None,
                    parties=parties)


def _disposition(scope: dict, today: dt.date) -> str:
    """Content-Disposition with both an ASCII fallback and the real Arabic name.

    Transliterating Arabic to ASCII collapses every project to the same slug, so two
    different projects would download as the same file and silently overwrite each
    other. RFC 5987 `filename*` carries the real name; `filename` stays ASCII-unique
    for any client that ignores it.
    """
    stamp = f'{today:%Y%m%d}'
    if scope['kind'] == 'supplier':
        ascii_name = f'EGCO-analysis-{scope["key"]}-{stamp}.xlsx'
        pretty = ascii_name
    elif scope['kind'] == 'contractor':
        # contractor codes are ASCII account numbers, same as suppliers'
        ascii_name = f'EGCO-analysis-contractor-{scope["key"]}-{stamp}.xlsx'
        pretty = ascii_name
    elif scope['kind'] == 'project':
        # short stable suffix keeps the ASCII fallback unique per project
        digest = hashlib.sha1(scope['key'].encode('utf-8')).hexdigest()[:6]
        ascii_name = f'EGCO-analysis-project-{digest}-{stamp}.xlsx'
        pretty = f'EGCO-تحليل-{scope["key"]}-{stamp}.xlsx'
    else:
        ascii_name = f'EGCO-analysis-{stamp}.xlsx'
        pretty = ascii_name

    encoded = quote(pretty, safe='')
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


def _payload(db: Session, today: dt.date, ps: list, scope: dict,
             start, end) -> dict:
    """Report payload for a resolved scope — the one place parties are wired in."""
    parties = scope['parties']
    section = None
    if parties in ('contractors', 'both') or scope['kind'] == 'contractor':
        section = contractor_report_service.section(
            db, today, code=scope['key'] if scope['kind'] == 'contractor' else None)
    payload = report_service.build(ps, today, start, end,
                                   contractors=section, parties=parties)
    payload['meta']['scope'] = scope['kind']
    payload['meta']['scope_label'] = scope['label']
    if scope['kind'] == 'contractor':
        payload['contractorDetail'] = dict(
            partyKind='contractor', code=scope['key'],
            name=payload['contractors']['rows'][0]['name'] if payload['contractors']['rows'] else scope['key'],
            byProject=contractor_report_service.entries_by_project(
                _contractor_row(db, scope['key'])))
    return payload


@router.get('/analysis')
def analysis(account: Optional[str] = Query(None),
             project: Optional[str] = Query(None),
             contractor: Optional[str] = Query(None),
             parties: Optional[str] = Query(None),
             date_from: Optional[str] = Query(None),
             date_to: Optional[str] = Query(None),
             period_from: Optional[str] = Query(None),
             db: Session = Depends(get_session)) -> dict:
    today = dt.date.today()
    ps, scope = _scoped(db, today, account, project, _parties(parties), contractor)
    start = parse_date(date_from, 'تاريخ البداية') or parse_date(period_from, 'الفترة')
    end = parse_date(date_to, 'تاريخ النهاية')
    return _payload(db, today, ps, scope, start, end)


@router.get('/scopes')
def scopes(db: Session = Depends(get_session)) -> dict:
    """قوائم النطاقات المتاحة للتقرير — يملأ قائمة الاختيار في الواجهة."""
    ps = payables_service.positions(db, include_empty=True)
    suppliers = [dict(account=p.supplier.account, name=p.supplier.name,
                      project=p.supplier.project or UNASSIGNED,
                      hasData=bool(p.invoices or p.payments))
                 for p in ps]
    suppliers.sort(key=lambda s: (not s['hasData'], s['name']))
    projects = sorted({s['project'] for s in suppliers})
    contractors = [dict(code=r.code, name=r.name,
                        hasData=any(e.deleted_at is None for e in r.entries))
                   for r in db.query(models.Contractor).filter(
                       models.Contractor.deleted_at.is_(None)).all()]
    contractors.sort(key=lambda c: (not c['hasData'], c['name']))
    return dict(suppliers=suppliers, projects=projects, contractors=contractors,
                parties=list(PARTIES))


@router.get('/periodic')
def periodic(granularity: str = Query('quarter'),
            year: int = Query(...),
            account: Optional[str] = Query(None),
            db: Session = Depends(get_session)) -> dict:
    return periods_service.periodic(db, granularity, year, account)


@router.get('/export.xlsx')
def export_xlsx(granularity: Optional[str] = Query(None),
                year: Optional[int] = Query(None),
                account: Optional[str] = Query(None),
                project: Optional[str] = Query(None),
                contractor: Optional[str] = Query(None),
                parties: Optional[str] = Query(None),
                date_from: Optional[str] = Query(None),
                date_to: Optional[str] = Query(None),
                db: Session = Depends(get_session)):
    today = dt.date.today()
    ps, scope = _scoped(db, today, account, project, _parties(parties), contractor)
    start = parse_date(date_from, 'تاريخ البداية')
    end = parse_date(date_to, 'تاريخ النهاية')
    analysis_payload = _payload(db, today, ps, scope, start, end)

    periodic_payload = None
    if granularity and year and scope['kind'] != 'contractor':
        periodic_payload = periods_service.periodic(db, granularity, year, account)

    content = export_service.build_workbook(
        analysis_payload, periodic_payload,
        contractors_only=(scope['kind'] == 'contractor'))
    headers = {'Content-Disposition': _disposition(scope, today)}
    return StreamingResponse(
        iter([content]),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers=headers,
    )
