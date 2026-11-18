# -*- coding: utf-8 -*-
"""`GET /today` — الصفحة الرئيسية بطلب واحد.

كل رقم منقول من محرك قائم (overview، positions، contractors_list_json، المشاريع)
عبر لقطة الطلب (request_cache) فلا يُحسب شيء مرتين ولا يختلف رقم هنا عن شاشته
الأصلية. الجديد فقط: الإسقاط اليومي لثلاثين يوماً (من نفس بنود الاستحقاق التي
يستعملها /cashflow) وأعمار الدين من تاريخ الفاتورة (تعريف النموذج المعتمد).
"""
from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import D
from app.services import contractors_service as CS
from app.services import payables_service as PS
from app.services import settings_service as SS
from app.services.money_wire import money_str, money_str_or_none

ZERO = Decimal('0')
STALE_DAYS = 60
MAX_TASKS = 12
_SEV_ORDER = {'danger': 0, 'warn': 1, 'info': 2, 'ok': 3}


# ---------------------------------------------------------------- لقطة الإجماليات

def totals_snapshot(db: Session, today: Optional[dt.date] = None) -> dict:
    """إجماليات + مجموعات معرّفات الفواتير (للمقارنة قبل/بعد الرفع، لا تُخزَّن)."""
    today = today or dt.date.today()
    ps = PS.positions(db, today=today, include_empty=True)
    t = CS.contractors_list_json(db, today)['totals']
    inv_ids = set()
    open_ids = set()
    for p in ps:
        for i in p.invoices:
            inv_ids.add(i.id)
            if i.remaining > 0:
                open_ids.add(i.id)
    return dict(
        supplierOpen=money_str(sum((p.outstanding for p in ps), ZERO)),
        supplierOverdue=money_str(sum((p.overdue for p in ps), ZERO)),
        supplierDue7=money_str(sum((p.due_within_7 for p in ps), ZERO)),
        contractorOwed=money_str(D(t['owedToContractors'])),
        contractorOverdue=money_str(D(t['overdueTotal'])),
        invoiceCount=len(inv_ids), openInvoiceCount=len(open_ids),
        _invoiceIds=inv_ids, _openIds=open_ids)


def public_totals(snap: dict) -> dict:
    return {k: v for k, v in snap.items() if not k.startswith('_')}


# ---------------------------------------------------------------- الإسقاط النقدي

def cash_projection(db: Session, today: dt.date, days: int = 30) -> dict:
    """رصيد يومي لـ`days` يوماً من اليوم: الموردون (المتبقي حسب الاستحقاق) والتحصيلات.

    المتأخر (استحقاق ≤ اليوم) يقع كله على اليوم الأول — هو مستحق الآن فعلاً. بلا
    رصيد بنكي يبدأ من صفر ويقول ذلك (basis) بدل أن يوهم برصيد.
    """
    bank = SS.bank_balance(db)
    start = bank if bank is not None else ZERO
    delta: Dict[int, Decimal] = {}
    for p in PS.positions(db, today=today, include_empty=True):
        for i in p.invoices:
            if i.remaining <= 0 or i.due_date is None:
                continue
            off = max(0, (i.due_date - today).days)
            if off < days:
                delta[off] = delta.get(off, ZERO) - D(i.remaining)
    for r in db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None)).all():
        if r.status == 'collected' or r.due_date is None:
            continue
        off = max(0, (r.due_date - today).days)
        if off < days:
            delta[off] = delta.get(off, ZERO) + D(r.amount or 0)
    out = []
    bal = start
    for k in range(days):
        bal += delta.get(k, ZERO)
        out.append(dict(date=today + dt.timedelta(days=k), balance=bal))
    return dict(days=out, basis='bank' if bank is not None else 'no_bank_balance', bank=bank)


# ---------------------------------------------------------------- الحداثة

def staleness(db: Session, today: dt.date) -> dict:
    logs: Dict[str, models.ImportLog] = {}
    for l in db.query(models.ImportLog).filter(models.ImportLog.deleted_at.is_(None)).all():
        if l.account and (l.account not in logs or (l.created_at or dt.datetime.min) >
                          (logs[l.account].created_at or dt.datetime.min)):
            logs[l.account] = l
    rows = []
    newest = None
    for p in PS.positions(db, today=today, include_empty=True):
        dates = [i.date for i in p.invoices] + [x.date for x in p.payments]
        for i in p.invoices:
            if newest is None or i.date > newest:
                newest = i.date
        rows.append(_cov('supplier', p.supplier.account, p.supplier.name,
                         max(dates) if dates else None, logs, today))
    for c in db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None)).all():
        dates = [e.date for e in CS._live_entries(c)]
        rows.append(_cov('contractor', c.code, c.name, max(dates) if dates else None, logs, today))
    rows.sort(key=lambda r: (r['lastActivityDays'] is not None,
                             -(r['lastActivityDays'] or 0), r['name']))
    return dict(newestInvoiceDays=(today - newest).days if newest else None,
                newestInvoiceDate=newest.isoformat() if newest else None,
                coverage=rows)


def _cov(ptype, pid, name, last, logs, today) -> dict:
    l = logs.get(pid)
    days = (today - last).days if last else None
    return dict(partyType=ptype, partyId=pid, name=name,
                lastActivity=last.isoformat() if last else None, lastActivityDays=days,
                lastImportAt=l.created_at.replace(microsecond=0).isoformat()
                if l is not None and l.created_at else None,
                file=(l.path.rsplit('/', 1)[-1] if l is not None and l.path else None),
                stale=days is None or days > STALE_DAYS)


# ---------------------------------------------------------------- المهام والجودة

_ALERT_VIEW = {'needs_term': 'suppliers', 'contractors_without_statement': 'contractors',
               'contractors_overdue': 'contractors'}


def _quality(alerts: List[dict]) -> List[dict]:
    out = []
    for a in alerts:
        sev = {'warning': 'warn'}.get(a.get('level'), a.get('level') or 'info')
        view = _ALERT_VIEW.get(a.get('kind') or '')
        if view is None:
            text = a.get('text', '')
            view = 'cash' if 'عجز' in text or 'التحصيلات' in text else (
                'import' if 'كشوف' in text or 'حركة' in text else 'suppliers')
        out.append(dict(severity=sev, text=a.get('text', ''), view=view))
    return out


def _tasks(db: Session, today: dt.date, cash: dict, needs_term: int) -> List[dict]:
    tasks: List[dict] = []
    for p in PS.positions(db, today=today, include_empty=False):
        if p.overdue > 0:
            tasks.append(dict(id=f'overdue:supplier:{p.supplier.account}', severity='danger',
                              title=f'سداد متأخر — {p.supplier.name}',
                              detail=f'متأخر حتى {p.delay.days} يوماً',
                              amount=money_str(p.overdue),
                              action=dict(label='افتح المورد', view='supplier',
                                          params={'id': p.supplier.account})))
    for r in CS.contractors_list_json(db, today)['rows']:
        ov = r.get('overdue')
        if r.get('paymentTermDays') is not None and ov and D(ov['amount']) > 0:
            tasks.append(dict(id=f'overdue:contractor:{r["code"]}', severity='danger',
                              title=f'مستخلص متأخر — {r["name"]}', detail='',
                              amount=money_str(D(ov['amount'])),
                              action=dict(label='افتح المقاول', view='contractor',
                                          params={'id': r['code']})))
    for g in db.query(models.ContractorGuarantee).filter(
            models.ContractorGuarantee.deleted_at.is_(None),
            models.ContractorGuarantee.released_on.is_(None)).all():
        due, _ = CS.guarantee_release(g, today)
        c = g.contractor
        if due is None or c is None or c.deleted_at is not None or (due - today).days > 7:
            continue
        tasks.append(dict(id=f'guarantee:{g.id}', severity='warn',
                          title=f'ضمان يحين فكّه — {c.name}',
                          detail=f'{g.project or ""} · {due.isoformat()}',
                          amount=money_str(D(g.amount or 0)),
                          action=dict(label='الضمانات', view='guarantees', params={'id': g.id})))
    first = next((d for d in cash['days'] if d['balance'] < 0), None)
    if first is not None:
        tasks.append(dict(id='deficit', severity='danger', title='عجز نقدي متوقع',
                          detail=f'يبدأ {first["date"].isoformat()}',
                          amount=money_str(first['balance']),
                          action=dict(label='التدفق النقدي', view='cash', params={})))
    if needs_term:
        tasks.append(dict(id='needs_term', severity='warn',
                          title='موردون بلا مدة سداد', detail=f'{needs_term} مورد',
                          amount=None, action=dict(label='حدّد المدة', view='suppliers',
                                                   params={'filter': 'needs_term'})))
    tasks.sort(key=lambda t: (_SEV_ORDER.get(t['severity'], 9),
                              -(D(t['amount']) if t['amount'] is not None else ZERO)))
    return tasks[:MAX_TASKS]


# ---------------------------------------------------------------- التجميع

def _aging(db: Session, today: dt.date) -> dict:
    a = dict(d0_30=ZERO, d31_60=ZERO, d61_90=ZERO, d90p=ZERO)
    for p in PS.positions(db, today=today, include_empty=False):
        for i in p.invoices:
            if i.remaining <= 0:
                continue
            age = (today - i.date).days
            k = 'd0_30' if age <= 30 else 'd31_60' if age <= 60 else 'd61_90' if age <= 90 else 'd90p'
            a[k] += D(i.remaining)
    return {k: money_str(v) for k, v in a.items()}


def _last_change(db: Session) -> Optional[dict]:
    s = (db.query(models.ChangeSnapshot).filter(models.ChangeSnapshot.deleted_at.is_(None))
         .order_by(models.ChangeSnapshot.at.desc()).first())
    if s is None:
        return None
    return dict(at=s.at.replace(microsecond=0).isoformat(), file=s.file,
                before=json.loads(s.before_json or '{}'), after=json.loads(s.after_json or '{}'),
                newInvoices=s.new_invoices, paidInvoices=s.paid_invoices)


def today_json(db: Session, today: Optional[dt.date] = None) -> dict:
    from app.services import events_service, overview_service, projects_service
    from app.services import project_registry_service as PR
    today = today or dt.date.today()
    ov = overview_service.overview(db, today)
    ps = PS.positions(db, today=today, include_empty=True)
    cash = cash_projection(db, today, 30)
    low = min(cash['days'], key=lambda d: d['balance'])
    first = next((d for d in cash['days'] if d['balance'] < 0), None)
    bank = SS.bank_balance_json(db)
    c = ov['contractors']
    kpis = dict(
        # من positions مباشرة بـDecimal (لا من floats المقرَّبة في overview)
        supplierOpen=money_str(sum((p.outstanding for p in ps), ZERO)),
        supplierOverdue=money_str(sum((p.overdue for p in ps), ZERO)),
        supplierDue7=money_str(sum((p.due_within_7 for p in ps), ZERO)),
        contractorOwed=money_str(D(c['owedToContractors'])),
        contractorOverdue=money_str(D(c['overdue'])),
        withTerm=c['withTermCount'], withoutTerm=c['withoutTermCount'],
        bankBalance=bank['balance'], bankBalanceAt=bank['at'],
        cashLow=money_str(low['balance']), cashLowDate=low['date'].isoformat(),
        firstDeficitDate=first['date'].isoformat() if first else None)
    rows = projects_service.list_projects(db, today)['rows']
    PR.enrich_project_rows(db, rows)
    projects = [dict(id=r.get('id'), name=r['project'], budgetDelayPct=r.get('budgetDelayPct'),
                     contractValue=r.get('contractValue'), executed=r.get('executed'),
                     margin=r.get('margin')) for r in rows]
    return dict(
        generatedAt=dt.datetime.now().replace(microsecond=0).isoformat(),
        asOf=today.isoformat(),
        lastEventId=events_service.last_event_id(db),
        kpis=kpis,
        tasks=_tasks(db, today, cash, ov['needsTerm']),
        lastChange=_last_change(db),
        staleness=staleness(db, today),
        quality=_quality(ov['alerts']),
        projects=projects,
        aging=_aging(db, today),
        cash30=[dict(date=d['date'].isoformat(), balance=money_str(d['balance']))
                for d in cash['days']],
        cashBasis=cash['basis'],
    )


def supplier_open_as_of(db: Session, as_of: dt.date) -> Decimal:
    """رصيد الموردين المفتوح كما كان في `as_of`: حركات حتى ذلك التاريخ فقط، نفس المحرك."""
    from app.domain import payables as P
    total = ZERO
    for row in db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None)).all():
        invs = [P.Invoice(date=i.date, amount=i.amount, number=i.number, doc=i.doc,
                          description=i.description, id=i.id, source=i.source or 'statement',
                          manual_due_date=i.manual_due_date)
                for i in row.invoices if i.deleted_at is None and i.date <= as_of]
        pays = [P.Payment(date=x.date, amount=x.amount, doc=x.doc, description=x.description,
                          id=x.id, source=x.source or 'statement')
                for x in row.payments if x.deleted_at is None and x.date <= as_of]
        if not invs and not pays:
            continue
        total += P.position(PS._supplier(row), invs, pays, as_of).outstanding
    return total


def gm_report(db: Session, today: Optional[dt.date] = None) -> dict:
    """تقرير المدير العام — كل ما تطبعه الشرائح بلا حساب في المتصفح."""
    from app.services import budget_service as BS
    today = today or dt.date.today()
    ps = PS.positions(db, today=today, include_empty=True)
    open_now = sum((p.outstanding for p in ps), ZERO)
    prev_date = today - dt.timedelta(days=30)
    prev = supplier_open_as_of(db, prev_date)
    cash = cash_projection(db, today, 30)
    low = min(cash['days'], key=lambda d: d['balance'])
    first = next((d for d in cash['days'] if d['balance'] < 0), None)
    recs = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None)).all()
    r_open = sum((D(r.amount or 0) for r in recs if r.status != 'collected'), ZERO)
    r_over = sum((D(r.amount or 0) for r in recs if r.status != 'collected'
                  and r.due_date is not None and r.due_date < today), ZERO)
    r_in30 = sum((D(r.amount or 0) for r in recs if r.status != 'collected'
                  and r.due_date is not None and today <= r.due_date <= today + dt.timedelta(days=30)), ZERO)
    r_month = sum((D(r.amount or 0) for r in recs if r.status == 'collected' and r.collected_on
                   and r.collected_on.year == today.year and r.collected_on.month == today.month), ZERO)
    budget = []
    latest: Dict[str, dict] = {}
    for r in BS.budget_list_json(db)['rows']:
        if r['project'] not in latest or r['month'] > latest[r['project']]['month']:
            latest[r['project']] = r
    for r in sorted(latest.values(), key=lambda r: r['project']):
        budget.append(dict(project=r['project'], month=r['month'], delayPct=r.get('delayPct'),
                           cumPlanned=money_str_or_none(r.get('cumPlanned')),
                           cumActual=money_str_or_none(r.get('cumActual'))))
    gexp = []
    for g in db.query(models.ContractorGuarantee).filter(
            models.ContractorGuarantee.deleted_at.is_(None),
            models.ContractorGuarantee.released_on.is_(None)).all():
        due, _ = CS.guarantee_release(g, today)
        c = g.contractor
        if due is None or c is None or c.deleted_at is not None or (due - today).days > 30:
            continue
        gexp.append(dict(id=g.id, contractorCode=c.code, contractorName=c.name,
                         project=g.project or '', amount=money_str(D(g.amount or 0)),
                         releaseDue=due.isoformat()))
    gexp.sort(key=lambda x: x['releaseDue'])
    t = CS.contractors_list_json(db, today)['totals']
    return dict(
        asOf=today.isoformat(),
        supplierOpen=money_str(open_now), supplierOpenPrevMonth=money_str(prev),
        supplierOpenPrevMonthDate=prev_date.isoformat(),
        supplierOpenChange=money_str(open_now - prev),
        contractorOwed=money_str(D(t['owedToContractors'])),
        bank=SS.bank_balance_json(db),
        cash30=[dict(date=d['date'].isoformat(), balance=money_str(d['balance']))
                for d in cash['days']],
        cashLow=money_str(low['balance']), cashLowDate=low['date'].isoformat(),
        firstDeficitDate=first['date'].isoformat() if first else None, cashBasis=cash['basis'],
        collections=dict(open=money_str(r_open), overdue=money_str(r_over),
                         in30=money_str(r_in30), collectedThisMonth=money_str(r_month)),
        budget=budget, guaranteesExpiring=gexp)
