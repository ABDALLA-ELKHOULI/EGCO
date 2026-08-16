# -*- coding: utf-8 -*-
"""مشاريع الطرف — قراءة وكتابة لائحة مشاريع مورد أو مقاول.

Suppliers and contractors have the identical need (one party, several projects) so
they share one implementation. Anything that special-cases one of them here is a
bug waiting to happen: the two lists must behave the same or filtering «كل المشاريع»
will quietly mean two different things on two screens.
"""
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models

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


def all_projects(db: Session) -> List[str]:
    """كل المشاريع المعروفة من الجدولين معاً — لقوائم الاختيار."""
    names = {r[0] for r in db.query(models.PartyProject.project).distinct().all() if r[0]}
    names |= {s.project for s in db.query(models.Supplier).filter(
        models.Supplier.deleted_at.is_(None)).all() if s.project}
    return sorted(names)


def parties_in_project(db: Session, party_type: str, project: str) -> set:
    """معرّفات الأطراف العاملة في مشروع — للتصفية «ينتمي إليه» لا «يساويه»."""
    return {r[0] for r in db.query(models.PartyProject.party_id).filter_by(
        party_type=party_type, project=project).all()}
