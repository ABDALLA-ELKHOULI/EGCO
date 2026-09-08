# -*- coding: utf-8 -*-
"""نماذج مدخلات الموازنة.

المستخدم يُدخل ٦ حقول فقط (انظر PLAN-BUDGET.md §٢) — الباقي محسوب في
budget_service ولا يُقبل من الواجهة أبداً: لا cumActual ولا completionPct ولا
delayPct في أي نموذج هنا، فلا طريق لكتابتها مباشرة يتجاوز محرك الحساب.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas._amount import AmountRange
from typing import Annotated


class ClaimIn(BaseModel):
    """مستخلص واحد ضمن claims[] — رقم · مبلغ · تاريخ."""
    no: str = ''
    amount: Annotated[float, AmountRange] = 0.0
    date: Optional[str] = None  # ISO yyyy-mm-dd


class BudgetSnapshotIn(BaseModel):
    """إدخال/تعديل شهر موازنة — الحقول الستة التي يُدخلها المستخدم فعلياً."""
    project: str = Field(min_length=1, max_length=120)
    month: str  # ISO yyyy-mm-dd — أول يوم من الشهر
    actualMonth: Annotated[float, AmountRange] = 0.0
    plannedMonth: Annotated[float, AmountRange] = 0.0
    claims: List[ClaimIn] = []
    docNo: str = ''
    issuedOn: Optional[str] = None
    notes: str = ''
    #: تجاوز التعارض عمداً بعد أن رآه المستخدم في /preview — بلا هذا الحقل
    #: /budget و/budget/{id} يرفضان الكتابة عند وجود تعارض (انظر الخطر ٢).
    forceConflict: bool = False
    #: مسار الملف الذي أعادته /imports/budget-attachment بعد رفعه ونسخه —
    #: بلا هذا الحقل يُنسخ الملف ويُعرض اسمه ولا يبقى مربوطاً بسجل الشهر إطلاقاً،
    #: وهي بالضبط الفجوة التي كشفها وكيلا الواجهة والتصدير مستقلَّين عن بعضهما.
    attachment: Optional[str] = None


class ProjectCityIn(BaseModel):
    city: str = ''


class CommentIn(BaseModel):
    text: str = Field(min_length=1)
