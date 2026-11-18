# -*- coding: utf-8 -*-
"""ناقل SSE داخل العملية — مشترك لكل نافذة مفتوحة.

لماذا في الذاكرة: الخادم عملية واحدة خاصة بتطبيق سطح المكتب، لا عنقود؛ Redis أو
طابور خارجي تعقيد بلا فائدة. المسارات المتزامنة (sync) تعمل في خيوط threadpool،
بينما المشترك (مولّد SSE) يعيش في حلقة asyncio — فالنشر يمرّ عبر
`call_soon_threadsafe` وإلا وُضعت الرسالة في طابور من خيط آخر بلا إيقاظ للحلقة.

الرسائل العابرة (invalidate/progress) لا تُخزَّن: من فاتته يُعيد الجلب عند
الاتصال أصلاً. الإشعارات وحدها مخزّنة في جدول events وتُعاد بـLast-Event-ID.
"""
from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, List, Optional, Tuple

#: حدّ الطابور لكل مشترك — نافذة معلّقة لا يجوز أن تراكم ذاكرة بلا نهاية؛ عند
#: الامتلاء تُسقط الرسالة لذلك المشترك وحده (سيعيد الجلب عند invalidate التالي).
MAX_QUEUE = 500


class Broker:
    def __init__(self) -> None:
        self._subs: List[Tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []
        self._lock = threading.Lock()

    def subscribe(self) -> asyncio.Queue:
        loop = asyncio.get_event_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUE)
        with self._lock:
            self._subs.append((loop, q))
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._subs = [(l, s) for (l, s) in self._subs if s is not q]

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subs)

    def publish(self, event: str, data: Any, id: Optional[int] = None) -> None:
        msg = format_sse(event, data, id)
        with self._lock:
            subs = list(self._subs)
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(_put, q, msg)
            except RuntimeError:
                # حلقة أُغلقت (نافذة أُغلقت أثناء النشر) — يُزال المشترك بصمت
                self.unsubscribe(q)


    def close_all(self) -> None:
        """إيقاف الخادم: كل بث مفتوح يتلقى إشارة إنهاء (None) فيُغلق نفسه نظيفاً
        بدل أن تبقى مهامه معلّقة حتى تُدمَّر («Task was destroyed but it is pending»)."""
        with self._lock:
            subs = list(self._subs)
            self._subs = []
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(_put, q, None)
            except RuntimeError:
                pass


def _put(q: asyncio.Queue, msg) -> None:
    try:
        q.put_nowait(msg)
    except asyncio.QueueFull:
        pass


def format_sse(event: str, data: Any, id: Optional[int] = None) -> str:
    lines = []
    if id is not None:
        lines.append('id: %d' % id)
    lines.append('event: %s' % event)
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    for line in payload.split('\n'):
        lines.append('data: ' + line)
    return '\n'.join(lines) + '\n\n'


broker = Broker()


def publish_invalidate(keys: List[str]) -> None:
    broker.publish('invalidate', {'keys': keys})


def publish_progress(kind: str, pct: int, file: str = '') -> None:
    broker.publish('progress', {'kind': kind, 'pct': max(0, min(100, int(pct))), 'file': file})
