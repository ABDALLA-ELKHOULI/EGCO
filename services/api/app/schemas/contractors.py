# -*- coding: utf-8 -*-
"""نماذج مدخلات المقاولين.

Field names are the exact camelCase JSON keys the frontend sends — no aliasing layer,
matching the rest of the API's wire format.
"""
from typing import Optional

from pydantic import BaseModel, Field


class ContractorIn(BaseModel):
    """إضافة مقاول يدوياً — الكود هو الهوية، الاسم للعرض فقط."""
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=300)
    phone: str = ''
    notes: str = ''
    defaultRetentionRate: Optional[float] = None
    defaultGuaranteeDays: Optional[int] = None


class ContractorUpdate(BaseModel):
    """تعديل مقاول — الكود ثابت."""
    name: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    defaultRetentionRate: Optional[float] = None
    defaultGuaranteeDays: Optional[int] = None


class EntryIn(BaseModel):
    """حركة يدوية — exactly one of debit/credit must be > 0 (validated in the route)."""
    date: str                          # ISO
    debit: float = Field(0.0, ge=0)
    credit: float = Field(0.0, ge=0)
    description: str = ''
    kind: Optional[str] = None         # auto-classified from the description when omitted
    claimNo: Optional[str] = None
    project: Optional[str] = None


class EntryUpdate(BaseModel):
    date: Optional[str] = None
    debit: Optional[float] = Field(None, ge=0)
    credit: Optional[float] = Field(None, ge=0)
    description: Optional[str] = None
    kind: Optional[str] = None
    claimNo: Optional[str] = None
    project: Optional[str] = None


class ClaimIn(BaseModel):
    """مستخلص — cumulative totals as printed on the document, all editable."""
    project: str = ''
    number: str = ''
    date: str
    grossCumulative: float = Field(0.0, ge=0)
    previousCumulative: float = Field(0.0, ge=0)
    retentionRate: Optional[float] = Field(None, ge=0, le=1)
    retentionAmount: float = Field(0.0, ge=0)
    otherDeductions: float = Field(0.0, ge=0)
    netDue: float = 0.0                # may go negative when deductions exceed the work
    description: str = ''


class ClaimUpdate(BaseModel):
    project: Optional[str] = None
    number: Optional[str] = None
    date: Optional[str] = None
    grossCumulative: Optional[float] = Field(None, ge=0)
    previousCumulative: Optional[float] = Field(None, ge=0)
    retentionRate: Optional[float] = Field(None, ge=0, le=1)
    retentionAmount: Optional[float] = Field(None, ge=0)
    otherDeductions: Optional[float] = Field(None, ge=0)
    netDue: Optional[float] = None
    description: Optional[str] = None


class GuaranteeIn(BaseModel):
    """ضمان مشروع — every field user-editable, the release clock lives here."""
    project: str = ''
    amount: Optional[float] = Field(None, ge=0)
    retentionRate: Optional[float] = Field(None, ge=0, le=1)
    finishedOn: Optional[str] = None
    guaranteeDays: Optional[int] = None
    releaseDue: Optional[str] = None
    releasedOn: Optional[str] = None
    notes: Optional[str] = None


class GuaranteeUpdate(BaseModel):
    amount: Optional[float] = Field(None, ge=0)
    retentionRate: Optional[float] = Field(None, ge=0, le=1)
    finishedOn: Optional[str] = None
    guaranteeDays: Optional[int] = None
    releaseDue: Optional[str] = None
    releasedOn: Optional[str] = None
    notes: Optional[str] = None
