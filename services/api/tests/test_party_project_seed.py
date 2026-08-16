# -*- coding: utf-8 -*-
"""بذر جدول مشاريع الطرف من العمود المفرد القديم.

الخلل الذي يحرسه هذا الاختبار: أول نسخة من البذر كتبت INSERT خاماً بلا
created_at/updated_at، وهما NOT NULL بلا قيمة افتراضية. ومع «INSERT OR IGNORE»
ابتلعت القاعدة كل صف بصمت — الهجرة تُعلن النجاح، وتضع علمها، وجدولُها فارغ.
على قاعدة المستخدم الحقيقية: ١٠٣ موردين لكلٍّ منهم مشروع، وصفر صفوف مبذورة،
فيظهر الجميع بلا مشاريع.

The lesson worth keeping: OR IGNORE turns a constraint violation into silence. Any
migration that uses it must check afterwards that it actually wrote something.
"""
import datetime as dt

import pytest
from sqlalchemy import text


def _add_supplier(client, account: str, project: str) -> None:
    r = client.post('/api/v1/suppliers', json=dict(
        account=account, name=f'مورد {account}', project=project, term='30 يوم'))
    assert r.status_code in (200, 201), r.text


def _reseed(session_mod):
    """يمسح الجدول وعلمه ثم يُعيد البذر — كما يحدث لأول مرة على قاعدة قائمة."""
    with session_mod.engine.begin() as conn:
        conn.execute(text('DELETE FROM party_projects'))
        conn.execute(text(
            "DELETE FROM schema_flags WHERE key = 'seed_party_projects_v1'"))
        session_mod._seed_party_projects(conn)


def _rows(session_mod):
    with session_mod.engine.begin() as conn:
        return conn.execute(text(
            'SELECT party_type, project, created_at, updated_at '
            'FROM party_projects')).fetchall()


def test_backfill_writes_a_row_per_supplier_that_has_a_project(api_client):
    import app.db.session as session_mod

    _add_supplier(api_client, '2110001', 'الرسين')
    _add_supplier(api_client, '2110002', 'السدن')
    _add_supplier(api_client, '2110003', '')       # بلا مشروع — لا يُبذر

    _reseed(session_mod)
    rows = _rows(session_mod)

    projects = {r[1] for r in rows}
    assert 'الرسين' in projects
    assert 'السدن' in projects
    assert '' not in projects

    # الأعمدة غير القابلة للفراغ مملوءة فعلاً — هذا هو الخلل الأصلي بعينه
    for r in rows:
        assert r[2] is not None, 'created_at فارغ — الصف كان ليُبتلع صمتاً'
        assert r[3] is not None, 'updated_at فارغ — الصف كان ليُبتلع صمتاً'


def test_backfill_sets_its_flag_and_is_idempotent(api_client):
    import app.db.session as session_mod

    _add_supplier(api_client, '2110010', 'مشروع مكرر')
    _reseed(session_mod)
    first = len(_rows(session_mod))

    with session_mod.engine.begin() as conn:
        flagged = conn.execute(text(
            "SELECT COUNT(*) FROM schema_flags "
            "WHERE key = 'seed_party_projects_v1'")).scalar()
        # العلم موضوع، فالنداء الثاني لا يفعل شيئاً
        session_mod._seed_party_projects(conn)

    assert flagged == 1, 'بذرٌ ناجح يجب أن يضع علمه فلا يتكرر'
    assert len(_rows(session_mod)) == first, 'تكرار البذر ضاعف الصفوف'


def test_seeded_projects_are_visible_through_the_api(api_client):
    """الاختبار الذي كان سيكشف الخلل: المشاريع تصل إلى الشاشة فعلاً."""
    import app.db.session as session_mod

    _add_supplier(api_client, '2110020', 'الرسين')
    _reseed(session_mod)

    r = api_client.get('/api/v1/suppliers')
    assert r.status_code == 200
    row = next(x for x in r.json()['rows'] if x['account'] == '2110020')
    assert row.get('projects') == ['الرسين'], (
        'المورد يظهر بلا مشاريع رغم أن له مشروعاً — البذر لم يصل')
