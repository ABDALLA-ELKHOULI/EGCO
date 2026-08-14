# -*- coding: utf-8 -*-
"""الرفع والحفظ.

Rule that matters: an import is saved only if the computed balance reconciles with the
balance the statement itself prints. A wrong number in the database is worse than a
failed import, so a mismatch is reported and nothing is written.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import models
from app.domain import payables as P
from app.domain.payables import D, money
from decimal import Decimal
from app.ingest import (contractor_statement, csv_statement, pdf_statement,
                        receivables_excel, receivables_legacy, suppliers_excel)
from app.ingest.csv_statement import CsvStatementParseError
from app.ingest.pdf_statement import StatementParseError
from app.ingest.suppliers_excel import SuppliersParseError

STATEMENT_SOURCES = {'pdf_statement', 'csv_statement'}

_PARSERS = {
    'pdf_statement': pdf_statement.parse,
    'csv_statement': csv_statement.parse,
}

#: مصادر التحصيلات (الداخل) — تُحفظ عبر receivables_service لا عبر مسار الكشوفات
RECEIVABLE_SOURCES = {'receivables_legacy_html', 'receivables_excel'}

_PARSE_ERRORS = (StatementParseError, CsvStatementParseError, SuppliersParseError)

#: extension -> source classification for the folder scanner
_EXT_SOURCE = {
    '.pdf': 'pdf_statement',
    '.csv': 'csv_statement',
    '.xlsx': 'suppliers_excel',
    '.xlsm': 'suppliers_excel',
}


# ---------------------------------------------------------------- backup

def backup_db() -> None:
    """ينسخ قاعدة البيانات احتياطياً قبل أي عملية استيراد تكتب بيانات.

    Skips silently if the DB does not exist yet (first run). Keeps the newest 20
    backups and prunes older ones.
    """
    db_path = settings.DB_PATH
    if not db_path.exists():
        return
    backups_dir = settings.DATA_DIR / 'backups'
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    dest = backups_dir / f'egco-{stamp}.db'
    try:
        shutil.copy2(db_path, dest)
    except OSError:
        return
    existing = sorted(backups_dir.glob('egco-*.db'))
    for old in existing[:-20]:
        try:
            old.unlink()
        except OSError:
            pass


def import_suppliers(db: Session, path: str, backup: bool = True) -> dict:
    """رفع ملف مدد الموردين — upserts by account number."""
    parsed = suppliers_excel.parse(path)
    if backup:
        backup_db()
    created = updated = 0

    for s in parsed['suppliers']:
        row = db.query(models.Supplier).filter_by(account=s.account).one_or_none()
        if row is None:
            row = models.Supplier(account=s.account)
            db.add(row)
            created += 1
        else:
            updated += 1
        row.name = s.name
        row.project = s.project
        row.term_raw = s.term.raw
        row.term_kind = s.term.kind
        row.term_days = s.term.days

    log = models.ImportLog(source='suppliers_excel', path=path,
                           imported=created + updated, skipped=0, reconciled=1,
                           issues=json.dumps(parsed['issues'], ensure_ascii=False))
    db.add(log)
    db.commit()
    return dict(imported=created + updated, created=created, updated=updated,
                skipped=0, reconciled=True, issues=parsed['issues'])


# ---------------------------------------------------------------- contractor dispatch
#
# PDF statements are dispatched by WHO owns the account, not by its prefix: an account
# that exists in the Supplier table goes through the supplier (Invoice/Payment + FIFO)
# flow unchanged; any UNKNOWN account — whatever the prefix — goes through the
# contractor ledger flow instead of being rejected as 'unknown_supplier'. Real 211*
# statements exist that are not suppliers and can close negative, which the supplier
# FIFO flow cannot represent.

def _is_known_supplier(db: Optional[Session], account: Optional[str]) -> bool:
    if not account:
        return False
    if db is not None:
        return db.query(models.Supplier).filter_by(account=account).filter(
            models.Supplier.deleted_at.is_(None)).first() is not None
    # preview has no request-scoped session — open a short-lived one for the lookup.
    from app.db.session import SessionLocal
    s = SessionLocal()
    try:
        return s.query(models.Supplier).filter_by(account=account).filter(
            models.Supplier.deleted_at.is_(None)).first() is not None
    finally:
        s.close()


def _contractor_parsed_if_any(path: str, source: str,
                              db: Optional[Session]) -> Optional[dict]:
    """Return the contractor parse when this PDF should take the ledger flow.

    Known suppliers keep the supplier flow UNCHANGED — with two exceptions the
    supplier (Invoice/Payment + FIFO) flow structurally cannot represent, which fall
    back to the ledger flow even for a known supplier:
      * an opening-balance-only statement (zero CompanyCode blocks — pdf_statement
        raises on those);
      * a POSITIVE printed closing (the counterparty owes US; supplier outstanding
        can never reconcile against it).
    """
    if source != 'pdf_statement':
        return None
    parsed = contractor_statement.parse(path)
    if _is_known_supplier(db, parsed['account']):
        has_tx = any(r.get('kind') != 'opening' for r in parsed['rows'])
        positive = (parsed['printed_balance'] is not None
                    and parsed['printed_balance'] > 0)
        if has_tx and not positive:
            return None
    return parsed


def _contractor_preview(parsed: dict) -> dict:
    """Review-screen numbers for a contractor statement — computed vs printed,
    signed (the ledger convention), with kind='contractor' so the UI can label it."""
    rows = parsed['rows']
    debit_total = sum((D(r['debit']) for r in rows), Decimal('0'))
    credit_total = sum((D(r['credit']) for r in rows), Decimal('0'))
    computed = debit_total - credit_total
    stated = (D(parsed['printed_balance'])
              if parsed['printed_balance'] is not None else None)
    ok = stated is None or abs(computed - stated) <= Decimal('0.01')
    return dict(
        kind='contractor',
        account=parsed['account'], name=parsed['name'],
        rowCount=len(rows),
        totalDebit=money(debit_total), totalPaid=money(debit_total),
        totalCredit=money(credit_total), totalInvoiced=money(credit_total),
        computedBalance=money(computed),
        statementBalance=money(stated) if stated is not None else None,
        reconciled=bool(ok),
        difference=money(computed - stated) if stated is not None else None,
        issues=list(parsed['issues']),
    )


def preview_statement(path: str, source: str = 'pdf_statement',
                      db: Optional[Session] = None) -> dict:
    """قراءة بلا حفظ — powers the review screen (S5) before anything is written."""
    cparsed = _contractor_parsed_if_any(path, source, db)
    if cparsed is not None:
        return _contractor_preview(cparsed)
    parser = _PARSERS.get(source, pdf_statement.parse)
    parsed = parser(path)
    invoices, payments = parsed['invoices'], parsed['payments']
    # Invoice/Payment amounts are Decimal (domain layer); statement_balance arrives as
    # a float from the parser — normalise through D() before mixing them.
    total_inv = sum((D(i.amount) for i in invoices), Decimal('0'))
    total_pay = sum((D(p.amount) for p in payments), Decimal('0'))
    computed = total_inv - total_pay
    stated = D(parsed['statement_balance']) if parsed['statement_balance'] is not None else None
    ok = stated is None or abs(computed - abs(stated)) <= Decimal('0.01')

    issues = list(parsed['issues'])
    if stated is None and source == 'csv_statement':
        issues.append(dict(severity='warning', row=None,
                           message='لا يحتوي CSV على رصيد للمطابقة'))

    return dict(
        account=parsed['account'],
        invoiceCount=len(invoices), paymentCount=len(payments),
        totalInvoiced=money(total_inv), totalPaid=money(total_pay),
        computedBalance=money(computed),
        statementBalance=money(abs(stated)) if stated is not None else None,
        reconciled=bool(ok),
        difference=money(computed - abs(stated)) if stated is not None else None,
        issues=issues,
    )


def commit_statement(db: Session, path: str, allow_unreconciled: bool = False,
                     source: str = 'pdf_statement', backup: bool = True) -> dict:
    """الحفظ — refuses to write when the parse does not reconcile."""
    cparsed = _contractor_parsed_if_any(path, source, db)
    if cparsed is not None:
        return _commit_contractor(db, cparsed, path,
                                  allow_unreconciled=allow_unreconciled, backup=backup)
    parser = _PARSERS.get(source, pdf_statement.parse)
    parsed = parser(path)
    pre = preview_statement(path, source)

    if not pre['reconciled'] and not allow_unreconciled:
        return dict(saved=False, reason='not_reconciled', **pre)

    account = parsed['account']
    if not account:
        return dict(saved=False, reason='no_account', **pre)
    supplier = db.query(models.Supplier).filter_by(account=account).one_or_none()
    if supplier is None:
        return dict(saved=False, reason='unknown_supplier', **pre)

    if backup:
        backup_db()

    # ImportLog is created FIRST (flushed for its id) so every row this import creates
    # or resurrects can be stamped with import_log_id — that stamp is what lets the
    # uploaded-files screen delete exactly this import's rows later.
    log = models.ImportLog(source=source, path=path, account=account or '',
                           imported=0, skipped=0, reconciled=1 if pre['reconciled'] else 0,
                           issues=json.dumps(pre['issues'], ensure_ascii=False))
    db.add(log)
    db.flush()

    added = skipped = 0
    for inv in parsed['invoices']:
        exists = db.query(models.Invoice).filter_by(
            supplier_id=supplier.id, number=inv.number, date=inv.date,
            amount=inv.amount).one_or_none()
        if exists:
            # a soft-deleted row matching this identity is resurrected, not skipped —
            # otherwise upload -> delete -> re-upload silently imports 0 rows.
            if exists.deleted_at is not None:
                exists.deleted_at = None
                exists.import_log_id = log.id
                added += 1
            else:
                skipped += 1
            continue
        db.add(models.Invoice(supplier_id=supplier.id, number=inv.number, date=inv.date,
                              amount=inv.amount, doc=inv.doc, description=inv.description,
                              source=source, import_log_id=log.id))
        added += 1

    for pay in parsed['payments']:
        exists = db.query(models.Payment).filter_by(
            supplier_id=supplier.id, doc=pay.doc, date=pay.date,
            amount=pay.amount).one_or_none()
        if exists:
            if exists.deleted_at is not None:
                exists.deleted_at = None
                exists.import_log_id = log.id
                added += 1
            else:
                skipped += 1
            continue
        db.add(models.Payment(supplier_id=supplier.id, date=pay.date, amount=pay.amount,
                              doc=pay.doc, description=pay.description, source=source,
                              import_log_id=log.id))
        added += 1

    log.imported = added
    log.skipped = skipped
    db.commit()
    out = dict(pre)
    out.update(saved=True, added=added, skipped=skipped,
               supplier=dict(account=supplier.account, name=supplier.name))
    return out


def _commit_contractor(db: Session, parsed: dict, path: str,
                       allow_unreconciled: bool = False, backup: bool = True) -> dict:
    """حفظ كشف مقاول/متعامل — same reconciliation contract as the supplier flow:
    the computed signed balance must equal the printed «اجمالي الحساب», with the same
    allow_unreconciled escape hatch."""
    pre = _contractor_preview(parsed)

    if not pre['reconciled'] and not allow_unreconciled:
        return dict(saved=False, reason='not_reconciled', **pre)
    if not parsed['account']:
        return dict(saved=False, reason='no_account', **pre)

    if backup:
        backup_db()

    log = models.ImportLog(source='pdf_statement', path=path, account=parsed['account'],
                           imported=0, skipped=0, reconciled=1 if pre['reconciled'] else 0,
                           issues=json.dumps(pre['issues'], ensure_ascii=False))
    db.add(log)
    db.flush()

    from app.services import contractors_service
    res = contractors_service.upsert_from_statement(db, parsed, path, import_log_id=log.id)

    log.imported = res['added']
    log.skipped = res['skipped']
    db.commit()
    out = dict(pre)
    out.update(saved=True, added=res['added'], skipped=res['skipped'],
               contractor=res['contractor'])
    return out


# ---------------------------------------------------------------- folder scan

def scan_dir(dir_path: str) -> dict:
    """مسح مجلد — non-recursive listing classified by extension.

    Raises NotADirectoryError if `dir_path` does not exist or is not a directory;
    the route maps that to a 404 with an Arabic detail.
    """
    if not os.path.isdir(dir_path):
        raise NotADirectoryError(dir_path)

    files: List[dict] = []
    skipped: List[dict] = []
    with os.scandir(dir_path) as it:
        entries = sorted(it, key=lambda e: e.name)
    for entry in entries:
        if not entry.is_file():
            continue
        name = entry.name
        ext = os.path.splitext(name)[1].lower()
        source = _EXT_SOURCE.get(ext)
        if source is None:
            skipped.append(dict(name=name, reason='صيغة غير مدعومة'))
            continue
        try:
            size_kb = round(entry.stat().st_size / 1024)
        except OSError:
            size_kb = 0
        files.append(dict(path=entry.path, name=name, source=source, sizeKb=size_kb))

    return dict(dir=dir_path, files=files, skipped=skipped)


# ---------------------------------------------------------------- batch import

def _classify(path: str) -> Optional[str]:
    ext = os.path.splitext(path)[1].lower()
    return _EXT_SOURCE.get(ext)


def _classify_xlsx(path: str) -> str:
    """يميّز ملف Excel: تقرير انحراف موازنة أم ملف موردين.

    Extension alone cannot tell them apart, and feeding a budget workbook to the
    suppliers parser produced a confusing read_error — the user's actual complaint
    was that the app never says WHAT it detected. Peeking sheet names is cheap.
    """
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True)
        names = wb.sheetnames
        wb.close()
        if any('انحراف' in n for n in names):
            return 'budget_deviation'
    except Exception:
        pass
    return 'suppliers_excel'


#: what the app understood the file to be — shown per-file in the import result
DETECTED_LABELS = {
    'suppliers_excel': 'ملف مدد الموردين',
    'budget_deviation': 'تقرير انحراف الموازنة',
    'pdf_statement': 'كشف حساب (PDF)',
    'csv_statement': 'كشف حساب (CSV)',
    'supplier': 'كشف حساب مورد',
    'contractor': 'كشف حساب مقاول/متعامل',
    None: 'صيغة غير معروفة',
}


def batch_import(db: Session, paths: List[str], allow_unreconciled: bool = False) -> dict:
    """استيراد دفعة ملفات — one backup for the whole batch, suppliers files first,
    a bad file never aborts the rest. Every row reports what the file was DETECTED
    as, and re-uploads that add nothing are flagged 'duplicate' instead of 'saved'."""
    backup_db()

    ordered = sorted(paths, key=lambda p: 0 if _classify(p) == 'suppliers_excel' else 1)

    results: List[dict] = []
    saved = 0
    duplicates = 0
    seen_paths = set()

    for path in ordered:
        name = os.path.basename(path)
        source = _classify(path)
        row = dict(path=path, name=name, source=source, status='read_error',
                   detected=DETECTED_LABELS.get(source, DETECTED_LABELS[None]),
                   account=None, supplierName=None, added=0, skipped=0,
                   computedBalance=None, statementBalance=None, message='')
        try:
            # نفس الملف مرتين في نفس الدفعة — يحدث عند اختيار مجلد ثم إضافة ملفات يدوياً
            key = os.path.normcase(os.path.abspath(path))
            if key in seen_paths:
                row['status'] = 'duplicate'
                row['message'] = 'نفس الملف مكرر داخل هذه الدفعة — تم تجاهله'
                duplicates += 1
                results.append(row)
                continue
            seen_paths.add(key)

            if source is None:
                row['message'] = ('صيغة غير مدعومة — الصيغ المقبولة: PDF كشف حساب، '
                                  'Excel موردين أو موازنة، CSV كشف حساب')
                results.append(row)
                continue
            if not os.path.isfile(path):
                row['message'] = 'الملف غير موجود'
                results.append(row)
                continue

            if source == 'suppliers_excel':
                kind = _classify_xlsx(path)
                row['detected'] = DETECTED_LABELS[kind]
                if kind == 'budget_deviation':
                    from app.services import budget_service
                    bres = budget_service.import_budget(db, path)
                    row['status'] = 'saved'
                    row['added'] = bres.get('imported', 0) + bres.get('updated', 0)
                    if bres.get('imported', 0) == 0 and bres.get('updated', 0) > 0:
                        row['message'] = ('تم تحديث لقطات موازنة موجودة (%d) — '
                                          'الملف مرفوع سابقاً' % bres['updated'])
                    else:
                        row['message'] = 'تم استيراد %d لقطة موازنة لمشاريع: %s' % (
                            row['added'], '، '.join(bres.get('projects', [])))
                    saved += 1
                    results.append(row)
                    continue
                res = import_suppliers(db, path, backup=False)
                row['added'] = res['imported']
                if res['imported'] == 0:
                    row['status'] = 'duplicate'
                    row['message'] = 'لا موردين جدد — الملف مرفوع سابقاً'
                    duplicates += 1
                else:
                    row['status'] = 'saved'
                    row['message'] = 'تم استيراد %d مورد' % res['imported']
                    saved += 1
            else:
                res = commit_statement(db, path, allow_unreconciled=allow_unreconciled,
                                       source=source, backup=False)
                row['account'] = res.get('account')
                row['computedBalance'] = res.get('computedBalance')
                row['statementBalance'] = res.get('statementBalance')
                if res.get('saved'):
                    row['added'] = res.get('added', 0)
                    row['skipped'] = res.get('skipped', 0)
                    is_contractor = res.get('kind') == 'contractor'
                    row['detected'] = DETECTED_LABELS['contractor' if is_contractor
                                                      else 'supplier']
                    party = (res.get('contractor') if is_contractor
                             else res.get('supplier')) or {}
                    row['supplierName'] = party.get('name')
                    # أُعيد رفع كشف سبق حفظه — كل حركاته موجودة، لم يُضف شيء
                    if row['added'] == 0 and row['skipped'] > 0:
                        row['status'] = 'duplicate'
                        row['message'] = 'مكرر — هذا الكشف مرفوع سابقاً ولا حركات جديدة فيه'
                        duplicates += 1
                    else:
                        row['status'] = 'saved'
                        row['message'] = ('تم حفظ كشف مقاول/متعامل' if is_contractor
                                          else 'تم الحفظ بنجاح')
                        saved += 1
                else:
                    reason = res.get('reason')
                    if reason == 'not_reconciled':
                        row['status'] = 'not_reconciled'
                        row['message'] = 'الرصيد المحسوب لا يطابق رصيد الكشف'
                    elif reason == 'unknown_supplier':
                        row['status'] = 'unknown_supplier'
                        row['message'] = 'رقم الحساب غير موجود في ملف مدد الموردين'
                    elif reason == 'no_account':
                        row['status'] = 'no_account'
                        row['message'] = 'تعذر تحديد رقم الحساب من الملف'
                    else:
                        row['status'] = 'read_error'
                        row['message'] = 'تعذرت قراءة الملف'
        except _PARSE_ERRORS as e:
            row['status'] = 'read_error'
            row['message'] = str(e)
        except Exception as e:  # a single bad file must never abort the batch
            row['status'] = 'read_error'
            row['message'] = 'خطأ غير متوقع أثناء القراءة: %s' % e
        results.append(row)

    failed = len(results) - saved - duplicates
    return dict(total=len(results), saved=saved, duplicates=duplicates,
                failed=failed, results=results)
