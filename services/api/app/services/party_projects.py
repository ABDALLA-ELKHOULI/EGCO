# -*- coding: utf-8 -*-
"""مشاريع الطرف — قراءة وكتابة لائحة مشاريع مورد أو مقاول.

Suppliers and contractors have the identical need (one party, several projects) so
they share one implementation. Anything that special-cases one of them here is a
bug waiting to happen: the two lists must behave the same or filtering «كل المشاريع»
will quietly mean two different things on two screens.
"""
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.utils.arabic import normalize_ar

SUPPLIER = 'supplier'
CONTRACTOR = 'contractor'


def projects_of(db: Session, party_type: str, party_id: str) -> List[str]:
    """مشاريع الطرف بترتيب العرض."""
    rows = (db.query(models.PartyProject)
            .filter_by(party_type=party_type, party_id=party_id)
            .order_by(models.PartyProject.position).all())
    return [r.project for r in rows]


def set_projects(db: Session, party_type: str, party_id: str,
                 projects: Optional[List[str]]) -> List[str]:
    """يستبدل لائحة المشاريع بالكامل. لا يُنفّذ commit — يتركه للمستدعي.

    projects=None تعني «لا تغيّر»، وهو ما يجعل تعديلاً جزئياً (اسم فقط) لا يمحو
    المشاريع بصمت.
    """
    if projects is None:
        return projects_of(db, party_type, party_id)

    # تنظيف: بلا فراغات، بلا فوارغ، بلا تكرار، مع الحفاظ على الترتيب المُدخل
    clean: List[str] = []
    for p in projects:
        p = (p or '').strip()
        if p and p not in clean:
            clean.append(p)

    db.query(models.PartyProject).filter_by(
        party_type=party_type, party_id=party_id).delete(synchronize_session=False)
    for i, p in enumerate(clean):
        db.add(models.PartyProject(party_type=party_type, party_id=party_id,
                                   project=p, position=i))
    return clean


def primary(projects: List[str]) -> str:
    """المشروع الذي يُكتب في العمود المفرد — الأول، أو فراغ."""
    return projects[0] if projects else ''


def _raw_project_names(db: Session) -> List[str]:
    """كل الأسماء الخام كما كُتبت — بلا تطبيع ولا تجميع، قبل التعامل مع التكرار."""
    names = [r[0] for r in db.query(models.PartyProject.project).distinct().all() if r[0]]
    names += [s.project for s in db.query(models.Supplier).filter(
        models.Supplier.deleted_at.is_(None)).all() if s.project]
    return names


def project_variant_groups(db: Session) -> Dict[str, List[str]]:
    """يجمع أسماء المشاريع حسب هويتها بعد التطبيع — {مطبَّع: [الصيغ الخام كلها]}.

    مشروعان أُدخلا بإملاءين مختلفين لنفس الاسم (المدينه / المدينة) ينتهيان بنفس
    المفتاح هنا. تُستخدم لتجميع لائحة الاختيار على قيمة واحدة، ولإخبار من يُدخل
    اسماً جديداً أن صيغة قريبة موجودة أصلاً بدل أن يُنشئ توأماً بصمت.
    """
    groups: Dict[str, List[str]] = {}
    for name in _raw_project_names(db):
        key = normalize_ar(name)
        variants = groups.setdefault(key, [])
        if name not in variants:
            variants.append(name)
    return groups


def canonical_project_name(variants: List[str]) -> str:
    """يختار صيغة عرض واحدة من عدة صيغ لنفس المشروع — الأقصر، ثم أبجدياً.

    الأقصر لأن الصيغة الأطول غالباً حرف إضافي (تاء مربوطة تُكتب أحياناً هاء) لا
    معلومة زائدة؛ هذا اختيار عرض في قائمة اختيار فقط، لا يُعدَّل به أي سجل مخزَّن.
    """
    return sorted(variants, key=lambda v: (len(v), v))[0]


def all_projects(db: Session) -> List[str]:
    """كل المشاريع المعروفة — صيغة واحدة لكل هوية (بعد تجميع التنويعات الإملائية)
    لقوائم الاختيار، حتى لا يظهر «المدينة» و«المدينه» كخيارين منفصلين لنفس المشروع.
    """
    groups = project_variant_groups(db)
    return sorted(canonical_project_name(variants) for variants in groups.values())


def parties_in_project(db: Session, party_type: str, project: str) -> set:
    """معرّفات الأطراف العاملة في مشروع — للتصفية «ينتمي إليه» لا «يساويه».

    تُطابق كل الصيغ الإملائية المكافئة للاسم المُمرَّر، لا الصيغة الحرفية فقط —
    وإلا فالتصفية بـ«المدينة» تُخفي مورداً أُدخل ملفه تحت «المدينه» رغم أنه
    نفس المشروع بالضبط.
    """
    if not project:
        return set()
    key = normalize_ar(project)
    variants = {name for name in _raw_project_names(db) if normalize_ar(name) == key}
    variants.add(project)
    return {r[0] for r in db.query(models.PartyProject.party_id).filter(
        models.PartyProject.party_type == party_type,
        models.PartyProject.project.in_(variants)).all()}


def suggest_existing_project(db: Session, name: str) -> Optional[str]:
    """لو كان الاسم يطابق مشروعاً موجوداً إملائياً بعد التطبيع لكن بصيغة مختلفة
    حرفياً، تُرجع الصيغة الموجودة (وإلا None) — تُستعمل عند إضافة مشروع جديد
    لعرض اقتراح «هل تقصد…» بدل إنشاء توأم بصمت. تطابق حرفي كامل ليس اقتراحاً
    (هو المشروع نفسه أصلاً)."""
    if not name or not name.strip():
        return None
    key = normalize_ar(name)
    for existing in _raw_project_names(db):
        if existing != name and normalize_ar(existing) == key:
            return existing
    return None
