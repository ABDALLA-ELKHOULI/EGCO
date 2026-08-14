# -*- coding: utf-8 -*-
"""استخراج التقرير التحليلي — assembles the analysis report payload.

Produces exactly the sections drawn in the Figma screen "S6 — التقرير التحليلي":
letterhead → executive summary → ageing → payment schedule → notes.

This layer only shapes and labels; every number comes from `domain.payables`, so the
report can never disagree with what the screens show.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional, Sequence

from app.domain.payables import SupplierPosition, money as _money_dec, payment_schedule
from app.services.payables_service import period_breakdown

AR_MONTHS = {1:'يناير',2:'فبراير',3:'مارس',4:'أبريل',5:'مايو',6:'يونيو',
             7:'يوليو',8:'أغسطس',9:'سبتمبر',10:'أكتوبر',11:'نوفمبر',12:'ديسمبر'}
AR_DIGITS = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')


def ar_num(v) -> str:
    return str(v).translate(AR_DIGITS)


def ar_date(d: dt.date) -> str:
    return f'{ar_num(d.day)} {AR_MONTHS[d.month]} {ar_num(d.year)}'


def money(v: float) -> str:
    return f'{v:,.2f}'


def _serial(today: dt.date, seq: int = 1) -> str:
    return f'EGC-AP-{today:%Y%m}-{seq:03d}'


def build(positions: Sequence[SupplierPosition], today: dt.date,
          period_from: Optional[dt.date] = None,
          period_to: Optional[dt.date] = None,
          contractors: Optional[dict] = None,
          parties: str = 'suppliers') -> dict:
    """Return the full report payload, ready to render as PDF/Excel or on screen.

    `contractors` is the section produced by contractor_report_service.section() —
    dict(rows, totals, totals_dec). When given, it is attached as payload['contractors']
    and its totals are rolled into the executive summary. Ageing and the payment
    schedule stay supplier-only: contractors carry no due dates, so no bucket may
    claim them.
    """
    zero = Decimal('0')
    total_invoiced = sum((p.total_invoiced for p in positions), zero)
    total_paid = sum((p.total_paid for p in positions), zero)
    outstanding = sum((p.outstanding for p in positions), zero)
    overdue = sum((p.overdue for p in positions), zero)
    within7 = sum((p.due_within_7 for p in positions), zero)

    # افتتاحي + حركة الفترة = ختامي. الحركة يجب أن تكون داخل المدى نفسه؛ استعمال
    # الإجماليات التاريخية بدلها يجعل الثلاثة أرقاماً لا تتصالح على الوثيقة.
    # opening + in-period movement MUST equal closing — all-time totals break the identity.
    if period_from is not None:
        breakdowns = [period_breakdown(p, period_from, period_to) for p in positions]
        opening_balance = sum((b['opening'] for b in breakdowns), zero)
        closing_balance = sum((b['closing'] for b in breakdowns), zero)
        invoiced_in_period = sum((b['invoiced_in_period'] for b in breakdowns), zero)
        paid_in_period = sum((b['paid_in_period'] for b in breakdowns), zero)
        period_str = f'من {ar_date(period_from)} إلى {ar_date(period_to or today)}'
    else:
        opening_balance = zero
        closing_balance = outstanding
        invoiced_in_period = total_invoiced
        paid_in_period = total_paid
        period_str = f'حتى {ar_date(today)}'

    # ---- ageing, aggregated across suppliers
    keys = [('لم يحن موعدها', 'current'), ('متأخر ١–٣٠ يوماً', 'd1_30'),
            ('متأخر ٣١–٦٠ يوماً', 'd31_60'), ('متأخر ٦١–٩٠ يوماً', 'd61_90'),
            ('أكثر من ٩٠ يوماً', 'd90_plus')]
    ageing = []
    for label, attr in keys:
        amount = sum((getattr(p.ageing, attr) for p in positions), zero)
        count = 0
        for p in positions:
            for inv in p.invoices:
                if inv.remaining <= 0 or inv.due_date is None:
                    continue
                late = (today - inv.due_date).days
                bucket = ('current' if late <= 0 else 'd1_30' if late <= 30 else
                          'd31_60' if late <= 60 else 'd61_90' if late <= 90 else 'd90_plus')
                if bucket == attr:
                    count += 1
        ageing.append(dict(label=label, count=count, amount=_money_dec(amount),
                           pct=float(amount / outstanding * 100) if outstanding else 0.0))

    # ---- schedule
    sched = []
    for b in payment_schedule(positions, today, horizon_days=120):
        days = (b['date'] - today).days
        status = (f'متأخر {ar_num(abs(days))} يوماً' if days < 0
                  else 'مستحق اليوم' if days == 0
                  else f'خلال {ar_num(days)} أيام' if days <= 7
                  else f'بعد {ar_num(days)} يوماً')
        # every scheduled document says who it belongs to — a due-date row with no party
        # is unusable in a meeting ("مستحق على مَن؟").
        items = [dict(partyKind='supplier', name=it['supplier'], account=it['account'],
                      invoice=it['invoice'], amount=_money_dec(it['amount']),
                      overdue=bool(it['overdue']))
                 for it in b['items']]
        sched.append(dict(date=b['date'].isoformat(), date_ar=ar_date(b['date']),
                          count=len(b['items']), amount=_money_dec(b['amount']),
                          status=status, overdue=days < 0, items=items))

    # ---- notes: derived from the data, not hardcoded prose
    notes = []
    if any(p.total_paid > 0 for p in positions):
        notes.append(dict(title='توزيع الدفعات',
                          body='كشف الحساب لا يربط الدفعة بفاتورة، فوُزِّع المسدد بطريقة '
                               'الأقدم أولاً (FIFO)، وهي الطريقة التي تعيد إنتاج رصيد الكشف.'))
    if sched:
        outstanding_f = float(outstanding)
        top = max(sched, key=lambda s: s['amount'])
        if outstanding_f and top['amount'] / outstanding_f > 0.5:
            notes.append(dict(title='تركّز الاستحقاق',
                              body=f'{top["amount"]/outstanding_f*100:.1f}٪ من المديونية المفتوحة '
                                   f'تستحق في يوم واحد ({top["date_ar"]}) — يلزم تدبير السيولة قبله.'))
    claims = [p for p in positions if p.needs_manual_due_date]
    if claims:
        notes.append(dict(title='موردو المستخلصات',
                          body=f'{ar_num(len(claims))} مورداً بمدة «مستخلص» لا يُحسب استحقاقهم '
                               'تلقائياً، ويحتاجون إدخال تاريخ يدوياً بعد اعتماد المستخلص.'))

    # ---- contractors: rolled into the summary only when they are in scope
    c_dec = (contractors or {}).get('totals_dec') or {}
    c_invoiced = c_dec.get('invoiced', zero)
    c_paid = c_dec.get('paid', zero)
    c_outstanding = c_dec.get('outstanding', zero)
    if contractors is not None and contractors['rows']:
        notes.append(dict(title='المقاولون خارج جدول الأعمار',
                          body='حسابات المقاولين دفتر جارٍ بلا تواريخ استحقاق، فلا تُدرَج '
                               'في أعمار الديون ولا في جدول الاستحقاقات؛ أرقامهم في '
                               'قسم المقاولون وفي الملخص التنفيذي فقط.'))

    payload = dict(
        meta=dict(
            company='شركة إعمار الخليج المصرية للمقاولات',
            department='الإدارة المالية — الفرع الرئيسي',
            title='تقرير تحليل مديونية الموردين',
            serial=_serial(today),
            issued_on=ar_date(today),
            period=period_str,
            opening_balance=_money_dec(opening_balance),
            closing_balance=_money_dec(closing_balance),
            invoiced_in_period=_money_dec(invoiced_in_period),
            paid_in_period=_money_dec(paid_in_period),
            period_from=period_from.isoformat() if period_from else None,
            period_to=(period_to or today).isoformat(),
            basis='تاريخ الفاتورة + مدة المورد',
            classification='داخلي — للاستخدام الإداري',
            currency='ر.س',
        ),
        summary=dict(total_invoiced=_money_dec(total_invoiced + c_invoiced),
                     total_paid=_money_dec(total_paid + c_paid),
                     outstanding=_money_dec(outstanding + c_outstanding),
                     overdue=_money_dec(overdue),
                     due_within_7=_money_dec(within7),
                     supplier_count=len(positions)),
        ageing=ageing,
        schedule=sched,
        suppliers=[dict(partyKind='supplier',
                        account=p.supplier.account, name=p.supplier.name,
                        project=p.supplier.project, term=p.supplier.term.raw or 'كاش',
                        outstanding=_money_dec(p.outstanding), overdue=_money_dec(p.overdue))
                   for p in sorted(positions, key=lambda x: -x.outstanding)],
        notes=notes,
    )

    if contractors is not None:
        section = dict(rows=contractors['rows'], totals=contractors['totals'])
        payload['contractors'] = section
        payload['summary']['contractor_count'] = contractors['totals']['count']
        payload['summary']['contractor_balance'] = contractors['totals']['balance']
        payload['meta']['parties'] = parties
        payload['meta']['includes'] = dict(suppliers=parties in ('suppliers', 'both'),
                                           contractors=True)
        # honest labelling: the ageing/schedule sections still describe suppliers only.
        payload['meta']['ageing_covers'] = 'suppliers'
        payload['meta']['title'] = ('تقرير تحليل مديونية المقاولين'
                                    if parties == 'contractors'
                                    else 'تقرير تحليل مديونية الموردين والمقاولين')
    return payload
