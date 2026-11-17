# -*- coding: utf-8 -*-
"""م-٤٩ — «دفعھ» بالهاء الفارسية دفعةٌ لا «أخرى».

على نسخة القاعدة الحقيقية: ٦ قيود بـ٤٥٠٬٠٠٠ ر.س صُنّفت «أخرى» فعُدّت خصماً في
تقرير المقاول. هذا الاختبار يثبّت المُصنِّف، والهجرة تُصلح المخزَّن.
"""
from app.domain.contractors import classify_entry, extract_claim_no


def test_persian_heh_payment():
    assert classify_entry('دفعھ من الحساب') == 'payment'
    assert classify_entry('دفعہ') == 'payment'


def test_persian_heh_retention_and_invoice():
    assert classify_entry('فاتورھ رقم 5') == 'invoice'


def test_arabic_heh_unchanged():
    assert classify_entry('دفعة رقم 3') == 'payment'
    assert classify_entry('مستخلص رقم 6') == 'claim'
    assert extract_claim_no('مستخلص رقم 14') == '14'
