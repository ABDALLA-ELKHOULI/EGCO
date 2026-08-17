# -*- coding: utf-8 -*-
"""جداول قاعدة البيانات.

Every row carries id (UUID) / created_at / updated_at / deleted_at. There is no cloud,
but those four columns are what make a future device-to-device merge possible without a
migration — and financial records are soft-deleted, never removed.

The supplier key is `account` (رقم الحساب), never the name: انجاز الرواد appears in five
projects and سماء البناء in four.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import List, Optional

from sqlalchemy import (Date, DateTime, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    deleted_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)


class PartyProject(TimestampMixin, Base):
    """مشاريع الطرف — مورد أو مقاول يعمل في أكثر من مشروع.

    جدول ربط واحد يخدم الاثنين: نفس الحاجة، ونفس السلوك، فلا داعي لجدولين
    يتباعدان. `party_type` هو 'supplier' أو 'contractor' و`party_id` معرّفه.

    The single `project` column on Supplier stays and is kept in sync with the FIRST
    project here. Reports, exports and the budget screen all read that column; dropping
    it would break them, and rewriting every one of them is a bigger change than this
    feature justifies. The column is the summary; this table is the truth.
    """
    __tablename__ = 'party_projects'
    __table_args__ = (UniqueConstraint('party_type', 'party_id', 'project',
                                       name='uq_party_project'),)
    party_type: Mapped[str] = mapped_column(String(20), index=True)
    party_id: Mapped[str] = mapped_column(String(36), index=True)
    project: Mapped[str] = mapped_column(String(120), index=True)
    #: ترتيب العرض — الأول هو الذي يُكتب في العمود المفرد
    position: Mapped[int] = mapped_column(Integer, default=0)


class Supplier(TimestampMixin, Base):
    __tablename__ = 'suppliers'
    account: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(300))
    project: Mapped[str] = mapped_column(String(120), default='')
    term_raw: Mapped[str] = mapped_column(String(60), default='')
    #: cached normalisation of term_raw — 'days' | 'cash' | 'claim'
    term_kind: Mapped[str] = mapped_column(String(20), default='cash')
    term_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    invoices: Mapped[List['Invoice']] = relationship(back_populates='supplier')
    payments: Mapped[List['Payment']] = relationship(back_populates='supplier')


class Invoice(TimestampMixin, Base):
    """فاتورة — a credit line on the statement."""
    __tablename__ = 'invoices'
    # الوصف والمستند جزء من الهوية — كشوف حقيقية تحمل فاتورتين بنفس الرقم والتاريخ
    # والمبلغ وتختلفان في المستند/الوصف (سامي سويد: فاتورة ٨٥٠٠٦ بسندين مختلفين).
    # بدونهما ترفض القاعدة الصف الثاني فيفشل الملف كله — وهو ما حدث فعلاً.
    # جدول حركات المقاولين يضم الوصف في هويته منذ البداية؛ هذان الجدولان تأخّرا.
    __table_args__ = (UniqueConstraint('supplier_id', 'number', 'date', 'amount',
                                       'doc', 'description',
                                       name='uq_invoice_identity'),)

    supplier_id: Mapped[str] = mapped_column(ForeignKey('suppliers.id'), index=True)
    number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    date: Mapped[dt.date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    doc: Mapped[str] = mapped_column(String(60), default='')
    description: Mapped[str] = mapped_column(Text, default='')
    #: only used by claim-based suppliers, where the due date cannot be derived
    manual_due_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    #: 'statement' | 'manual' | 'csv_statement'
    source: Mapped[str] = mapped_column(String(20), default='statement')
    #: which ImportLog created this row — null for manual/pre-feature rows
    import_log_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)

    supplier: Mapped[Supplier] = relationship(back_populates='invoices')


class Payment(TimestampMixin, Base):
    """دفعة — a debit line on the statement."""
    __tablename__ = 'payments'
    # نفس السبب: دفعتان بنفس السند والتاريخ والمبلغ تختلفان في الوصف
    # (انظمة الطلاء: مرتجعان لفاتورتين مختلفتين على سند واحد).
    __table_args__ = (UniqueConstraint('supplier_id', 'doc', 'date', 'amount',
                                       'description',
                                       name='uq_payment_identity'),)

    supplier_id: Mapped[str] = mapped_column(ForeignKey('suppliers.id'), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    doc: Mapped[str] = mapped_column(String(60), default='')
    description: Mapped[str] = mapped_column(Text, default='')
    #: 'statement' | 'manual' | 'csv_statement'
    source: Mapped[str] = mapped_column(String(20), default='statement')
    #: which ImportLog created this row — null for manual/pre-feature rows
    import_log_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)

    supplier: Mapped[Supplier] = relationship(back_populates='payments')


class Receivable(TimestampMixin, Base):
    """تحصيلات — an amount owed TO the company (unit sale instalments)."""
    __tablename__ = 'receivables'
    __table_args__ = (UniqueConstraint('unit', 'client', 'amount', 'status', 'source',
                                       name='uq_receivable_identity'),)

    project: Mapped[str] = mapped_column(String(120), default='')
    unit: Mapped[str] = mapped_column(String(60), default='')
    client: Mapped[str] = mapped_column(String(300), default='')
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    due_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    collected_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    #: 'collected' | 'open'
    status: Mapped[str] = mapped_column(String(20), default='open')
    source: Mapped[str] = mapped_column(String(40), default='')
    notes: Mapped[str] = mapped_column(Text, default='')
    #: which ImportLog created this row — null for manual/pre-feature rows
    import_log_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)


class Contractor(TimestampMixin, Base):
    """مقاول — keyed by the accounting-system code (212xxxxx), never the name.

    Names repeat across projects the same way supplier names do; the code is the
    identity, the name is only for matching suggestions during import.
    """
    __tablename__ = 'contractors'
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(300))
    phone: Mapped[str] = mapped_column(String(60), default='')
    notes: Mapped[str] = mapped_column(Text, default='')
    #: default retention rate for new claims (e.g. 0.05 / 0.10) — the claim itself wins
    default_retention_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    #: default guarantee period in days — editable per project guarantee
    default_guarantee_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    entries: Mapped[List['ContractorEntry']] = relationship(back_populates='contractor')
    claims: Mapped[List['ContractorClaim']] = relationship(back_populates='contractor')
    guarantees: Mapped[List['ContractorGuarantee']] = relationship(back_populates='contractor')


class ContractorEntry(TimestampMixin, Base):
    """حركة على حساب مقاول — ledger line from the statement or manual entry.

    The ledger is the financial source of truth: balance = Σdebit − Σcredit,
    positive = he owes us, negative = we owe him — the statement's own convention.
    debit (مدين) = payments to him / back-charges; credit (دائن) = مستخلصات.
    """
    __tablename__ = 'contractor_entries'
    __table_args__ = (UniqueConstraint('contractor_id', 'doc', 'date', 'debit', 'credit',
                                       'description', name='uq_contractor_entry_identity'),)

    contractor_id: Mapped[str] = mapped_column(ForeignKey('contractors.id'), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    debit: Mapped[float] = mapped_column(Float, default=0.0)
    credit: Mapped[float] = mapped_column(Float, default=0.0)
    doc: Mapped[str] = mapped_column(String(60), default='')
    description: Mapped[str] = mapped_column(Text, default='')
    #: 'claim' مستخلص | 'payment' دفعة | 'retention' تأمين/ضمان | 'deduction' خصم
    #: | 'invoice' فاتورة محملة عليه | 'opening' رصيد افتتاحي | 'other'
    kind: Mapped[str] = mapped_column(String(20), default='other')
    #: مستخلص number when the description carries one
    claim_no: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    #: project attribution — auto-detected from the description, editable
    project: Mapped[str] = mapped_column(String(120), default='')
    #: 'statement' | 'manual'
    source: Mapped[str] = mapped_column(String(20), default='statement')
    #: which ImportLog created this row — null for manual/pre-feature rows
    import_log_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)

    contractor: Mapped[Contractor] = relationship(back_populates='entries')


class ContractorClaim(TimestampMixin, Base):
    """مستخلص — the document itself, cumulative totals as printed, all editable.

    Claims do NOT feed the balance (the ledger does); they carry the retention
    detail and cumulative history the ledger lines cannot show.
    """
    __tablename__ = 'contractor_claims'
    __table_args__ = (UniqueConstraint('contractor_id', 'project', 'number', 'date',
                                       name='uq_claim_identity'),)

    contractor_id: Mapped[str] = mapped_column(ForeignKey('contractors.id'), index=True)
    project: Mapped[str] = mapped_column(String(120), default='')
    number: Mapped[str] = mapped_column(String(60), default='')
    date: Mapped[dt.date] = mapped_column(Date)
    gross_cumulative: Mapped[float] = mapped_column(Float, default=0.0)
    previous_cumulative: Mapped[float] = mapped_column(Float, default=0.0)
    retention_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    retention_amount: Mapped[float] = mapped_column(Float, default=0.0)
    other_deductions: Mapped[float] = mapped_column(Float, default=0.0)
    net_due: Mapped[float] = mapped_column(Float, default=0.0)
    description: Mapped[str] = mapped_column(Text, default='')
    #: 'manual' | 'excel' | 'pdf'
    source: Mapped[str] = mapped_column(String(20), default='manual')

    contractor: Mapped[Contractor] = relationship(back_populates='claims')


class ContractorGuarantee(TimestampMixin, Base):
    """ضمان مقاول في مشروع — the release clock, every field user-editable."""
    __tablename__ = 'contractor_guarantees'
    __table_args__ = (UniqueConstraint('contractor_id', 'project',
                                       name='uq_guarantee_identity'),)

    contractor_id: Mapped[str] = mapped_column(ForeignKey('contractors.id'), index=True)
    project: Mapped[str] = mapped_column(String(120), default='')
    #: retention held for this project (accumulated from claims or set by hand)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    retention_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    finished_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    guarantee_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    #: manual override; when null the due date derives from finished_on + guarantee_days
    release_due: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    released_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default='')

    contractor: Mapped[Contractor] = relationship(back_populates='guarantees')


class BudgetSnapshot(TimestampMixin, Base):
    """لقطة موازنة شهرية لمشروع — من تقرير انحراف الموازنة التقديرية."""
    __tablename__ = 'budget_snapshots'
    __table_args__ = (UniqueConstraint('project', 'month', name='uq_budget_identity'),)

    project: Mapped[str] = mapped_column(String(120), index=True)
    #: first day of the report month
    month: Mapped[dt.date] = mapped_column(Date)
    serial: Mapped[str] = mapped_column(String(60), default='')
    issued_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    actual_month: Mapped[float] = mapped_column(Float, default=0.0)
    planned_month: Mapped[float] = mapped_column(Float, default=0.0)
    deviation_month: Mapped[float] = mapped_column(Float, default=0.0)
    cum_actual: Mapped[float] = mapped_column(Float, default=0.0)
    cum_planned: Mapped[float] = mapped_column(Float, default=0.0)
    cum_prev_actual: Mapped[float] = mapped_column(Float, default=0.0)
    cum_prev_planned: Mapped[float] = mapped_column(Float, default=0.0)
    #: fraction, e.g. 0.1596 = 15.96% behind schedule
    delay_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    #: fraction, e.g. 0.8404 — from the financial notes when stated
    completion_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    #: JSON list of {no, amount, date} — مستخلصات صادرة للمالك في الشهر
    claims: Mapped[str] = mapped_column(Text, default='[]')
    notes: Mapped[str] = mapped_column(Text, default='')
    source: Mapped[str] = mapped_column(Text, default='')


class AccountClassification(TimestampMixin, Base):
    """قرار تصنيف يدوي لحساب برقم بادئة غير معروفة (ليس 211/212/216).

    Added for the strict-prefix-dispatch task: any account whose prefix isn't
    211/212/216 must be asked about once, remembered, and never guessed again —
    see import_service._dispatch_kind.
    """
    __tablename__ = 'account_classifications'
    account: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    #: 'supplier' | 'contractor' | 'guarantee' | 'ignore'
    kind: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(300), default='')
    decided_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class GuaranteeAccount(TimestampMixin, Base):
    """حساب ضمان (بادئة 216) مستقل — يُربط لاحقاً بمقاول/مورد إن وُجدت مطابقة.

    New table (additive only, no ALTER on existing tables) backing the 216
    guarantee-statement flow described in this task.
    """
    __tablename__ = 'guarantee_accounts'
    account: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(300), default='')
    linked_contractor_code: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    balance: Mapped[float] = mapped_column(Float, default=0.0)


class GuaranteeEntry(TimestampMixin, Base):
    """حركة على حساب ضمان (216) — credit يضيف تأمين من مستخلص، debit يفرج/يخصم."""
    __tablename__ = 'guarantee_entries'
    __table_args__ = (UniqueConstraint('guarantee_account_id', 'doc', 'date', 'debit',
                                       'credit', 'description',
                                       name='uq_guarantee_entry_identity'),)
    guarantee_account_id: Mapped[str] = mapped_column(ForeignKey('guarantee_accounts.id'),
                                                       index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    debit: Mapped[float] = mapped_column(Float, default=0.0)
    credit: Mapped[float] = mapped_column(Float, default=0.0)
    doc: Mapped[str] = mapped_column(String(60), default='')
    description: Mapped[str] = mapped_column(Text, default='')
    source: Mapped[str] = mapped_column(String(20), default='statement')
    import_log_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)


class LearnedLayout(TimestampMixin, Base):
    """نمط تخطيط ملف مُتعلَّم — قاعدة استخراج حتمية قابلة لإعادة الاستخدام، لا بيانات.

    يُخزَّن هنا شكل الملف (بنيته) لا محتواه: كشفان من نفس نظام المحاسبة بأسماء
    وأرقام مختلفة يجب أن يحملا نفس fingerprint؛ انظر ai_service.compute_fingerprint
    للطريقة وحدودها الصادقة. rulesJson يحمل الأنماط (تعابير نمطية + ترتيب حقول)
    التي استنتجها الكود من أول استخراج بالذكاء الاصطناعي لهذا التخطيط — وليس أي
    استدعاء نموذج إضافي.
    """
    __tablename__ = 'learned_layouts'
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    #: 'pdf' | 'xlsx' | 'other'
    source_kind: Mapped[str] = mapped_column(String(20))
    sample_account: Mapped[str] = mapped_column(String(32), default='')
    sample_name: Mapped[str] = mapped_column(String(300), default='')
    #: JSON — انظر ai_service.learn_rules_from_extraction للشكل الدقيق
    rules_json: Mapped[str] = mapped_column(Text, default='{}')
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)
    #: طول النص (حرف) الذي أُرسل للنموذج عند التعلّم — أساس تقدير tokensSaved لاحقاً
    learned_from_chars: Mapped[int] = mapped_column(Integer, default=0)


class AppSetting(TimestampMixin, Base):
    """إعداد عام واحد للتطبيق — مفتاح/قيمة نصية. يبدأ بإعداد تخصيص الدفعات فقط.

    جدول عام حتى لا يحتاج كل إعداد مستقبلي جدولاً مستقلاً؛ القيمة نص دائماً
    (يفسّرها القارئ) لإبقاء البنية بسيطة. انظر payables_service.is_smart_allocation_enabled.
    """
    __tablename__ = 'app_settings'
    key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    value: Mapped[str] = mapped_column(Text, default='')


class PaymentAllocation(TimestampMixin, Base):
    """قرار تخصيص دفعة لفاتورة (أو فواتير عبر أسطر متعددة) أو «على الحساب».

    جزء من ميزة «تخصيص الدفعات» الاختيارية (إعداد افتراضي متوقف — انظر AppSetting
    أعلاه). يُقرأ فقط حين الإعداد مفعّل؛ إن كان متوقفاً يُتجاهل هذا الجدول كلياً
    ويبقى السلوك القديم (allocate_fifo) كما هو.

    صف واحد لكل (دفعة، فاتورة) — دفعة مقسّمة على عدة فواتير تحمل عدة صفوف بنفس
    payment_id، ومجموع amount عبر أسطر الدفعة يُتحقّق منه في payables_service قبل
    الحفظ (لا هنا — هذا الجدول يخزّن القرار كما اتُّخذ ولا يحاسب). invoice_id
    فارغ = جزء «على الحساب» بلا فاتورة محددة (kind='on_account').

    وجود أي صف بهذا payment_id يعني أن القرار اتُّخذ ولن تُسأل عنه الدفعة مرة
    أخرى — domain/payables.allocate_smart يقرأ هذا الجدول كخرائط قرارات جاهزة.
    القرار قابل للتعديل: يُحذف الصف/الصفوف القديمة ويُكتب قرار جديد محلها
    (payables_service.save_payment_allocation).
    """
    __tablename__ = 'payment_allocations'
    __table_args__ = (UniqueConstraint('payment_id', 'invoice_id',
                                       name='uq_payment_allocation'),)
    payment_id: Mapped[str] = mapped_column(ForeignKey('payments.id'), index=True)
    #: NULL == على الحساب (لا فاتورة محددة)
    invoice_id: Mapped[Optional[str]] = mapped_column(ForeignKey('invoices.id'),
                                                       nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    #: 'manual' (المستخدم اختار فاتورة/فواتير) | 'on_account' (على الحساب بلا فاتورة)
    kind: Mapped[str] = mapped_column(String(20), default='manual')


class ImportLog(TimestampMixin, Base):
    """سجل الرفع — audit trail so any imported number can be explained later."""
    __tablename__ = 'import_logs'
    source: Mapped[str] = mapped_column(String(40))
    path: Mapped[str] = mapped_column(Text)
    account: Mapped[str] = mapped_column(String(32), default='')
    imported: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    reconciled: Mapped[int] = mapped_column(Integer, default=0)
    issues: Mapped[str] = mapped_column(Text, default='[]')
