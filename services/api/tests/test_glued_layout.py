# -*- coding: utf-8 -*-
"""التخطيط «الملتصق» — كشوف يطبعها النظام المحاسبي بلا علامة CompanyCode.

هذه الملفات كانت تُرفض جميعاً برسالة «لم يُعثر على أي حركة في الملف» وهي مليئة
بالحركات: المحلّل كان يقسّم على CompanyCode= وهي غائبة تماماً عن هذا التخطيط.

The three fixtures are real statements the user hit the failure with. Each one
covers a different trap:

  kahrabaiya   — رصيد افتتاحي printed label-FIRST (the other layout prints it last)
  sami         — descriptions that spill onto extra lines, because a description
                 ending in a digit («جزء من حوالھ25») pushes its amount to the next
                 line and an index-based read silently drops the whole row
  lamsa        — the minimal case: one invoice, one payment, closes at zero

كل ملف يُطابَق بإجماليه المطبوع — وهو الاختبار الوحيد الذي يُعتد به هنا.
"""
import os
from decimal import Decimal as D

import pytest

from app.ingest import pdf_statement as PS

SAMPLES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'design', 'samples')

CASES = [
    ('statement-glued-kahrabaiya.pdf', '2110904', D('0.00'), 1, 1),
    ('statement-glued-sami-muhandiya.pdf', '2111705', D('0.00'), 12, 5),
    ('statement-glued-lamsa.pdf', '2110937', D('0.00'), 1, 1),
]

pytestmark = pytest.mark.skipif(
    not os.path.isdir(SAMPLES), reason='design/samples غير متاح')


@pytest.mark.parametrize('fname,account,closing,n_inv,n_pay', CASES)
def test_glued_layout_parses_and_reconciles(fname, account, closing, n_inv, n_pay):
    path = os.path.join(SAMPLES, fname)
    if not os.path.exists(path):
        pytest.skip('%s غير متاح' % fname)
    r = PS.parse(path)

    assert r['account'] == account
    assert len(r['invoices']) == n_inv
    assert len(r['payments']) == n_pay

    invoiced = sum((D(str(i.amount)) for i in r['invoices']), D(0))
    paid = sum((D(str(p.amount)) for p in r['payments']), D(0))
    computed = invoiced - paid

    # اصطلاح الإشارة: المطبوع سالبٌ لما نَدين به — أي computed == −stated.
    stated = r['statement_balance']
    assert stated is not None, 'إجمالي الحساب المطبوع لم يُقرأ'
    assert abs(computed + D(str(stated))) <= D('0.01')
    assert abs(computed - closing) <= D('0.01')


def test_spilled_description_row_is_not_dropped():
    """«دفعھ سامي سویدي جزء من حوالھ25» — وصف ينتهي برقم فيدفع مبلغه لسطر تالٍ.

    قراءةٌ بالفهرس كانت تُسقط هذه الحركة بلا صوت، فيختل الكشف بمقدار ١٠٬٠٠٠ ر.س
    ويبدو الملف كأنه لا يطابق — وهو يطابق تماماً.
    """
    path = os.path.join(SAMPLES, 'statement-glued-sami-muhandiya.pdf')
    if not os.path.exists(path):
        pytest.skip('العيّنة غير متاحة')
    r = PS.parse(path)
    spilled = [p for p in r['payments']
               if 'جزء من' in p.description and D(str(p.amount)) == D('10000.00')]
    assert len(spilled) == 1, 'الحركة ذات الوصف المنسكب سقطت من القراءة'
    assert spilled[0].date.isoformat() == '2025-06-03'
