# -*- coding: utf-8 -*-
"""المبالغ على السلك في المسارات الجديدة — نص Decimal بمنزلتين.

المسارات القديمة تُرسل float عبر `money()` وتبقى كذلك (الأرقام الذهبية تحرسها).
الجديدة (/today، /events، م-٥٠) تُرسل نصاً: الواجهة تنسّق فقط ولا تجمع floats،
ولا يمرّ المبلغ برحلة float قد تُسقط هللة (BACKEND-ANALYSIS §٣.٥). التقريب نفسه
الذي يستعمله `money()` (quantize بسياق Decimal الافتراضي) — فالنص والرقم القديم
لنفس المبلغ متطابقان دائماً.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Optional

from app.domain.payables import D

_CENT = Decimal('0.01')


def money_str(x) -> str:
    return str(D(x).quantize(_CENT))


def money_str_or_none(x) -> Optional[str]:
    return None if x is None else money_str(x)


def parse_money(value, allow_negative: bool = False) -> Optional[Decimal]:
    """مبلغ من جسم طلب (نص أو رقم) — None للفراغ، ValueError لغير الصالح أو السالب
    (السالب مسموح للرصيد البنكي فقط: السحب على المكشوف حالة حقيقية)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        d = D(value.strip().replace(',', '') if isinstance(value, str) else value)
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError('مبلغ غير صالح: %s' % (value,))
    if not d.is_finite() or (d < 0 and not allow_negative):
        raise ValueError('المبلغ يجب أن يكون صفراً أو أكثر: %s' % (value,))
    return d.quantize(_CENT)
