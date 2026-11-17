# -*- coding: utf-8 -*-
"""تصفير البيانات — حذف كل ما رُفع وأُدخل، والإبقاء على إعدادات التطبيق.

لماذا حذف فعلي لا حذف منطقي: «تصفير» يعني العودة إلى تطبيق فارغ. الحذف المنطقي
(`deleted_at`) يُبقي الصفوف في القاعدة فتظهر في سلّة المحذوفات وتُحتسب في بعض
المسارات، فلا يكون التطبيق فارغاً فعلاً — ويفقد الزرّ معناه. هذا والحذف النهائي
في سلّة المحذوفات هما المساران الوحيدان اللذان يحذفان صفاً فعلياً من القاعدة.

البيانات التي تُمحى لا يمكن إعادة إدخالها يدوياً — مئات الكشوف وآلاف الحركات —
لذلك النسخة الاحتياطية **شرط للتنفيذ لا خطوة مصاحبة**: إن تعذّر أخذها يُلغى
التصفير كله. هذا يخالف سلوك النسخة قبل التحديث (هناك فشل النسخ لا يوقف التحديث)
والفارق مقصود: التحديث لا يمسّ البيانات، وهذا يمحوها.
"""
import logging
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.db import models

logger = logging.getLogger(__name__)

#: العبارة التي يكتبها المستخدم ليؤكّد. نقرة واحدة لا تكفي لفعلٍ لا رجعة فيه،
#: وكتابة الكلمة تُجبر على قراءة ما يُحذف بدل الضغط الآلي على «نعم».
CONFIRM_PHRASE = 'تصفير'

#: ما يُمحى — بيانات الشركة التي تُعرض في الشاشات. الترتيب يحترم المفاتيح
#: الأجنبية: الأبناء قبل الآباء، وإلا فشل الحذف على قيد مرجعي.
WIPED: List[tuple] = [
    ('payment_allocations', models.PaymentAllocation, 'تخصيصات الدفعات'),
    ('invoices', models.Invoice, 'الفواتير'),
    ('payments', models.Payment, 'الدفعات'),
    ('contractor_claims', models.ContractorClaim, 'المستخلصات'),
    ('contractor_guarantees', models.ContractorGuarantee, 'ضمانات المقاولين'),
    ('contractor_entries', models.ContractorEntry, 'حركات المقاولين'),
    ('guarantee_entries', models.GuaranteeEntry, 'حركات الضمانات'),
    ('guarantee_accounts', models.GuaranteeAccount, 'حسابات الضمانات'),
    ('receivables', models.Receivable, 'التحصيلات'),
    ('budget_comments', models.BudgetComment, 'ملاحظات الموازنة'),
    ('budget_snapshots', models.BudgetSnapshot, 'لقطات الموازنة'),
    ('party_projects', models.PartyProject, 'مشاريع الأطراف'),
    ('project_cities', models.ProjectCity, 'مدن المشاريع'),
    ('suppliers', models.Supplier, 'الموردون'),
    ('contractors', models.Contractor, 'المقاولون'),
    ('import_logs', models.ImportLog, 'سجلّ الملفات المرفوعة'),
]

#: ما يبقى — إعدادات وذاكرة تعلُّم، لا بيانات شركة. محوها يعني إعادة إدخال مفتاح
#: الذكاء ومسار النسخ الخارجي، وإعادة تعليم صيغ الملفات على حساب الرموز، بلا أي
#: مقابل: لا شيء منها يظهر كرقم في الشاشات.
KEPT: List[tuple] = [
    ('app_settings', models.AppSetting, 'الإعدادات (مزوّد الذكاء، مسار النسخ)'),
    ('learned_layouts', models.LearnedLayout, 'صيغ الملفات المتعلَّمة'),
    ('account_classifications', models.AccountClassification,
     'تصنيفات الحسابات اليدوية'),
]


def preview(db: Session) -> Dict[str, object]:
    """ماذا سيُحذف وماذا سيبقى — بالأعداد الفعلية، قبل أي تنفيذ.

    تُعرض في نافذة التأكيد: «موافق» على رقم تراه أصدق من «موافق» على وصف عام.
    """
    wiped = [dict(table=t, label=label, count=db.query(m).count())
             for t, m, label in WIPED]
    kept = [dict(table=t, label=label, count=db.query(m).count())
            for t, m, label in KEPT]
    return dict(
        wipes=wiped,
        keeps=kept,
        totalRows=sum(int(r['count']) for r in wiped),
        confirmPhrase=CONFIRM_PHRASE,
        isEmpty=all(int(r['count']) == 0 for r in wiped),
    )


def reset_all(db: Session, backup_name: Optional[str] = None) -> Dict[str, object]:
    """يمحو بيانات الشركة. يفترض أن النسخة الاحتياطية أُخذت قبل النداء.

    `backup_name` يُعاد في النتيجة ليراه المستخدم: الطمأنينة ليست أن نقول «أخذنا
    نسخة» بل أن نسمّيها، فيجدها إن احتاجها.
    """
    deleted: Dict[str, int] = {}
    for table, model, _label in WIPED:
        deleted[table] = db.query(model).delete(synchronize_session=False)
    db.commit()
    total = sum(deleted.values())
    logger.warning('تم تصفير البيانات — %d صفاً محذوفاً، النسخة: %s',
                   total, backup_name or '—')
    return dict(reset=True, deleted=deleted, totalDeleted=total,
                backup=backup_name)
