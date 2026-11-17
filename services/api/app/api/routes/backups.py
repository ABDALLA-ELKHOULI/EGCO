# -*- coding: utf-8 -*-
"""مسارات النسخ الاحتياطي (م-٤٥) — القائمة، نسخة يدوية، النسخة اليومية عند
الإقلاع، المجلد الخارجي، والحذف. الاستعادة نفسها ليست هنا: تحتاج إيقاف الخدمة
واستبدال الملف وإعادة التشغيل، وهذا لا تفعله الخدمة بنفسها — يفعله Electron
(`backup:restore`) بعد أن يوقفها.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import backup_service as BS

router = APIRouter()


class ExternalDirBody(BaseModel):
    path: Optional[str] = None


@router.get('')
def list_backups() -> dict:
    return dict(items=BS.list_backups(), dir=str(BS.backup_dir()), keep=BS.KEEP)


@router.post('')
def create_manual(db: Session = Depends(get_session)) -> dict:
    """نسخة يدوية الآن — «نسخة الآن» في الإعدادات، و`data:export` في Electron
    يستعملها أيضاً حتى لا ينسخ قاعدة حيّة بعد اليوم."""
    try:
        return dict(backup=BS.create_backup('manual', BS.get_external_dir(db)))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except (RuntimeError, OSError) as e:
        raise HTTPException(500, 'تعذّر أخذ النسخة: %s' % e)


@router.post('/daily-if-due')
def daily_if_due(db: Session = Depends(get_session)) -> dict:
    """تستدعيها الواجهة عند فتح الإعدادات/الإقلاع — تأخذ يومية إن مضى يوم،
    وإلا تعيد `taken=False` بلا أثر."""
    try:
        info = BS.daily_if_due(BS.get_external_dir(db))
    except (RuntimeError, OSError) as e:
        raise HTTPException(500, 'تعذّرت النسخة اليومية: %s' % e)
    last = BS.latest('daily')
    return dict(taken=info is not None, backup=info, lastDaily=last)


@router.get('/settings')
def get_settings(db: Session = Depends(get_session)) -> dict:
    return dict(externalDir=BS.get_external_dir(db))


@router.put('/settings')
def put_settings(body: ExternalDirBody, db: Session = Depends(get_session)) -> dict:
    return dict(externalDir=BS.set_external_dir(db, body.path))


@router.delete('/{name}')
def delete_backup(name: str) -> dict:
    try:
        ok = BS.delete_backup(name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not ok:
        raise HTTPException(404, 'النسخة غير موجودة')
    return dict(deleted=name)
