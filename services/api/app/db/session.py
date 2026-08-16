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



def _rebuild_identity_constraints(conn) -> None:
    """يوسّع هوية الفواتير والدفعات لتشمل الوصف/المستند — بإعادة بناء الجدولين.

    SQLite cannot ALTER a UNIQUE constraint, so the table is rebuilt: rename aside,
    recreate from the (new) model, copy every row, drop the old one. Real statements
    carry two genuinely different lines that match on the old identity — the second
    insert hit `UNIQUE constraint failed` and the WHOLE file failed to import. Widening
    the identity is what lets both lines coexist while a true re-import still dedupes.

    Runs at most once, guarded by `schema_flags`; a failure rolls the rename back so a
    half-migrated database can never be left behind.
    """
    conn.execute(text('CREATE TABLE IF NOT EXISTS schema_flags '
                      '(key TEXT PRIMARY KEY, applied_at TEXT)'))
    flag = 'widen_invoice_payment_identity_v1'
    done = conn.execute(text('SELECT 1 FROM schema_flags WHERE key = :k'),
                        {'k': flag}).fetchone()
    if done:
        return

    for table in ('invoices', 'payments'):
        sql = conn.execute(
            text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:n"),
            {'n': table}).scalar()
        if not sql:
            continue
        cols = [row[1] for row in conn.execute(text(f'PRAGMA table_info({table})')).fetchall()]
        col_list = ', '.join(f'"{c}"' for c in cols)
        # فهارس الجدول تبقى بأسمائها بعد إعادة التسمية وتتبع الجدول القديم، فتصطدم
        # بفهارس الجدول الجديد — تُحذف أولاً (يُعيد create() إنشاءها).
        idx = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=:n "
            "AND name NOT LIKE 'sqlite_autoindex%'"), {'n': table}).fetchall()]
        conn.execute(text(f'ALTER TABLE {table} RENAME TO {table}_old_identity'))
        try:
            for name in idx:
                conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
            Base.metadata.tables[table].create(bind=conn)
            # نسخ كل الصفوف كما هي — لا صف يُفقد ولا يُعدَّل
            conn.execute(text(
                f'INSERT INTO {table} ({col_list}) SELECT {col_list} FROM {table}_old_identity'))
            conn.execute(text(f'DROP TABLE {table}_old_identity'))
        except Exception:
            conn.execute(text(f'DROP TABLE IF EXISTS {table}'))
            conn.execute(text(f'ALTER TABLE {table}_old_identity RENAME TO {table}'))
            raise
        logger.info('rebuilt %s with the widened identity constraint', table)

    conn.execute(text('INSERT OR REPLACE INTO schema_flags (key, applied_at) '
                      'VALUES (:k, :t)'),
                 {'k': flag, 't': dt.datetime.now(dt.timezone.utc).isoformat()})


def init_db() -> None:
    """Create tables on first run. Swap for Alembic once the schema starts changing."""
    Base.metadata.create_all(engine)
    # Lightweight migration for installs created before the `source` column existed —
    # create_all() never alters existing tables, so existing DBs need a manual ALTER.
    with engine.begin() as conn:
        _rebuild_identity_constraints(conn)
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
        # `learned_layouts` is new as of the AI-rescue token-saving cache — additive
        # table only (no ALTER on existing tables), create_all() above already makes it
        # for fresh installs; explicit checkfirst=True create() here covers existing DBs.
        Base.metadata.tables['learned_layouts'].create(bind=conn, checkfirst=True)
        # `party_projects` is new as of multi-project support — additive table only.
        Base.metadata.tables['party_projects'].create(bind=conn, checkfirst=True)
        _seed_party_projects(conn)
    _migrate_211_contractors_to_suppliers()


#: marker for the one-time backfill below.
_SEED_PARTY_PROJECTS_FLAG = 'seed_party_projects_v1'


def _seed_party_projects(conn) -> None:
    """يبذر جدول مشاريع الطرف من المشروع المفرد الموجود.

    Without this backfill every existing supplier would look like it belongs to no
    project the moment the UI starts reading the new table, and «كل المشاريع» would
    return nothing — the data is all still there, but the screen would say otherwise,
    which is the worst kind of failure in this app. Runs once.
    """
    if _migration_applied(conn, _SEED_PARTY_PROJECTS_FLAG):
        return
    # created_at/updated_at غير قابلين للفراغ ولا يحملان قيمة افتراضية في القاعدة —
    # إغفالهما في INSERT خام يجعل «OR IGNORE» يبتلع كل صف بصمت، فيبدو البذر ناجحاً
    # وجدولُه فارغ. تُملأ هنا صراحةً.
    now = dt.datetime.now(dt.timezone.utc).isoformat(sep=' ')
    conn.execute(text(
        "INSERT OR IGNORE INTO party_projects "
        "(id, party_type, party_id, project, position, created_at, updated_at) "
        "SELECT lower(hex(randomblob(16))), 'supplier', id, project, 0, :now, :now "
        "FROM suppliers WHERE project IS NOT NULL AND project <> ''"), {'now': now})
    # المقاول لا يحمل عمود مشروع مفرد — مشاريعه مستنتجة من حركاته، فتُبذر منها.
    conn.execute(text(
        "INSERT OR IGNORE INTO party_projects "
        "(id, party_type, party_id, project, position, created_at, updated_at) "
        "SELECT lower(hex(randomblob(16))), 'contractor', contractor_id, project, 0, :now, :now "
        "FROM (SELECT DISTINCT contractor_id, project FROM contractor_entries "
        "      WHERE project IS NOT NULL AND project <> '' AND deleted_at IS NULL)"),
        {'now': now})
    # لا صفوف = بذرٌ فاشل، لا قاعدة فارغة: يُترك العَلَم بلا وضع فيُعاد في التشغيل
    # التالي بعد إصلاح السبب، بدل أن يُدفن الخلل خلف علامة «تمّ».
    seeded = conn.execute(text("SELECT COUNT(*) FROM party_projects")).scalar() or 0
    has_source = conn.execute(text(
        "SELECT COUNT(*) FROM suppliers WHERE project IS NOT NULL AND project <> ''")).scalar() or 0
    if has_source and not seeded:
        return
    _mark_migration_applied(conn, _SEED_PARTY_PROJECTS_FLAG)


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
