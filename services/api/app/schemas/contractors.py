# -*- coding: utf-8 -*-
"""نماذج مدخلات المقاولين.

Field names are the exact camelCase JSON keys the frontend sends — no aliasing layer,
matching the rest of the API's wire format.
"""
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field

from app.schemas._amount import AmountRange


class ContractorIn(BaseModel):
    """إضافة مقاول يدوياً — الكود هو الهوية، الاسم للعرض فقط."""
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=300)
    phone: str = ''
    notes: str = ''
    defaultRetentionRate: Optional[float] = None
    defaultGuaranteeDays: Optional[int] = None
    #: مشاريع المقاول — اختياري عند الإنشاء؛ غيابه يعني «بلا مشاريع بعد».
    projects: Optional[List[str]] = None


class ContractorUpdate(BaseModel):
    """تعديل مقاول — الكود ثابت."""
    name: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    defaultRetentionRate: Optional[float] = None
    defaultGuaranteeDays: Optional[int] = None
    #: None تعني «لا تغيّر» — نفس عقد SupplierUpdate.projects.
    projects: Optional[List[str]] = None


class EntryIn(BaseModel):
    """حركة يدوية — exactly one of debit/credit must be > 0 (validated in the route)."""
    date: str                          # ISO
    debit: Annotated[float, Field(0.0, ge=0), AmountRange]
    credit: Annotated[float, Field(0.0, ge=0), AmountRange]
    description: str = ''
    kind: Optional[str] = None         # auto-classified from the description when omitted
    claimNo: Optional[str] = None
    project: Optional[str] = None


class EntryUpdate(BaseModel):
    date: Optional[str] = None
    debit: Annotated[Optional[float], Field(None, ge=0), AmountRange]
    credit: Annotated[Optional[float], Field(None, ge=0), AmountRange]
    description: Optional[str] = None
    kind: Optional[str] = None
    claimNo: Optional[str] = None
    project: Optional[str] = None


class ClaimIn(BaseModel):
    """مستخلص — cumulative totals as printed on the document, all editable."""
    project: str = ''
    number: str = ''
    date: str
    grossCumulative: Annotated[float, Field(0.0, ge=0), AmountRange]
    previousCumulative: Annotated[float, Field(0.0, ge=0), AmountRange]
    retentionRate: Optional[float] = Field(None, ge=0, le=1)
    retentionAmount: Annotated[float, Field(0.0, ge=0), AmountRange]
    otherDeductions: Annotated[float, Field(0.0, ge=0), AmountRange]
    netDue: Annotated[float, AmountRange] = 0.0  # may go negative when deductions exceed the work
    description: str = ''


class ClaimUpdate(BaseModel):
    project: Optional[str] = None
    number: Optional[str] = None
    date: Optional[str] = None
    grossCumulative: Annotated[Optional[float], Field(None, ge=0), AmountRange]
    previousCumulative: Annotated[Optional[float], Field(None, ge=0), AmountRange]
    retentionRate: Optional[float] = Field(None, ge=0, le=1)
    retentionAmount: Annotated[Optional[float], Field(None, ge=0), AmountRange]
    otherDeductions: Annotated[Optional[float], Field(None, ge=0), AmountRange]
    netDue: Annotated[Optional[float], AmountRange] = None
    description: Optional[str] = None


class GuaranteeIn(BaseModel):
    """ضمان مشروع — every field user-editable, the release clock lives here."""
    project: str = ''
    amount: Annotated[Optional[float], Field(None, ge=0), AmountRange]
    retentionRate: Optional[float] = Field(None, ge=0, le=1)
    finishedOn: Optional[str] = None
    guaranteeDays: Optional[int] = None
    releaseDue: Optional[str] = None
    releasedOn: Optional[str] = None
    notes: Optional[str] = None


class GuaranteeUpdate(BaseModel):
    amount: Annotated[Optional[float], Field(None, ge=0), AmountRange]
    retentionRate: Optional[float] = Field(None, ge=0, le=1)
    finishedOn: Optional[str] = None
    guaranteeDays: Optional[int] = None
    releaseDue: Optional[str] = None
    releasedOn: Optional[str] = None
    notes: Optional[str] = None
