# -*- coding: utf-8 -*-
"""اختبارات مشاريع الطرف المتعددة — الموردون والمقاولون.

يغطي: set/replace/clear عبر party_projects.set_projects مباشرة، عقد "None تعني
لا تغيّر" عبر PUT الموردين/المقاولين، تصفية العضوية (ينتمي إليه، لا يساويه) عبر
مسارَي القائمة، تزامن primary() مع Supplier.project المفرد، وقيد التفرّد
(party_type, party_id, project). يستخدم fixture الـ api_client من conftest.py —
نفس عقد بقية اختبارات الـ API — فلا اعتماد على ملفات عيّنة خارجية.
"""
import pytest


def _create_supplier(client, account, name, project=''):
    r = client.post('/api/v1/suppliers', json=dict(account=account, name=name, project=project))
    assert r.status_code == 201, r.text
    return r.json()


def _create_contractor(client, code, name):
    r = client.post('/api/v1/contractors', json=dict(code=code, name=name))
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- set/replace/clear

def test_set_projects_directly(api_client):
    """party_projects.set_projects: استبدال كامل، وقيمة None تعني «لا تغيّر»."""
    import app.db.session as session_mod
    from app.services import party_projects as PP

    _create_supplier(api_client, '211001', 'مورد أ')
    with session_mod.SessionLocal() as db:
        from app.db import models
        row = db.query(models.Supplier).filter_by(account='211001').one()
        sid = row.id

        out = PP.set_projects(db, PP.SUPPLIER, sid, ['مشروع أ', 'مشروع ب'])
        db.commit()
        assert out == ['مشروع أ', 'مشروع ب']
        assert PP.projects_of(db, PP.SUPPLIER, sid) == ['مشروع أ', 'مشروع ب']

        # استبدال كامل — لائحة جديدة تمحو القديمة تماماً
        out2 = PP.set_projects(db, PP.SUPPLIER, sid, ['مشروع ج'])
        db.commit()
        assert out2 == ['مشروع ج']
        assert PP.projects_of(db, PP.SUPPLIER, sid) == ['مشروع ج']

        # تفريغ صريح بلائحة فارغة — يمحو كل شيء
        out3 = PP.set_projects(db, PP.SUPPLIER, sid, [])
        db.commit()
        assert out3 == []
        assert PP.projects_of(db, PP.SUPPLIER, sid) == []

        # إعادة التعيين، ثم None تعني «لا تغيّر»
        PP.set_projects(db, PP.SUPPLIER, sid, ['مشروع د'])
        db.commit()
        out4 = PP.set_projects(db, PP.SUPPLIER, sid, None)
        db.commit()
        assert out4 == ['مشروع د']
        assert PP.projects_of(db, PP.SUPPLIER, sid) == ['مشروع د']


def test_set_projects_cleans_blanks_and_dupes(api_client):
    import app.db.session as session_mod
    from app.services import party_projects as PP

    _create_supplier(api_client, '211002', 'مورد ب')
    with session_mod.SessionLocal() as db:
        from app.db import models
        sid = db.query(models.Supplier).filter_by(account='211002').one().id
        out = PP.set_projects(db, PP.SUPPLIER, sid,
                              ['  مشروع أ  ', '', 'مشروع أ', 'مشروع ب', '   '])
        db.commit()
        assert out == ['مشروع أ', 'مشروع ب']


# ---------------------------------------------------------------- PUT: None means unchanged

def test_supplier_put_partial_edit_does_not_wipe_projects(api_client):
    _create_supplier(api_client, '211010', 'مورد التعديل')
    r = api_client.put('/api/v1/suppliers/211010',
                       json=dict(projects=['مشروع الفا', 'مشروع بيتا']))
    assert r.status_code == 200, r.text
    assert r.json()['projects'] == ['مشروع الفا', 'مشروع بيتا']
    assert r.json()['project'] == 'مشروع الفا'  # primary = الأول

    # تعديل جزئي — اسم فقط، بلا حقل projects — يجب ألا يمحو اللائحة
    r2 = api_client.put('/api/v1/suppliers/211010', json=dict(name='اسم جديد'))
    assert r2.status_code == 200, r2.text
    assert r2.json()['projects'] == ['مشروع الفا', 'مشروع بيتا']
    assert r2.json()['name'] == 'اسم جديد'

    # الآن تعديل صريح للائحة — يجب أن يستبدلها فعلاً
    r3 = api_client.put('/api/v1/suppliers/211010', json=dict(projects=['مشروع جاما']))
    assert r3.status_code == 200, r3.text
    assert r3.json()['projects'] == ['مشروع جاما']
    assert r3.json()['project'] == 'مشروع جاما'

    # الظهور في GET أيضاً — عبر القائمة، لأن كشف المورد التفصيلي (٤٠٤) يقتصر على
    # موردين لهم حركة فعلية (فواتير أو دفعات)، وهذا المورد بلا حركة.
    g = api_client.get('/api/v1/suppliers', params={'q': '211010'})
    row = next(r for r in g.json()['rows'] if r['account'] == '211010')
    assert row['projects'] == ['مشروع جاما']


def test_contractor_put_partial_edit_does_not_wipe_projects(api_client):
    _create_contractor(api_client, 'C900', 'مقاول التعديل')
    r = api_client.put('/api/v1/contractors/C900',
                       json=dict(projects=['مشروع واحد', 'مشروع اثنين']))
    assert r.status_code == 200, r.text
    assert r.json()['projects'] == ['مشروع واحد', 'مشروع اثنين']

    r2 = api_client.put('/api/v1/contractors/C900', json=dict(phone='0500000000'))
    assert r2.status_code == 200, r2.text
    assert r2.json()['projects'] == ['مشروع واحد', 'مشروع اثنين']
    assert r2.json()['phone'] == '0500000000'


# ---------------------------------------------------------------- membership filtering

def test_supplier_membership_filtering_matches_any_project(api_client):
    """مورد على ثلاثة مشاريع يجب أن يظهر تحت الثلاثة — لا الأول فقط."""
    _create_supplier(api_client, '211020', 'مورد متعدد')
    api_client.put('/api/v1/suppliers/211020',
                   json=dict(projects=['برج الشمال', 'برج الجنوب', 'فيلات الواحة']))
    _create_supplier(api_client, '211021', 'مورد آخر', project='برج الشمال')

    for proj in ('برج الشمال', 'برج الجنوب', 'فيلات الواحة'):
        r = api_client.get('/api/v1/suppliers', params={'project': proj})
        assert r.status_code == 200, r.text
        accounts = {row['account'] for row in r.json()['rows']}
        assert '211020' in accounts, f'{proj}: {accounts}'

    # مشروع لا ينتمي إليه المورد المتعدد — لا يظهر
    r = api_client.get('/api/v1/suppliers', params={'project': 'مشروع لا علاقة له'})
    accounts = {row['account'] for row in r.json()['rows']}
    assert '211020' not in accounts
    assert accounts == set()


def test_contractor_membership_filtering_matches_any_project(api_client):
    _create_contractor(api_client, 'C910', 'مقاول متعدد')
    api_client.put('/api/v1/contractors/C910',
                   json=dict(projects=['مشروع أ', 'مشروع ب', 'مشروع ج']))
    _create_contractor(api_client, 'C911', 'مقاول آخر')
    api_client.put('/api/v1/contractors/C911', json=dict(projects=['مشروع أ']))

    for proj in ('مشروع أ', 'مشروع ب', 'مشروع ج'):
        r = api_client.get('/api/v1/contractors', params={'project': proj})
        assert r.status_code == 200, r.text
        codes = {row['code'] for row in r.json()['rows']}
        assert 'C910' in codes, f'{proj}: {codes}'

    r = api_client.get('/api/v1/contractors', params={'project': 'مشروع ب'})
    codes = {row['code'] for row in r.json()['rows']}
    assert 'C911' not in codes  # C911 ليس على «مشروع ب»


# ---------------------------------------------------------------- primary stays in sync

def test_supplier_primary_stays_in_sync_with_single_project_column(api_client):
    _create_supplier(api_client, '211030', 'مورد التزامن')
    api_client.put('/api/v1/suppliers/211030',
                   json=dict(projects=['المشروع الأول', 'المشروع الثاني']))

    import app.db.session as session_mod
    with session_mod.SessionLocal() as db:
        from app.db import models
        row = db.query(models.Supplier).filter_by(account='211030').one()
        assert row.project == 'المشروع الأول'

    # إعادة ترتيب اللائحة يغيّر primary تبعاً لذلك
    api_client.put('/api/v1/suppliers/211030',
                   json=dict(projects=['المشروع الثاني', 'المشروع الأول']))
    with session_mod.SessionLocal() as db:
        from app.db import models
        row = db.query(models.Supplier).filter_by(account='211030').one()
        assert row.project == 'المشروع الثاني'

    # تفريغ اللائحة بالكامل — primary فراغ
    api_client.put('/api/v1/suppliers/211030', json=dict(projects=[]))
    with session_mod.SessionLocal() as db:
        from app.db import models
        row = db.query(models.Supplier).filter_by(account='211030').one()
        assert row.project == ''


# ---------------------------------------------------------------- uniqueness

def test_party_project_uniqueness_holds(api_client):
    """قيد (party_type, party_id, project) — إدخال مكرر ضمن نفس set_projects يُنظَّف
    (انظر test_set_projects_cleans_blanks_and_dupes)، والقيد نفسه يمنع الإدراج
    المباشر المزدوج تحت نفس الهوية."""
    import app.db.session as session_mod
    from app.services import party_projects as PP
    from app.db import models
    from sqlalchemy.exc import IntegrityError

    _create_supplier(api_client, '211040', 'مورد القيد')
    with session_mod.SessionLocal() as db:
        sid = db.query(models.Supplier).filter_by(account='211040').one().id
        db.add(models.PartyProject(party_type=PP.SUPPLIER, party_id=sid,
                                   project='مشروع فريد', position=0))
        db.commit()

        db.add(models.PartyProject(party_type=PP.SUPPLIER, party_id=sid,
                                   project='مشروع فريد', position=1))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


# ---------------------------------------------------------------- create endpoints

def test_create_supplier_with_projects(api_client):
    r = api_client.post('/api/v1/suppliers',
                        json=dict(account='211050', name='مورد جديد',
                                  projects=['أ', 'ب']))
    assert r.status_code == 201, r.text
    assert r.json()['projects'] == ['أ', 'ب']
    assert r.json()['project'] == 'أ'


def test_create_contractor_with_projects(api_client):
    r = api_client.post('/api/v1/contractors',
                        json=dict(code='C920', name='مقاول جديد', projects=['س', 'ص']))
    assert r.status_code == 201, r.text
    assert r.json()['projects'] == ['س', 'ص']


# ---------------------------------------------------------------- all_projects dropdown

def test_all_projects_reflects_newly_added_project_immediately(api_client):
    _create_supplier(api_client, '211060', 'مورد لمشروع جديد')
    api_client.put('/api/v1/suppliers/211060', json=dict(projects=['مشروع فريد جداً']))

    r = api_client.get('/api/v1/suppliers')
    assert 'مشروع فريد جداً' in r.json()['projects']
