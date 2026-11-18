# -*- coding: utf-8 -*-
"""بثّ `invalidate` بعد كل كتابة ناجحة — يُغني الواجهة عن الاستطلاع.

Middleware ASGI خام (لا BaseHTTPMiddleware) لأنه يمرّ أيضاً على بث SSE الطويل؛
الصيغة الخام لا تحجز الاستجابة في الذاكرة. يقرأ رمز الحالة من رسالة البدء، ويبثّ
بعد انتهاء الاستجابة فقط — فلا تُبطَل الواجهة قبل أن تُحفظ الكتابة فعلاً.
"""
from __future__ import annotations

from typing import List, Optional

from app.core.config import settings
from app.services import sse_broker

_ALL = ['suppliers', 'contractors', 'overview', 'today', 'projects', 'cash', 'calendar',
        'reports', 'coverage', 'imports', 'guarantees', 'revenues', 'budget', 'trash']

_KEYS = {
    'suppliers': ['suppliers', 'overview', 'today', 'projects', 'cash', 'calendar', 'reports', 'coverage'],
    'manual': ['suppliers', 'overview', 'today', 'projects', 'cash', 'calendar', 'reports', 'coverage'],
    'invoices': ['suppliers', 'overview', 'today', 'projects', 'cash', 'calendar', 'reports', 'coverage'],
    'contractors': ['contractors', 'overview', 'today', 'projects', 'cash', 'calendar', 'reports', 'guarantees'],
    'import': [k for k in _ALL if k != 'trash'],
    'revenues': ['revenues', 'cash', 'overview', 'today', 'projects'],
    'budget': ['budget', 'projects', 'today'],
    'projects': ['projects', 'suppliers', 'contractors', 'today', 'overview'],
    'project-admin': ['projects', 'suppliers', 'contractors', 'today', 'overview'],
    'trash': _ALL,
    'reset': ['*'],
    'backups': ['backups'],
    'settings': ['settings', 'cash', 'today', 'overview'],
    'cashflow': ['cash'],
    'ai': ['ai'],
}

#: POST للقراءة فقط — لا يغيّر شيئاً فلا يُبطل شيئاً
_READ_ONLY_POSTS = {
    'import/preview', 'import/scan', 'import/classify', 'import/classify/suggest',
    'budget/preview', 'ai/test', 'ai/extract', 'ai/ask', 'ai/remind', 'ai/budget-notes',
    'ai/summary', 'ai/brief', 'ai/anomalies', 'ai/parse-text', 'ai/what-if', 'ai/priorities',
}


def keys_for(method: str, path: str) -> Optional[List[str]]:
    if method not in ('POST', 'PUT', 'PATCH', 'DELETE'):
        return None
    prefix = settings.API_PREFIX.rstrip('/') + '/'
    if not path.startswith(prefix):
        return None
    rest = path[len(prefix):].strip('/')
    if not rest or rest.startswith('events'):
        return None
    if method == 'POST' and rest in _READ_ONLY_POSTS:
        return None
    return _KEYS.get(rest.split('/', 1)[0], ['*'])


class InvalidateMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get('type') != 'http':
            return await self.app(scope, receive, send)
        keys = keys_for(scope.get('method', ''), scope.get('path', ''))
        if keys is None:
            return await self.app(scope, receive, send)
        status = {'code': 500}

        async def _send(message):
            if message['type'] == 'http.response.start':
                status['code'] = message['status']
            await send(message)

        await self.app(scope, receive, _send)
        if status['code'] < 400:
            sse_broker.publish_invalidate(keys)
