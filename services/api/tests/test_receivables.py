# -*- coding: utf-8 -*-
"""اختبارات قارئ report4.html — يعمل على الملف الحقيقي عندما يكون متاحاً."""
import importlib
import os

import pytest

from app.ingest import receivables_legacy

REAL_REPORT4 = os.path.expanduser('/Users/abdallaalkhouli/Desktop/Anchor/EGCO/report4.html')


@pytest.mark.skipif(not os.path.exists(REAL_REPORT4), reason='الملف الحقيقي غير متوفر في هذه البيئة')
def test_parses_real_report4_with_plausible_totals():
    parsed = receivables_legacy.parse(REAL_REPORT4)
    rows = parsed['receivables']
    assert len(rows) > 0

    total_collected = sum(r.amount for r in rows if r.status == 'collected')
    assert total_collected > 0

    # every row has a client and a positive amount
    for r in rows:
        assert r.client
        assert r.amount > 0
        assert r.status in ('collected', 'open')


@pytest.mark.skipif(not os.path.exists(REAL_REPORT4), reason='الملف الحقيقي غير متوفر في هذه البيئة')
def test_import_receivables_persists_rows(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.services.receivables_service as receivables_service_mod
    importlib.reload(receivables_service_mod)

    session_mod.init_db()
    db = session_mod.SessionLocal()
    try:
        result = receivables_service_mod.import_receivables(db, REAL_REPORT4,
                                                             source='receivables_legacy_html')
        assert result['saved'] is True
        assert result['added'] > 0
        assert result['totalCollected'] > 0

        from app.db import models
        count = db.query(models.Receivable).filter(models.Receivable.deleted_at.is_(None)).count()
        assert count == result['added']

        # re-importing the same file should not duplicate rows
        result2 = receivables_service_mod.import_receivables(db, REAL_REPORT4,
                                                              source='receivables_legacy_html')
        assert result2['added'] == 0
        assert result2['skipped'] == result['added']
    finally:
        db.close()
