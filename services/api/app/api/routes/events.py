# -*- coding: utf-8 -*-
"""الإشعارات + SSE — انظر docs/next/API-CONTRACT.md §١."""
import asyncio
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_session
from app.services import events_service as ES
from app.services import sse_broker

router = APIRouter()

HEARTBEAT_SECONDS = 20.0


@router.get('')
def list_events(status: str = Query('unread', pattern='^(unread|all)$'),
                limit: int = Query(50, ge=1, le=500),
                db: Session = Depends(get_session)) -> list:
    return ES.list_events(db, status, limit)


@router.get('/unread-count')
def unread_count(db: Session = Depends(get_session)) -> dict:
    n = db.query(models.Event).filter(models.Event.deleted_at.is_(None),
                                      models.Event.archived.is_(False),
                                      models.Event.read.is_(False)).count()
    return dict(count=n)


def _get(db: Session, event_id: int) -> models.Event:
    e = db.query(models.Event).filter(models.Event.id == event_id,
                                      models.Event.deleted_at.is_(None)).one_or_none()
    if e is None:
        raise HTTPException(404, detail='الإشعار غير موجود')
    return e


@router.post('/read-all')
def read_all(db: Session = Depends(get_session)) -> dict:
    n = db.query(models.Event).filter(models.Event.read.is_(False),
                                      models.Event.deleted_at.is_(None)).update(
        {models.Event.read: True}, synchronize_session=False)
    db.commit()
    return dict(updated=n)


@router.post('/generate')
def generate(db: Session = Depends(get_session)) -> dict:
    return dict(created=ES.generate(db))


@router.post('/external')
def external(body: dict = Body(...), db: Session = Depends(get_session)) -> dict:
    """من Electron — «تحديث متاح» فقط؛ لا يُسمح لمصدر خارجي بإنشاء أنواع مالية."""
    if body.get('kind') != 'update_available':
        raise HTTPException(422, detail='النوع المسموح هنا: update_available فقط')
    version = str(body.get('version') or '').strip()
    key = f'update:{version}' if version else None
    e = ES.emit(db, 'update_available', 'info',
                str(body.get('title') or f'تحديث متاح {version}').strip(),
                str(body.get('detail') or ''), view='settings', params={}, dedupe_key=key)
    if e is None and key:
        e = db.query(models.Event).filter_by(dedupe_key=key).one()
    return ES.event_json(e)


@router.post('/{event_id}/read')
def read_one(event_id: int, db: Session = Depends(get_session)) -> dict:
    e = _get(db, event_id)
    e.read = True
    db.commit()
    return ES.event_json(e)


@router.post('/{event_id}/archive')
def archive(event_id: int, db: Session = Depends(get_session)) -> dict:
    e = _get(db, event_id)
    e.archived = True
    e.read = True
    db.commit()
    return ES.event_json(e)


async def stream_messages(last_id: int, max_messages: Optional[int] = None,
                          heartbeat: float = HEARTBEAT_SECONDS):
    """مولّد SSE: إعادة ما فات (Last-Event-ID) ثم البث الحيّ مع نبض كل ٢٠ ثانية.

    `max_messages` للاختبارات فقط — بث لا ينتهي لا يُختبر.
    """
    q = sse_broker.broker.subscribe()
    sent = 0
    try:
        yield 'retry: 3000\n\n'
        if last_id >= 0:
            from app.db import session as session_mod
            with session_mod.SessionLocal() as db:
                backlog = [ES.event_json(e) for e in ES.events_after(db, last_id)]
            for ev in backlog:
                yield sse_broker.format_sse('notification', ev, id=ev['id'])
                sent += 1
                if max_messages is not None and sent >= max_messages:
                    return
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=heartbeat)
            except asyncio.TimeoutError:
                yield ': heartbeat\n\n'
                continue
            if msg is None:          # إيقاف الخادم
                return
            yield msg
            sent += 1
            if max_messages is not None and sent >= max_messages:
                return
    finally:
        sse_broker.broker.unsubscribe(q)


@router.get('/stream')
def stream(request: Request, lastEventId: Optional[int] = Query(None),
           maxMessages: Optional[int] = Query(None, ge=1, le=1000)):
    header = request.headers.get('last-event-id')
    last = lastEventId
    if last is None and header and header.strip().isdigit():
        last = int(header.strip())
    gen = stream_messages(last if last is not None else -1, maxMessages)
    return StreamingResponse(gen, media_type='text/event-stream',
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
