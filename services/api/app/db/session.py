# -*- coding: utf-8 -*-
from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.models import Base

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


def get_session() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
