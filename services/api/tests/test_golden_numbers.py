# -*- coding: utf-8 -*-
"""الأرقام الذهبية — كل مسار قراءة تستعمله الواجهة يُلتقط JSON قبل أي تغيير،
ويُقارَن بعده: كل قيمة كانت موجودة يجب أن تبقى كما هي بالضبط (مفاتيح جديدة
مسموحة، قيمة متغيّرة = فشل).

لماذا: إعادة الهيكلة (تحميل مسبق، لقطة لكل طلب، فهارس) يجب ألا تحرّك هللة.
اختبار يقارن المخرج كاملاً هو الضمان الوحيد الذي لا يعتمد على أن نتذكّر أي
رقم يعتمد على أي دالة.

مصدران:
  - قاعدة البذر (`testing_seed`) — دائماً، والمرجع في `tests/golden/seed.json`.
  - نسخة من القاعدة الحقيقية — فقط إن وُجدت (`EGCO_GOLDEN_REAL_DB`)، ومرجعها في
    `tests/golden/real/` **المستثنى من git**: أسماء ومبالغ حقيقية لا تُرفع لمستودع عام.

التاريخ مُثبَّت (`FROZEN_TODAY`) لأن كل «متأخر/مستحق خلال ٧» نسبي لليوم — بلا
تثبيت يتغيّر المرجع كل منتصف ليل.

`EGCO_GOLDEN_UPDATE=1` يعيد كتابة المراجع (فقط قبل التغيير أو بعد قرار صريح).
"""
from __future__ import annotations

import datetime as _real_dt
import importlib
import json
import os
import shutil
import sys
import types
from pathlib import Path
from urllib.parse import quote

import pytest

GOLDEN_DIR = Path(__file__).parent / 'golden'
FROZEN_TODAY = _real_dt.date(2026, 11, 17)
DEFAULT_REAL_DB = ('/private/tmp/claude-501/-Users-abdallaalkhouli-Desktop-Anchor-EGCO/'
                   'f531385f-45cb-447a-8b62-fa1a0195c359/scratchpad/next-be/master/egco.db')

#: مفاتيح متقلّبة بطبيعتها (طوابع زمنية، معرّفات uuid تتولّد مع كل بذر، مسار
#: القاعدة) — تُستثنى من المقارنة لأنها ليست أرقاماً ولا تتغيّر بسبب الحساب.
_VOLATILE = {'id', 'createdAt', 'updatedAt', 'deletedAt', 'generatedAt', 'decidedAt',
             'at', 'db', 'importedAt', 'created_at', 'lastImportAt', 'paymentId',
             'invoiceId', 'snapshotId', 'logId', 'entryId', 'claimId', 'guaranteeId'}


class _FrozenDate(_real_dt.date):
    @classmethod
    def today(cls):
        return FROZEN_TODAY


class _FrozenDateTime(_real_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        base = _real_dt.datetime(FROZEN_TODAY.year, FROZEN_TODAY.month, FROZEN_TODAY.day, 9, 0, 0)
        if tz is not None:
            return base.replace(tzinfo=tz)
        return base


def _frozen_dt_module():
    m = types.ModuleType('datetime_frozen')
    for k in dir(_real_dt):
        if not k.startswith('__'):
            setattr(m, k, getattr(_real_dt, k))
    m.date = _FrozenDate
    m.datetime = _FrozenDateTime
    return m


def _freeze(monkeypatch):
    """يستبدل `dt` في كل وحدة app.* (عدا محلّلات ingest التي تفحص isinstance)."""
    fake = _frozen_dt_module()
    for name, mod in list(sys.modules.items()):
        if not name.startswith('app.') or name.startswith('app.ingest'):
            continue
        if getattr(mod, 'dt', None) is _real_dt:
            monkeypatch.setattr(mod, 'dt', fake)


_RELOAD = [
    'app.core.config', 'app.db.session', 'app.services.payables_service',
    'app.services.report_service', 'app.services.periods_service',
    'app.services.import_service', 'app.services.export_service',
    'app.api.routes.dashboard', 'app.api.routes.suppliers', 'app.api.routes.manual',
    'app.api.routes.imports', 'app.services.contractors_service',
    'app.services.contractor_report_service', 'app.api.routes.contractors',
    'app.api.routes.reports', 'app.services.ai_service', 'app.services.ai_features_service',
    'app.api.routes.ai', 'app.api.router', 'app.main',
]


def _make_client(tmp_path, monkeypatch, seed: bool, real_db: str = ''):
    data = tmp_path / 'data'
    data.mkdir(parents=True, exist_ok=True)
    if real_db:
        shutil.copy2(real_db, data / 'egco.db')
    monkeypatch.setenv('EGCO_DATA_DIR', str(data))
    if seed:
        monkeypatch.setenv('EGCO_SEED', '1')
    else:
        monkeypatch.delenv('EGCO_SEED', raising=False)
    # نفس إعادة التحميل التي يجريها conftest.api_client: المسارات تُحسب وقت الاستيراد
    for name in _RELOAD:
        importlib.reload(importlib.import_module(name))
    import app.main as main_mod
    _freeze(monkeypatch)
    from fastapi.testclient import TestClient
    return TestClient(main_mod.app)


def _routes(client) -> dict:
    """كل GET للقراءة تستعمله الواجهة — مع تفاصيل كل طرف/مشروع."""
    base = '/api/v1'
    simple = [
        '/overview', '/dashboard', '/dashboard/day', '/suppliers',
        '/contractors', '/contractors/overview', '/contractors/claims-due',
        '/projects', '/cashflow', '/cashflow?parties=both', '/cashflow?parties=contractors',
        '/coverage', '/reports/analysis', '/reports/project-summary', '/reports/priorities',
        '/reports/scopes', '/reports/periodic', '/budget', '/budget/overview',
        '/guarantees', '/revenues', '/import/history', '/trash', '/project-admin',
        '/suppliers/payment-allocation/pending-count',
        '/dashboard/day?date=2026-11-17', '/dashboard/day?date=2026-12-01',
        '/reports/periodic?year=2026', '/reports/periodic?year=2026&granularity=year',
        '/cashflow?weeks=4&period_days=7',
    ]
    out = {}
    for path in simple:
        r = client.get(base + path)
        out[path] = dict(status=r.status_code, body=r.json() if r.status_code == 200 else None)
    sup = out['/suppliers']['body'] or {}
    for row in sorted((sup.get('rows') or []), key=lambda x: x['account']):
        p = '/suppliers/' + quote(row['account'])
        r = client.get(base + p)
        out[p] = dict(status=r.status_code, body=r.json() if r.status_code == 200 else None)
    con = out['/contractors']['body'] or {}
    for row in sorted((con.get('rows') or []), key=lambda x: x['code']):
        p = '/contractors/' + quote(row['code'])
        r = client.get(base + p)
        out[p] = dict(status=r.status_code, body=r.json() if r.status_code == 200 else None)
    prj = out['/projects']['body'] or {}
    for row in sorted((prj.get('rows') or []), key=lambda x: x['project']):
        for p in ('/projects/' + quote(row['project'], safe=''),
                  '/reports/project-summary?project=' + quote(row['project'], safe='')):
            r = client.get(base + p)
            out[p] = dict(status=r.status_code, body=r.json() if r.status_code == 200 else None)
    return out


def _diff(golden, current, path='$', problems=None):
    """golden ⊆ current: كل مفتاح/قيمة في المرجع يجب أن يطابق. مفاتيح جديدة مسموحة."""
    if problems is None:
        problems = []
    if len(problems) > 40:
        return problems
    if isinstance(golden, dict):
        if not isinstance(current, dict):
            problems.append(f'{path}: صار {type(current).__name__} بدل dict')
            return problems
        for k, v in golden.items():
            if k in _VOLATILE:
                continue
            if k not in current:
                problems.append(f'{path}.{k}: مفتاح اختفى')
                continue
            _diff(v, current[k], f'{path}.{k}', problems)
    elif isinstance(golden, list):
        if not isinstance(current, list) or len(golden) != len(current):
            problems.append(f'{path}: طول القائمة تغيّر {len(golden)} → '
                            f'{len(current) if isinstance(current, list) else current!r}')
            return problems
        for i, (g, c) in enumerate(zip(golden, current)):
            _diff(g, c, f'{path}[{i}]', problems)
    else:
        if golden != current or type(golden) is not type(current):
            problems.append(f'{path}: {golden!r} → {current!r}')
    return problems


def _check(name: str, snapshot: dict, target: Path):
    if os.environ.get('EGCO_GOLDEN_UPDATE') or not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1, sort_keys=True),
                          encoding='utf-8')
        if not os.environ.get('EGCO_GOLDEN_UPDATE'):
            pytest.skip(f'{name}: لا مرجع بعد — كُتب الآن في {target}')
        return
    golden = json.loads(target.read_text(encoding='utf-8'))
    # تمرير المخرج الحالي عبر JSON حتى تُقارَن الأنواع كما تصل الواجهة فعلاً
    current = json.loads(json.dumps(snapshot, ensure_ascii=False))
    problems = _diff(golden, current)
    assert not problems, f'{name}: تغيّرت أرقام ذهبية:\n' + '\n'.join(problems)


def test_golden_numbers_seed(tmp_path, monkeypatch):
    with _make_client(tmp_path, monkeypatch, seed=True) as client:
        snap = _routes(client)
    assert snap['/overview']['status'] == 200
    _check('seed', snap, GOLDEN_DIR / 'seed.json')


def test_golden_numbers_real_copy(tmp_path, monkeypatch):
    real = os.environ.get('EGCO_GOLDEN_REAL_DB', DEFAULT_REAL_DB)
    if not os.path.exists(real):
        pytest.skip('نسخة القاعدة الحقيقية غير متاحة على هذا الجهاز')
    with _make_client(tmp_path, monkeypatch, seed=False, real_db=real) as client:
        snap = _routes(client)
    assert snap['/overview']['status'] == 200
    _check('real', snap, GOLDEN_DIR / 'real' / 'real.json')
