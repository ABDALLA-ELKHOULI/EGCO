# -*- coding: utf-8 -*-
"""أداة دمج المشاريع (م-٣٠) — المعاينة يجب أن تطابق الأثر الفعلي بالضبط، ولا
هجرة صامتة تُعيد تسمية شيء بلا أن يطلبه المستخدم."""


def test_merge_preview_matches_actual_effect(api_client):
    # مورد باسم "سدن" (بلا أل) ومقاول بمشروع "السدن" (بأل) — نفس المشروع، صيغتان.
    api_client.post('/api/v1/suppliers', json={
        'account': '995', 'name': 'مورد', 'project': 'سدن', 'term': 'كاش'})
    api_client.post('/api/v1/contractors', json={
        'code': '2129002', 'name': 'مقاول', 'projects': ['السدن']})

    preview = api_client.get('/api/v1/project-admin/merge/preview',
                             params={'fromName': 'سدن', 'intoName': 'السدن'}).json()
    assert preview['affected']['suppliers'] == 1
    assert preview['total'] == preview['affected']['suppliers'] + \
        preview['affected']['party_projects']

    merge = api_client.post('/api/v1/project-admin/merge',
                            json={'fromName': 'سدن', 'intoName': 'السدن'}).json()
    assert merge['merged']['affected']['suppliers'] == preview['affected']['suppliers']

    supplier = api_client.get('/api/v1/suppliers/995').json()
    assert supplier['project'] == 'السدن'

    projects = api_client.get('/api/v1/project-admin').json()
    assert 'سدن' not in projects['projects']
    assert 'السدن' in projects['projects']


def test_merge_same_name_rejected(api_client):
    r = api_client.get('/api/v1/project-admin/merge/preview',
                       params={'fromName': 'أ', 'intoName': 'أ'})
    assert r.status_code == 422


def test_merge_nonexistent_source_404s(api_client):
    r = api_client.get('/api/v1/project-admin/merge/preview',
                       params={'fromName': 'لا يوجد', 'intoName': 'شيء'})
    assert r.status_code == 404


def test_import_of_contractors_balance_resolves_to_known_project(api_client):
    # المورد يُدخل "السدن" بأل أولاً — الأسبق يصبح الصيغة القائمة.
    api_client.post('/api/v1/suppliers', json={
        'account': '996', 'name': 'مورد', 'project': 'السدن', 'term': 'كاش'})

    from app.services import party_projects as PP
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        resolved = PP.resolve_to_known_project(db, 'سدن')
        assert resolved == 'السدن'
        # اسم لا يطابق أي مشروع قائم يبقى كما هو — لا اختراع مطابقة.
        assert PP.resolve_to_known_project(db, 'مشروع جديد كلياً') == 'مشروع جديد كلياً'
    finally:
        db.close()
