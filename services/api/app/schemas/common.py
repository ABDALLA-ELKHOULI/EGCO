# -*- coding: utf-8 -*-
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas._amount import AmountRange


class AccountClassificationIn(BaseModel):
    account: str = Field(min_length=1, max_length=32)
    kind: Literal['supplier', 'contractor', 'guarantee', 'ignore']
    name: str = ''


class ClassifySuggestRequest(BaseModel):
    path: str


class NewSupplierIn(BaseModel):
    """إنشاء مورد أثناء الرفع — لحساب ظهر في كشف ولم يكن في ملف المدد."""
    name: Optional[str] = None
    project: Optional[str] = None
    #: مدة السداد كما يكتبها المستخدم («٤٥ يوم»، «كاش»…) — تحدّد تواريخ الاستحقاق
    term: Optional[str] = None


class ImportRequest(BaseModel):
    path: str
    source: Literal['pdf_statement', 'suppliers_excel', 'csv_statement', 'receivables_legacy_html', 'receivables_excel']
    allow_unreconciled: bool = False
    #: يُملأ فقط بعد أن يؤكّد المستخدم إنشاء الحساب الجديد
    create_supplier: Optional[NewSupplierIn] = None


class PreviewRequest(BaseModel):
    path: str
    source: Literal['pdf_statement', 'suppliers_excel', 'csv_statement', 'receivables_legacy_html', 'receivables_excel'] = 'pdf_statement'


class ScanDirRequest(BaseModel):
    dir: str


class BatchImportRequest(BaseModel):
    paths: List[str]
    allow_unreconciled: bool = False


class DueDateUpdate(BaseModel):
    due_date: Optional[str] = None


# ---------------------------------------------------------------- الموردون

class SupplierIn(BaseModel):
    """إضافة مورد يدوياً.

    `term` is the free-text payment term exactly as the company writes it
    ('45 يوم', 'كاش', 'مستخلص', or blank) — it is normalised server-side by the same
    parser the Excel import uses, so a hand-added supplier behaves identically to an
    imported one.
    """
    account: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=300)
    project: str = ''
    term: str = ''
    #: مشاريع المورد الكاملة — اختياري: لو أُرسل «project» فقط بلا هذا الحقل، يُشتق
    #: منه (انظر routes/suppliers.py). أُرسل كلاهما؟ project يبقى المرجع الأساسي عبر
    #: primary() بعد set_projects.
    projects: Optional[List[str]] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    project: Optional[str] = None
    term: Optional[str] = None
    #: None تعني «لا تغيّر» — تعديل جزئي (مثلاً تغيير الاسم فقط) يجب ألا يمحو مشاريع
    #: المورد بصمت (انظر party_projects.set_projects).
    projects: Optional[List[str]] = None


# ---------------------------------------------------------------- المديونية

class InvoiceIn(BaseModel):
    """إضافة مديونية مستحقة يدوياً."""
    account: str                      # رقم حساب المورد
    amount: Annotated[float, Field(gt=0), AmountRange]
    date: str                         # ISO — تاريخ الفاتورة
    due_date: Optional[str] = None
    description: str = ''
    reference: Optional[str] = None


class InvoiceUpdate(BaseModel):
    amount: Annotated[Optional[float], Field(default=None, gt=0), AmountRange]
    date: Optional[str] = None
    due_date: Optional[str] = None
    description: Optional[str] = None
    reference: Optional[str] = None


class PaymentIn(BaseModel):
    """تسجيل دفعة يدوياً."""
    account: str
    amount: Annotated[float, Field(gt=0), AmountRange]
    date: str
    description: str = ''
    reference: Optional[str] = None


# ---------------------------------------------------------------- التحصيلات (الإيراد)

class RevenueIn(BaseModel):
    """إضافة تحصيل يدوياً — نفس شكل السجل المستورد من الملفات."""
    project: str = ''
    unit: str = ''
    client: str = Field(min_length=1, max_length=300)
    amount: Annotated[float, Field(gt=0), AmountRange]
    due_date: Optional[str] = Field(default=None, alias='dueDate')
    status: str = 'open'
    collected_on: Optional[str] = Field(default=None, alias='collectedOn')
    notes: str = ''

    class Config:
        populate_by_name = True


class RevenueUpdate(BaseModel):
    """تعديل جزئي — الحقول غير المُرسلة لا تُلمس؛ dueDate/collectedOn قد تُرسل صراحة
    كـ null لمسحها (يُميَّز ذلك عبر exclude_unset عند القراءة في المسار)."""
    project: Optional[str] = None
    unit: Optional[str] = None
    client: Optional[str] = Field(default=None, min_length=1, max_length=300)
    amount: Annotated[Optional[float], Field(default=None, gt=0), AmountRange]
    due_date: Optional[str] = Field(default=None, alias='dueDate')
    status: Optional[str] = None
    collected_on: Optional[str] = Field(default=None, alias='collectedOn')
    notes: Optional[str] = None

    class Config:
        populate_by_name = True
