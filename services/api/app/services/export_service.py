# -*- coding: utf-8 -*-
"""تصدير Excel — GET /api/v1/reports/export.xlsx.

Three sheets, right-to-left, Arabic titles: الملخص (summary), الفترات (periods),
الموردون (suppliers).
"""
from __future__ import annotations

import io
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

NUM_FMT = '#,##0.00'


def _style_header(ws, row=1):
    for cell in ws[row]:
        if cell.value is not None:
            cell.font = Font(bold=True)


def _autosize(ws):
    for col_cells in ws.columns:
        length = max((len(str(c.value)) if c.value is not None else 0) for c in col_cells)
        letter = get_column_letter(col_cells[0].column)
        ws.column_dimensions[letter].width = min(max(length + 2, 10), 40)


def _contractors_sheet(wb: Workbook, contractors: dict, first: bool = False):
    """ورقة المقاولون — no ageing columns: their ledger has no due dates."""
    ws = wb.active if first else wb.create_sheet('المقاولون')
    if first:
        ws.title = 'المقاولون'
    ws.sheet_view.rightToLeft = True
    ws.append(['كود المقاول', 'الاسم', 'المشاريع', 'المحمّل عليه', 'المدفوع',
               'خصومات وتحميلات', 'المستحق له', 'الرصيد'])
    _style_header(ws)
    for c in contractors.get('rows', []):
        ws.append([c.get('code', ''), c.get('name', ''),
                   '، '.join(c.get('projects') or []),
                   c.get('invoiced', 0), c.get('paid', 0), c.get('deductions', 0),
                   c.get('outstanding', 0), c.get('balance', 0)])
    t = contractors.get('totals') or {}
    if t:
        ws.append(['الإجمالي', '', '', t.get('invoiced', 0), t.get('paid', 0),
                   t.get('deductions', 0), t.get('outstanding', 0), t.get('balance', 0)])
        for cell in ws[ws.max_row]:
            cell.font = Font(bold=True)
    for r in range(2, ws.max_row + 1):
        for c in (4, 5, 6, 7, 8):
            cell = ws.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _autosize(ws)
    return ws


def _priorities_sheet(wb: Workbook, priorities: dict):
    """ورقة أولويات السداد — نفس القائمة الحتمية المعروضة في قسم التقرير التحليلي
    (F.build_priorities)، بلا عمود «ضمن الميزانية» — ذاك تقدير محلي في الواجهة
    فقط، فلا يُطبع كحقيقة من الخادم على وثيقة مُصدَّرة.
    """
    ws = wb.create_sheet('أولويات السداد')
    ws.sheet_view.rightToLeft = True
    ws.append(['#', 'الاسم', 'النوع', 'المبلغ (ر.س)', 'السبب'])
    _style_header(ws)
    for i, it in enumerate(priorities.get('items') or [], start=1):
        ws.append([i, it.get('name', ''),
                   'مقاول' if it.get('partyKind') == 'contractor' else 'مورد',
                   it.get('amount', 0), it.get('reason', '')])
    for r in range(2, ws.max_row + 1):
        cell = ws.cell(row=r, column=4)
        if isinstance(cell.value, (int, float)):
            cell.number_format = NUM_FMT
    _autosize(ws)
    return ws


def build_project_summary_workbook(payload: dict) -> bytes:
    """ورقة واحدة — ملخّص المشروع بسطر واحد لكل شركة، بنفس آلية build_workbook.

    عمود «أقصى تأخر» و«شريحته» يُتركان فارغين للمقاولين — لا يُخترع صفر لتأخر
    لا معنى محاسبياً له (انظر تعليق `delay` في report_service.project_summary).
    """
    wb = Workbook()
    ws = wb.active
    ws.title = 'ملخص المشروع'
    ws.sheet_view.rightToLeft = True
    ws.append(['اسم الشركة', 'رقم الحساب', 'نوع الطرف', 'إجمالي المفوتر', 'المسدد',
               'المتبقي', 'المتأخر', 'أقصى تأخر (يوم)', 'آخر دفعة — التاريخ',
               'آخر دفعة — المبلغ'])
    _style_header(ws)
    for r in payload.get('rows', []):
        delay = r.get('delay') or {}
        lp = r.get('lastPayment') or {}
        ws.append([
            r.get('name', ''), r.get('account', ''),
            'مقاول' if r.get('partyKind') == 'contractor' else 'مورد',
            r.get('totalInvoiced', 0), r.get('totalPaid', 0), r.get('outstanding', 0),
            delay.get('amount', '') if r.get('delay') is not None else '—',
            delay.get('days', '') if r.get('delay') is not None else '—',
            lp.get('date', ''), lp.get('amount', ''),
        ])
    t = payload.get('totals') or {}
    if t:
        ws.append(['الإجمالي', '', '', t.get('totalInvoiced', 0), t.get('totalPaid', 0),
                   t.get('outstanding', 0), t.get('delayedAmount', 0),
                   t.get('maxDelayDays', 0), '', ''])
        for cell in ws[ws.max_row]:
            cell.font = Font(bold=True)
    for r in range(2, ws.max_row + 1):
        for c in (4, 5, 6, 7, 8, 10):
            cell = ws.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _autosize(ws)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_workbook(analysis: dict, periodic: Optional[dict] = None,
                   suppliers_rows: Optional[list] = None,
                   contractors_only: bool = False,
                   priorities: Optional[dict] = None) -> bytes:
    wb = Workbook()

    if contractors_only:
        # تقرير مقاول واحد — his sheet and nothing else; the supplier sheets would be
        # empty and would read as "no debts" rather than "not in scope".
        _contractors_sheet(wb, analysis.get('contractors') or {}, first=True)
        if priorities is not None:
            _priorities_sheet(wb, priorities)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    # ---- الملخص
    ws1 = wb.active
    ws1.title = 'الملخص'
    ws1.sheet_view.rightToLeft = True
    meta = analysis['meta']
    summary = analysis['summary']
    rows = [
        ('الشركة', meta.get('company', '')),
        ('الفترة', meta.get('period', '')),
        ('رصيد أول المدة', meta.get('opening_balance', 0)),
        ('رصيد آخر المدة', meta.get('closing_balance', summary.get('outstanding', 0))),
        ('إجمالي الفواتير', summary.get('total_invoiced', 0)),
        ('إجمالي المسدد', summary.get('total_paid', 0)),
        ('المديونية القائمة', summary.get('outstanding', 0)),
        ('المتأخر', summary.get('overdue', 0)),
        ('مستحق خلال ٧ أيام', summary.get('due_within_7', 0)),
        ('عدد الموردين', summary.get('supplier_count', 0)),
    ]
    if analysis.get('contractors') is not None:
        rows += [('النطاق', meta.get('scope_label', '')),
                 ('عدد المقاولين', summary.get('contractor_count', 0)),
                 ('رصيد المقاولين', summary.get('contractor_balance', 0))]
    ws1.append(['البند', 'القيمة'])
    _style_header(ws1)
    for label, value in rows:
        ws1.append([label, value])
    for r in range(2, ws1.max_row + 1):
        cell = ws1.cell(row=r, column=2)
        if isinstance(cell.value, (int, float)):
            cell.number_format = NUM_FMT
    _autosize(ws1)

    # ---- الفترات
    ws2 = wb.create_sheet('الفترات')
    ws2.sheet_view.rightToLeft = True
    headers2 = ['الفترة', 'من', 'إلى', 'الرصيد الافتتاحي', 'المفوتر', 'المسدد',
               'الصافي', 'الرصيد الختامي', 'متوسط أيام السداد']
    ws2.append(headers2)
    _style_header(ws2)
    if periodic:
        for p in periodic['periods']:
            ws2.append([p['label'], p['from'], p['to'], p['opening'], p['invoiced'],
                       p['paid'], p['net'], p['closing'],
                       p['avgSettlementDays'] if p['avgSettlementDays'] is not None else ''])
    for r in range(2, ws2.max_row + 1):
        for c in (4, 5, 6, 7, 8, 9):
            cell = ws2.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _autosize(ws2)

    # ---- الموردون
    ws3 = wb.create_sheet('الموردون')
    ws3.sheet_view.rightToLeft = True
    ws3.append(['رقم الحساب', 'الاسم', 'المشروع', 'المدة', 'المديونية القائمة', 'المتأخر'])
    _style_header(ws3)
    supplier_rows = suppliers_rows if suppliers_rows is not None else analysis.get('suppliers', [])
    for s in supplier_rows:
        ws3.append([s.get('account', ''), s.get('name', ''), s.get('project', ''),
                   s.get('term', ''), s.get('outstanding', 0), s.get('overdue', 0)])
    for r in range(2, ws3.max_row + 1):
        for c in (5, 6):
            cell = ws3.cell(row=r, column=c)
            if isinstance(cell.value, (int, float)):
                cell.number_format = NUM_FMT
    _autosize(ws3)

    if analysis.get('contractors') is not None:
        _contractors_sheet(wb, analysis['contractors'])

    if priorities is not None:
        _priorities_sheet(wb, priorities)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
