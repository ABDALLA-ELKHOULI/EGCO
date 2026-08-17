# -*- coding: utf-8 -*-
"""الرفع والحفظ.

Rule that matters: an import is saved only if the computed balance reconciles with the
balance the statement itself prints. A wrong number in the database is worse than a
failed import, so a mismatch is reported and nothing is written.
"""
from __future__ import annotations

import datetime as dt
import difflib
import json
import os
import re
import shutil
import unicodedata
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import models
from app.domain import payables as P
from app.domain.payables import D, money, parse_term
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


# ---------------------------------------------------------------- تحذير التكرار المحتمل
#
# القيد الفريد (uq_invoice_identity) يمنع الصف المطابق حرفياً فقط: الحركة نفسها إذا
# أُعيد إصدار سندها برقم آخر (أو اختلف وصفها بين تصديرين متداخلين) تحمل هوية مختلفة،
# فتمرّ من الفلترة ومن القيد معاً وتُضاعف المبلغ بصمت. هذا القسم يرصد هذه الحالة
# ويعرضها فقط — لا يحذف ولا يدمج ولا يمنع الحفظ: القرار للمستخدم وحده، ولأن
# «فاتورتان بنفس اليوم والمبلغ» حالة مشروعة تماماً (ولهذا الوصف والمستند جزء من
# الهوية أصلاً — انظر تعليق uq_invoice_identity).
#
# لماذا لا يكفي «نفس التاريخ ونفس المبلغ»؟ قياسٌ على قاعدة المستخدم الحقيقية أعطى
# ٨٧ زوجاً بهذه القاعدة، جميعها تقريباً فواتير مستقلة من مورد واحد بنفس اليوم
# والقيمة (ارتك: بلاط بسعر ثابت، عدة فواتير يومياً) تختلف في **رقم الفاتورة**.
# ورقم الفاتورة هو مفتاح النظام المحاسبي نفسه: اختلافه يعني حركتين مختلفتين قطعاً.
# لذلك نشترط أن يبدو الطرفان الحركة نفسها:
#   • رقما فاتورة موجودان ومختلفان        -> حركتان مختلفتان، لا تحذير.
#   • رقما فاتورة موجودان ومتطابقان        -> نفس الفاتورة بسندين -> تحذير.
#   • رقم مفقود (كشوف CSV والدفعات)        -> نقارن أرقام الوصف نفسه: أرقام الوصف
#     بعد استبعاد رقم السند (الذي يُتوقّع اختلافه) يجب أن تتطابق، مع تشابه نصي عالٍ.
# بهذه القاعدة نزل العدد على نفس القاعدة الحقيقية من ٨٧ إلى صفر (لا تكرار محتمل
# قائماً اليوم)، أي أن التحذير حين يظهر يستحق النظر فعلاً.

#: نص التحذير كما طلبه المستخدم — يسبق تفاصيل الحركتين
NEAR_DUP_MESSAGE = ('حركتان بنفس التاريخ والمبلغ ويختلف سندهما — '
                    'تأكّد أنهما ليستا حركة واحدة')

#: أقصى عدد تحذيرات تُرسل مع الملف الواحد — كشف مشوّه قد يولّد مئات الأزواج،
#: وقائمة لا تُقرأ لا تفيد أحداً. الباقي يُلخَّص في سطر واحد.
_NEAR_DUP_LIMIT = 20

#: حد التشابه النصي حين لا يوجد رقم فاتورة نحتكم إليه
_NEAR_DUP_TEXT_RATIO = 0.75

_ND_DIAC = re.compile('[ً-ْ]')
_ND_DIGITS = re.compile(r'\d+')


def _nd_norm(text: Optional[str]) -> str:
    """توحيد النص العربي قبل المقارنة — الكشوف تكتب نفس الكلمة بأشكال مختلفة
    (فاتوره/فاتورة، ارتك/ارتكك، ي/ى) وأحياناً بمحارف عرض مختلفة تماماً."""
    s = unicodedata.normalize('NFKC', text or '')
    s = s.replace('ـ', '')                     # التطويل
    s = _ND_DIAC.sub('', s)
    s = s.replace('ى', 'ي').replace('ة', 'ه')
    s = s.replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا')
    return re.sub(r'\s+', ' ', s).strip()


def _nd_num(text: Optional[str]) -> str:
    """رقم بلا أصفار بادئة — السند يُكتب 00002143 في عمود ويُذكر 2143 في الوصف."""
    return (text or '').strip().lstrip('0')


def _nd_desc_digits(description: Optional[str], docs: Tuple[str, ...]) -> frozenset:
    """أرقام الوصف بعد استبعاد أرقام السندات نفسها.

    الوصف عادةً يحمل رقم الفاتورة («فاتورة14553760 شركة مدار») وهو ما يفرّق حركتين
    مستقلتين حتى لو تطابق كل شيء آخر؛ بينما رقم السند يُتوقّع اختلافه في الحالة التي
    نبحث عنها أصلاً، فلا يصحّ أن يُحسب فرقاً."""
    skip = set(_nd_num(d) for d in docs if _nd_num(d))
    return frozenset(n for n in (_nd_num(m) for m in _ND_DIGITS.findall(description or ''))
                     if n and n not in skip)


def _nd_identity(row: dict) -> tuple:
    return (row.get('number') or '', row.get('doc') or '', row.get('description') or '')


def _nd_bucket(row: dict) -> tuple:
    """المجموعة التي يُبحث داخلها فقط: نفس نوع السجل ونفس التاريخ ونفس المبلغ
    بالضبط (المبلغ Decimal مقرّب مرة واحدة عند الحد)."""
    return (row['kind'], row['date'], money(row['amount']))


def _nd_same_transaction(a: dict, b: dict) -> bool:
    """هل يبدو الصفّان الحركة الواحدة نفسها بسند/وصف مختلف؟ (انظر شرح القاعدة أعلاه)"""
    if _nd_identity(a) == _nd_identity(b):
        return False        # تطابق حرفي — يعالجه القيد الفريد وفلترة التكرار، لا هنا
    an, bn = (a.get('number') or '').strip(), (b.get('number') or '').strip()
    if an and bn:
        return an == bn
    docs = (a.get('doc') or '', b.get('doc') or '')
    if _nd_desc_digits(a.get('description'), docs) != _nd_desc_digits(b.get('description'), docs):
        return False
    ratio = difflib.SequenceMatcher(
        None, _nd_norm(a.get('description')), _nd_norm(b.get('description'))).ratio()
    return ratio >= _NEAR_DUP_TEXT_RATIO


def _nd_side(row: dict) -> dict:
    return dict(number=row.get('number') or None, doc=row.get('doc') or '',
                description=row.get('description') or '')


def _nd_issue(a: dict, b: dict, scope: str) -> dict:
    """تحذير واحد بصيغة `issues` المستعملة في كل مكان (severity/row/message) مع حقول
    إضافية مُهيكلة — تُخزَّن كما هي في ImportLog.issues فتُقرأ بعد الرفع بأيام."""
    amount = money(a['amount'])
    date_str = a['date'].isoformat() if hasattr(a['date'], 'isoformat') else str(a['date'])
    detail = ('%s · %s · %s ر.س · سند %s «%s» مقابل سند %s «%s»' % (
        NEAR_DUP_MESSAGE, date_str, ('%.2f' % abs(amount)),
        a.get('doc') or '—', (a.get('description') or '').strip() or '—',
        b.get('doc') or '—', (b.get('description') or '').strip() or '—'))
    return dict(severity='warning', row=None, message=detail,
                kind='near_duplicate', scope=scope, ledger=a['kind'],
                date=date_str, amount=amount,
                a=_nd_side(a), b=_nd_side(b))


def _nd_row(kind: str, date, amount, doc, description,
            number: Optional[str] = None) -> dict:
    return dict(kind=kind, date=date, amount=D(amount), doc=doc or '',
                description=description or '', number=number)


def find_near_duplicates(incoming: List[dict],
                         existing: Optional[List[dict]] = None) -> List[dict]:
    """تحذيرات التكرار المحتمل: داخل الملف نفسه (scope='file') ومقابل ما هو محفوظ
    للطرف نفسه (scope='db'). لا تحذف ولا تعدّل شيئاً — تصف فقط."""
    buckets = {}
    for row in (existing or []):
        buckets.setdefault(_nd_bucket(row), []).append(row)

    issues: List[dict] = []
    seen = set()
    extra = 0
    incoming_buckets = {}

    for row in incoming:
        key = _nd_bucket(row)
        for other, scope in ([(o, 'file') for o in incoming_buckets.get(key, [])] +
                             [(o, 'db') for o in buckets.get(key, [])]):
            if not _nd_same_transaction(row, other):
                continue
            sig = (key, scope) + tuple(sorted((_nd_identity(row), _nd_identity(other))))
            if sig in seen:
                continue
            seen.add(sig)
            if len(issues) >= _NEAR_DUP_LIMIT:
                extra += 1
                continue
            issues.append(_nd_issue(other, row, scope))
        incoming_buckets.setdefault(key, []).append(row)

    if extra:
        issues.append(dict(severity='warning', row=None, kind='near_duplicate_more',
                           message='و%d حالة أخرى مشابهة لم تُعرض هنا' % extra))
    return issues


def _nd_rows_from_parsed(parsed: dict) -> List[dict]:
    """صفوف الكشف الواردة (مورد) بالشكل الذي يفهمه الفاحص."""
    rows = [_nd_row('invoice', i.date, i.amount, i.doc, i.description, i.number)
            for i in parsed['invoices']]
    rows += [_nd_row('payment', p.date, p.amount, p.doc, p.description)
             for p in parsed['payments']]
    return rows


def _nd_rows_from_supplier(db: Optional[Session], supplier_id: Optional[str]) -> List[dict]:
    """الحركات الحيّة المحفوظة لهذا المورد — المحذوفة منطقياً لا تُقارن (نفس عرف
    الحذف الناعم في بقية النظام: صفٌّ محذوف غير موجود)."""
    if db is None or not supplier_id:
        return []
    rows = [_nd_row('invoice', i.date, i.amount, i.doc, i.description, i.number)
            for i in db.query(models.Invoice).filter(
                models.Invoice.supplier_id == supplier_id,
                models.Invoice.deleted_at.is_(None)).all()]
    rows += [_nd_row('payment', p.date, p.amount, p.doc, p.description)
             for p in db.query(models.Payment).filter(
                models.Payment.supplier_id == supplier_id,
                models.Payment.deleted_at.is_(None)).all()]
    return rows


def _nd_rows_from_contractor(db: Optional[Session], contractor_id: Optional[str]) -> List[dict]:
    if db is None or not contractor_id:
        return []
    # المبلغ موقّع (مدين − دائن) كي لا يُقارن قيد مدين بقيد دائن بنفس القيمة
    return [_nd_row('entry', e.date, D(e.debit) - D(e.credit), e.doc, e.description)
            for e in db.query(models.ContractorEntry).filter(
                models.ContractorEntry.contractor_id == contractor_id,
                models.ContractorEntry.deleted_at.is_(None)).all()]


def _nd_supplier_issues(db: Optional[Session], parsed: dict) -> List[dict]:
    supplier = None
    if db is not None and parsed.get('account'):
        supplier = db.query(models.Supplier).filter_by(
            account=parsed['account']).filter(
            models.Supplier.deleted_at.is_(None)).one_or_none()
    return find_near_duplicates(
        _nd_rows_from_parsed(parsed),
        _nd_rows_from_supplier(db, supplier.id if supplier is not None else None))


def _nd_contractor_issues(db: Optional[Session], parsed: dict) -> List[dict]:
    contractor = None
    if db is not None and parsed.get('account'):
        contractor = db.query(models.Contractor).filter_by(
            code=parsed['account']).filter(
            models.Contractor.deleted_at.is_(None)).one_or_none()
    incoming = [_nd_row('entry', r['date'], D(r['debit']) - D(r['credit']),
                        r.get('doc'), r.get('description'))
                for r in parsed['rows']]
    return find_near_duplicates(
        incoming, _nd_rows_from_contractor(db, contractor.id if contractor is not None else None))


def near_duplicates_for_account(db: Session, account: str) -> dict:
    """كل التكرارات المحتملة القائمة الآن لحساب واحد — تُطلب بعد الرفع بأيام.

    تُحسب من الحركات المحفوظة نفسها (لا من سجل الرفع) كي تشمل ما يمتدّ بين ملفين
    مرفوعين في وقتين مختلفين — وهي بالضبط الحالة التي لا يمكن لأي ملف وحده كشفها.
    """
    supplier = db.query(models.Supplier).filter_by(account=account).filter(
        models.Supplier.deleted_at.is_(None)).one_or_none()
    if supplier is not None:
        rows = _nd_rows_from_supplier(db, supplier.id)
        return dict(account=account, name=supplier.name, kind='supplier',
                    pairs=find_near_duplicates(rows))
    contractor = db.query(models.Contractor).filter_by(code=account).filter(
        models.Contractor.deleted_at.is_(None)).one_or_none()
    if contractor is not None:
        rows = _nd_rows_from_contractor(db, contractor.id)
        return dict(account=account, name=contractor.name, kind='contractor',
                    pairs=find_near_duplicates(rows))
    return dict(account=account, name=None, kind=None, pairs=[])


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


# ---------------------------------------------------------------- account-prefix dispatch
#
# REPLACED (see task: "strict account-prefix dispatch"): dispatch used to be by WHO
# owns the account (known-supplier lookup) with structural fallbacks (opening-only /
# positive-closing statements fell back to the contractor ledger flow even for a known
# supplier). That let a mis-scanned or renumbered account silently land in the wrong
# flow. The user-stated rule is now absolute and prefix-only:
#   '211' -> supplier flow      '212' -> contractor ledger flow
#   '216' -> guarantee flow     anything else -> ASK (never guess) via
#            AccountClassification; unclassified files are not saved.
# A stored AccountClassification overrides the ask-me step for non-211/212/216
# accounts once the user (optionally AI-assisted) has answered for that account.

def _account_prefix(account: Optional[str]) -> str:
    return (account or '')[:3]


def _classification_for(db: Optional[Session], account: str) -> Optional['models.AccountClassification']:
    if not account:
        return None
    if db is not None:
        return db.query(models.AccountClassification).filter_by(account=account).one_or_none()
    from app.db.session import SessionLocal
    s = SessionLocal()
    try:
        return s.query(models.AccountClassification).filter_by(account=account).one_or_none()
    finally:
        s.close()


def dispatch_kind(db: Optional[Session], account: Optional[str]) -> Optional[str]:
    """'supplier' | 'contractor' | 'guarantee' | None (needs_classification)."""
    prefix = _account_prefix(account)
    if prefix == '211':
        return 'supplier'
    if prefix == '212':
        return 'contractor'
    if prefix == '216':
        return 'guarantee'
    cls = _classification_for(db, account or '')
    if cls is not None and cls.kind in ('supplier', 'contractor', 'guarantee'):
        return cls.kind
    return None


def _contractor_parsed_if_any(path: str, source: str,
                              db: Optional[Session]) -> Optional[dict]:
    """Return the contractor parse when this PDF's account dispatches to the ledger flow
    ('212', or a stored classification of 'contractor').

    NOTE: commit_statement()/batch_import() no longer call this — they probe the
    account once via contractor_statement.parse() and dispatch directly on
    dispatch_kind() (see commit_statement below) to avoid re-parsing the same PDF
    twice per commit. This helper is kept only for preview_statement()'s contractor
    branch, which still relies on it."""
    if source != 'pdf_statement':
        return None
    parsed = contractor_statement.parse(path)
    if dispatch_kind(db, parsed['account']) == 'contractor':
        return parsed
    return None


def _contractor_preview(parsed: dict, db: Optional[Session] = None) -> dict:
    """Review-screen numbers for a contractor statement — computed vs printed,
    signed (the ledger convention), with kind='contractor' so the UI can label it."""
    rows = parsed['rows']
    debit_total = sum((D(r['debit']) for r in rows), Decimal('0'))
    credit_total = sum((D(r['credit']) for r in rows), Decimal('0'))
    computed = debit_total - credit_total
    stated = (D(parsed['printed_balance'])
              if parsed['printed_balance'] is not None else None)
    ok = stated is None or abs(computed - stated) <= Decimal('0.01')
    # تحذير معلوماتي بحت — لا يدخل في `ok` ولا يغيّر بوابة المطابقة إطلاقاً
    near_dups = _nd_contractor_issues(db, parsed)
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
        issues=list(parsed['issues']) + near_dups,
        nearDuplicates=near_dups,
    )


def _needs_classification_preview(parsed: dict) -> dict:
    """Unknown-prefix account with no stored AccountClassification: ask, don't guess.
    Never saved — status is surfaced by the caller as 'needs_classification'."""
    from app.services import ai_features_service
    try:
        ai_suggestion = ai_features_service.suggest_account_kind(
            account=parsed['account'], name=parsed['name'],
            excerpt=parsed.get('name', ''))
    except Exception:
        ai_suggestion = None  # AI is best-effort only — never blocks classification
    return dict(
        kind='needs_classification',
        account=parsed['account'], name=parsed['name'],
        reconciled=False,
        message='رقم الحساب %s ليس مورداً (211) ولا مقاولاً (212) ولا ضماناً (216) — '
                'يحتاج تصنيفاً يدوياً' % (parsed['account'] or '?'),
        aiSuggestion=ai_suggestion,
        issues=list(parsed.get('issues', [])),
    )


def preview_statement(path: str, source: str = 'pdf_statement',
                      db: Optional[Session] = None) -> dict:
    """قراءة بلا حفظ — powers the review screen (S5) before anything is written."""
    if source == 'pdf_statement':
        probe = contractor_statement.parse(path)
        k = dispatch_kind(db, probe['account'])
        if k is None:
            return _needs_classification_preview(probe)
        if k == 'guarantee':
            from app.services import guarantees_service
            return guarantees_service.preview(probe)
    cparsed = _contractor_parsed_if_any(path, source, db)
    if cparsed is not None:
        return _contractor_preview(cparsed, db)
    parser = _PARSERS.get(source, pdf_statement.parse)
    parsed = parser(path)
    invoices, payments = parsed['invoices'], parsed['payments']
    # Invoice/Payment amounts are Decimal (domain layer); statement_balance arrives as
    # a float from the parser — normalise through D() before mixing them.
    total_inv = sum((D(i.amount) for i in invoices), Decimal('0'))
    total_pay = sum((D(p.amount) for p in payments), Decimal('0'))
    computed = total_inv - total_pay
    stated = D(parsed['statement_balance']) if parsed['statement_balance'] is not None else None
    # المطابقة بالإشارة لا بالمقدار: الكشف يطبع السالب حين نكون نحن المدينين
    # (قنبر −80,049.95 ونحن ندين له بها)، والموجب حين يكون الطرف مديناً لنا
    # (بيت الاباء +474,147.10 بعد أن دفعنا له مقدماً). أي:  computed == −stated.
    #
    # Comparing magnitudes (the old `abs`) made an overpaid supplier look like a
    # mismatch and blocked its import entirely — the file could never be saved.
    ok = stated is None or abs(computed + stated) <= Decimal('0.01')

    issues = list(parsed['issues'])
    if stated is None and source == 'csv_statement':
        issues.append(dict(severity='warning', row=None,
                           message='لا يحتوي CSV على رصيد للمطابقة'))
    # تحذير معلوماتي بحت: يُضاف بعد حساب `ok` ولا يُقرأ في أي شرط حفظ — ملف مطابق
    # يبقى مطابقاً وملف غير مطابق يبقى مرفوضاً.
    near_dups = _nd_supplier_issues(db, parsed)
    issues += near_dups

    return dict(
        account=parsed['account'],
        invoiceCount=len(invoices), paymentCount=len(payments),
        totalInvoiced=money(total_inv), totalPaid=money(total_pay),
        computedBalance=money(computed),
        # يُعرض بنفس اتجاه «المديونية» (موجب = علينا) ليقارن بصرياً بالمحسوب أعلاه
        statementBalance=money(-stated) if stated is not None else None,
        reconciled=bool(ok),
        difference=money(computed + stated) if stated is not None else None,
        issues=issues,
        nearDuplicates=near_dups,
    )


def commit_statement(db: Session, path: str, allow_unreconciled: bool = False,
                     source: str = 'pdf_statement', backup: bool = True,
                     create_supplier: Optional[dict] = None) -> dict:
    """الحفظ — refuses to write when the parse does not reconcile.

    Dispatches on dispatch_kind() exactly like preview_statement(): a PDF's account
    is probed once (contractor_statement.parse reads the generic block format used
    by both the contractor and guarantee flows) and routed to the matching commit
    helper. An unknown-prefix account with no stored AccountClassification is never
    saved — reason='needs_classification' — so the caller (batch_import / the route)
    can surface the تصنيف flow instead of guessing.
    """
    if source == 'pdf_statement':
        probe = contractor_statement.parse(path)
        kind = dispatch_kind(db, probe['account'])
        if kind is None:
            pre = _needs_classification_preview(probe)
            return dict(saved=False, reason='needs_classification', **pre)
        if kind == 'guarantee':
            return _commit_guarantee(db, probe, path,
                                     allow_unreconciled=allow_unreconciled, backup=backup)
        if kind == 'contractor':
            return _commit_contractor(db, probe, path,
                                      allow_unreconciled=allow_unreconciled, backup=backup)
        # kind == 'supplier' -> falls through to the generic supplier flow below,
        # byte-identical to the pre-dispatch-rework behaviour.

    parser = _PARSERS.get(source, pdf_statement.parse)
    parsed = parser(path)
    pre = preview_statement(path, source, db)

    if not pre['reconciled'] and not allow_unreconciled:
        return dict(saved=False, reason='not_reconciled', **pre)

    account = parsed['account']
    if not account:
        return dict(saved=False, reason='no_account', **pre)
    supplier = db.query(models.Supplier).filter_by(account=account).one_or_none()
    if supplier is None:
        # كشف مطابق تماماً لحساب لم نره من قبل. رفضه صمتاً هو ما جعل ملفاً سليماً
        # «يُرفع بنجاح» دون أن يتغيّر رقم واحد — أسوأ من رسالة خطأ صريحة.
        # نعيد اسم الطرف من الترويسة كي يعرضه المستخدم ويقرّر: أضِفه أم لا.
        # ولا نُنشئه تلقائياً: مدة السداد غير معروفة، وهي التي تحدّد تواريخ
        # الاستحقاق ومنها التأخر كله — تخمينها يلوّن الشاشة بمتأخرات وهمية.
        if not create_supplier:
            return dict(saved=False, reason='unknown_supplier',
                        suggestedName=parsed.get('name') or '', **pre)
        supplier = models.Supplier(
            account=account,
            name=(create_supplier.get('name') or parsed.get('name') or account),
            project=(create_supplier.get('project') or ''),
            term_raw=(create_supplier.get('term') or ''))
        t = parse_term(supplier.term_raw)
        supplier.term_kind, supplier.term_days = t.kind, t.days
        db.add(supplier)
        db.flush()

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
        # الهوية تشمل المستند والوصف — سطران يتطابقان في الرقم والتاريخ والمبلغ
        # ويختلفان في المستند/الوصف هما حركتان مختلفتان، لا تكراراً.
        # .first() لا .one_or_none(): قواعد قديمة قد تحوي صفين متطابقين فيرفع
        # one_or_none استثناءً يُفشل الملف كله.
        # ‏db.flush() قبل الاستعلام: الجلسة تعمل بـ autoflush=False، فصفٌّ أُضيف
        # قبل قليل في هذه الحلقة نفسها لا يراه الاستعلام. كشفٌ يحمل سطرين
        # متطابقين تماماً (وهو وارد) كان يمرّ بكليهما كأنهما جديدان، ثم يصطدم
        # بقيد الهوية عند الحفظ فيفشل **الملف كله** برسالة ٥٠٠ لا معنى لها.
        db.flush()
        exists = db.query(models.Invoice).filter_by(
            supplier_id=supplier.id, number=inv.number, date=inv.date,
            amount=inv.amount, doc=inv.doc,
            description=inv.description).first()
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
        db.flush()          # نفس السبب أعلاه — الدفعات المتطابقة أشيع من الفواتير
        exists = db.query(models.Payment).filter_by(
            supplier_id=supplier.id, doc=pay.doc, date=pay.date,
            amount=pay.amount, description=pay.description).first()
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
    pre = _contractor_preview(parsed, db)

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


def _commit_guarantee(db: Session, parsed: dict, path: str,
                      allow_unreconciled: bool = False, backup: bool = True) -> dict:
    """حفظ كشف ضمان (216) — same reconciliation contract: computed retention held
    (Σcredit − Σdebit including opening) must equal the printed closing (in magnitude),
    with the same allow_unreconciled escape hatch as every other statement flow."""
    from app.services import guarantees_service
    pre = guarantees_service.preview(parsed)

    if not pre['reconciled'] and not allow_unreconciled:
        return dict(saved=False, reason='not_reconciled', **pre)
    if not parsed['account']:
        return dict(saved=False, reason='no_account', **pre)

    if backup:
        backup_db()

    # ImportLog created FIRST (flushed for id) so every GuaranteeEntry this import
    # creates or resurrects can be stamped with import_log_id — same contract as the
    # supplier/contractor flows.
    log = models.ImportLog(source='pdf_statement', path=path, account=parsed['account'],
                           imported=0, skipped=0, reconciled=1 if pre['reconciled'] else 0,
                           issues=json.dumps(pre['issues'], ensure_ascii=False))
    db.add(log)
    db.flush()

    res = guarantees_service.commit(db, parsed, path, import_log_id=log.id)

    log.imported = res['added']
    log.skipped = res['skipped']
    db.commit()
    out = dict(pre)
    out.update(saved=True, added=res['added'], skipped=res['skipped'],
               guaranteeAccount=res['guaranteeAccount'],
               matchedContractor=res['matchedContractor'])
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
    'guarantee': 'كشف حساب ضمان (216)',
    'ai_extract': 'استخراج بالذكاء الاصطناعي',
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
                   computedBalance=None, statementBalance=None, message='',
                   nearDuplicates=[])
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
                # تحذير التكرار المحتمل يُرافق الصف سواء حُفظ الملف أو رُفض — فهو
                # وصف لما في الملف، لا نتيجة للحفظ، ولا يغيّر status أبداً.
                row['nearDuplicates'] = res.get('nearDuplicates') or []
                row['computedBalance'] = res.get('computedBalance')
                row['statementBalance'] = res.get('statementBalance')
                if res.get('saved'):
                    row['added'] = res.get('added', 0)
                    row['skipped'] = res.get('skipped', 0)
                    res_kind = res.get('kind')
                    if res_kind == 'guarantee':
                        row['detected'] = DETECTED_LABELS['guarantee']
                        row['supplierName'] = (res.get('guaranteeAccount') or {}).get('name')
                        if row['added'] == 0 and row['skipped'] > 0:
                            row['status'] = 'duplicate'
                            row['message'] = 'مكرر — هذا الكشف مرفوع سابقاً ولا حركات جديدة فيه'
                            duplicates += 1
                        else:
                            row['status'] = 'saved'
                            row['message'] = 'تم حفظ كشف ضمان'
                            saved += 1
                    else:
                        is_contractor = res_kind == 'contractor'
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
                    elif reason == 'needs_classification':
                        row['status'] = 'needs_classification'
                        row['supplierName'] = res.get('name')
                        row['message'] = res.get('message') or (
                            'رقم الحساب %s يحتاج تصنيفاً يدوياً' % (res.get('account') or '?'))
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
