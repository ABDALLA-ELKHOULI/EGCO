# -*- coding: utf-8 -*-
"""تجميع الموردين حسب المشروع.

م-٢٩: الشاشة كانت تجمع الموردين فقط وتصمت عن مديونية المقاولين — مدير مالي يفتح
«المشاريع» وحدها يظنّ مشروعاً بلا أي التزام رغم أن مقاوليه مدينون بالملايين
(انظر docs/feedback/BACKLOG.md م-٢٩). كل صفّ هنا يحمل الآن مديونية الموردين
**و** مستحق/لنا من المقاولين **و** الالتزام الكلي **و** تأخر الموازنة، بجانب
بعضها — لا في شاشة منفصلة. الأرقام تُستقى حصراً من contractors_service و
budget_service الجاهزتين (لا إعادة حساب هنا)."""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.domain import payables as P
from app.domain.payables import D, money
from app.services import budget_service as BS
from app.services import contractors_service as CS
from app.services import payables_service as PS
from app.utils.arabic import project_key

UNKNOWN_PROJECT = 'غير محدد'


def _project_of(p) -> str:
    return p.supplier.project.strip() if p.supplier.project and p.supplier.project.strip() else UNKNOWN_PROJECT


def _match_key(name: str) -> str:
    """مفتاح مطابقة مشروع لهذه الشاشة — arabic.project_key() (المُضافة من الوكيل
    المسؤول عن م-٣٠) توحّد الإملاء وتتجاهل أل التعريف؛ هنا نزيل المسافات المتبقية
    أيضاً كي تجتمع «سدن» و «السدن » (بمسافة زائدة محتملة) في مفتاح واحد. النتيجة
    للمقارنة فقط — لا تُخزَّن ولا تُعرض، نفس قاعدة arabic.py."""
    return re.sub(r'\s+', '', project_key(name))


def _group(db: Session, today: Optional[dt.date] = None) -> dict:
    today = today or dt.date.today()
    ps = PS.positions(db, today=today, include_empty=True)
    groups: dict = {}
    for p in ps:
        proj = _project_of(p)
        groups.setdefault(proj, []).append(p)
    return groups


def _row_for(project: str, positions: list) -> dict:
    zero = Decimal('0')
    outstanding = sum((p.outstanding for p in positions), zero)
    overdue = sum((p.overdue for p in positions), zero)
    due_within_7 = sum((p.due_within_7 for p in positions), zero)
    total_invoiced = sum((p.total_invoiced for p in positions), zero)
    total_paid = sum((p.total_paid for p in positions), zero)
    open_invoice_count = sum(len([i for i in p.invoices if i.remaining > 0]) for p in positions)
    with_data = len([p for p in positions if p.invoices or p.payments])

    top = sorted(positions, key=lambda p: -p.outstanding)[:3]
    top_suppliers = [dict(account=p.supplier.account, name=p.supplier.name,
                          outstanding=money(p.outstanding)) for p in top]

    return dict(
        project=project,
        supplierCount=len(positions),
        suppliersWithData=with_data,
        outstanding=money(outstanding),
        overdue=money(overdue),
        dueWithin7=money(due_within_7),
        totalInvoiced=money(total_invoiced),
        totalPaid=money(total_paid),
        openInvoiceCount=open_invoice_count,
        topSuppliers=top_suppliers,
        contractorCount=None,
    )


def _contractor_lookup(db: Session, today: Optional[dt.date] = None) -> dict:
    """يبني خريطة {مفتاح_مطبَّع → مجموع مستحق/لنا/عدد/أسماء الصيغ} من
    contractors_service.contractors_list_json(db)['totals']['byProject'] — الدالة
    الجاهزة والمبنية على ContractorEntry.project الحقيقي (لا نُعيد حسابها هنا،
    فقط نُعيد تجميعها بمفتاح يتجاهل «ال» والمسافات كي يجتمع «سدن» و«السدن»)."""
    by_project = CS.contractors_list_json(db, today)['totals']['byProject']
    out: dict = {}
    for b in by_project:
        # حركات مقاولين بلا مشروع مُفصَح عنه (UNASSIGNED_PROJECT_LABEL) — تُدمَج هنا
        # تحت نفس دلو «غير محدد» الذي يجمع موردين بلا مشروع (UNKNOWN_PROJECT)، بدل
        # أن تُستبعد كلياً. بدون هذا كان totals.contractorsOwed هنا يقلّ عن
        # /contractors owedToContractors بمقدار هذا الدلو بالضبط — نفس فكرة توحيد
        # «بلا مشروع/متنوع» في م-٣٠، ونفس شرط التحقق المطلوب (بلا ازدواج ولا نقص).
        name = UNKNOWN_PROJECT if b.get('unassigned') else b['project']
        key = _match_key(name)
        if not key:
            continue
        agg = out.setdefault(key, dict(owedToContractors=Decimal('0'), owedToUs=Decimal('0'),
                                       count=0, names=set()))
        agg['owedToContractors'] += D(b['owedToContractors'])
        agg['owedToUs'] += D(b['owedToUs'])
        agg['count'] += b['count']
        agg['names'].add(b['project'])
    return out


def _budget_lookup(db: Session) -> dict:
    """آخر شهر موازنة معروف لكل مشروع (بمفتاح مطبَّع مماثل) — للتأخر ٪ فقط، من
    budget_service.budget_list_json(db) الجاهزة."""
    rows = BS.budget_list_json(db)['rows']
    out: dict = {}
    for r in rows:
        key = _match_key(r['project'])
        if not key:
            continue
        cur = out.get(key)
        if cur is None or r['month'] > cur['month']:
            out[key] = r
    return out


def _enrich_row(row: dict, contractor_lookup: dict, budget_lookup: dict,
                key: Optional[str] = None) -> dict:
    # `key` يُمرَّر صراحةً للصفّ الاصطناعي «غير محدد» — اسم عرضه المختار
    # (sorted(c['names'])[0]) قد لا يُعيد نفس المفتاح عند إعادة تطبيعه (مثال:
    # «غير مُسند» لا يُطبَّع إلى نفس مفتاح UNKNOWN_PROJECT «غير محدد» رغم أنهما
    # اجتمعا عمداً تحت نفس الدلو أعلاه) — إعادة الاشتقاق من الاسم كانت تُفقد
    # المطابقة فيعرض الصفّ صفراً رغم وجود مبلغ حقيقي في contractor_lookup.
    if key is None:
        key = _match_key(row['project'])
    c = contractor_lookup.get(key)
    if c is not None:
        row['contractorsOwed'] = money(c['owedToContractors'])
        row['contractorsOwedToUs'] = money(c['owedToUs'])
        row['contractorCount'] = c['count']
        # صيغ الاسم الأخرى المدموجة هنا (م-٣٠) — تُعرض للمستخدم صراحةً، لا تُخفى.
        alt = sorted(n for n in c['names'] if n != row['project'])
        row['contractorProjectNames'] = sorted(c['names'])
        row['mergedSpellingAlert'] = bool(alt)
    else:
        row['contractorsOwed'] = 0.0
        row['contractorsOwedToUs'] = 0.0
        row['contractorCount'] = 0
        row['contractorProjectNames'] = []
        row['mergedSpellingAlert'] = False
    extra = D(c['owedToContractors']) if c is not None else Decimal('0')
    row['totalCommitment'] = money(D(row['outstanding']) + extra)
    b = budget_lookup.get(key)
    row['budgetDelayPct'] = b['delayPct'] if b is not None else None
    row['budgetMonth'] = b['month'] if b is not None else None
    return row


def list_projects(db: Session, today: Optional[dt.date] = None,
                  q: Optional[str] = None, date_from: Optional[dt.date] = None,
                  date_to: Optional[dt.date] = None,
                  min_outstanding: Optional[float] = None) -> dict:
    today = today or dt.date.today()
    groups = _group(db, today)

    contractor_lookup = _contractor_lookup(db, today)
    budget_lookup = _budget_lookup(db)
    matched_keys = set()

    rows = []
    for proj, positions in groups.items():
        if q and q.strip() not in proj:
            continue
        row = _row_for(proj, positions)
        row = _enrich_row(row, contractor_lookup, budget_lookup)
        matched_keys.add(_match_key(proj))
        if date_from is not None or date_to is not None:
            zero = Decimal('0')
            opening = invoiced_p = paid_p = closing = zero
            for p in positions:
                b = PS.period_breakdown(p, date_from, date_to)
                opening += b['opening']
                invoiced_p += b['invoiced_in_period']
                paid_p += b['paid_in_period']
                closing += b['closing']
            row['openingBalance'] = money(opening)
            row['invoicedInPeriod'] = money(invoiced_p)
            row['paidInPeriod'] = money(paid_p)
            row['closingBalance'] = money(closing)
        if min_outstanding is not None and row['outstanding'] < min_outstanding:
            continue
        rows.append(row)

    # مشاريع لها مقاولون بلا أي مورد على الإطلاق (لا تظهر في `groups` أصلاً) —
    # بدون هذا كانت مديونيتهم تختفي كلياً من هذه الشاشة، ومجموع الأعمدة لا يساوي
    # إجمالي /contractors (التحقق المطلوب في PLAN §٣). صفّ اصطناعي: صفر موردين،
    # كل أرقامه من contractors_lookup وحده.
    for key, c in contractor_lookup.items():
        if key in matched_keys:
            continue
        name = sorted(c['names'])[0]
        if q and q.strip() not in name:
            continue
        row = _row_for(name, [])
        row = _enrich_row(row, contractor_lookup, budget_lookup, key=key)
        matched_keys.add(key)
        rows.append(row)

    rows.sort(key=lambda r: -r['outstanding'])

    # Sum the Decimal positions across ALL matched groups directly, not the
    # already-rounded per-project floats — summing money()-rounded floats can drift by
    # fractions of a piaster from the exact total, disagreeing with dashboard/overview/
    # suppliers which all sum Decimals before rounding once at the boundary.
    zero = Decimal('0')
    matched_projects = {r['project'] for r in rows}
    all_positions = [p for proj, positions in groups.items()
                     if proj in matched_projects for p in positions]
    # مقاولون فقط — مُجمَّعة مرة واحدة لكل مفتاح مطابق (matched_keys)، فلا تُحسب
    # مديونية مشروع مرتين حتى لو ظهر بصيغتين مدموجتين في صفّ واحد.
    contractors_owed_total = sum((c['owedToContractors'] for k, c in contractor_lookup.items()
                                  if k in matched_keys), zero)
    contractors_owed_us_total = sum((c['owedToUs'] for k, c in contractor_lookup.items()
                                     if k in matched_keys), zero)
    suppliers_outstanding = sum((p.outstanding for p in all_positions), zero)
    totals = dict(
        count=len(rows),
        invoiced=money(sum((p.total_invoiced for p in all_positions), zero)),
        paid=money(sum((p.total_paid for p in all_positions), zero)),
        outstanding=money(suppliers_outstanding),
        overdue=money(sum((p.overdue for p in all_positions), zero)),
        dueWithin7=money(sum((p.due_within_7 for p in all_positions), zero)),
        supplierCount=sum(r['supplierCount'] for r in rows),
        contractorsOwed=money(contractors_owed_total),
        contractorsOwedToUs=money(contractors_owed_us_total),
        totalCommitment=money(suppliers_outstanding + contractors_owed_total),
    )
    filters_applied = dict(q=q, dateFrom=date_from.isoformat() if date_from else None,
                           dateTo=date_to.isoformat() if date_to else None,
                           minOutstanding=min_outstanding)
    return dict(asOf=today.isoformat(), totals=totals, rows=rows, filtersApplied=filters_applied)


def project_detail(db: Session, project: str, today: Optional[dt.date] = None) -> Optional[dict]:
    today = today or dt.date.today()
    groups = _group(db, today)
    key = project if project in groups else None
    if key is None:
        # allow lookup by the display label even if caller passed it verbatim
        for g in groups:
            if g == project:
                key = g
                break

    contractor_lookup = _contractor_lookup(db, today)
    budget_lookup = _budget_lookup(db)
    match_key = _match_key(project)
    c = contractor_lookup.get(match_key)

    if key is None:
        # لا موردين لهذا المشروع إطلاقاً — لكن قد يكون له مقاولون (نفس حالة
        # الصفوف الاصطناعية في list_projects). لا نُرجع 404 لمشروعٍ موجود فعلاً
        # عند المقاولين وحدهم.
        if c is None:
            return None
        name = sorted(c['names'])[0]
        row = _row_for(name, [])
        row['suppliers'] = []
        row['schedule'] = []
    else:
        positions = groups[key]
        row = _row_for(key, positions)
        row['suppliers'] = [PS.position_json(p) for p in positions]
        row['schedule'] = [
            dict(date=b['date'].isoformat(), amount=money(b['amount']), count=len(b['items']))
            for b in P.payment_schedule(positions, today, 90)
        ]

    row = _enrich_row(row, contractor_lookup, budget_lookup, key=match_key)

    # قائمة مقاولي المشروع — contractors_list_json(db, project=...) لا يعرف مطابقة
    # «سدن»/«السدن» (فلترته على r['projects'] بمقارنة normalize_ar وحدها، ملف
    # contractors_service.py مملوك لوكيل آخر ولا يُلمس هنا)، فنستدعيه مرة لكل صيغة
    # اسم مدموجة في هذا المشروع ونُوحّد بالكود — لا ازدواج لأن كل مقاول كودٌ واحد.
    names = c['names'] if c is not None else {row['project']}
    seen_codes = set()
    contractors_rows = []
    for name in sorted(names):
        for r in CS.contractors_list_json(db, today, project=name)['rows']:
            if r['code'] in seen_codes:
                continue
            seen_codes.add(r['code'])
            contractors_rows.append(r)
    contractors_rows.sort(key=lambda r: r['balance'])
    row['contractors'] = contractors_rows
    return row
