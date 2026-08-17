# -*- coding: utf-8 -*-
"""اختبارات مقاومة عدد أرقام الحساب — قِيس على 60+ كشفاً حقيقياً فظهرت أطوال 5
(الضمان 21620) و6 (211181) و7 (أغلب الحسابات) و8 (21201020). مرساة المطابقة هي
مجاورة تسمية «الحساب» لا عدد الأرقام، فلا تقع في فخ التواريخ (2025-01-01،
01-07-1446) أو أرقام المستندات المجاورة في الترويسة."""
import importlib
import os

import pytest

from app.ingest.pdf_statement import ACCOUNT_RE, parse

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')


def test_account_re_matches_five_through_eight_digits_anchored_on_label():
    assert ACCOUNT_RE.search('21620\n: الحساب').group(1) == '21620'          # 5
    assert ACCOUNT_RE.search('211181\n: الحساب').group(1) == '211181'        # 6
    assert ACCOUNT_RE.search('2110960\n: الحساب').group(1) == '2110960'      # 7
    assert ACCOUNT_RE.search('21201020\n: الحساب').group(1) == '21201020'    # 8


def test_account_re_ignores_unlabelled_dates_and_amounts():
    # A bare digit run that is NOT followed by the "الحساب" label must never match —
    # this is exactly the trap a blind {6,7} → {4,9} widening would fall into.
    header = ': من تاريخ2025-01-01\n: الى تاريخ2026-08-17\n01-07-1446\n04-03-1448\n500,000.00'
    assert ACCOUNT_RE.search(header) is None


def test_account_re_does_not_match_the_document_number_two_lines_away():
    # A document/voucher number sitting near an unrelated label must not be picked up
    # just because it happens to be 4-9 digits — the label must be the very next line.
    header = '00001294\n: رقم المستند\n211181\n: الحساب'
    m = ACCOUNT_RE.search(header)
    assert m is not None
    assert m.group(1) == '211181'


# ---------------------------------------------------------------- isolated-db fixtures
# Same pattern as tests/test_guarantee_import.py: a throwaway EGCO_DATA_DIR so nothing
# ever touches the user's real app-data, plus module reloads so settings.DATA_DIR
# actually picks up the temp dir (those modules resolve paths at import time).

@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.db.models as models_mod
    importlib.reload(models_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)

    session_mod.init_db()

    class Env:
        pass

    e = Env()
    e.session = session_mod
    e.models = models_mod
    e.import_service = import_service_mod
    return e


@pytest.fixture()
def db(env):
    session = env.session.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.mark.parametrize('fname,expected_account,expected_prefix_kind', [
    ('guarantee-alquds.pdf', '21620', 'guarantee'),      # 5 digits, prefix 216
    ('contractor-diyar-alwadi.pdf', '21201020', 'contractor'),  # 8 digits, prefix 212
    ('statement-injaz-alsuddan.pdf', '2110960', 'supplier'),    # 7 digits, prefix 211
])
def test_real_statements_parse_expected_account_across_lengths(fname, expected_account,
                                                                expected_prefix_kind,
                                                                db, env):
    path = os.path.join(SAMPLES, fname)
    if not os.path.exists(path):
        pytest.skip('design/samples/%s not present in this checkout' % fname)
    result = parse(path)
    assert result['account'] == expected_account
    # dispatch_kind is prefix-only and must stay length-agnostic: a 5-, 7-, or 8-digit
    # account with the right prefix dispatches the same as any other length would.
    assert env.import_service.dispatch_kind(db, result['account']) == expected_prefix_kind


def test_dispatch_kind_is_length_agnostic_on_prefix(db, env):
    # The 211/212/216 rule is absolute and must not silently assume a fixed length.
    dispatch_kind = env.import_service.dispatch_kind
    assert dispatch_kind(db, '211181') == 'supplier'      # 6 digits
    assert dispatch_kind(db, '2110960') == 'supplier'     # 7 digits
    assert dispatch_kind(db, '21201020') == 'contractor'  # 8 digits
    assert dispatch_kind(db, '21620') == 'guarantee'      # 5 digits
    assert dispatch_kind(db, '2990001') is None            # unknown prefix — ask, never guess
