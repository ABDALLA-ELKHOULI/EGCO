# -*- coding: utf-8 -*-
"""سلّة المحذوفات — م-٣١: الواجهة كانت تَعِد «الحذف ناعم ويمكن التراجع عنه من
قاعدة البيانات» بلا أي مسار API أو زرّ يُحقق الوعد. هذا الملف هو ذلك المسار.

كل شاشة تحذف منطقياً (`deleted_at`) موردين/مقاولين تُخفي معهم فواتيرهم ودفعاتهم
وحركاتهم بصمت — لا لأن تلك الصفوف حُذفت هي نفسها، بل لأن كل استعلام يعرضها
يمر عبر المورد/المقاول ويصفّي بـ`deleted_at is None` على الطرف. استرجاع الطرف
من هنا (تصفير `deleted_at` فقط) **يُعيدها كلها فوراً** بلا أي خطوة إضافية —
مُتحقَّق منه في tests/test_trash.py على رقم حقيقي (5,938,715.01).

الاستيرادات والحركات اليدوية على العكس: حذفها (imports.py:389-453 ومسارات
الحذف اليدوي في suppliers.py/contractors.py) يضع `deleted_at` على الصفوف نفسها
مباشرة، فاسترجاعها هنا يُصفِّر `deleted_at` على تلك الصفوف بعينها.
"""
import datetime as dt
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.services import party_projects as PP

router = APIRouter()

#: كل نوع مدعوم في السلّة — القيمة تصف كيف يُقرأ ويُستعاد.
_SUPPLIER = 'supplier'
_CONTRACTOR = 'contractor'
_INVOICE = 'invoice'
_PAYMENT = 'payment'
_CONTRACTOR_ENTRY = 'contractor_entry'
_IMPORT_LOG = 'import_log'
_BUDGET_MONTH = 'budget_month'

_KINDS = (_SUPPLIER, _CONTRACTOR, _INVOICE, _PAYMENT, _CONTRACTOR_ENTRY,
         _IMPORT_LOG, _BUDGET_MONTH)


def _iso(d) -> Optional[str]:
    return d.isoformat() if d is not None else None


def _supplier_rows(db: Session) -> List[dict]:
    rows = db.query(models.Supplier).filter(models.Supplier.deleted_at.isnot(None)).all()
    out = []
    for s in rows:
        inv = db.query(models.Invoice).filter_by(supplier_id=s.id).filter(
            models.Invoice.deleted_at.is_(None)).count()
        pay = db.query(models.Payment).filter_by(supplier_id=s.id).filter(
            models.Payment.deleted_at.is_(None)).count()
        out.append(dict(kind=_SUPPLIER, id=s.account, name=s.name,
                        deletedAt=_iso(s.deleted_at),
                        summary=dict(invoices=inv, payments=pay)))
    return out


def _contractor_rows(db: Session) -> List[dict]:
    rows = db.query(models.Contractor).filter(models.Contractor.deleted_at.isnot(None)).all()
    out = []
    for c in rows:
        entries = db.query(models.ContractorEntry).filter_by(contractor_id=c.id).filter(
            models.ContractorEntry.deleted_at.is_(None)).count()
        out.append(dict(kind=_CONTRACTOR, id=c.code, name=c.name,
                        deletedAt=_iso(c.deleted_at),
                        summary=dict(entries=entries)))
    return out


def _invoice_rows(db: Session) -> List[dict]:
    # الفواتير المحذوفة هي نفسها فقط — لا فواتير المورد المحذوف كلياً (تلك تُستعاد
    # مع طرفها، انظر _supplier_rows/شرح الملف أعلاه). عرضها هنا مفيد لحذف يدوي
    # لفاتورة مفردة (manual.py) لا لحذف مورد كامل.
    rows = (db.query(models.Invoice, models.Supplier)
           .join(models.Supplier, models.Invoice.supplier_id == models.Supplier.id)
           .filter(models.Invoice.deleted_at.isnot(None)).all())
    return [dict(kind=_INVOICE, id=i.id, name='%s — فاتورة %s' % (s.name, i.number or i.doc),
                deletedAt=_iso(i.deleted_at),
                summary=dict(amount=i.amount, supplierAccount=s.account))
           for i, s in rows]


def _payment_rows(db: Session) -> List[dict]:
    rows = (db.query(models.Payment, models.Supplier)
           .join(models.Supplier, models.Payment.supplier_id == models.Supplier.id)
           .filter(models.Payment.deleted_at.isnot(None)).all())
    return [dict(kind=_PAYMENT, id=p.id, name='%s — دفعة %s' % (s.name, p.doc),
                deletedAt=_iso(p.deleted_at),
                summary=dict(amount=p.amount, supplierAccount=s.account))
           for p, s in rows]


def _contractor_entry_rows(db: Session) -> List[dict]:
    rows = (db.query(models.ContractorEntry, models.Contractor)
           .join(models.Contractor, models.ContractorEntry.contractor_id == models.Contractor.id)
           .filter(models.ContractorEntry.deleted_at.isnot(None)).all())
    return [dict(kind=_CONTRACTOR_ENTRY, id=e.id,
                name='%s — حركة %s' % (c.name, e.doc),
                deletedAt=_iso(e.deleted_at),
                summary=dict(debit=e.debit, credit=e.credit, contractorCode=c.code))
           for e, c in rows]


def _import_log_rows(db: Session) -> List[dict]:
    rows = db.query(models.ImportLog).filter(models.ImportLog.deleted_at.isnot(None)).all()
    return [dict(kind=_IMPORT_LOG, id=l.id, name='استيراد %s — %s' % (l.source, l.path),
                deletedAt=_iso(l.deleted_at),
                summary=dict(imported=l.imported, account=l.account))
           for l in rows]


def _budget_month_rows(db: Session) -> List[dict]:
    rows = db.query(models.BudgetSnapshot).filter(
        models.BudgetSnapshot.deleted_at.isnot(None)).all()
    return [dict(kind=_BUDGET_MONTH, id=b.id, name='%s — %s' % (b.project, _iso(b.month)),
                deletedAt=_iso(b.deleted_at),
                summary=dict(actual=b.actual_month, planned=b.planned_month))
           for b in rows]


_LISTERS = {
    _SUPPLIER: _supplier_rows, _CONTRACTOR: _contractor_rows,
    _INVOICE: _invoice_rows, _PAYMENT: _payment_rows,
    _CONTRACTOR_ENTRY: _contractor_entry_rows, _IMPORT_LOG: _import_log_rows,
    _BUDGET_MONTH: _budget_month_rows,
}


@router.get('')
def list_trash(kind: Optional[str] = Query(None), db: Session = Depends(get_session)) -> dict:
    """لائحة كل المحذوف منطقياً — بالنوع المطلوب، أو كل الأنواع إن لم يُحدَّد."""
    if kind is not None and kind not in _KINDS:
        raise HTTPException(422, detail='نوع غير معروف: %s — المسموح: %s' % (
            kind, ', '.join(_KINDS)))
    kinds = [kind] if kind else list(_KINDS)
    rows: List[dict] = []
    for k in kinds:
        rows += _LISTERS[k](db)
    rows.sort(key=lambda r: r['deletedAt'] or '', reverse=True)
    return dict(rows=rows, count=len(rows))


def _get_row(db: Session, kind: str, item_id: str):
    if kind == _SUPPLIER:
        return db.query(models.Supplier).filter_by(account=item_id).one_or_none()
    if kind == _CONTRACTOR:
        return db.query(models.Contractor).filter_by(code=item_id).one_or_none()
    if kind == _INVOICE:
        return db.query(models.Invoice).filter_by(id=item_id).one_or_none()
    if kind == _PAYMENT:
        return db.query(models.Payment).filter_by(id=item_id).one_or_none()
    if kind == _CONTRACTOR_ENTRY:
        return db.query(models.ContractorEntry).filter_by(id=item_id).one_or_none()
    if kind == _IMPORT_LOG:
        return db.query(models.ImportLog).filter_by(id=item_id).one_or_none()
    if kind == _BUDGET_MONTH:
        return db.query(models.BudgetSnapshot).filter_by(id=item_id).one_or_none()
    return None


@router.post('/{kind}/{item_id}/restore')
def restore(kind: str, item_id: str, db: Session = Depends(get_session)) -> dict:
    """يُحيي الصف — ومع تبعياته التي حُذفت معه (مورد/مقاول تُعاد فواتيره وحركاته
    تلقائياً لأنها لم تُحذَف هي نفسها أصلاً، انظر شرح الملف؛ استيراد يُعيد كل صف
    يحمل نفس import_log_id)."""
    if kind not in _KINDS:
        raise HTTPException(422, detail='نوع غير معروف: %s' % kind)
    row = _get_row(db, kind, item_id)
    if row is None or row.deleted_at is None:
        raise HTTPException(404, detail='لا يوجد صف محذوف بهذا المعرّف')

    dependents = dict()
    row.deleted_at = None

    if kind == _IMPORT_LOG:
        # كل صف يحمل import_log_id هذا وحُذف (بهذا المسار وحده — انظر imports.py
        # delete_import) يُستعاد معه؛ صف حي أصلاً لا يُلمس.
        for model, key in ((models.Invoice, 'invoices'), (models.Payment, 'payments'),
                           (models.ContractorEntry, 'entries'),
                           (models.Receivable, 'receivables'),
                           (models.GuaranteeEntry, 'guaranteeEntries')):
            n = 0
            for r in db.query(model).filter(
                    model.import_log_id == row.id, model.deleted_at.isnot(None)).all():
                r.deleted_at = None
                n += 1
            if n:
                dependents[key] = n

    db.commit()
    return dict(restored=dict(kind=kind, id=item_id, dependents=dependents))


@router.delete('/{kind}/{item_id}')
def purge(kind: str, item_id: str, confirm: bool = Query(False),
         db: Session = Depends(get_session)) -> dict:
    """حذف نهائي — لا رجعة بعده. الطريق الوحيد للحذف الفعلي في التطبيق كله؛ كل
    مسار حذف آخر (suppliers.py/contractors.py/imports.py) منطقي فقط."""
    if kind not in _KINDS:
        raise HTTPException(422, detail='نوع غير معروف: %s' % kind)
    if not confirm:
        raise HTTPException(400, detail='الحذف النهائي يحتاج تأكيداً صريحاً — '
                                        'أعد الطلب مع confirm=true')
    row = _get_row(db, kind, item_id)
    if row is None or row.deleted_at is None:
        raise HTTPException(404, detail='لا يوجد صف محذوف بهذا المعرّف')

    if kind == _SUPPLIER:
        db.query(models.Invoice).filter_by(supplier_id=row.id).delete(synchronize_session=False)
        db.query(models.Payment).filter_by(supplier_id=row.id).delete(synchronize_session=False)
    elif kind == _CONTRACTOR:
        db.query(models.ContractorEntry).filter_by(
            contractor_id=row.id).delete(synchronize_session=False)

    db.delete(row)
    db.commit()
    return dict(purged=dict(kind=kind, id=item_id))
