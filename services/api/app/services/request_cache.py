# -*- coding: utf-8 -*-
"""ذاكرة مؤقتة لعمر الجلسة الواحدة (= طلب HTTP واحد) — «لقطة الطلب».

لماذا: `/overview` كان يحسب `positions()` ست مرات و`contractors_list_json` مرتين
في طلب واحد (انظر docs/product/BACKEND-ANALYSIS-2026-11.md §٢.١). الحساب نفسه
صحيح ومختبَر؛ المشكلة تكراره فقط. هذه الوحدة تحفظ النتيجة في `Session.info`
فيعيدها الاستدعاء الثاني بلا إعادة حساب — **لا يتغيّر أي رقم** لأن الدالة نفسها
هي التي تُنتج القيمة في المرة الأولى.

الأمان: أي كتابة (flush) أو commit أو rollback على الجلسة تمسح الذاكرة فوراً —
مسار يكتب ثم يقرأ في نفس الطلب يرى دائماً البيانات الجديدة لا لقطة قديمة.
الجلسة تُغلق نهاية الطلب فتموت الذاكرة معها؛ لا شيء يعيش بين طلبين.
"""
from __future__ import annotations

from typing import Any, Callable, Hashable

from sqlalchemy import event
from sqlalchemy.orm import Session

_KEY = '_egco_request_cache'


def get(db: Session, key: Hashable, factory: Callable[[], Any]) -> Any:
    """القيمة المخزّنة لهذا المفتاح في هذه الجلسة، أو تُحسب مرة وتُخزَّن."""
    cache = db.info.setdefault(_KEY, {})
    if key in cache:
        return cache[key]
    value = factory()
    # factory قد يكتب (نادراً) فيمسح الذاكرة — نعيد جلبها بدل الكتابة في قاموس ميت
    db.info.setdefault(_KEY, {})[key] = value
    return value


def peek(db: Session, key: Hashable) -> Any:
    """القيمة إن كانت محسوبة سلفاً، وإلا None — لاشتقاق نسخة مصفّاة بلا استعلام."""
    return db.info.get(_KEY, {}).get(key)


def clear(db: Session) -> None:
    db.info.pop(_KEY, None)


def _clear_on(session, *args, **kwargs):  # noqa: ANN001 — توقيع مستمعي SQLAlchemy
    session.info.pop(_KEY, None)


# على صنف Session كله: كل جلسة تُنشأ (من أي sessionmaker، حتى بعد إعادة تحميل
# session.py في الاختبارات) تُمسح ذاكرتها عند أي كتابة.
for _evt in ('after_flush', 'after_commit', 'after_rollback', 'after_soft_rollback'):
    if not event.contains(Session, _evt, _clear_on):
        event.listen(Session, _evt, _clear_on)
