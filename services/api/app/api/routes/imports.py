# -*- coding: utf-8 -*-
"""الرفع — the renderer never touches the filesystem: Electron picks the path,
the backend reads it. That keeps the UI sandbox intact."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.ingest.csv_statement import CsvStatementParseError
from app.ingest.pdf_statement import StatementParseError
from app.ingest.suppliers_excel import SuppliersParseError
from app.schemas.common import BatchImportRequest, ImportRequest, PreviewRequest, ScanDirRequest
from app.services import import_service, receivables_service

router = APIRouter()

_PARSE_ERRORS = (StatementParseError, SuppliersParseError, CsvStatementParseError)


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
