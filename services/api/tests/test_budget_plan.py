# -*- coding: utf-8 -*-
"""الموازنة التقديرية (خطة شهرية) — قارئ بعناوين فوضوية، رفض عند عدم تطابق
الاجمالى، تأكيد إنشاء المشروع، وإعادة رفع لا تكرّر."""
import datetime as dt
from decimal import Decimal

import openpyxl
import pytest

from app.services import budget_plan_service as B

LABELS = ['يونيو 2026م', 'يوليو 2026م', 'أغسطس 2026م', 'ديسمبر2026م', 'فبراير 2027م ',
          'ابريل 2027م', 'اغسطس 2027م', 'اكتوبر2027']
MONTHS = [dt.date(2026, 6, 1), dt.date(2026, 7, 1), dt.date(2026, 8, 1), dt.date(2026, 12, 1),
          dt.date(2027, 2, 1), dt.date(2027, 4, 1), dt.date(2027, 8, 1), dt.date(2027, 10, 1)]
HEADER = ['رقم ', 'الشهر', 'نسبة الإنجاز المتوقعه', 'القيمه المخطط لها بدون الضريبه',
          'القيمه المخطط لها شامل الضريبه', 'خصم نسبة الدفعه المقدمه', 'خصم حسن الأداء',
          'صافى المستخلص ', 'خصم نسبه المواد', 'صافى المبلغ المحول', 'الضريبة',
          'صافى المبلغ المحول بعد خصم الضريبه', 'صافى مستخلص اعمار', 'الضريبه',
          'صافى مستخلص اعمار بعد خصم الضريبه', 'الضريبه المستحقه']


def _row_values(planned):
    incl = planned * 1.15
    adv = planned * 0.037
    ret = planned * 0.05
    net_claim = incl - adv - ret
    mat = net_claim * 0.6
    net = net_claim - mat
    vat = planned * 0.15
    return [1 / 8, planned, incl, adv, ret, net_claim, mat, net, vat, net - vat,
            net * 0.9, vat * 0.9, net * 0.9 - vat * 0.9, vat * 0.1]


def build(path, project='أفيرا', tamper=None, labels=LABELS):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'الملخص التنفيذي'
    ws['B2'] = 'موازنة تقديرية — شركة %s' % project
    ws['B3'] = 'ملخص تنفيذي  |  الفترة: يونيو 2026 –اكتوبر 2027  |  العملة: ريال سعودي'
    ws['H5'] = 'مدة التنفيذ (شهر)'
    ws['H6'] = 8
    d = wb.create_sheet('الموازنة التفصيلية')
    d['F3'], d['G3'] = 'قيمة العقد شامل الضريبه', 9200000.004
    d['F4'], d['G4'] = 'قيمة العقد بدون الضريبه', 8000000
    d['F5'], d['G5'] = 'قيمة الدفعه المقدمه', 800000
    d['F6'], d['G6'] = 'قيمة الفورما الالمنيوم', 1182996
    d['F8'], d['G8'] = 'نسبة المواد', 0.6
    d['F9'], d['G9'] = 'نسبة الضمان', 0.05
    d['F10'], d['G10'] = 'نسبة الدفعه المقدمه', 0.037
    d['F11'], d['G11'] = 'قيمة الضريبه', 1.15
    for j, h in enumerate(HEADER, 1):
        d.cell(row=14, column=j, value=h)
    rows = []
    for i, lab in enumerate(labels):
        vals = _row_values(1000000.3333333)
        rows.append(vals)
        d.cell(row=15 + i, column=1, value=i + 1)
        d.cell(row=15 + i, column=2, value=lab)
        for j, v in enumerate(vals):
            d.cell(row=15 + i, column=3 + j, value=v)
    tr = 15 + len(labels)
    d.cell(row=tr, column=1, value='الاجمالى')
    for j in range(len(rows[0])):
        total = sum(r[j] for r in rows)
        if tamper is not None and j == tamper:
            total += 5
        d.cell(row=tr, column=3 + j, value=total)
    wb.save(path)
    return path


def test_messy_month_labels_parse():
    for lab, want in zip(LABELS, MONTHS):
        assert B.parse_month_label(lab) == want
    assert B.parse_month_label('نوفمبر2027') == dt.date(2027, 11, 1)
    assert B.parse_month_label('أغسطس 26') == dt.date(2026, 8, 1)
    assert B.parse_month_label('شهر ما') is None


def test_reader_reads_everything(tmp_path):
    p = B.parse(build(str(tmp_path / 'plan.xlsx')))
    assert p['project'] == 'أفيرا'
    assert p['period'].startswith('يونيو 2026')
    assert p['contract'] == dict(inclVat='9200000.00', exclVat='8000000.00', durationMonths=8)
    assert p['assumptions']['advancePayment'] == '800000.00'
    assert p['assumptions']['aluminiumFormwork'] == '1182996.00'
    assert p['assumptions']['vatFactor'] == '1.1500'
    keys = [c['key'] for c in p['columns']]
    assert keys == ['completion_pct', 'planned_excl_vat', 'planned_incl_vat', 'advance_deduction',
                    'retention_deduction', 'net_claim', 'materials_deduction', 'net_transfer',
                    'vat', 'net_transfer_after_vat', 'emaar_net', 'emaar_vat',
                    'emaar_net_after_vat', 'vat_due']
    assert [m['month'] for m in p['months']] == MONTHS
    assert all(c['ok'] for c in p['check'])
    # المجموع بالـDecimal ثم التقريب مرة واحدة — لا جمع أرقام مقرَّبة
    assert p['totals']['planned_excl_vat'] == Decimal('8000002.67')


def test_totals_mismatch_refused(tmp_path):
    path = build(str(tmp_path / 'bad.xlsx'), tamper=7)   # عمود صافي المبلغ المحول
    with pytest.raises(B.BudgetPlanParseError) as e:
        B.parse(path)
    msg = str(e.value)
    assert 'صافى المبلغ المحول' in msg and '-5.00' in msg


def test_bad_month_refused(tmp_path):
    path = build(str(tmp_path / 'm.xlsx'), labels=LABELS[:-1] + ['شهر غير معروف'])
    with pytest.raises(B.BudgetPlanParseError):
        B.parse(path)


def test_classify_preview_commit_idempotent(api_client, tmp_path):
    path = build(str(tmp_path / 'plan.xlsx'))
    assert api_client.post('/api/v1/import/classify', json={'path': path}).json() == \
        {'source': 'budget_plan'}

    pv = api_client.post('/api/v1/import/preview', json={'path': path, 'source': 'budget_plan'}).json()
    assert pv['projectExists'] is False and pv['monthCount'] == 8 and pv['totalsOk']
    assert pv['existing']['status'] == 'new'

    # بلا تأكيد: لا شيء يُحفظ ولا مشروع يُنشأ
    r = api_client.post('/api/v1/import', json={'path': path, 'source': 'budget_plan'}).json()
    assert r['saved'] is False and r['reason'] == 'project_missing'
    assert api_client.get('/api/v1/projects/أفيرا/budget-plan').status_code == 404

    r = api_client.post('/api/v1/import', json={'path': path, 'source': 'budget_plan',
                                               'confirm_project': True}).json()
    assert r['saved'] is True and r['added'] == 8 and r['createdProject'] is True

    plan = api_client.get('/api/v1/projects/أفيرا/budget-plan').json()
    assert len(plan['months']) == 8
    assert plan['totals']['net_transfer'] == pv['totals']['net_transfer']
    assert all(m['actualExclVat'] is None for m in plan['months'])   # لا فعلي مُخترع

    # إعادة الرفع: مطابق مسبقاً، لا تكرار
    pv2 = api_client.post('/api/v1/import/preview', json={'path': path, 'source': 'budget_plan'}).json()
    assert pv2['projectExists'] is True and pv2['existing']['status'] == 'identical'
    r2 = api_client.post('/api/v1/import', json={'path': path, 'source': 'budget_plan'}).json()
    assert r2['saved'] is True and r2['identical'] is True and r2['added'] == 0
    plan2 = api_client.get('/api/v1/projects/أفيرا/budget-plan').json()
    assert len(plan2['months']) == 8 and plan2['id'] == plan['id']



def test_plan_vs_actual_uses_real_snapshot_only(api_client, tmp_path):
    from app.db import models
    from app.db.session import SessionLocal
    path = build(str(tmp_path / 'plan.xlsx'))
    api_client.post('/api/v1/import', json={'path': path, 'source': 'budget_plan',
                                           'confirm_project': True})
    with SessionLocal() as db:
        assert db.query(models.BudgetSnapshot).count() == 0
        db.add(models.BudgetSnapshot(project='أفيرا', month=dt.date(2026, 7, 1),
                                     actual_month=900000.0, planned_month=1000000.0))
        db.commit()
    plan = api_client.get('/api/v1/projects/أفيرا/budget-plan').json()
    with_actual = [m for m in plan['months'] if m['hasActual']]
    assert [m['month'] for m in with_actual] == ['2026-07']
    assert with_actual[0]['actualExclVat'] == '900000.00'
    assert with_actual[0]['deviation'] == '-100000.33'
    assert plan['actualVsPlan']['monthsWithActual'] == 1
