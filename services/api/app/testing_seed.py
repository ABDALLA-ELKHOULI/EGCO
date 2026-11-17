# -*- coding: utf-8 -*-
"""بذر بيانات مصنوعة لاختبارات الواجهة (م-٤٧) — لا عيّنات حقيقية.

يعمل فقط حين `EGCO_SEED=1` عند إقلاع الخادم **وعلى قاعدة فارغة**. أي شرط منهما
غائب = لا يكتب شيئاً. الغاية: خادم مؤقت يقدّم أرقاماً ثابتة معروفة سلفاً حتى
تستطيع اختبارات Playwright مطابقة «المديونية المفتوحة» عبر الشاشات.

الإدخال يمرّ عبر دوال المسارات اليدوية نفسها (routes/suppliers, routes/manual,
routes/contractors, routes/budget) لا عبر ORM مباشر، حتى تكون الأرقام متّسقة
تماماً مع ما يحصل عليه المستخدم حين يُدخل يدوياً — نفس تحليل المدة، نفس ربط
المشاريع، نفس تصنيف حركات المقاولين.

التواريخ نسبية لليوم فيبقى «متأخر/مستحق قريباً» صادقاً في أي يوم تُشغَّل فيه.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
from decimal import Decimal
from typing import List

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SEED_ENV = 'EGCO_SEED'

PROJECTS = ['السدن', 'المدينة', 'سدايم']

#: (account, name, project, term, invoices[(days_ago, amount, doc)], payments[(days_ago, amount, doc)])
#: التواريخ مختارة بحيث لا يعبر أي بند حدّاً (٧/٣٠/٦٠/٩٠ يوماً) قبل ~٨٠ يوماً من
#: البذر — فتبقى أرقام KPI وشرائح الأعمار ثابتة للقطات المرجعية البصرية مدةً كافية.
SUPPLIERS = [
    ('2110001', 'شركة الحديد الموحدة', 'السدن', '90 يوم',
     [(200, Decimal('100000.00'), 'F-1001'), (10, Decimal('50000.00'), 'F-1002')],
     [(60, Decimal('30000.00'), 'P-2001')]),
    ('2110002', 'مصنع الخرسانة الجاهزة', 'المدينة', '60 يوم',
     [(400, Decimal('75000.50'), 'F-1003')],
     []),
    ('2110003', 'مؤسسة الكهرباء الحديثة', 'سدايم', 'كاش',
     [(150, Decimal('12500.00'), 'F-1004')],
     [(1, Decimal('2500.00'), 'P-2002')]),
    ('2110004', 'شركة الدهانات الوطنية', 'السدن', '365 يوم',
     [(20, Decimal('40000.00'), 'F-1005')],
     []),
]

#: إجمالي المديونية المفتوحة المتوقع بعد البذر = Σفواتير − Σدفعات (كل مورد رصيده موجب)
EXPECTED_OUTSTANDING = Decimal('245000.50')
#: المتأخر: ٢١١٠٠٠١ فاتورة ٢٠٠ يوم ناقص دفعة ٣٠٠٠٠ (FIFO) + ٢١١٠٠٠٢ كاملة + ٢١١٠٠٠٣ (كاش، ناقص دفعتها)
EXPECTED_OVERDUE = Decimal('155000.50')

#: (code, name, project, entries[(days_ago, debit, credit, description)])
#: الأوصاف بالصيغ التي يعرفها domain/contractors.classify_entry:
#: «رصيد افتتاحي» → opening · «مستخلص رقم N» → claim · «دفعة» → payment
CONTRACTORS = [
    ('2120001', 'مقاولات البناء الحديث', 'السدن', [
        (120, Decimal('0'), Decimal('200000.00'), 'رصيد افتتاحي'),
        (40, Decimal('0'), Decimal('150000.00'), 'مستخلص رقم 1'),
        (30, Decimal('100000.00'), Decimal('0'), 'دفعة'),
    ]),
    ('2120002', 'مؤسسة الأعمال الكهروميكانيكية', 'المدينة', [
        (80, Decimal('0'), Decimal('80000.00'), 'رصيد افتتاحي'),
        (25, Decimal('0'), Decimal('60000.00'), 'مستخلص رقم 1'),
        (15, Decimal('90000.00'), Decimal('0'), 'دفعة'),
    ]),
    ('2120003', 'شركة التشطيبات المتقدمة', 'سدايم', [
        (50, Decimal('0'), Decimal('30000.00'), 'رصيد افتتاحي'),
        (5, Decimal('20000.00'), Decimal('0'), 'دفعة'),
    ]),
]

GUARANTEE = dict(code='2120001', project='السدن', amount=Decimal('17500.00'),
                 finished_days_ago=200, guarantee_days=365)

BUDGET = dict(project='السدن', actual=Decimal('1200000.00'), planned=Decimal('1500000.00'))


def seed_requested() -> bool:
    return os.environ.get(SEED_ENV) == '1'


def database_is_empty(db: Session) -> bool:
    """فارغة = لا مورد ولا مقاول ولا لقطة موازنة (حتى المحذوف منطقياً يُحتسب)."""
    from app.db import models
    for model in (models.Supplier, models.Contractor, models.BudgetSnapshot,
                  models.Invoice, models.Payment, models.ContractorEntry):
        if db.query(model.id).first() is not None:
            return False
    return True


def _iso(days_ago: int, today: dt.date) -> str:
    return (today - dt.timedelta(days=days_ago)).isoformat()


def seed(db: Session, today: dt.date = None) -> dict:
    """يبذر الحزمة كاملة ويعيد ملخّصاً بالأعداد. يفترض أن المستدعي تحقّق من الحارس."""
    from app.api.routes import budget as budget_route
    from app.api.routes import contractors as contractors_route
    from app.api.routes import manual as manual_route
    from app.api.routes import suppliers as suppliers_route
    from app.schemas.budget import BudgetSnapshotIn
    from app.schemas.common import InvoiceIn, PaymentIn, SupplierIn
    from app.schemas.contractors import ContractorIn, EntryIn, GuaranteeIn

    today = today or dt.date.today()
    counts = dict(suppliers=0, invoices=0, payments=0, contractors=0, entries=0,
                  guarantees=0, budgetMonths=0)

    for account, name, project, term, invoices, payments in SUPPLIERS:
        suppliers_route.create_supplier(
            SupplierIn(account=account, name=name, project=project, term=term,
                       projects=[project]), db)
        counts['suppliers'] += 1
        for days_ago, amount, doc in invoices:
            manual_route.create_invoice(
                InvoiceIn(account=account, amount=float(amount), date=_iso(days_ago, today),
                          description='فاتورة توريد', reference=doc), db)
            counts['invoices'] += 1
        for days_ago, amount, doc in payments:
            manual_route.create_payment(
                PaymentIn(account=account, amount=float(amount), date=_iso(days_ago, today),
                          description='دفعة', reference=doc), db)
            counts['payments'] += 1

    for code, name, project, entries in CONTRACTORS:
        contractors_route.create_contractor(
            ContractorIn(code=code, name=name, projects=[project]), db)
        counts['contractors'] += 1
        for days_ago, debit, credit, description in entries:
            contractors_route.create_entry(
                code,
                EntryIn(date=_iso(days_ago, today), debit=float(debit), credit=float(credit),
                        description=description, project=project), db)
            counts['entries'] += 1

    contractors_route.create_guarantee(
        GUARANTEE['code'],
        GuaranteeIn(project=GUARANTEE['project'], amount=float(GUARANTEE['amount']),
                    finishedOn=_iso(GUARANTEE['finished_days_ago'], today),
                    guaranteeDays=GUARANTEE['guarantee_days']), db)
    counts['guarantees'] += 1

    month = today.replace(day=1)
    budget_route.budget_create(
        BudgetSnapshotIn(project=BUDGET['project'], month=month.isoformat(),
                         actualMonth=float(BUDGET['actual']),
                         plannedMonth=float(BUDGET['planned']),
                         docNo='EGCO/E2E-001', notes='شهر مصنوع لاختبارات الواجهة'), db)
    counts['budgetMonths'] += 1

    return counts


def seed_if_requested() -> bool:
    """نقطة الاستدعاء من lifespan. يعيد True فقط إن بُذر فعلاً.

    الحارسان صريحان ومستقلان: بلا `EGCO_SEED=1` لا يُفتح حتى اتصال بالقاعدة،
    وعلى قاعدة فيها أي بيانات لا يُكتب صف واحد — القاعدة الحقيقية للمستخدم
    ليست فارغة أبداً، فحتى لو ضُبط المتغير خطأً لا يُلمس شيء.
    """
    if not seed_requested():
        return False
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        if not database_is_empty(db):
            logger.warning('%s=1 لكن القاعدة ليست فارغة — لن يُبذر شيء', SEED_ENV)
            return False
        counts = seed(db)
        logger.info('بُذرت بيانات الاختبار المصنوعة: %s', counts)
        return True
    finally:
        db.close()


__all__: List[str] = ['seed_if_requested', 'seed', 'database_is_empty', 'seed_requested',
                      'EXPECTED_OUTSTANDING', 'EXPECTED_OVERDUE', 'SUPPLIERS', 'CONTRACTORS']
