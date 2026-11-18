# -*- coding: utf-8 -*-
"""BUG-004 — خيارات فلتر المشاريع لا تعرض مشروعاً محذوفاً أو مدموجاً."""
B = '/api/v1'


def test_merged_and_deleted_projects_leave_filter_options(api_client):
    c = api_client
    c.post(B + '/suppliers', json=dict(account='2110001', name='أ', project='سدن', term='كاش'))
    c.post(B + '/suppliers', json=dict(account='2110002', name='ب', project='المدينة', term='كاش'))
    # رابط بمشروع ثانٍ ثم فكّه (حذف منطقي) — يجب ألا يبقى اسمه خياراً
    c.put(B + '/suppliers/2110002', json=dict(projects=['المدينة', 'مشروع مؤقت']))
    c.put(B + '/suppliers/2110002', json=dict(projects=['المدينة']))
    pid = c.post(B + '/projects', json={'name': 'مشروع فارغ'}).json()['id']
    assert 'مشروع فارغ' in c.get(B + '/suppliers').json()['projects']
    c.delete(f'{B}/projects/{pid}')
    r = c.post(B + '/project-admin/merge', json=dict(fromName='سدن', intoName='المدينة'))
    assert r.status_code == 200, r.text
    opts = c.get(B + '/suppliers').json()['projects']
    assert 'سدن' not in opts and 'مشروع مؤقت' not in opts and 'مشروع فارغ' not in opts
    assert 'المدينة' in opts
    assert 'سدن' not in c.get(B + '/project-admin').json()['projects']
    assert all(x['name'] != 'مشروع فارغ' for x in c.get(B + '/projects/registry').json())
