# -*- coding: utf-8 -*-
"""الأحداث والإشعارات — المولّد، التخزين، والنشر عبر SSE.

كل حدث يُشتق من نفس المحركات المختبرة (positions، تأخر المقاولين، الضمانات)؛ لا
حساب جديد هنا. `dedupe_key` يجعل المولّد idempotent: يُشغَّل عند الإقلاع وبعد كل
رفع ونسخة وعند الطلب، ونفس الفاتورة المتأخرة تُبلَّغ مرة واحدة فقط.

قاعدة «لا تخترع رقماً»: لا حدث تأخر لمقاول بلا مدة سداد.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
from contextlib import contextmanager
from decimal import Decimal
from typing import Iterator, List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import models
from app.domain.payables import D
from app.services import sse_broker
from app.services.money_wire import money_str

logger = logging.getLogger(__name__)

SEVERITIES = ('danger', 'warn', 'ok', 'info')
STALE_DAYS = 60
GUARANTEE_DAYS = 7
DEFICIT_DAYS = 30
_AR_DIGITS = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')


def _ar(n) -> str:
    return str(n).translate(_AR_DIGITS)


def _fmt(x) -> str:
    return '{:,.2f}'.format(D(x))


def _session_factory():
    # يُقرأ وقت الاستدعاء لا وقت الاستيراد: الاختبارات تعيد تحميل session.py
    from app.db import session as session_mod
    return session_mod.SessionLocal


def event_json(e: models.Event) -> dict:
    try:
        params = json.loads(e.link_params or '{}')
    except ValueError:
        params = {}
    return dict(id=e.id, at=e.at.replace(microsecond=0).isoformat() if e.at else None,
                kind=e.kind, severity=e.severity, title=e.title, detail=e.detail or '',
                link=dict(view=e.link_view, params=params) if e.link_view else None,
                read=bool(e.read), archived=bool(e.archived))


def emit(db: Session, kind: str, severity: str, title: str, detail: str = '',
         view: Optional[str] = None, params: Optional[dict] = None,
         dedupe_key: Optional[str] = None, publish: bool = True) -> Optional[models.Event]:
    """يحفظ الحدث وينشره. يعيد None إن كان مكرراً (dedupe_key موجود سلفاً)."""
    if severity not in SEVERITIES:
        severity = 'info'
    if dedupe_key is not None:
        exists = db.query(models.Event.id).filter_by(dedupe_key=dedupe_key).first()
        if exists is not None:
            return None
    e = models.Event(kind=kind, severity=severity, title=title, detail=detail or '',
                     link_view=view, link_params=json.dumps(params or {}, ensure_ascii=False),
                     dedupe_key=dedupe_key, at=dt.datetime.now())
    db.add(e)
    try:
        db.commit()
    except IntegrityError:
        # سباق نادر بين مولّدين (إقلاع + رفع) على نفس المفتاح — الأول يكفي
        db.rollback()
        return None
    if publish:
        sse_broker.broker.publish('notification', event_json(e), id=e.id)
    return e


def emit_standalone(**kw) -> Optional[dict]:
    """emit بجلسة خاصة — لنقاط تشغيل لا تملك جلسة (النسخ، الإقلاع)."""
    try:
        with _session_factory()() as db:
            e = emit(db, **kw)
            return event_json(e) if e is not None else None
    except Exception:  # noqa: BLE001 — حدث فاشل لا يُسقط العملية الأصلية أبداً
        logger.exception('تعذّر حفظ حدث %s', kw.get('kind'))
        return None


# ---------------------------------------------------------------- المولّد
#
# المولّدات تُرجع «مرشّحين» لا أحداثاً: صف لكل بند (فاتورة/مستخلص/ضمان…) بمفتاح
# dedupe. القرار بين «حدث لكل بند» و«حدث ملخّص» يُتخذ مركزياً في generate():
#  - أول توليد لقاعدة (لا أحداث سابقة إطلاقاً): ملخّص لكل نوع. فحص يدوي على نسخة
#    حقيقية أنتج ٥٠ إشعاراً غير مقروء عند أول تشغيل فدُفن المهم تحت المتراكم.
#  - بعده: حدث لكل انتقال جديد فقط، وملخّص إن تجاوز الجديد في دفعة واحدة GROUP_OVER.
# في الحالتين تُسجَّل مفاتيح البنود المُلخَّصة كأحداث صامتة (مقروءة ومؤرشفة) حتى لا
# تعود فرادى في التوليد التالي — «لا تكرار» يبقى مضموناً بنفس dedupe_key.

GROUP_OVER = 5


def _c(kind, severity, title, detail, view, params, key, amount=None, party=None):
    return dict(kind=kind, severity=severity, title=title, detail=detail, view=view,
                params=params, key=key, amount=D(amount) if amount is not None else None,
                party=party)


def _overdue_invoices(db: Session, today: dt.date) -> list:
    from app.services import payables_service as PS
    out = []
    for p in PS.positions(db, today=today, include_empty=False):
        for i in p.invoices:
            if i.remaining <= 0 or i.due_date is None or i.due_date >= today:
                continue
            late = (today - i.due_date).days
            out.append(_c('overdue_new', 'danger', f'فاتورة متأخرة — {p.supplier.name}',
                          f'{i.number or i.doc or "بلا رقم"} · {_fmt(i.remaining)} ر.س · '
                          f'تأخرت {_ar(late)} يوماً', 'supplier', {'id': p.supplier.account},
                          f'overdue:{i.id}', i.remaining, p.supplier.account))
    return out


def _claims_overdue(db: Session, today: dt.date) -> list:
    from app.services import calendar_service
    out = []
    for ev in calendar_service.contractor_claim_events(db, today=today):
        if not ev['overdue']:
            continue
        ref = ev.get('claimNo') or ev.get('doc') or ev['claimDate']
        out.append(_c('claim_overdue', 'danger', f'مستخلص متأخر — {ev["name"]}',
                      f'مستخلص {ref} · {_fmt(ev["amount"])} ر.س · تأخر {_ar(ev["daysLate"])} يوماً',
                      'contractor', {'id': ev['code']},
                      f'claim_overdue:{ev["code"]}:{ref}:{ev["date"]}', ev['amount'], ev['code']))
    return out


def _guarantees(db: Session, today: dt.date) -> list:
    from app.services import contractors_service as CS
    out = []
    for g in db.query(models.ContractorGuarantee).filter(
            models.ContractorGuarantee.deleted_at.is_(None),
            models.ContractorGuarantee.released_on.is_(None)).all():
        due, _ = CS.guarantee_release(g, today)
        if due is None or (due - today).days > GUARANTEE_DAYS:
            continue
        c = g.contractor
        if c is None or c.deleted_at is not None:
            continue
        when = 'حان موعد فكّه' if due <= today else f'يحين خلال {_ar((due - today).days)} أيام'
        out.append(_c('guarantee_due', 'warn', f'ضمان {when} — {c.name}',
                      f'{g.project or "بلا مشروع"} · {_fmt(g.amount or 0)} ر.س · {due.isoformat()}',
                      'contractor', {'id': c.code}, f'guarantee:{g.id}:{due.isoformat()}',
                      g.amount or 0, c.code))
    return out


def _deficit(db: Session, today: dt.date) -> list:
    from app.services import today_service
    proj = today_service.cash_projection(db, today, DEFICIT_DAYS)
    first = next((p for p in proj['days'] if p['balance'] < 0), None)
    if first is None:
        return []
    basis = '' if proj['basis'] == 'bank' else ' (بلا رصيد بنكي مُدخل — الإسقاط يبدأ من صفر)'
    return [_c('cash_deficit', 'danger', 'عجز نقدي متوقع',
               f'الرصيد يصبح {_fmt(first["balance"])} ر.س في {first["date"].isoformat()}{basis}',
               'cash', {}, f'deficit:{first["date"].isoformat()}')]


def _stale(db: Session, today: dt.date) -> list:
    from app.services import today_service
    out = []
    month = today.strftime('%Y-%m')
    for r in today_service.staleness(db, today)['coverage']:
        # «لا حركة إطلاقاً» يُبلَّغ في الجودة لا كإشعار
        if not r['stale'] or r['lastActivity'] is None:
            continue
        view = 'supplier' if r['partyType'] == 'supplier' else 'contractor'
        out.append(_c('stale_statement', 'warn', f'كشف قديم — {r["name"]}',
                      f'آخر حركة منذ {_ar(r["lastActivityDays"])} يوماً — ارفع كشفاً أحدث',
                      view, {'id': r['partyId']},
                      f'stale:{r["partyType"]}:{r["partyId"]}:{month}', None,
                      f'{r["partyType"]}:{r["partyId"]}'))
    return out


_GENERATORS = (_overdue_invoices, _claims_overdue, _guarantees, _deficit, _stale)


def _plural(n: int, one: str, two: str, few: str, many: str) -> str:
    """تمييز العدد العربي: ١ مفرد، ٢ مثنى، ٣–١٠ جمع، ١١+ مفرد منصوب."""
    if n == 1:
        return one
    if n == 2:
        return two
    if 3 <= n <= 10:
        return f'{_ar(n)} {few}'
    return f'{_ar(n)} {many}'


def _summary(kind: str, items: list, context: str) -> dict:
    """حدث ملخّص لنوع واحد — العدد والأطراف والمبلغ، ورابط للقائمة المصفّاة."""
    n = len(items)
    parties = len({i['party'] for i in items if i['party']})
    total = sum((i['amount'] for i in items if i['amount'] is not None), Decimal('0'))
    amount = f' — {_fmt(total)} ر.س' if total else ''
    suffix = f' {context}' if context else ''
    if kind == 'overdue_new':
        title = (f'{_plural(n, "فاتورة متأخرة", "فاتورتان متأخرتان", "فواتير متأخرة", "فاتورة متأخرة")}'
                 f' لدى {_plural(parties, "مورد واحد", "موردَين", "موردين", "مورداً")}{amount}')
        view, params = 'suppliers', {'filter': 'overdue'}
    elif kind == 'claim_overdue':
        title = (f'{_plural(n, "مستخلص متأخر", "مستخلصان متأخران", "مستخلصات متأخرة", "مستخلصاً متأخراً")}'
                 f' لدى {_plural(parties, "مقاول واحد", "مقاولَين", "مقاولين", "مقاولاً")}{amount}')
        view, params = 'contractors', {'filter': 'overdue'}
    elif kind == 'guarantee_due':
        title = (f'{_plural(n, "ضمان", "ضمانان", "ضمانات", "ضماناً")} '
                 f'{"ينتهي" if n == 1 else "تنتهي"} خلال ٧ أيام{amount}')
        view, params = 'guarantees', {'filter': 'due7'}
    elif kind == 'stale_statement':
        title = (f'{_plural(n, "طرف", "طرفان", "أطراف", "طرفاً")} بلا كشف حديث '
                 f'(آخر حركة أقدم من {_ar(STALE_DAYS)} يوماً)')
        view, params = 'import', {'filter': 'stale'}
    else:
        title, view, params = items[0]['title'], items[0]['view'], items[0]['params']
    return dict(kind=kind, severity=items[0]['severity'], title=title + suffix,
                detail='', view=view, params=params)


def _silent(db: Session, c: dict) -> None:
    """يحجز مفتاح بند لُخِّص — حدث مقروء مؤرشف لا يظهر ولا يُبَثّ."""
    db.add(models.Event(kind=c['kind'], severity=c['severity'], title=c['title'],
                        detail=c['detail'], link_view=c['view'],
                        link_params=json.dumps(c['params'], ensure_ascii=False),
                        dedupe_key=c['key'], read=True, archived=True, at=dt.datetime.now()))


def generate(db: Optional[Session] = None, today: Optional[dt.date] = None,
             context: str = '') -> int:
    """يشغّل المولّدات؛ يعيد عدد الأحداث **الظاهرة** الجديدة. `context` يُلحق بنص الملخّص
    (مثل «بعد استيراد كشف-2110001.pdf»)."""
    today = today or dt.date.today()
    own = db is None
    if own:
        db = _session_factory()()
    created = 0
    try:
        # «أول توليد» = لا حدث من أي نوع مولَّد سابقاً (أحداث الرفع/النسخ لا تُحسب)
        first_run = db.query(models.Event.id).filter(
            models.Event.kind.in_([k for k in (
                'overdue_new', 'claim_overdue', 'guarantee_due', 'cash_deficit',
                'stale_statement')])).first() is None
        for g in _GENERATORS:
            try:
                cands = g(db, today)
                if not cands:
                    continue
                existing = {k for (k,) in db.query(models.Event.dedupe_key).filter(
                    models.Event.dedupe_key.in_([c['key'] for c in cands])).all()}
                new = [c for c in cands if c['key'] not in existing]
                if not new:
                    continue
                kind = new[0]['kind']
                if kind != 'cash_deficit' and (first_run or len(new) > GROUP_OVER):
                    for c in new:
                        _silent(db, c)
                    sm = _summary(kind, new, '' if first_run else context)
                    sm_key = f'summary:{kind}:' + new[0]['key']
                    db.commit()
                    if emit(db, sm['kind'], sm['severity'], sm['title'], sm['detail'],
                            view=sm['view'], params=sm['params'], dedupe_key=sm_key):
                        created += 1
                else:
                    for c in new:
                        if emit(db, c['kind'], c['severity'], c['title'], c['detail'],
                                view=c['view'], params=c['params'], dedupe_key=c['key']):
                            created += 1
            except Exception:  # noqa: BLE001 — فشل مولّد لا يوقف البقية
                db.rollback()
                logger.exception('فشل مولّد الأحداث %s', g.__name__)
    finally:
        if own:
            db.close()
    return created


def generate_safely(context: str = '') -> int:
    try:
        return generate(context=context)
    except Exception:  # noqa: BLE001
        logger.exception('تعذّر توليد الأحداث')
        return 0


# ---------------------------------------------------------------- الرفع: قبل/بعد

def _file_label(path: str) -> str:
    return os.path.basename(path or '') or (path or '')


@contextmanager
def track_import(file_path: str, source: str = '') -> Iterator[dict]:
    """يغلّف رفعاً في طبقة المسار: لقطة قبل، تنفيذ، لقطة بعد، حدث، ثم المولّد.

    يُستعمل في routes/imports.py لا داخل import_service (يملكه وكيل آخر). أي فشل
    في التتبّع نفسه لا يُفشل الرفع: الرفع هو العمل الحقيقي، الإشعار ثانوي.
    """
    from app.services import today_service
    file = _file_label(file_path)
    ctx: dict = {'result': None}
    before = None
    try:
        with _session_factory()() as db:
            before = today_service.totals_snapshot(db)
    except Exception:  # noqa: BLE001
        logger.exception('تعذّرت لقطة ما قبل الرفع')
    sse_broker.publish_progress('import', 0, file)
    try:
        yield ctx
    except Exception as exc:
        detail = getattr(exc, 'detail', None) or str(exc)
        emit_standalone(kind='import_failed', severity='danger', title=f'فشل رفع {file}',
                        detail=str(detail)[:500], view='import', params={})
        sse_broker.publish_progress('import', 100, file)
        raise
    sse_broker.publish_progress('import', 100, file)
    result = ctx.get('result')
    saved = not (isinstance(result, dict) and result.get('saved') is False)
    if not saved:
        reason = result.get('reason') if isinstance(result, dict) else ''
        emit_standalone(kind='import_failed', severity='danger', title=f'لم يُحفظ {file}',
                        detail=_reason_ar(reason), view='import', params={})
        return
    try:
        with _session_factory()() as db:
            after = today_service.totals_snapshot(db)
            if before is not None:
                new_inv = max(0, after['_invoiceIds'].__len__() - len(
                    before['_invoiceIds'] & after['_invoiceIds']))
                paid = len(before['_openIds'] - after['_openIds'])
                snap = models.ChangeSnapshot(
                    at=dt.datetime.now(), file=file, source=source or '',
                    before_json=json.dumps(today_service.public_totals(before), ensure_ascii=False),
                    after_json=json.dumps(today_service.public_totals(after), ensure_ascii=False),
                    new_invoices=new_inv, paid_invoices=paid)
                db.add(snap)
                db.commit()
                d = D(after['supplierOpen']) - D(before['supplierOpen'])
                detail = (f'{_ar(new_inv)} فاتورة جديدة · {_ar(paid)} سُدّدت · '
                          f'مديونية الموردين {"+" if d >= 0 else "−"}{_fmt(abs(d))} ر.س')
            else:
                detail = ''
            emit(db, 'import_done', 'ok', f'اكتمل رفع {file}', detail, view='today', params={})
    except Exception:  # noqa: BLE001
        logger.exception('تعذّرت لقطة ما بعد الرفع')
    generate_safely(context=f'بعد استيراد {file}')


def _reason_ar(reason: Optional[str]) -> str:
    return {
        'not_reconciled': 'الرصيد المحسوب لا يطابق رصيد الكشف',
        'needs_classification': 'حساب ببادئة غير معروفة يحتاج تصنيفاً',
        'no_account': 'لم يُعثر على رقم الحساب في الملف',
        'unknown_supplier': 'المورد غير موجود — أنشئه أولاً',
    }.get(reason or '', reason or 'سبب غير معروف')


def backup_with_events(fn):
    """نسخة + حدث نجاح/فشل + تقدّم — الفشل يُعاد رفعه للمستدعي كما كان."""
    sse_broker.publish_progress('backup', 0)
    try:
        info = fn()
    except Exception as e:
        emit_standalone(kind='backup_failed', severity='danger',
                                       title='فشلت النسخة الاحتياطية', detail=str(e)[:300],
                                       view='settings', params={})
        sse_broker.publish_progress('backup', 100)
        raise
    sse_broker.publish_progress('backup', 100)
    if info:
        name = info.get('name') if isinstance(info, dict) else str(info)
        emit_standalone(kind='backup_done', severity='ok',
                                       title='أُخذت نسخة احتياطية', detail=name or '',
                                       view='settings', params={},
                                       dedupe_key=f'backup:{name}' if name else None)
    return info



# ---------------------------------------------------------------- القراءة

def list_events(db: Session, status: str = 'unread', limit: int = 50) -> List[dict]:
    q = db.query(models.Event).filter(models.Event.deleted_at.is_(None),
                                      models.Event.archived.is_(False))
    if status == 'unread':
        q = q.filter(models.Event.read.is_(False))
    rows = q.order_by(models.Event.id.desc()).limit(max(1, min(limit, 500))).all()
    return [event_json(e) for e in rows]


def events_after(db: Session, last_id: int, limit: int = 200) -> List[models.Event]:
    return (db.query(models.Event).filter(models.Event.id > last_id,
                                          models.Event.archived.is_(False),
                                          models.Event.deleted_at.is_(None))
            .order_by(models.Event.id).limit(limit).all())


def last_event_id(db: Session) -> int:
    row = db.query(models.Event.id).order_by(models.Event.id.desc()).first()
    return row[0] if row else 0
