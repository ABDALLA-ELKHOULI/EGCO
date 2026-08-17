# -*- coding: utf-8 -*-
"""يربط قاعدة البيانات بحسابات المقاولين.

Loads rows, hands them to app/domain/contractors.py, and shapes JSON for the wire —
no arithmetic lives here beyond calling the domain layer, same rule as
payables_service.py.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.domain import contractors as C
from app.domain.payables import D, money
from app.services import party_projects as PP
from app.utils.arabic import contains_ar, normalize_ar


# ---------------------------------------------------------------- known projects

def known_projects(db: Session) -> List[str]:
    """أسماء المشاريع المعروفة — from suppliers and budget snapshots."""
    names = set()
    for (p,) in db.query(models.Supplier.project).filter(
            models.Supplier.deleted_at.is_(None)).distinct().all():
        if p:
            names.add(p)
    for (p,) in db.query(models.BudgetSnapshot.project).filter(
            models.BudgetSnapshot.deleted_at.is_(None)).distinct().all():
        if p:
            names.add(p)
    return sorted(names)


# ---------------------------------------------------------------- statement upsert

def upsert_from_statement(db: Session, parsed: dict, path: str,
                          import_log_id: Optional[str] = None) -> dict:
    """حفظ كشف مقاول — creates the contractor when the code is new, inserts ledger
    rows idempotently (duplicate identity rows are skipped, so re-import adds 0).

    `import_log_id` stamps every row this call creates or resurrects so the
    uploaded-files screen can later delete exactly this import's rows. A soft-deleted
    row matching an incoming row's identity is resurrected (un-deleted, re-stamped)
    rather than skipped — otherwise upload -> delete -> re-upload adds 0 rows.
    """
    code = parsed['account']
    row = db.query(models.Contractor).filter_by(code=code).one_or_none()
    created = row is None
    if row is None:
        row = models.Contractor(code=code, name=parsed.get('name') or code)
        db.add(row)
        db.flush()
    else:
        if row.deleted_at is not None:
            row.deleted_at = None
        if parsed.get('name'):
            row.name = parsed['name']

    projects = known_projects(db)
    added = skipped = 0
    for r in parsed['rows']:
        desc = r.get('description') or ''
        kind = r.get('kind') or C.classify_entry(desc)
        # ‏.first() لا ‎.one_or_none()‎: نظيرتها في import_service تحوّلت بعد أن أسقطت
        # كشفاً كاملاً بـ MultipleResultsFound حين وُجد صفّان قديمان بهوية متطابقة.
        # هوية ContractorEntry أوسع أصلاً فلا يقع ذلك اليوم — لكن أي توسيعٍ لاحق
        # لها يُعيد الانفجار نفسه، والتماثل هنا أرخص من تكرار الحادثة.
        exists = db.query(models.ContractorEntry).filter_by(
            contractor_id=row.id, doc=r.get('doc') or '', date=r['date'],
            debit=r['debit'], credit=r['credit'], description=desc).first()
        if exists is not None:
            if exists.deleted_at is not None:
                exists.deleted_at = None
                exists.import_log_id = import_log_id
                added += 1
            else:
                skipped += 1
            continue
        db.add(models.ContractorEntry(
            contractor_id=row.id, date=r['date'], debit=r['debit'], credit=r['credit'],
            doc=r.get('doc') or '', description=desc, kind=kind,
            claim_no=C.extract_claim_no(desc),
            project=C.detect_project(desc, projects), source='statement',
            import_log_id=import_log_id))
        added += 1

    db.commit()
    return dict(contractor=dict(code=row.code, name=row.name),
                added=added, skipped=skipped, created=created)


# ---------------------------------------------------------------- guarantees

def guarantee_release(g: models.ContractorGuarantee, today: Optional[dt.date] = None):
    """موعد فك الضمان وحالته.

    release_due = the explicit date when set, otherwise finished_on + guarantee_days.
    status: released > due (release_due <= today) > upcoming (within 30 days)
    > scheduled (later, or no date derivable yet).
    """
    today = today or dt.date.today()
    due = g.release_due
    if due is None and g.finished_on is not None and g.guarantee_days is not None:
        due = g.finished_on + dt.timedelta(days=g.guarantee_days)
    if g.released_on is not None:
        status = 'released'
    elif due is None:
        status = 'scheduled'
    elif due <= today:
        status = 'due'
    elif due <= today + dt.timedelta(days=30):
        status = 'upcoming'
    else:
        status = 'scheduled'
    return due, status


def guarantee_json(g: models.ContractorGuarantee, today: Optional[dt.date] = None) -> dict:
    due, status = guarantee_release(g, today)
    return dict(id=g.id, project=g.project, amount=money(g.amount or 0),
                retentionRate=g.retention_rate,
                finishedOn=g.finished_on.isoformat() if g.finished_on else None,
                guaranteeDays=g.guarantee_days,
                releaseDue=due.isoformat() if due else None,
                releasedOn=g.released_on.isoformat() if g.released_on else None,
                dueStatus=status, notes=g.notes or '')


def sync_guarantee_from_claims(db: Session, contractor: models.Contractor,
                               project: str) -> None:
    """ضمان المشروع = مجموع تأمينات مستخلصاته.

    Always recomputed on any claim create/update/delete. The guarantees PUT sets the
    amount explicitly and that value wins until the NEXT claim change re-derives it —
    a deliberate, simple rule documented for the frontend too.
    """
    total = sum((D(c.retention_amount or 0)
                 for c in db.query(models.ContractorClaim).filter_by(
                     contractor_id=contractor.id, project=project, deleted_at=None).all()),
                Decimal('0'))
    # identity is (contractor, project) including soft-deleted rows — inserting a new
    # row next to a soft-deleted one would violate the unique constraint, so a
    # soft-deleted guarantee is resurrected by the claim change instead.
    g = db.query(models.ContractorGuarantee).filter_by(
        contractor_id=contractor.id, project=project).one_or_none()
    if g is None:
        g = models.ContractorGuarantee(contractor_id=contractor.id, project=project)
        db.add(g)
    g.deleted_at = None
    g.amount = money(total)


# ---------------------------------------------------------------- serialisation

def entry_json(e: models.ContractorEntry) -> dict:
    return dict(id=e.id, date=e.date.isoformat(), debit=money(e.debit or 0),
                credit=money(e.credit or 0), doc=e.doc or '',
                description=e.description or '', kind=e.kind or 'other',
                claimNo=e.claim_no, project=e.project or '',
                source=e.source or 'statement')


def claim_json(c: models.ContractorClaim) -> dict:
    return dict(id=c.id, project=c.project or '', number=c.number or '',
                date=c.date.isoformat(),
                grossCumulative=money(c.gross_cumulative or 0),
                previousCumulative=money(c.previous_cumulative or 0),
                retentionRate=c.retention_rate,
                retentionAmount=money(c.retention_amount or 0),
                otherDeductions=money(c.other_deductions or 0),
                netDue=money(c.net_due or 0),
                description=c.description or '', source=c.source or 'manual')


def _live_entries(row: models.Contractor) -> list:
    return [e for e in row.entries if e.deleted_at is None]


def _entry_dicts(entries) -> List[dict]:
    return [dict(debit=e.debit or 0, credit=e.credit or 0, kind=e.kind or 'other')
            for e in entries]


def contractor_row_json(row: models.Contractor, today: Optional[dt.date] = None,
                        projects: Optional[List[str]] = None) -> dict:
    """سطر شاشة القائمة — one dict per contractor.

    `projects` — لائحة مشاريع المقاول المعيَّنة (party_projects.projects_of)، يمررها
    المستدعي الذي يملك db. بلا تمرير صريح نتراجع للمشاريع المستنتجة من حركات دفتره —
    نفس السلوك القديم قبل هذه الميزة — حتى لا ينكسر مستدعٍ لا يعرف بعد بجدول
    party_projects (مثل ai_features_service.py).
    """
    entries = _live_entries(row)
    pos = C.position(_entry_dicts(entries))
    guarantees = [g for g in row.guarantees if g.deleted_at is None]
    retention_held = sum((D(g.amount or 0) for g in guarantees
                          if g.released_on is None), Decimal('0'))
    alerts = 0
    for g in guarantees:
        _, status = guarantee_release(g, today)
        if status in ('due', 'upcoming'):
            alerts += 1
    if projects is None:
        projects = sorted({e.project for e in entries if e.project})
    return dict(
        code=row.code, name=row.name, phone=row.phone or '',
        projects=projects,
        balance=money(pos['balance']),
        duesTotal=money(pos['claims_total']),
        paidTotal=money(pos['payments_total']),
        deductionsTotal=money(pos['deductions_total']),
        retentionHeld=money(retention_held),
        entryCount=len(entries),
        lastActivity=max(e.date for e in entries).isoformat() if entries else None,
        lastPayment=_last_payment(entries),
        releaseAlerts=alerts,
    )


def _last_payment(entries) -> object:
    """آخر دفعة فعلية للمقاول — أساسية في القائمة مثل نظيرتها عند الموردين."""
    pays = [e for e in entries if e.kind == 'payment' and (e.debit or 0) > 0]
    if not pays:
        return None
    last = max(pays, key=lambda e: e.date)
    return dict(date=last.date.isoformat(), amount=money(D(last.debit)))


def _direction_of(balance: float) -> str:
    if balance < 0:
        return 'owed_to_them'
    if balance > 0:
        return 'owed_to_us'
    return 'balanced'


#: أعمدة الترتيب — نفس فكرة suppliers.py: مفتاح يرسله الجدول ودالة تستخرج قيمة
#: الفرز. لا يوجد عمود «تأخر» هنا — حركات المقاول قيود مدين/دائن بلا تاريخ استحقاق،
#: فلا معنى محاسبياً لحساب تأخر (انظر تعليق delay في routes/contractors.py).
CONTRACTOR_SORT_KEYS = {
    'name': lambda r: r['name'] or '',
    'code': lambda r: r['code'] or '',
    'balance': lambda r: r['balance'],
    'duesTotal': lambda r: r['duesTotal'],
    'paidTotal': lambda r: r['paidTotal'],
    'retentionHeld': lambda r: r['retentionHeld'],
    'lastPaymentDate': lambda r: (r['lastPayment'] or {}).get('date') or '',
    'lastPaymentAmount': lambda r: (r['lastPayment'] or {}).get('amount') or 0,
    'lastActivity': lambda r: r['lastActivity'] or '',
}


def contractors_list_json(db: Session, today: Optional[dt.date] = None,
                          q: Optional[str] = None, project: Optional[str] = None,
                          direction: Optional[str] = None,
                          has_guarantees: Optional[bool] = None,
                          sort: Optional[str] = None, dir: str = 'asc') -> dict:
    # المشاريع المعروضة/المُصفّى عليها = لائحة party_projects المعيَّنة صراحةً ∪
    # المشاريع المستنتجة من حركات الدفتر — إسقاط الثاني كان يكسر التصفية لأي مقاول
    # وسمت حركاته مشروعاً دون أن يُعيَّن له صراحةً عبر نموذج التعديل بعد (الحالة
    # الشائعة اليوم، قبل أن يستخدم المستخدم المحرر الجديد).
    def _row(r: models.Contractor) -> dict:
        base = contractor_row_json(r, today)  # مستنتج من الحركات (السلوك القديم)
        assigned = PP.projects_of(db, PP.CONTRACTOR, r.id)
        base['projects'] = sorted(set(base['projects']) | set(assigned))
        return base

    all_rows = [_row(r) for r in db.query(models.Contractor).filter(
        models.Contractor.deleted_at.is_(None)).all()]

    # التصفية بمشروع تعني «ينتمي إليه ضمن لائحته» لا «يساويه» — مقاول على ثلاثة
    # مشاريع يجب أن يظهر تحت الثلاثة. r['projects'] أعلاه مصدره الآن party_projects
    # (عضوية حقيقية)، لا اشتقاق من حركات الدفتر كما كان سابقاً.
    rows = []
    # مطابقة مطبَّعة لصيغ المشروع المكافئة إملائياً (المدينة/المدينه) — تُحسب مرة
    # واحدة خارج الحلقة لا لكل صف، نفس سبب حساب ids_in_project مرة في suppliers.py.
    project_key = normalize_ar(project) if project else None
    for r in all_rows:
        if q:
            # مقارنة مُطبَّعة عربياً — انظر app/utils/arabic.py وتعليق suppliers.py
            # المطابق: الاسم كما كتبه المستخدم بحثاً قد يختلف حرفاً واحداً إملائياً
            # عمّا كتبه نظام الحسابات القديم لنفس المقاول بالضبط.
            if not contains_ar(r['name'], q) and not contains_ar(r['code'], q):
                continue
        if project_key and not any(normalize_ar(p) == project_key for p in r['projects']):
            continue
        if direction and _direction_of(r['balance']) != direction:
            continue
        if has_guarantees is not None:
            row_has = r['retentionHeld'] > 0
            if row_has != has_guarantees:
                continue
        rows.append(r)

    if sort and sort in CONTRACTOR_SORT_KEYS:
        # الاسم فاصل التعادل دائماً — نفس سبب suppliers.py: بدونه يتبدّل ترتيب
        # المتساويات بين طلب وآخر فيبدو الجدول وكأنه يتحرك بلا سبب.
        rows.sort(key=lambda r: r['name'])
        rows.sort(key=CONTRACTOR_SORT_KEYS[sort], reverse=(dir == 'desc'))
    else:
        # الأشد سالبية أولاً — the contractors we owe the most come first.
        rows.sort(key=lambda r: r['balance'])
    zero = Decimal('0')
    claims_total = sum((D(r['duesTotal']) for r in rows), zero)
    paid_total = sum((D(r['paidTotal']) for r in rows), zero)
    deductions_total = sum((D(r['deductionsTotal']) for r in rows), zero)
    owed_to_contractors = sum((abs(D(r['balance'])) for r in rows if r['balance'] < 0), zero)
    owed_to_us = sum((D(r['balance']) for r in rows if r['balance'] > 0), zero)
    balance = sum((D(r['balance']) for r in rows), zero)
    retention = sum((D(r['retentionHeld']) for r in rows), zero)
    totals = dict(count=len(rows),
                 claimsTotal=money(claims_total),
                 paidTotal=money(paid_total),
                 deductionsTotal=money(deductions_total),
                 balance=money(balance),
                 owedToContractors=money(owed_to_contractors),
                 owedToUs=money(owed_to_us),
                 retentionHeld=money(retention))
    filters_applied = dict(q=q, project=project, direction=direction,
                           hasGuarantees=has_guarantees)
    return dict(count=len(rows), rows=rows, totals=totals, filtersApplied=filters_applied)


def contractor_detail_json(row: models.Contractor, today: Optional[dt.date] = None,
                           projects: Optional[List[str]] = None) -> dict:
    """`projects` اختياري — نفس عقد contractor_row_json: بلا تمرير صريح نتراجع
    للمشاريع المستنتجة من حركات الدفتر (perProject) حتى لا ينكسر مستدعٍ قديم."""
    entries = _live_entries(row)
    pos = C.position(_entry_dicts(entries))

    # ---- per-project breakdown ('' = unassigned; frontend labels it).
    per: dict = {}
    for e in entries:
        b = per.setdefault(e.project or '', dict(debit=Decimal('0'), credit=Decimal('0'),
                                                 count=0))
        b['debit'] += D(e.debit or 0)
        b['credit'] += D(e.credit or 0)
        b['count'] += 1
    per_project = [dict(project=p, debit=money(b['debit']), credit=money(b['credit']),
                        balance=money(b['debit'] - b['credit']), entryCount=b['count'])
                   for p, b in sorted(per.items())]
    if projects is None:
        projects = sorted(p for p in per.keys() if p)

    return dict(
        code=row.code, name=row.name, phone=row.phone or '', notes=row.notes or '',
        projects=projects,
        defaultRetentionRate=row.default_retention_rate,
        defaultGuaranteeDays=row.default_guarantee_days,
        balance=money(pos['balance']),
        debitTotal=money(pos['debit_total']), creditTotal=money(pos['credit_total']),
        duesTotal=money(pos['claims_total']), paidTotal=money(pos['payments_total']),
        retentionTotal=money(pos['retention_total']),
        deductionsTotal=money(pos['deductions_total']),
        # حركات لا تندرج تحت البنود أعلاه (فواتير محمّلة · رصيد افتتاحي · أخرى).
        # كانت تُحتسب في الرصيد وتختفي من العرض، فتبدو الأرقام غير متسقة.
        otherDebits=money(pos['other_debits']),
        otherCredits=money(pos['other_credits']),
        lastPayment=_last_payment(entries),
        perProject=per_project,
        entries=[entry_json(e) for e in
                 sorted(entries, key=lambda e: (e.date, e.created_at), reverse=True)],
        claims=[claim_json(c) for c in
                sorted((c for c in row.claims if c.deleted_at is None),
                       key=lambda c: c.date, reverse=True)],
        guarantees=[guarantee_json(g, today) for g in row.guarantees
                    if g.deleted_at is None],
    )


# ---------------------------------------------------------------- overview (321-contractor scale)

#: يستخرج المبلغين المضمَّنين في نص تحذير المطابقة الذي يكتبه import_service.py
#: (commit_debts_report) — الحقل هناك نص جاهز للعرض فقط، بلا حقلين رقميين منفصلين،
#: وimport_service.py مملوك لوكيل آخر فلا يجوز تعديله ليُخرج الرقمين صراحةً. هذا
#: أرخص بديل: نص التحذير ثابت الصياغة (راجع commit_debts_report)، فاستخراجه
#: بتعبير نمطي أدق من إعادة اشتقاق الأرقام بحساب مختلف قد ينحرف عن رقم المطابقة نفسه.
_MISMATCH_RE = re.compile(
    r'رصيد الملف (-?[\d.]+) يختلف عن الرصيد المحسوب من الحركات (-?[\d.]+)')

#: بادئة حساب المقاول الثابتة — نفس قاعدة التصنيف المطلقة في dispatch_kind
#: (import_service.py): 211=مورد، 212=مقاول، 216=ضمان. سجل المطابقة يخلط تحذيرات
#: المقاولين والموردين معاً فنُميّز مقاولي هذه الشاشة بالبادئة، لا بالتخمين.
_CONTRACTOR_ACCOUNT_PREFIX = '212'


def _latest_debts_report_log(db: Session) -> Optional[models.ImportLog]:
    return db.query(models.ImportLog).filter_by(source='debts_report_xls').order_by(
        models.ImportLog.created_at.desc()).first()


def _contractor_balance_mismatches(db: Session) -> List[dict]:
    """اختلافات الرصيد بين تقرير المديونيات المجمّع ودفتر الحركات — من أحدث استيراد
    لهذا المصدر فقط (استيراد لاحق يحل محل السابق كسجل التحذيرات المرجعي)."""
    log = _latest_debts_report_log(db)
    if log is None:
        return []
    try:
        issues = json.loads(log.issues or '[]')
    except (ValueError, TypeError):
        return []
    out = []
    for it in issues:
        if it.get('kind') != 'balance_mismatch':
            continue
        account = it.get('account') or ''
        if not account.startswith(_CONTRACTOR_ACCOUNT_PREFIX):
            continue
        m = _MISMATCH_RE.search(it.get('message') or '')
        out.append(dict(
            account=account, name=it.get('name') or '',
            fileBalance=money(D(m.group(1))) if m else None,
            derivedBalance=money(D(m.group(2))) if m else None,
            message=it.get('message') or ''))
    # الأكبر فرقاً أولاً — أكثرها استحقاقاً للمراجعة يظهر أولاً بلا تمرير.
    out.sort(key=lambda r: abs((r['fileBalance'] or 0) - (r['derivedBalance'] or 0)),
             reverse=True)
    return out


def _by_project_debt(db: Session) -> List[dict]:
    """توزيع «المستحق للمقاولين» على المشاريع — من حركات الدفاتر الحيّة مباشرة
    (نفس معادلة الرصيد: مدين − دائن)، لا من صف واحد لكل مقاول، لأن مقاولاً واحداً
    قد يعمل على أكثر من مشروع بمبالغ مختلفة لكل منها. حساب سالب (مستحق للمقاول)
    فقط يُجمع هنا — رصيد موجب في مشروع ما «مستحق لنا» لا يُحسب ديناً على المشروع."""
    buckets: dict = {}
    q = (db.query(models.ContractorEntry.project, models.ContractorEntry.contractor_id,
                 models.ContractorEntry.debit, models.ContractorEntry.credit)
         .join(models.Contractor, models.Contractor.id == models.ContractorEntry.contractor_id)
         .filter(models.ContractorEntry.deleted_at.is_(None),
                 models.Contractor.deleted_at.is_(None)))
    per_contractor_project: dict = {}
    for project, contractor_id, debit, credit in q.all():
        key = (project or '', contractor_id)
        b = per_contractor_project.setdefault(key, Decimal('0'))
        per_contractor_project[key] = b + D(debit or 0) - D(credit or 0)

    for (project, contractor_id), balance in per_contractor_project.items():
        if balance >= 0:
            continue  # لا دين على هذا المشروع من هذا المقاول
        b = buckets.setdefault(project, dict(owed=Decimal('0'), contractorIds=set()))
        b['owed'] += abs(balance)
        b['contractorIds'].add(contractor_id)

    rows = [dict(project=p or '(بلا مشروع)', owed=money(b['owed']),
                contractorCount=len(b['contractorIds']))
           for p, b in buckets.items()]
    rows.sort(key=lambda r: r['owed'], reverse=True)
    return rows


def _reported_debt(db: Session) -> dict:
    """المستحق حسب تقرير المديونيات المجمّع — الرصيد المُبلَّغ لا المشتقّ.

    لماذا هذا الرقم موجود أصلاً: بعد استيراد التقرير صار في القاعدة ٣٢١ مقاولاً،
    لكن ٣٢٠ منهم بلا قيود دفترية (التقرير يعطي أرصدة لا حركات). فالرصيد المشتقّ
    من الحركات يصف مقاولاً واحداً ويقول ٥٦٬٦٥١.٩٩، بينما الملف يقول ٧٬٧٨٢٬٤٣١.٧٤ —
    أقلّ من الحقيقة بـ١٣٧ ضعفاً. عرض المشتقّ وحده على لوحة عنوانها «المستحق
    للمقاولين» رقمٌ كاذب بالمعنى الذي يهم: صحيح الحساب، خاطئ الوصف.

    الرقمان يُعرضان منفصلَين بتسميتيهما، ولا يُجمعان أبداً — لكل منهما مصدر مختلف،
    وخلطهما يخلق ثالثاً لا يصف شيئاً.
    """
    rows = (db.query(models.Contractor)
            .filter(models.Contractor.deleted_at.is_(None),
                    models.Contractor.reported_balance.isnot(None)).all())
    owed = sum((abs(D(r.reported_balance)) for r in rows
                if D(r.reported_balance) < 0), Decimal('0'))
    by_project: dict = {}
    for r in rows:
        bal = D(r.reported_balance)
        if bal >= 0:
            continue
        for proj in PP.projects_of(db, PP.CONTRACTOR, r.id) or ['']:
            b = by_project.setdefault(proj, dict(owed=Decimal('0'), count=0))
            b['owed'] += abs(bal)
            b['count'] += 1
            break            # الرصيد المُبلَّغ صفٌّ واحد لكل مقاول، فلا يُوزَّع
    projects = sorted(
        (dict(project=k or 'بلا مشروع', owed=money(v['owed']), contractors=v['count'])
         for k, v in by_project.items()),
        key=lambda x: -x['owed'])
    top = sorted((r for r in rows if D(r.reported_balance) < 0),
                 key=lambda r: D(r.reported_balance))[:10]
    return dict(
        owed=money(owed),
        contractorCount=len(rows),
        byProject=projects,
        topOwed=[dict(code=r.code, name=r.name,
                      balance=money(D(r.reported_balance))) for r in top],
    )


def contractors_overview_json(db: Session, today: Optional[dt.date] = None) -> dict:
    """أرقام لوحة نظرة المقاولين — تُبنى فوق تقرير المديونيات المجمّع (321 مقاولاً)،
    لا فوق الرصيد المفرد الذي كانت الشاشة تعرضه قبل هذا الاستيراد. كل رقم مُجمَّع
    هنا خادمياً (لا حساب في الواجهة) ومحدود النطاق صراحة في تسميته."""
    listing = contractors_list_json(db)  # نفس ترتيب وحساب شاشة القائمة تماماً
    rows = listing['rows']

    top_owed = [r for r in rows if r['balance'] < 0][:10]

    guarantee_accounts = db.query(models.GuaranteeAccount).filter(
        models.GuaranteeAccount.deleted_at.is_(None)).all()
    guarantees_216_total = sum((D(g.balance or 0) for g in guarantee_accounts), Decimal('0'))

    log = _latest_debts_report_log(db)

    return dict(
        totals=dict(
            owedToContractors=listing['totals']['owedToContractors'],
            contractorCount=listing['totals']['count'],
            retentionHeld=listing['totals']['retentionHeld'],
        ),
        reported=_reported_debt(db),
        byProject=_by_project_debt(db),
        topOwed=[dict(code=r['code'], name=r['name'], balance=r['balance'],
                     projects=r['projects']) for r in top_owed],
        guaranteeAccounts216=dict(
            total=money(guarantees_216_total), count=len(guarantee_accounts)),
        balanceMismatches=_contractor_balance_mismatches(db),
        lastDebtsReportImport=log.created_at.isoformat() if log else None,
        hasDebtsReportImport=log is not None,
    )
