# -*- coding: utf-8 -*-
from typing import Optional
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import parse_date
from app.db import models
from app.db.session import get_session
from app.domain.payables import DELAY_BUCKETS, parse_term, money
from app.schemas.common import SupplierIn, SupplierUpdate
from app.services import party_projects as PP
from app.services import payables_service as PS

router = APIRouter()


def _activity(db: Session, supplier_id: str):
    dates = []
    for i in db.query(models.Invoice.date).filter_by(supplier_id=supplier_id,
                                                       deleted_at=None).all():
        dates.append(i[0])
    for p in db.query(models.Payment.date).filter_by(supplier_id=supplier_id,
                                                       deleted_at=None).all():
        dates.append(p[0])
    if not dates:
        return None, None
    return min(dates).isoformat(), max(dates).isoformat()


_VALID_STATUSES = ('awaiting_date', 'overdue', 'due_soon', 'open', 'clear')

_VALID_DELAY = tuple(k for k, _, _ in DELAY_BUCKETS) + ('none',)

#: أعمدة الترتيب — المفتاح كما يرسله الجدول، والدالة التي تستخرج قيمة الفرز.
#: Sorting on the server (over the full filtered set) is what keeps the totals row
#: honest: sort a page in the browser and the totals silently describe a different set.
_SORT_KEYS = {
    'name': lambda r: r['name'] or '',
    'account': lambda r: r['account'] or '',
    'project': lambda r: r['project'] or '',
    'term': lambda r: r.get('termDays') if r.get('termKind') == 'days' else -1,
    'status': lambda r: _VALID_STATUSES.index(r['status']) if r['status'] in _VALID_STATUSES else 99,
    'outstanding': lambda r: r['outstanding'],
    'overdue': lambda r: r['overdue'],
    'delay': lambda r: r['delay']['days'],
    'delayAmount': lambda r: r['delay']['amount'],
    'lastPaymentDate': lambda r: (r['lastPayment'] or {}).get('date') or '',
    'lastPaymentAmount': lambda r: (r['lastPayment'] or {}).get('amount') or 0,
}


def _parse_filter_date(s: Optional[str], label: str) -> Optional[dt.date]:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, detail=f'{label} غير صالح: {s}')


@router.get('')
def list_suppliers(q: Optional[str] = Query(None),
                   project: Optional[str] = Query(None),
                   status: Optional[str] = Query(None),
                   date_from: Optional[str] = Query(None),
                   date_to: Optional[str] = Query(None),
                   min_outstanding: Optional[float] = Query(None),
                   max_outstanding: Optional[float] = Query(None),
                   overdue_only: bool = Query(False),
                   has_data: Optional[bool] = Query(None),
                   delay: Optional[str] = Query(None),
                   min_delay_days: Optional[int] = Query(None),
                   max_delay_days: Optional[int] = Query(None),
                   sort: Optional[str] = Query(None),
                   dir: str = Query('asc'),
                   db: Session = Depends(get_session)) -> dict:
    """قائمة الموردين مع حالتهم — filtering happens after positions are computed,
    because status depends on the calculation, not on a stored column.

    Totals always reflect the applied filters, over the FULL filtered set (not just the
    rows shown) — one code path computes both."""
    if status is not None and status not in _VALID_STATUSES:
        raise HTTPException(422, detail=f'قيمة حالة غير صالحة: {status} — '
                                        f'المسموح: {", ".join(_VALID_STATUSES)}')
    if delay is not None and delay not in _VALID_DELAY:
        raise HTTPException(422, detail=f'شريحة تأخر غير صالحة: {delay} — '
                                        f'المسموح: {", ".join(_VALID_DELAY)}')
    if sort is not None and sort not in _SORT_KEYS:
        raise HTTPException(422, detail=f'عمود ترتيب غير صالح: {sort} — '
                                        f'المسموح: {", ".join(_SORT_KEYS)}')
    if dir not in ('asc', 'desc'):
        raise HTTPException(422, detail=f'اتجاه ترتيب غير صالح: {dir}')
    df = _parse_filter_date(date_from, 'تاريخ البداية')
    dtt = _parse_filter_date(date_to, 'تاريخ النهاية')
    if df is not None and dtt is not None and df > dtt:
        raise HTTPException(422, detail='تاريخ البداية يجب أن يسبق تاريخ النهاية')
    if (min_outstanding is not None and max_outstanding is not None
            and min_outstanding > max_outstanding):
        raise HTTPException(422, detail='الحد الأدنى للرصيد يجب ألا يتجاوز الحد الأقصى')

    ps = PS.positions(db, include_empty=True)
    rows = []
    matched = []
    supplier_ids = {row.account: row.id for row in
                    db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None)).all()}
    # التصفية بمشروع تعني «ينتمي إليه ضمن لائحته» لا «يساويه» — مورد على ثلاثة
    # مشاريع يجب أن يظهر تحت الثلاثة، لا تحت مشروعه الأساسي (project) فقط.
    ids_in_project = PP.parties_in_project(db, PP.SUPPLIER, project) if project else None
    for p in ps:
        st = PS.status_of(p)
        if status and st != status:
            continue
        if ids_in_project is not None and supplier_ids.get(p.supplier.account) not in ids_in_project:
            continue
        if q:
            needle = q.strip()
            if needle not in p.supplier.name and needle not in p.supplier.account:
                continue
        if min_outstanding is not None and p.outstanding < Decimal(str(min_outstanding)):
            continue
        if max_outstanding is not None and p.outstanding > Decimal(str(max_outstanding)):
            continue
        if overdue_only and p.overdue <= 0:
            continue
        # التصفية بالشريحة تعني «له مبلغ متأخر فيها» لا «أسوأ تأخره فيها» — سؤالك
        # «أرني المتأخر ٣١–٦٠ يوماً» يقصد المال الواقع هناك، وقد يملكه مورد أسوأ
        # تأخره ستة أشهر. لذلك يظهر المورد في كل شريحة له فيها مال.
        if delay is not None:
            if delay == 'none':
                if p.delay.days > 0:
                    continue
            elif p.delay.by_bucket.get(delay, Decimal('0')) <= 0:
                continue
        if min_delay_days is not None and p.delay.days < min_delay_days:
            continue
        if max_delay_days is not None and p.delay.days > max_delay_days:
            continue
        if has_data is not None:
            has_movement = bool(p.invoices or p.payments)
            if has_movement != has_data:
                continue
        sid = supplier_ids.get(p.supplier.account)
        d = PS.position_json(p, projects=PP.projects_of(db, PP.SUPPLIER, sid) if sid else [])
        d['status'] = st
        first_act, last_act = _activity(db, sid) if sid else (None, None)
        d['firstActivity'] = first_act
        d['lastActivity'] = last_act
        rows.append(d)
        matched.append(p)

    if sort:
        # الاسم فاصل التعادل دائماً — بدونه يتبدّل ترتيب المتساويات بين طلب وآخر
        # فيبدو الجدول وكأنه يتحرك بلا سبب.
        rows.sort(key=lambda r: r['name'])
        rows.sort(key=_SORT_KEYS[sort], reverse=(dir == 'desc'))
    else:
        rows.sort(key=lambda r: (-r['overdue'], -r['outstanding'], r['name']))
    # كل المشاريع المعروفة من party_projects — يشمل مشاريع إضافية لمورد له أكثر من
    # مشروع، لا العمود المفرد فقط.
    projects = PP.all_projects(db)
    # Sum the Decimal positions, not the already-rounded per-row floats — summing
    # money()-rounded floats can drift by fractions of a piaster from the exact total
    # (e.g. 5611014.100000001), disagreeing with dashboard/overview/projects which all
    # sum Decimals before rounding once at the boundary.
    zero = Decimal('0')
    totals = dict(
        count=len(matched),
        invoiced=money(sum((p.total_invoiced for p in matched), zero)),
        paid=money(sum((p.total_paid for p in matched), zero)),
        outstanding=money(sum((p.outstanding for p in matched), zero)),
        overdue=money(sum((p.overdue for p in matched), zero)),
        dueWithin7=money(sum((p.due_within_7 for p in matched), zero)),
        creditBalances=money(sum((p.credit_balance for p in matched), zero)),
        # توزيع المتأخر على الشرائح — للمجموعة المصفّاة كاملة لا للصفحة المعروضة.
        delayByBucket={k: money(sum((p.delay.by_bucket.get(k, zero) for p in matched), zero))
                       for k, _, _ in DELAY_BUCKETS},
        delayed=money(sum((p.delay.amount for p in matched), zero)),
    )
    if df is not None or dtt is not None:
        opening = invoiced_p = paid_p = closing = zero
        for p in matched:
            b = PS.period_breakdown(p, df, dtt)
            opening += b['opening']
            invoiced_p += b['invoiced_in_period']
            paid_p += b['paid_in_period']
            closing += b['closing']
        totals['openingBalance'] = money(opening)
        totals['invoicedInPeriod'] = money(invoiced_p)
        totals['paidInPeriod'] = money(paid_p)
        totals['closingBalance'] = money(closing)

    filters_applied = dict(q=q, project=project, status=status, dateFrom=date_from,
                           dateTo=date_to, minOutstanding=min_outstanding,
                           maxOutstanding=max_outstanding, overdueOnly=overdue_only,
                           hasData=has_data)
    return dict(count=len(rows), rows=rows, projects=projects, totals=totals,
               filtersApplied=filters_applied)


@router.get('/{account}')
def supplier_detail(account: str,
                    date_from: Optional[str] = Query(None),
                    date_to: Optional[str] = Query(None),
                    db: Session = Depends(get_session)) -> dict:
    """كشف مورد — invoices, payments, ageing."""
    ps = PS.positions(db, account=account)
    if not ps:
        raise HTTPException(404, detail=f'لا يوجد مورد بالحساب {account}')
    df = parse_date(date_from, 'تاريخ البداية')
    dtt = parse_date(date_to, 'تاريخ النهاية')
    sid = db.query(models.Supplier.id).filter_by(account=account).scalar()
    d = PS.position_json(ps[0], detail=True, date_from=df, date_to=dtt,
                         projects=PP.projects_of(db, PP.SUPPLIER, sid) if sid else [])
    d['status'] = PS.status_of(ps[0])
    return d


@router.post('', status_code=201)
def create_supplier(body: SupplierIn, db: Session = Depends(get_session)) -> dict:
    """إضافة مورد يدوياً."""
    exists = db.query(models.Supplier).filter_by(account=body.account).one_or_none()
    if exists is not None and exists.deleted_at is None:
        raise HTTPException(409, detail=f'يوجد مورد بالفعل بالحساب {body.account}')
    term = parse_term(body.term)
    if exists is not None:
        # previously soft-deleted — resurrect
        row = exists
        row.deleted_at = None
    else:
        row = models.Supplier(account=body.account)
        db.add(row)
    row.name = body.name
    row.project = body.project
    row.term_raw = term.raw
    row.term_kind = term.kind
    row.term_days = term.days
    db.flush()  # نحتاج row.id قبل set_projects
    # body.projects لو أُرسل يحل محل project المفرد كأساس؛ لو لم يُرسل نبذر
    # اللائحة من project حتى لا يبقى المورد الجديد بلا مشاريع في party_projects.
    projects_in = body.projects if body.projects is not None else (
        [body.project] if body.project else [])
    projects = PP.set_projects(db, PP.SUPPLIER, row.id, projects_in)
    row.project = PP.primary(projects)
    db.commit()
    db.refresh(row)
    return dict(account=row.account, name=row.name, project=row.project,
                term=row.term_raw or 'كاش', termKind=row.term_kind, termDays=row.term_days,
                projects=projects)


@router.put('/{account}')
def update_supplier(account: str, body: SupplierUpdate,
                    db: Session = Depends(get_session)) -> dict:
    """تعديل بيانات مورد — رقم الحساب ثابت."""
    row = db.query(models.Supplier).filter_by(account=account).filter(
        models.Supplier.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مورد بالحساب {account}')
    if body.name is not None:
        row.name = body.name
    if body.term is not None:
        term = parse_term(body.term)
        row.term_raw = term.raw
        row.term_kind = term.kind
        row.term_days = term.days
    # body.projects=None يعني «لا تغيّر» — تعديل جزئي (اسم أو مدة فقط) لا يمحو
    # مشاريع المورد بصمت (انظر party_projects.set_projects). لو أُرسل project المفرد
    # وحده بلا projects، نعامله كطلب استبدال باللائحة [project] — سلوك متوافق مع
    # الشاشات القديمة التي لا تعرف بعد بالمشاريع المتعددة.
    projects_in = body.projects
    if projects_in is None and body.project is not None:
        projects_in = [body.project] if body.project else []
    projects = PP.set_projects(db, PP.SUPPLIER, row.id, projects_in)
    if projects_in is not None:
        row.project = PP.primary(projects)
    db.commit()
    db.refresh(row)
    return dict(account=row.account, name=row.name, project=row.project,
                term=row.term_raw or 'كاش', termKind=row.term_kind, termDays=row.term_days,
                projects=projects)


@router.delete('/{account}')
def delete_supplier(account: str, force: bool = Query(False),
                    db: Session = Depends(get_session)) -> dict:
    """حذف مورد (حذف منطقي). إن كان له فواتير/دفعات، يُرفض إلا مع force=true."""
    row = db.query(models.Supplier).filter_by(account=account).filter(
        models.Supplier.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(404, detail=f'لا يوجد مورد بالحساب {account}')

    has_invoices = db.query(models.Invoice).filter_by(
        supplier_id=row.id, deleted_at=None).first() is not None
    has_payments = db.query(models.Payment).filter_by(
        supplier_id=row.id, deleted_at=None).first() is not None

    if (has_invoices or has_payments) and not force:
        raise HTTPException(409, detail='لا يمكن حذف المورد لوجود فواتير أو دفعات مسجلة له — '
                                        'استخدم force=true للحذف مع الإبقاء على السجلات')

    row.deleted_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return dict(deleted=True)
