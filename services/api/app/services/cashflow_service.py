# -*- coding: utf-8 -*-
"""يربط قاعدة البيانات بحسابات التدفق النقدي الصرفة (domain/cashflow.py)."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain import cashflow as C
from app.domain.payables import D, money
from app.services import payables_service as PS

NO_RECEIVABLES_WARNING = 'لم تُرفع بيانات التحصيلات بعد — التدفق الداخل صفر ولا يمثل توقعاً حقيقياً'
UNDATED_RECEIVABLES_WARNING = (
    'التحصيلات المرفوعة ({n} سجلاً) بلا تواريخ استحقاق — لا يمكن توقّع موعد دخولها، '
    'والتدفق الداخل أدناه صفر لهذا السبب لا لأنه لا يوجد مستحق لنا')
PAST_RECEIVABLES_WARNING = (
    'كل التحصيلات المفتوحة تواريخها قبل بداية المدى المعروض — لا يوجد داخل متوقّع فيه، '
    'وهي معروضة في سطر «متأخر الآن» بالمطابقة أسفل الجدول')
ALL_COLLECTED_WARNING = (
    'كل التحصيلات المرفوعة ({n} سجلاً) محصَّلة بالفعل — التحصيل تاريخٌ لا توقّع، '
    'فالتدفق الداخل أدناه صفر لهذا السبب')

OVERDUE_OUTFLOW_WARNING = (
    'متأخر الآن {amount} ر.س — استحقاقه مضى قبل بداية الجدول فلا دلو له، وهو غير محسوب '
    'في الرصيد التراكمي أدناه؛ لو سُدِّد اليوم لصار أدنى رصيد {min_balance} ر.س')
UNDATED_OUTFLOW_WARNING = (
    'بلا تواريخ استحقاق {amount} ر.س — لا يمكن وضعه في أي فترة، وهو مُدرَج في سطر '
    'المطابقة أسفل جدول الفترات لا في أعمدته')

ZERO = Decimal('0')


def _ar_money(x: Decimal) -> str:
    """رقم بفاصلة آلاف داخل نص تحذير — نفس تقريب money() حتى لا يختلف عن المعروض."""
    return '{:,.2f}'.format(money(x))


def _receivable_items(db: Session, project: Optional[str] = None):
    """Returns (items, stats).

    An inflow forecast may only contain money that has NOT arrived yet: a row with
    status='collected' is history, not a prediction. The previous version dated every
    row by `collected_on or due_date` and bucketed it, so an already-collected payment
    reappeared as future income and inflated the forecast — the exact divergence the
    التحصيلات screen (which reports it under «المحصّل») made visible. Only OPEN rows
    carrying a due date can be placed on the timeline.

    `stats` counts the OPEN population only (total / dated / undated) because that is
    what the warnings talk about; `collected` is reported alongside so a "no inflow"
    message can say *why* without lying about the file being empty.

    When `project` is given, only receivables belonging to that project are counted —
    both in the items placed on the timeline and in the stats used for the warnings,
    so the honesty messages stay true to the filtered scope, not the whole company.
    """
    q = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None))
    if project:
        q = q.filter(models.Receivable.project == project)
    rows = q.all()
    open_rows = [r for r in rows if r.status != 'collected']
    items = []
    undated = 0
    for r in open_rows:
        if r.due_date is None:
            undated += 1
            continue
        items.append(C.CashItem(date=r.due_date, amount=D(r.amount)))
    return items, dict(total=len(open_rows), dated=len(items), undated=undated,
                       collected=len(rows) - len(open_rows))


def _split(items, from_date: dt.date, horizon_end: dt.date) -> dict:
    """يقسّم بنوداً مؤرَّخة إلى: قبل الجدول / داخله / بعده — كل ريال في خانة واحدة."""
    before = sum((it.amount for it in items if it.date < from_date), ZERO)
    inside = sum((it.amount for it in items if from_date <= it.date <= horizon_end), ZERO)
    after = sum((it.amount for it in items if it.date > horizon_end), ZERO)
    return dict(overdue=before, scheduled=inside, beyond=after)


def _receivable_reconciliation(db, project, from_date, horizon_end) -> dict:
    """المطابقة مع شاشة التحصيلات: المجدول + المتأخر + خارج الأفق + بلا تواريخ = المفتوح."""
    q = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None))
    if project:
        q = q.filter(models.Receivable.project == project)
    rows = [r for r in q.all() if r.status != 'collected']
    dated = [C.CashItem(date=r.due_date, amount=D(r.amount)) for r in rows if r.due_date]
    undated = sum((D(r.amount) for r in rows if r.due_date is None), ZERO)
    parts = _split(dated, from_date, horizon_end)
    open_total = sum((D(r.amount) for r in rows), ZERO)
    d = dict(scheduled=parts['scheduled'], overdueNow=parts['overdue'],
             beyondHorizon=parts['beyond'], undated=undated, openTotal=open_total)
    d['difference'] = (d['scheduled'] + d['overdueNow'] + d['beyondHorizon'] + d['undated']
                       - open_total)
    return d


def _payable_items(db: Session, today: dt.date, project: Optional[str] = None):
    ps = PS.positions(db, today=today, project=project, include_empty=True)
    items = []
    for p in ps:
        for inv in p.invoices:
            if inv.remaining > 0 and inv.due_date is not None:
                items.append(C.CashItem(date=inv.due_date, amount=inv.remaining))
    return items


def _supplier_reconciliation(db, today, project, from_date, horizon_end) -> dict:
    """المطابقة مع شاشة الموردين، بالهللة.

    مديونية شاشة الموردين = Σ(الفواتير − المدفوعات) لكل مورد. الفواتير المفتوحة تتوزّع
    على أربع خانات لا خامسة لها: مجدولة داخل الجدول، متأخرة الآن (استحقاقها قبل بداية
    الجدول فلا دلو لها)، بعد نهاية الأفق المعروض، وبلا تاريخ استحقاق أصلاً (بنود
    «مستخلص» التي لم يُدخَل لها تاريخ يدوي — لا يمكن جدولتها بأمانة).
    ويُطرح منها رصيد المورد الدائن (مورد دُفع له أكثر مما فوتر) لأن مديونية الشاشة
    تجمعه بالسالب بينما المتبقي على الفواتير لا ينزل تحت الصفر.
    """
    ps = PS.positions(db, today=today, project=project, include_empty=True)
    dated, undated, credits = [], ZERO, ZERO
    for p in ps:
        for inv in p.invoices:
            if inv.remaining <= 0:
                continue
            if inv.due_date is None:
                undated += inv.remaining
            else:
                dated.append(C.CashItem(date=inv.due_date, amount=inv.remaining))
        credits += p.credit_balance
    parts = _split(dated, from_date, horizon_end)
    outstanding = sum((p.outstanding for p in ps), ZERO)
    # ملاحظة (هذه المهمة): p.outstanding أصبح دائماً >= 0 (توزيع FIFO يوقف "المتبقي"
    # عند صفر لكل فاتورة أصلاً)، فمجموع outstanding يساوي مجموع بنود الجدول تماماً —
    # لم يعد يحتاج طرح credits لتصحيح فجوة سالبة كما كان سابقاً. credits تبقى في
    # الاستجابة كمعلومة (رصيد لنا المقدم) لكنها لا تدخل معادلة الفرق.
    d = dict(scheduled=parts['scheduled'], overdueNow=parts['overdue'],
             beyondHorizon=parts['beyond'], undated=undated, credits=credits,
             outstanding=outstanding)
    d['difference'] = (d['scheduled'] + d['overdueNow'] + d['beyondHorizon'] + d['undated']
                       - outstanding)
    return d


def _scoped_contractors(db: Session, project: Optional[str] = None) -> list:
    """المقاولون ضمن نطاق المشروع، إن حُدِّد.

    تقريب موثَّق: يُعتبر المقاول تابعاً للمشروع المفلتَر إن حملت أي حركة من حركات
    دفتره ذلك المشروع (entry.project) — المقاول غالباً يعمل في أكثر من مشروع
    فلا يوجد رصيد "خاص بمشروع" دقيق في دفتر الحساب نفسه، فهذا أفضل تقريب متاح.
    """
    q = db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None))
    if not project:
        return q.all()
    ids = {cid for (cid,) in db.query(models.ContractorEntry.contractor_id)
           .filter(models.ContractorEntry.project == project).distinct()}
    return [c for c in q.all() if c.id in ids]


def _guarantee_due(g) -> Optional[dt.date]:
    """تاريخ الإفراج المحسوب — الصريح، وإلا الانتهاء + مدة الضمان، وإلا لا شيء."""
    if g.release_due is not None:
        return g.release_due
    if g.finished_on is not None and g.guarantee_days is not None:
        return g.finished_on + dt.timedelta(days=g.guarantee_days)
    return None


def _contractor_flow(db: Session, contractors: list, from_date: dt.date,
                     horizon_end: dt.date) -> tuple:
    """يرجع (بنود الخارج المجدولة، مطابقة المقاولين) — مطابقة تامّة مع شاشة المقاولين.

    شاشة المقاولين تعرض `owedToContractors` = Σ |الرصيد السالب| لكل مقاول حيّ، حيث
    الرصيد = Σ مدين − Σ دائن على حركات غير محذوفة. نفس المجموعة بالضبط تُستعمل هنا
    (النسخة السابقة كانت تُهمل `deleted_at` على المقاول والحركة والضمان معاً، فتنحرف
    عن الشاشة بصمت).

    التوزيع يتم **لكل مقاول على حدة** لا إجمالاً: ضماناته المؤرَّخة تُصنَّف (متأخرة /
    مجدولة / بعد الأفق)، والباقي من رصيده المستحق يُعتبر «بلا تواريخ». وإن تجاوزت
    ضماناته رصيده المستحق فالفائض يُسجَّل صراحةً في `excess` بدل أن يُبتلع بأرضية
    `max(0, …)` إجمالية تُخفي عدم التطابق.
    """
    ids = [c.id for c in contractors]
    owed = {}
    if ids:
        rows = db.query(models.ContractorEntry.contractor_id,
                        models.ContractorEntry.debit, models.ContractorEntry.credit) \
            .filter(models.ContractorEntry.contractor_id.in_(ids)) \
            .filter(models.ContractorEntry.deleted_at.is_(None)).all()
        bal = {}
        for cid, debit, credit in rows:
            bal[cid] = bal.get(cid, ZERO) + D(debit or 0) - D(credit or 0)
        owed = {cid: -b for cid, b in bal.items() if b < 0}

    items = []
    per = {}
    if ids:
        gq = db.query(models.ContractorGuarantee) \
            .filter(models.ContractorGuarantee.released_on.is_(None)) \
            .filter(models.ContractorGuarantee.deleted_at.is_(None)) \
            .filter(models.ContractorGuarantee.contractor_id.in_(ids))
        for g in gq.all():
            amount = D(g.amount or 0)
            due = _guarantee_due(g)
            if amount <= 0 or due is None:
                continue
            per.setdefault(g.contractor_id, []).append(C.CashItem(date=due, amount=amount))

    scheduled = overdue = beyond = undated = excess = ZERO
    for cid in set(list(per.keys()) + list(owed.keys())):
        parts = _split(per.get(cid, []), from_date, horizon_end)
        covered = parts['scheduled'] + parts['overdue'] + parts['beyond']
        due_i = owed.get(cid, ZERO)
        scheduled += parts['scheduled']
        overdue += parts['overdue']
        beyond += parts['beyond']
        if covered < due_i:
            undated += due_i - covered
        else:
            excess += covered - due_i
        items += [it for it in per.get(cid, []) if from_date <= it.date <= horizon_end]

    owed_total = sum(owed.values(), ZERO)
    recon = dict(scheduled=scheduled, overdueNow=overdue, beyondHorizon=beyond,
                 undated=undated, excess=excess, owedToContractors=owed_total)
    recon['difference'] = scheduled + overdue + beyond + undated - excess - owed_total
    return items, recon


_OUTFLOW_TERMS = ('scheduled', 'overdueNow', 'beyondHorizon', 'undated')


def _combine_outflow(supplier_recon: Optional[dict], contractor_recon: Optional[dict]) -> dict:
    """يجمع طرفَي الخارج المشمولَين في هذا الطلب في معادلة واحدة معروضة على الشاشة."""
    out = {k: ZERO for k in _OUTFLOW_TERMS}
    out['credits'] = ZERO        # أرصدة دائنة لدى موردين (تخفض المديونية)
    out['excess'] = ZERO         # ضمانات مقاولين تتجاوز رصيدهم المستحق
    out['openDebt'] = ZERO
    for recon, debt_key in ((supplier_recon, 'outstanding'),
                            (contractor_recon, 'owedToContractors')):
        if recon is None:
            continue
        for k in _OUTFLOW_TERMS:
            out[k] += recon[k]
        out['credits'] += recon.get('credits', ZERO)
        out['excess'] += recon.get('excess', ZERO)
        out['openDebt'] += recon[debt_key]
    out['difference'] = (out['scheduled'] + out['overdueNow'] + out['beyondHorizon']
                         + out['undated'] - out['credits'] - out['excess'] - out['openDebt'])
    return out


def _recon_json(d: Optional[dict]) -> Optional[dict]:
    if d is None:
        return None
    return {k: money(v) for k, v in d.items()}


def _known_projects(db: Session) -> list:
    """Distinct supplier ∪ receivable projects, sorted — feeds the UI selector.

    Always company-wide (never filtered) so the selector can offer every project
    regardless of which one is currently applied.
    """
    supplier_projects = {p for (p,) in db.query(models.Supplier.project)
                         .filter(models.Supplier.deleted_at.is_(None)).distinct() if p}
    receivable_projects = {p for (p,) in db.query(models.Receivable.project)
                           .filter(models.Receivable.deleted_at.is_(None)).distinct() if p}
    return sorted(supplier_projects | receivable_projects)


def cashflow(db: Session, weeks: int = 26, from_date: Optional[dt.date] = None,
            opening_balance: float = 0.0, today: Optional[dt.date] = None,
            project: Optional[str] = None, parties: str = 'suppliers',
            period_days: int = C.PERIOD_DAYS) -> dict:
    """`parties` — 'suppliers' (default, matches the pre-existing behaviour byte for
    byte), 'contractors', or 'both'. See the route docstring for the project ↔
    contractor attribution caveat.

    `period_days` — bucket length in days, default 14 (matches the pre-existing
    behaviour byte for byte). Range validation (1..92) is the route's job; this
    layer just threads the value through to `build_periods`.
    """
    today = today or dt.date.today()
    from_date = from_date or today
    horizon_end = C.horizon_end(from_date, weeks, period_days)

    recv_items, recv_stats = _receivable_items(db, project=project)
    recv_recon = _receivable_reconciliation(db, project, from_date, horizon_end)

    pay_items = []
    supplier_recon = None
    contractor_recon = None
    undated_contractor_dues = ZERO
    if parties in ('suppliers', 'both'):
        pay_items += _payable_items(db, today, project=project)
        supplier_recon = _supplier_reconciliation(db, today, project, from_date, horizon_end)
    if parties in ('contractors', 'both'):
        scoped = _scoped_contractors(db, project=project)
        guarantee_items, contractor_recon = _contractor_flow(db, scoped, from_date, horizon_end)
        pay_items += guarantee_items
        undated_contractor_dues = contractor_recon['undated']

    periods = C.build_periods(recv_items, pay_items, from_date, weeks, D(opening_balance),
                              period_days=period_days)

    total_inflow = sum((p.inflow for p in periods), Decimal('0'))
    # "Do we have usable income data?" — not "do rows exist?". A green flag over a zero
    # inflow is exactly how a forecast starts lying.
    has_usable = recv_stats['dated'] > 0 and total_inflow > 0
    summary = C.summarise(periods, has_usable)

    warnings = []
    # كل رسالة تحت هذا السطر يجب أن تصف الأرقام المعادة في نفس الحمولة — لا رسالة
    # «لا توجد بيانات» فوق ملف فيه صفوف، ولا العكس.
    if recv_stats['total'] == 0:
        warnings.append(ALL_COLLECTED_WARNING.format(n=recv_stats['collected'])
                        if recv_stats['collected'] > 0 else NO_RECEIVABLES_WARNING)
    elif recv_stats['dated'] == 0:
        warnings.append(UNDATED_RECEIVABLES_WARNING.format(n=recv_stats['total']))
    elif total_inflow == 0:
        warnings.append(PAST_RECEIVABLES_WARNING)

    outflow_recon = _combine_outflow(supplier_recon, contractor_recon)
    if outflow_recon['overdueNow'] > 0:
        warnings.append(OVERDUE_OUTFLOW_WARNING.format(
            amount=_ar_money(outflow_recon['overdueNow']),
            min_balance=_ar_money(summary['min_balance'] - outflow_recon['overdueNow'])))
    if outflow_recon['undated'] > 0:
        warnings.append(UNDATED_OUTFLOW_WARNING.format(amount=_ar_money(outflow_recon['undated'])))

    fd = summary['first_deficit']
    first_deficit_json = None
    if fd is not None:
        first_deficit_json = {'label': fd.label, 'from': fd.from_date.isoformat(),
                              'to': fd.to_date.isoformat(), 'amount': money(fd.balance)}

    return dict(
        asOf=today.isoformat(),
        openingBalance=money(opening_balance),
        periodDays=period_days,
        periods=[{
            'label': p.label, 'from': p.from_date.isoformat(), 'to': p.to_date.isoformat(),
            'inflow': money(p.inflow), 'outflow': money(p.outflow), 'net': money(p.net),
            'balance': money(p.balance), 'inflowCount': p.inflow_count,
            'outflowCount': p.outflow_count, 'deficit': p.deficit,
        } for p in periods],
        summary=dict(
            totalInflow=money(summary['total_inflow']), totalOutflow=money(summary['total_outflow']),
            netTotal=money(summary['net_total']), minBalance=money(summary['min_balance']),
            firstDeficit=first_deficit_json, hasReceivables=has_usable,
                     receivablesStats=recv_stats,
        ),
        warnings=warnings,
        projects=_known_projects(db),
        parties=parties,
        undatedContractorDues=money(undated_contractor_dues),
        # المطابقة — كل رقم هنا يجب أن يساوي ما تعرضه الشاشة الأخرى بالهللة، و`difference`
        # صفر دائماً. تُعرض على الشاشة كمعادلة صريحة بدل أن يُترك الفرق صامتاً.
        reconciliation=dict(
            **{'from': from_date.isoformat()},
            horizonEnd=horizon_end.isoformat(),
            outflow=_recon_json(outflow_recon),
            suppliers=_recon_json(supplier_recon),
            contractors=_recon_json(contractor_recon),
            inflow=_recon_json(recv_recon),
        ),
    )
