# -*- coding: utf-8 -*-
"""حد أعلى معقول لأي مبلغ مالي يدخله المستخدم — يمنع خطأ كتابي (صفر زائد) من
الدخول بصمت (مثال حي: 1e30 قُبِل كمبلغ فاتورة قبل هذا الفحص).

Shared across every money-carrying Pydantic field (manual invoice/payment,
revenues, contractor entries/claims/guarantees). A trillion SAR is far beyond
any real figure this company handles, so anything above it is almost certainly
a fat-fingered input, not a legitimate amount.
"""
from __future__ import annotations

from typing import Optional

from pydantic import AfterValidator

MAX_AMOUNT = 1e12


def _check_amount_range(v: Optional[float]) -> Optional[float]:
    if v is not None and abs(v) > MAX_AMOUNT:
        raise ValueError('المبلغ خارج النطاق المعقول')
    return v


AmountRange = AfterValidator(_check_amount_range)
