# -*- coding: utf-8 -*-
"""الرفع — the renderer never touches the filesystem: Electron picks the path,
the backend reads it. That keeps the UI sandbox intact."""
import datetime as dt
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.ingest.csv_statement import CsvStatementParseError
from app.ingest.pdf_statement import StatementParseError
from app.ingest.suppliers_excel import SuppliersParseError
from app.schemas.common import BatchImportRequest, ImportRequest, PreviewRequest, ScanDirRequest
from app.services import import_service, receivables_service

router = APIRouter()

_PARSE_ERRORS = (StatementParseError, SuppliersParseError, CsvStatementParseError)

#: sources managed from their own dedicated screen — deleting them here would be
#: dangerous (the supplier list drives every FIFO calculation; budget snapshots feed
#: the deviation report), so the history screen only lets the user delete statements.
_UNDELETABLE_SOURCES = {'suppliers_excel', 'budget_deviation'}

#: linked-rows count spans these four tables — every table a statement/receivables
#: import can write to.
_LINKED_MODELS = (models.Invoice, models.Payment, models.ContractorEntry, models.Receivable)

_RESURRECTION_WINDOW = dt.timedelta(minutes=3)


@router.post('/preview')
def preview(body: PreviewRequest) -> dict:
    """قراءة بلا حفظ — feeds the review screen."""
    try:
        if body.source in import_service.STATEMENT_SOURCES:
            return import_service.preview_statement(body.path, body.source)
        raise HTTPException(400, detail='المعاينة متاحة لكشف الحساب فقط')
    except _PARSE_ERRORS as e:
        raise HTTPException(422, detail=str(e))


@router.post('')
def run_import(body: ImportRequest, db: Session = Depends(get_session)) -> dict:
    try:
        if body.source == 'suppliers_excel':
            return import_service.import_suppliers(db, body.path)
        if body.source in import_service.RECEIVABLE_SOURCES:
            # التحصيلات (الداخل) — لا تمر بمطابقة رصيد الكشف لأنها ليست كشف حساب
            return receivables_service.import_receivables(db, body.path, body.source)
        return import_service.commit_statement(db, body.path, body.allow_unreconciled,
                                               source=body.source)
    except _PARSE_ERRORS as e:
        raise HTTPException(422, detail=str(e))


@router.post('/scan')
def scan(body: ScanDirRequest) -> dict:
    """مسح مجلد — non-recursive, classifies files by extension."""
    try:
        return import_service.scan_dir(body.dir)
    except NotADirectoryError:
        raise HTTPException(404, detail='المجلد غير موجود أو ليس مجلداً')


@router.post('/batch')
def batch(body: BatchImportRequest, db: Session = Depends(get_session)) -> dict:
    """استيراد دفعة ملفات — ملفات الموردين أولاً، نسخة احتياطية واحدة للدفعة كلها."""
    return import_service.batch_import(db, body.paths, body.allow_unreconciled)


# ---------------------------------------------------------------- الملفات المرفوعة

def _count_linked(db: Session, log_id: str) -> int:
    """عدد الحركات الحية المرتبطة بهذا الاستيراد عبر الجداول الأربعة."""
    total = 0
    for model in _LINKED_MODELS:
        total += db.query(model).filter(
            model.import_log_id == log_id, model.deleted_at.is_(None)).count()
    return total


def _resolve_party_name(db: Session, account: str) -> Optional[str]:
    if not account:
        return None
    supplier = db.query(models.Supplier).filter_by(account=account).filter(
        models.Supplier.deleted_at.is_(None)).one_or_none()
    if supplier is not None:
        return supplier.name
    contractor = db.query(models.Contractor).filter_by(code=account).filter(
        models.Contractor.deleted_at.is_(None)).one_or_none()
    if contractor is not None:
        return contractor.name
    return None


@router.get('/history')
def import_history(db: Session = Depends(get_session)) -> dict:
    """الملفات التي رُفعت — أحدثها أولاً، مع عدد الحركات الحيّة التي أضافها كل ملف."""
    logs = db.query(models.ImportLog).filter(
        models.ImportLog.deleted_at.is_(None)).order_by(
        models.ImportLog.created_at.desc()).all()

    rows = []
    for log in logs:
        linked = _count_linked(db, log.id)
        # legacy = imported before this feature existed, so no row carries its id —
        # still shown, still deletable (approximately), just flagged for the UI.
        legacy = linked == 0 and log.imported > 0
        can_delete = log.source not in _UNDELETABLE_SOURCES and (linked > 0 or legacy)
        rows.append(dict(
            id=log.id,
            date=log.created_at.isoformat(),
            fileName=os.path.basename(log.path) if log.path else '',
            path=log.path,
            source=log.source,
            detected=import_service.DETECTED_LABELS.get(
                log.source, import_service.DETECTED_LABELS[None]),
            account=log.account or None,
            partyName=_resolve_party_name(db, log.account),
            added=log.imported,
            skipped=log.skipped,
            reconciled=bool(log.reconciled),
            linkedRows=linked,
            canDelete=can_delete,
            legacy=legacy,
        ))
    return dict(rows=rows)


@router.delete('/history/{log_id}')
def delete_import(log_id: str, force: bool = False,
                  db: Session = Depends(get_session)) -> dict:
    """حذف كل ما أضافه استيراد واحد — لا يمس أي بيانات يدوية."""
    log = db.query(models.ImportLog).filter_by(id=log_id).filter(
        models.ImportLog.deleted_at.is_(None)).one_or_none()
    if log is None:
        raise HTTPException(404, detail='سجل الاستيراد غير موجود')
    if log.source in _UNDELETABLE_SOURCES:
        raise HTTPException(400, detail='هذا النوع يُدار من شاشته الخاصة ولا يُحذف من هنا')

    now = dt.datetime.now(dt.timezone.utc)
    counts = dict(invoices=0, payments=0, entries=0, receivables=0)
    linked = _count_linked(db, log.id)
    approximate = False

    if linked > 0:
        for model, key in ((models.Invoice, 'invoices'), (models.Payment, 'payments'),
                           (models.ContractorEntry, 'entries'),
                           (models.Receivable, 'receivables')):
            for row in db.query(model).filter(
                    model.import_log_id == log.id, model.deleted_at.is_(None)).all():
                row.deleted_at = now
                counts[key] += 1
    else:
        # سجل قديم — رُفع قبل أن تحمل الحركات import_log_id. الحذف تقريبي: نفس
        # الحساب، وحركات أُنشئت خلال ٣ دقائق من وقت الرفع.
        if not force:
            raise HTTPException(409, detail=(
                'هذا الاستيراد قديم ولا تحمل حركاته ربطاً مباشراً به — سيُحذف تقريبياً '
                'كل حركة لنفس الحساب أُنشئت خلال ٣ دقائق من وقت هذا الرفع. '
                'أعد الطلب مع force=true للمتابعة.'))
        approximate = True
        window_start = log.created_at - _RESURRECTION_WINDOW
        window_end = log.created_at + _RESURRECTION_WINDOW
        if log.account:
            for row in db.query(models.Invoice).join(models.Supplier).filter(
                    models.Supplier.account == log.account,
                    models.Invoice.created_at >= window_start,
                    models.Invoice.created_at <= window_end,
                    models.Invoice.deleted_at.is_(None)).all():
                row.deleted_at = now
                counts['invoices'] += 1
            for row in db.query(models.Payment).join(models.Supplier).filter(
                    models.Supplier.account == log.account,
                    models.Payment.created_at >= window_start,
                    models.Payment.created_at <= window_end,
                    models.Payment.deleted_at.is_(None)).all():
                row.deleted_at = now
                counts['payments'] += 1
            for row in db.query(models.ContractorEntry).join(models.Contractor).filter(
                    models.Contractor.code == log.account,
                    models.ContractorEntry.created_at >= window_start,
                    models.ContractorEntry.created_at <= window_end,
                    models.ContractorEntry.deleted_at.is_(None)).all():
                row.deleted_at = now
                counts['entries'] += 1

    log.deleted_at = now
    db.commit()
    out = dict(deleted=counts)
    if approximate:
        out['approximate'] = True
    return out
