# -*- coding: utf-8 -*-
"""مساعدات مشتركة لمسارات الـ API — shared FastAPI route helpers.

`parse_date` is the ONE place that turns a user-supplied date string (body field
or query param) into a `datetime.date`. Every call site must go through this
instead of calling `dt.date.fromisoformat()` directly, so a malformed date (wrong
format, out-of-range day/month, garbage text) always surfaces as a clean 422 with
an Arabic message instead of a bare framework 500.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import HTTPException


def parse_date(value: Optional[str], field_name: str,
               required: bool = False) -> Optional[dt.date]:
    """Parses an ISO `YYYY-MM-DD` date string.

    `None` or `''` returns `None` unless `required=True`, in which case a missing
    value also raises the same 422 (used for fields that must not be blank, e.g. an
    invoice date). Anything that isn't a valid ISO date raises HTTPException(422)
    with an Arabic detail message naming the offending field and value.
    """
    if not value:
        if required:
            raise HTTPException(
                422, detail=f'تاريخ غير صالح في {field_name}: قيمة مطلوبة')
        return None
    try:
        return dt.date.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(
            422,
            detail=f'تاريخ غير صالح في {field_name}: {value} — الصيغة المطلوبة YYYY-MM-DD')
