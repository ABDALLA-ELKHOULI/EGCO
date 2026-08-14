# -*- coding: utf-8 -*-
import datetime as dt
import json
import logging
from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db import models
from app.db.models import Base

logger = logging.getLogger(__name__)

settings.ensure_dirs()
engine = create_engine(settings.DB_URL, connect_args={'check_same_thread': False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def _migrate_add_column(conn, table: str, column: str, ddl_type: str, default_sql: str) -> None:
    cols = [row[1] for row in conn.execute(text(f'PRAGMA table_info({table})')).fetchall()]
    if column not in cols:
        conn.execute(text(
            f'ALTER TABLE {table} ADD COLUMN {column} {ddl_type} DEFAULT {default_sql}'))


def init_db() -> None:
    """Create tables on first run. Swap for Alembic once the schema starts changing."""
    Base.metadata.create_all(engine)
    # Lightweight migration for installs created before the `source` column existed —
    # create_all() never alters existing tables, so existing DBs need a manual ALTER.
    with engine.begin() as conn:
        _migrate_add_column(conn, 'invoices', 'source', 'TEXT', "'statement'")
        _migrate_add_column(conn, 'payments', 'source', 'TEXT', "'statement'")
        # `receivables` is new as of v0.3 — create_all() above already creates it for
        # fresh installs; for DBs created before this table existed, create it here too
        # (create_all is a no-op if it already exists, so this is always safe to run).
        Base.metadata.tables['receivables'].create(bind=conn, checkfirst=True)
        # `import_log_id` is new as of the uploaded-files management feature — links
        # rows back to the ImportLog that created them, so a re-import can resurrect
        # soft-deleted rows and a delete can remove exactly what one import added.
        _migrate_add_column(conn, 'invoices', 'import_log_id', 'TEXT', 'NULL')
        _migrate_add_column(conn, 'payments', 'import_log_id', 'TEXT', 'NULL')
        _migrate_add_column(conn, 'contractor_entries', 'import_log_id', 'TEXT', 'NULL')
        _migrate_add_column(conn, 'receivables', 'import_log_id', 'TEXT', 'NULL')
        # account_classifications / guarantee_accounts / guarantee_entries are new as of
        # the strict-prefix-dispatch + 216-guarantee-flow task — additive tables only
        # (no ALTER on existing tables), create_all() above already makes them for fresh
        # installs; explicit checkfirst=True create() here covers existing DBs too.
        Base.metadata.tables['account_classifications'].create(bind=conn, checkfirst=True)
        Base.metadata.tables['guarantee_accounts'].create(bind=conn, checkfirst=True)
        Base.metadata.tables['guarantee_entries'].create(bind=conn, checkfirst=True)
    _migrate_211_contractors_to_suppliers()


# ---------------------------------------------------------------- one-time data fixes

#: marker key for the one-time reclassification below — never re-run once applied.
_MIGRATION_211_FLAG = 'migrate_211_contractors_to_suppliers_v1'


def _migration_applied(conn, key: str) -> bool:
    conn.execute(text(
        "CREATE TABLE IF NOT EXISTS schema_flags "
        "(key TEXT PRIMARY KEY, applied_at TEXT)"))
    row = conn.execute(text('SELECT 1 FROM schema_flags WHERE key = :k'),
                       {'k': key}).fetchone()
    return row is not None


def _mark_migration_applied(conn, key: str) -> None:
    conn.execute(text(
        'INSERT INTO schema_flags (key, applied_at) VALUES (:k, :t)'),
        {'k': key, 't': dt.datetime.now(dt.timezone.utc).isoformat()})


def _migrate_211_contractors_to_suppliers() -> None:
    """يصحح خطأ توجيه قديم: قبل قاعدة البادئة الصارمة، حسابات 211* كانت تُفلتَر
    كمقاولين إن لم توجد في ملف مدد الموردين. يعيد كل مقاول code يبدأ بـ'211' إلى
    مورد — فاتورة لكل قيد دائن، دفعة لكل قيد مدين — ثم يحذف المقاول وقيوده منطقياً.

    مرة واحدة فقط ودائم الأمان عند التكرار: يُستدعى من init_db() في كل إقلاع، لكنه
    يتحقق أولاً من علامة schema_flags ولا يعمل شيئاً إن كانت موجودة.
    """
    with engine.begin() as conn:
        if _migration_applied(conn, _MIGRATION_211_FLAG):
            return

    db = SessionLocal()
    try:
        contractors = db.query(models.Contractor).filter(
            models.Contractor.deleted_at.is_(None),
            models.Contractor.code.like('211%')).all()

        moved_contractors = 0
        moved_entries = 0
        now = dt.datetime.now(dt.timezone.utc)

        for c in contractors:
            supplier = db.query(models.Supplier).filter_by(account=c.code).one_or_none()
            if supplier is None:
                supplier = models.Supplier(
                    account=c.code, name=c.name, project='',
                    term_raw='كاش', term_kind='cash', term_days=None)
                db.add(supplier)
                db.flush()

            entries = [e for e in c.entries if e.deleted_at is None]
            for e in entries:
                if e.credit:
                    exists = db.query(models.Invoice).filter_by(
                        supplier_id=supplier.id, number=e.doc or None, date=e.date,
                        amount=e.credit).one_or_none()
                    if exists is None:
                        db.add(models.Invoice(
                            supplier_id=supplier.id, number=e.doc or None, date=e.date,
                            amount=e.credit, doc=e.doc or '', description=e.description or '',
                            source='statement', import_log_id=e.import_log_id))
                        moved_entries += 1
                if e.debit:
                    exists = db.query(models.Payment).filter_by(
                        supplier_id=supplier.id, doc=e.doc or '', date=e.date,
                        amount=e.debit).one_or_none()
                    if exists is None:
                        db.add(models.Payment(
                            supplier_id=supplier.id, date=e.date, amount=e.debit,
                            doc=e.doc or '', description=e.description or '',
                            source='statement', import_log_id=e.import_log_id))
                        moved_entries += 1
                e.deleted_at = now

            db.add(models.ImportLog(
                source='migration_211_reclass', path='', account=c.code,
                imported=moved_entries, skipped=0, reconciled=1,
                issues=json.dumps([dict(
                    severity='warning', row=None,
                    message=('تم نقل الحساب %s (%s) تلقائياً من المقاولين إلى الموردين — '
                             'مدة السداد ضُبطت افتراضياً «كاش» وتحتاج مراجعة لأن '
                             'تواريخ استحقاق FIFO تعتمد عليها' % (c.code, c.name))
                )], ensure_ascii=False)))

            c.deleted_at = now
            moved_contractors += 1

        db.commit()
        logger.info('migrate_211_contractors_to_suppliers: moved %d contractor(s), '
                    '%d ledger entr(y/ies) converted to invoices/payments',
                    moved_contractors, moved_entries)
    finally:
        db.close()

    with engine.begin() as conn:
        _mark_migration_applied(conn, _MIGRATION_211_FLAG)


def get_session() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
