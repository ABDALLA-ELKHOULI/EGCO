# -*- coding: utf-8 -*-
"""سجل المشاريع وأطرافها بمبالغ (م-٥٠).

المشروع في القاعدة نصّ على كل حركة. الواجهة الجديدة تحتاج معرّفاً ثابتاً (رابط،
مبلغ إسناد، قيمة عقد) لا يضيع حين يُدمج «سدن» في «السدن». السجل يربط معرّفاً
ثابتاً بمفتاح المطابقة المطبَّع (نفس `_match_key` في شاشة المشاريع)، فكل الصيغ
الإملائية لنفس المشروع تقع على صفّ واحد.

قاعدة «لا تخترع رقماً» تحكم كل ما هنا:
- مبلغ إسناد غير مُدخل = None لا صفر.
- فواتير الموردين لا تحمل مشروعاً؛ مورد في أكثر من مشروع لا تُوزَّع أرقامه
  تخميناً — تُعاد None مع `attribution: 'shared'`.
- الهامش بلا قيمة عقد = None.
"""
from __future__ import annotations

import datetime as dt
import threading
from decimal import Decimal
from typing import Dict, List, Optional, Set

from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import D
from app.services import contractors_service as CS
from app.services import party_projects as PP
from app.services import payables_service as PS
from app.services import request_cache as RC
from app.services.money_wire import money_str, money_str_or_none
from app.services.projects_service import UNKNOWN_PROJECT, _match_key

ZERO = Decimal('0')
PARTY_TYPES = (PP.SUPPLIER, PP.CONTRACTOR)

#: مساران GET متزامنان قد يكتشفان المشروع الجديد معاً فيُنشئان صفّين — القفل
#: يجعل الإنشاء متسلسلاً داخل العملية الواحدة (الخادم عملية واحدة دائماً).
_ENSURE_LOCK = threading.Lock()


# ---------------------------------------------------------------- السجل

def _known_names(db: Session) -> List[str]:
    """كل اسم مشروع مكتوب في أي جدول — المصدر الذي يُبنى منه السجل."""
    names = list(PP.raw_project_names(db))
    for model in (models.ContractorEntry, models.BudgetSnapshot, models.Receivable):
        names += [r[0] for r in db.query(model.project).filter(
            model.deleted_at.is_(None)).distinct().all() if r[0]]
    return [n for n in names if n and n.strip()]


def _groups(db: Session) -> Dict[str, List[str]]:
    # محفوظة لعمر الطلب — تُستدعى لكل صف مشروع؛ أي كتابة تمسحها (request_cache)
    return RC.get(db, ('project_groups',), lambda: _groups_uncached(db))


def _groups_uncached(db: Session) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    for n in _known_names(db):
        k = _match_key(n)
        if not k:
            continue
        lst = out.setdefault(k, [])
        if n not in lst:
            lst.append(n)
    return out


def _display_name(db: Session, names: List[str]) -> str:
    """اسم العرض: صيغة الموردين إن وُجدت (هي ما تعرضه /projects)، وإلا الأقصر."""
    supplier_names = {s.project for s in db.query(models.Supplier.project).filter(
        models.Supplier.deleted_at.is_(None)).distinct().all() if s.project}
    preferred = [n for n in names if n in supplier_names]
    pool = preferred or names
    return sorted(pool, key=lambda v: (len(v), v))[0]


def _live_registry(db: Session) -> List[models.ProjectRegistry]:
    return db.query(models.ProjectRegistry).filter(
        models.ProjectRegistry.deleted_at.is_(None)).all()


def ensure(db: Session) -> Dict[str, models.ProjectRegistry]:
    """{مفتاح: صف السجل} — يُنشئ صفاً لكل مشروع جديد مكتشف (ولا يحذف أبداً)."""
    with _ENSURE_LOCK:
        by_key = {r.key: r for r in _live_registry(db)}
        groups = _groups(db)
        created = False
        for key, names in groups.items():
            if key in by_key:
                continue
            row = models.ProjectRegistry(name=_display_name(db, names), key=key)
            db.add(row)
            by_key[key] = row
            created = True
        # «غير محدد» صفّ اصطناعي في /projects (موردون بلا مشروع) — له معرّف أيضاً
        # حتى تعمل روابط الواجهة عليه، لكنه لا يقبل أطرافاً (انظر set_party).
        ukey = _match_key(UNKNOWN_PROJECT)
        if ukey not in by_key:
            row = models.ProjectRegistry(name=UNKNOWN_PROJECT, key=ukey)
            db.add(row)
            by_key[ukey] = row
            created = True
        if created:
            db.commit()
        return by_key


def registry_json(reg: models.ProjectRegistry, aliases: Optional[List[str]] = None) -> dict:
    return dict(id=reg.id, name=reg.name,
                contractValue=money_str_or_none(reg.contract_value),
                contractValueAt=(reg.contract_value_at.replace(microsecond=0).isoformat()
                                 if reg.contract_value_at else None),
                notes=reg.notes or '', aliases=sorted(aliases or []))


def registry_list(db: Session) -> List[dict]:
    by_key = ensure(db)
    groups = _groups(db)
    return [registry_json(r, [n for n in groups.get(k, []) if n != r.name])
            for k, r in sorted(by_key.items(), key=lambda kv: kv[1].name)]


def resolve(db: Session, id_or_name: str) -> Optional[models.ProjectRegistry]:
    """معرّف السجل أو اسم المشروع (أي صيغة إملائية) → صف السجل."""
    if not id_or_name:
        return None
    by_key = ensure(db)
    row = db.query(models.ProjectRegistry).filter(
        models.ProjectRegistry.id == id_or_name,
        models.ProjectRegistry.deleted_at.is_(None)).one_or_none()
    if row is not None:
        return row
    return by_key.get(_match_key(id_or_name))


def names_of(db: Session, reg: models.ProjectRegistry) -> Set[str]:
    """كل الصيغ الخام المكتوبة لهذا المشروع في القاعدة (+ اسم السجل)."""
    names = set(_groups(db).get(reg.key, []))
    names.add(reg.name)
    return names


def update_project(db: Session, reg: models.ProjectRegistry, fields: dict) -> dict:
    if 'contractValue' in fields:
        reg.contract_value = fields['contractValue']
        reg.contract_value_at = dt.datetime.now() if fields['contractValue'] is not None else None
    if 'notes' in fields and fields['notes'] is not None:
        reg.notes = fields['notes']
    db.commit()
    return registry_json(reg, [n for n in names_of(db, reg) if n != reg.name])


def merge_registry(db: Session, from_name: str, into_name: str) -> None:
    """بعد دمج الاسمين في project_admin: صف المصدر يُحذف منطقياً وقيمة عقده تنتقل
    للهدف إن لم يكن له قيمة. لا commit — يتركه للمستدعي (نفس معاملة الدمج)."""
    fk, ik = _match_key(from_name), _match_key(into_name)
    if fk == ik:
        return
    src = db.query(models.ProjectRegistry).filter_by(key=fk, deleted_at=None).one_or_none()
    if src is None:
        return
    dst = db.query(models.ProjectRegistry).filter_by(key=ik, deleted_at=None).one_or_none()
    if dst is None:
        # الهدف لم يُسجَّل بعد — يرث المصدرُ مفتاحَه فيبقى نفس المعرّف (لا رابط يضيع)
        src.key = ik
        src.name = into_name
        return
    if dst.contract_value is None and src.contract_value is not None:
        dst.contract_value = src.contract_value
        dst.contract_value_at = src.contract_value_at
    if src.notes and src.notes not in (dst.notes or ''):
        dst.notes = ((dst.notes + '\n') if dst.notes else '') + src.notes
    src.deleted_at = dt.datetime.now(dt.timezone.utc)


# ---------------------------------------------------------------- أطراف المشروع

def _live_links(db: Session, names: Set[str], party_type: Optional[str] = None):
    q = db.query(models.PartyProject).filter(
        models.PartyProject.project.in_(list(names)),
        models.PartyProject.deleted_at.is_(None))
    if party_type:
        q = q.filter(models.PartyProject.party_type == party_type)
    return q.order_by(models.PartyProject.position, models.PartyProject.created_at).all()


def _supplier_link_keys(db: Session) -> Dict[str, Set[str]]:
    """{supplier_id: {مفاتيح المشاريع المرتبط بها}} — لمعرفة هل الربط حصري."""
    out: Dict[str, Set[str]] = {}
    for r in db.query(models.PartyProject).filter(
            models.PartyProject.party_type == PP.SUPPLIER,
            models.PartyProject.deleted_at.is_(None)).all():
        out.setdefault(r.party_id, set()).add(_match_key(r.project))
    return out


def _positions_by_account(db: Session, today: dt.date) -> dict:
    return {p.supplier.account: p for p in PS.positions(db, today=today, include_empty=True)}


def _supplier_item(sup: models.Supplier, link: Optional[models.PartyProject],
                   pos, single: bool) -> dict:
    item = dict(partyType=PP.SUPPLIER, partyId=sup.account, name=sup.name,
                account=sup.account,
                amount=money_str_or_none(link.amount) if link is not None else None,
                notes=(link.notes or '') if link is not None else '',
                linked=link is not None,
                attribution='single' if single else 'shared')
    if single and pos is not None:
        item.update(invoiced=money_str(pos.total_invoiced), paid=money_str(pos.total_paid),
                    open=money_str(pos.outstanding), overdue=money_str(pos.overdue))
    else:
        # فواتير المورد بلا مشروع على السطر — لا توزيع تخميني على مشاريعه
        item.update(invoiced=None, paid=None, open=None, overdue=None)
    return item


def _contractor_numbers(row: models.Contractor, key: str, today: dt.date) -> dict:
    entries = [e for e in CS._live_entries(row) if _match_key(e.project or '') == key]
    claimed = sum((D(e.credit or 0) for e in entries), ZERO)
    paid = sum((D(e.debit or 0) for e in entries), ZERO)
    open_ = claimed - paid
    overdue = None
    if row.payment_term_days is not None:
        delay = CS.contractor_delay(row, CS._live_entries(row), today)
        overdue = ZERO
        if delay is not None:
            for c in delay.claims:
                if c.remaining > 0 and c.days_late > 0 and _match_key(c.project or '') == key:
                    overdue += D(c.remaining)
    return dict(entries=len(entries), claimed=claimed, paid=paid,
                open=open_ if open_ > 0 else ZERO, overdue=overdue)


def _contractor_item(row: models.Contractor, link: Optional[models.PartyProject],
                     key: str, today: dt.date) -> dict:
    n = _contractor_numbers(row, key, today)
    return dict(partyType=PP.CONTRACTOR, partyId=row.code, name=row.name, account=row.code,
                amount=money_str_or_none(link.amount) if link is not None else None,
                notes=(link.notes or '') if link is not None else '',
                linked=link is not None, attribution='entries',
                claimed=money_str(n['claimed']), paid=money_str(n['paid']),
                open=money_str(n['open']), overdue=money_str_or_none(n['overdue']))


def project_parties(db: Session, reg: models.ProjectRegistry,
                    today: Optional[dt.date] = None) -> List[dict]:
    today = today or dt.date.today()
    names = names_of(db, reg)
    links = _live_links(db, names)
    # الطرف نفسه قد يُربط بصيغتين للاسم قبل الدمج — صفّ واحد له، وأول مبلغ مُدخل
    first: Dict[tuple, models.PartyProject] = {}
    for l in links:
        k = (l.party_type, l.party_id)
        if k not in first or (first[k].amount is None and l.amount is not None):
            first[k] = l

    out: List[dict] = []
    sup_ids = [pid for (t, pid) in first if t == PP.SUPPLIER]
    if sup_ids:
        sups = {s.id: s for s in db.query(models.Supplier).filter(
            models.Supplier.id.in_(sup_ids), models.Supplier.deleted_at.is_(None)).all()}
        link_keys = _supplier_link_keys(db)
        positions = _positions_by_account(db, today)
        for (t, pid), l in first.items():
            if t != PP.SUPPLIER or pid not in sups:
                continue
            s = sups[pid]
            single = link_keys.get(pid, set()) <= {reg.key}
            out.append(_supplier_item(s, l, positions.get(s.account), single))

    # المقاولون: المربوطون صراحةً + من لهم قيود موسومة بالمشروع (حتى لا يختفي من
    # يعمل فعلاً لأن أحداً لم يربطه بعد — linked:false يقول ذلك صراحةً).
    linked_cids = {pid for (t, pid) in first if t == PP.CONTRACTOR}
    entry_cids = {cid for (cid, proj) in db.query(
        models.ContractorEntry.contractor_id, models.ContractorEntry.project).filter(
        models.ContractorEntry.deleted_at.is_(None),
        models.ContractorEntry.project.in_(list(names))).distinct().all()}
    cids = linked_cids | entry_cids
    if cids:
        rows = db.query(models.Contractor).filter(
            models.Contractor.id.in_(list(cids)),
            models.Contractor.deleted_at.is_(None)).all()
        for r in sorted(rows, key=lambda r: r.code):
            out.append(_contractor_item(r, first.get((PP.CONTRACTOR, r.id)), reg.key, today))

    # المربوطون أولاً بالمبلغ تنازلياً، ثم الاسم — ترتيب ثابت بين طلب وآخر
    out.sort(key=lambda x: (x['partyType'] != PP.SUPPLIER, not x['linked'],
                            -(D(x['amount']) if x['amount'] is not None else Decimal('-1')),
                            x['name']))
    return out


def assigned_total(db: Session, reg: models.ProjectRegistry) -> Decimal:
    """Σ مبالغ الإسناد المُدخلة (الفارغة لا تُحسب صفراً — تُستبعد)."""
    seen: Dict[tuple, Decimal] = {}
    for l in _live_links(db, names_of(db, reg)):
        if l.amount is None:
            continue
        seen.setdefault((l.party_type, l.party_id), D(l.amount))
    return sum(seen.values(), ZERO)


def contractor_cost(db: Session, names: Set[str]) -> Decimal:
    """Σ دائن قيود المستخلصات (kind='claim') الموسومة بالمشروع — المنفَّذ عبر المقاولين."""
    rows = db.query(models.ContractorEntry.credit).join(models.Contractor).filter(
        models.ContractorEntry.deleted_at.is_(None),
        models.Contractor.deleted_at.is_(None),
        models.ContractorEntry.kind == 'claim',
        models.ContractorEntry.project.in_(list(names))).all()
    return sum((D(r[0] or 0) for r in rows), ZERO)


def economics(db: Session, reg: models.ProjectRegistry, supplier_cost: Decimal) -> dict:
    """المُسند مقابل المنفَّذ مقابل قيمة العقد — مفاتيح جديدة على صف المشروع."""
    c_cost = contractor_cost(db, names_of(db, reg))
    executed = supplier_cost + c_cost
    margin = (reg.contract_value - executed) if reg.contract_value is not None else None
    return dict(id=reg.id, contractValue=money_str_or_none(reg.contract_value),
                assignedTotal=money_str(assigned_total(db, reg)),
                supplierCost=money_str(supplier_cost), contractorCost=money_str(c_cost),
                executed=money_str(executed), margin=money_str_or_none(margin))


def enrich_project_rows(db: Session, rows: List[dict]) -> None:
    """يضيف مفاتيح م-٥٠ على صفوف /projects في مكانها (لا يغيّر أي مفتاح قائم)."""
    by_key = ensure(db)
    for row in rows:
        reg = by_key.get(_match_key(row['project']))
        if reg is None:
            row.update(id=None, contractValue=None, assignedTotal=money_str(0),
                       supplierCost=money_str(D(row.get('totalInvoiced', 0))),
                       contractorCost=money_str(0),
                       executed=money_str(D(row.get('totalInvoiced', 0))), margin=None)
            continue
        row.update(economics(db, reg, D(row.get('totalInvoiced', 0))))


def _find_party(db: Session, party_type: str, party_id: str):
    if party_type == PP.SUPPLIER:
        return db.query(models.Supplier).filter(
            models.Supplier.account == party_id, models.Supplier.deleted_at.is_(None)).one_or_none()
    if party_type == PP.CONTRACTOR:
        return db.query(models.Contractor).filter(
            models.Contractor.code == party_id, models.Contractor.deleted_at.is_(None)).one_or_none()
    return None


def set_party(db: Session, reg: models.ProjectRegistry, party_type: str, party_id: str,
              amount: Optional[Decimal], notes: Optional[str],
              today: Optional[dt.date] = None):
    """ينشئ الرابط أو يعدّله أو يُحييه. يعيد (العنصر، أُنشئ؟) أو يرفع LookupError."""
    party = _find_party(db, party_type, party_id)
    if party is None:
        raise LookupError('الطرف غير موجود')
    names = names_of(db, reg)
    # رابط قائم بأي صيغة للاسم (حتى المحذوف منطقياً) يُعاد استعماله — لا توأم
    existing = [l for l in db.query(models.PartyProject).filter(
        models.PartyProject.party_type == party_type,
        models.PartyProject.party_id == party.id,
        models.PartyProject.project.in_(list(names))).all()]
    live = [l for l in existing if l.deleted_at is None]
    created = not live
    target = (live or [l for l in existing if l.project == reg.name] or existing or [None])[0]
    if target is None:
        pos = db.query(models.PartyProject).filter(
            models.PartyProject.party_type == party_type,
            models.PartyProject.party_id == party.id,
            models.PartyProject.deleted_at.is_(None)).count()
        target = models.PartyProject(party_type=party_type, party_id=party.id,
                                     project=reg.name, position=pos)
        db.add(target)
    target.deleted_at = None
    target.amount = amount
    if notes is not None:
        target.notes = notes
    db.flush()
    if party_type == PP.SUPPLIER:
        # العمود المفرد يتبع أول مشروع — نفس قاعدة نموذج تعديل المورد
        party.project = PP.primary(PP.projects_of(db, PP.SUPPLIER, party.id))
    db.commit()
    return party_item(db, reg, party_type, party.id, today), created


def party_item(db: Session, reg: models.ProjectRegistry, party_type: str, party_db_id: str,
               today: Optional[dt.date] = None) -> Optional[dict]:
    today = today or dt.date.today()
    for item in project_parties(db, reg, today):
        if item['partyType'] != party_type:
            continue
        party = _find_party(db, party_type, item['partyId'])
        if party is not None and party.id == party_db_id:
            return item
    return None


def unlink_party(db: Session, reg: models.ProjectRegistry, party_type: str,
                 party_id: str) -> bool:
    party = _find_party(db, party_type, party_id)
    if party is None:
        raise LookupError('الطرف غير موجود')
    now = dt.datetime.now(dt.timezone.utc)
    links = db.query(models.PartyProject).filter(
        models.PartyProject.party_type == party_type,
        models.PartyProject.party_id == party.id,
        models.PartyProject.project.in_(list(names_of(db, reg))),
        models.PartyProject.deleted_at.is_(None)).all()
    if not links:
        return False
    for l in links:
        l.deleted_at = now          # المبلغ يبقى — إعادة الربط تُحييه
    db.flush()
    if party_type == PP.SUPPLIER:
        party.project = PP.primary(PP.projects_of(db, PP.SUPPLIER, party.id))
    db.commit()
    return True


def party_projects(db: Session, party_type: str, party_id: str,
                   today: Optional[dt.date] = None) -> Optional[List[dict]]:
    """مشاريع طرف واحد بمبالغها — لصفحة المورد/المقاول. None إن لم يوجد الطرف."""
    today = today or dt.date.today()
    party = _find_party(db, party_type, party_id)
    if party is None:
        return None
    by_key = ensure(db)
    links = (db.query(models.PartyProject).filter(
        models.PartyProject.party_type == party_type,
        models.PartyProject.party_id == party.id,
        models.PartyProject.deleted_at.is_(None))
        .order_by(models.PartyProject.position).all())
    keys_seen: List[str] = []
    link_by_key: Dict[str, models.PartyProject] = {}
    for l in links:
        k = _match_key(l.project)
        if k not in link_by_key:
            keys_seen.append(k)
            link_by_key[k] = l
    if party_type == PP.CONTRACTOR:
        # مشاريع من القيود بلا رابط صريح تظهر أيضاً (linked:false)
        for e in CS._live_entries(party):
            k = _match_key(e.project or '')
            if k and k not in link_by_key and k not in keys_seen:
                keys_seen.append(k)
    out: List[dict] = []
    single = len({k for k in link_by_key}) <= 1
    pos = None
    if party_type == PP.SUPPLIER:
        pos = _positions_by_account(db, today).get(party.account)
    for k in keys_seen:
        reg = by_key.get(k)
        l = link_by_key.get(k)
        item = dict(projectId=reg.id if reg else None,
                    name=reg.name if reg else (l.project if l else k),
                    amount=money_str_or_none(l.amount) if l else None,
                    notes=(l.notes or '') if l else '', linked=l is not None)
        if party_type == PP.SUPPLIER:
            ok = single and pos is not None
            item.update(attribution='single' if single else 'shared',
                        invoiced=money_str(pos.total_invoiced) if ok else None,
                        open=money_str(pos.outstanding) if ok else None)
        else:
            n = _contractor_numbers(party, k, today)
            item.update(attribution='entries', claimed=money_str(n['claimed']),
                        open=money_str(n['open']))
        out.append(item)
    return out


def search_parties(db: Session, q: Optional[str], party_type: Optional[str],
                   limit: int = 20) -> List[dict]:
    from app.utils.arabic import contains_ar
    out: List[dict] = []
    needle = (q or '').strip()
    if party_type in (None, '', PP.SUPPLIER):
        projects = PP.projects_by_party(db, PP.SUPPLIER)
        for s in db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None)).all():
            if needle and not (contains_ar(s.name, needle) or contains_ar(s.account, needle)):
                continue
            out.append(dict(partyType=PP.SUPPLIER, partyId=s.account, name=s.name,
                            account=s.account, projects=projects.get(s.id, [])))
    if party_type in (None, '', PP.CONTRACTOR):
        projects = PP.projects_by_party(db, PP.CONTRACTOR)
        for c in db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None)).all():
            if needle and not (contains_ar(c.name, needle) or contains_ar(c.code, needle)):
                continue
            out.append(dict(partyType=PP.CONTRACTOR, partyId=c.code, name=c.name,
                            account=c.code, projects=projects.get(c.id, [])))
    out.sort(key=lambda x: (x['name'], x['account']))
    return out[:max(1, min(limit, 200))]


# ---------------------------------------------------------------- إنشاء/حذف مشروع

def create_project(db: Session, name: str, contract_value: Optional[Decimal]) -> dict:
    """مشروع جديد في السجل وحده (لا حركات بعد). يرفض التوأم الإملائي (ValueError)."""
    from app.utils.arabic import project_key
    name = (name or '').strip()
    if not name:
        raise ValueError('اسم المشروع مطلوب')
    by_key = ensure(db)
    key = _match_key(name)
    if key in by_key:
        raise FileExistsError(by_key[key].name)
    # project_key (يتجاهل «ال» والهمزات) — نفس ما تعتمده أداة الدمج م-٣٠
    for r in by_key.values():
        if project_key(r.name) == project_key(name):
            raise FileExistsError(r.name)
    reg = models.ProjectRegistry(name=name, key=key, contract_value=contract_value,
                                 contract_value_at=dt.datetime.now() if contract_value is not None else None)
    db.add(reg)
    db.commit()
    return registry_json(reg)


def linked_counts(db: Session, reg: models.ProjectRegistry) -> dict:
    names = list(names_of(db, reg))
    return dict(
        suppliers=db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None),
                                                   models.Supplier.project.in_(names)).count(),
        contractorEntries=db.query(models.ContractorEntry).filter(
            models.ContractorEntry.deleted_at.is_(None),
            models.ContractorEntry.project.in_(names)).count(),
        parties=db.query(models.PartyProject).filter(
            models.PartyProject.deleted_at.is_(None),
            models.PartyProject.project.in_(names)).count(),
        budgetMonths=db.query(models.BudgetSnapshot).filter(
            models.BudgetSnapshot.deleted_at.is_(None),
            models.BudgetSnapshot.project.in_(names)).count(),
        receivables=db.query(models.Receivable).filter(
            models.Receivable.deleted_at.is_(None),
            models.Receivable.project.in_(names)).count())


def registry_only_rows(db: Session, existing_names: List[str]) -> List[models.ProjectRegistry]:
    """مشاريع في السجل بلا أي حركة بعد — لا تظهر في /projects المبني من البيانات."""
    seen = {_match_key(n) for n in existing_names}
    return [r for r in ensure(db).values()
            if r.key not in seen and r.name != UNKNOWN_PROJECT and not _groups(db).get(r.key)]
