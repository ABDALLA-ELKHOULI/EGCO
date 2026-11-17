# -*- coding: utf-8 -*-
"""النسخ الاحتياطي (م-٤٥ · م-١٣) — شبكة الأمان الوحيدة لبيانات لا يمكن إعادة
إدخالها: ٥٩٩ مقاولاً و١٠٣ موردين وكل الكشوف على ملف SQLite واحد.

لماذا `VACUUM INTO` لا `shutil.copy`: القاعدة مفتوحة للكتابة طوال عمر الخدمة،
ونسخ الملف بايتاً-بايتاً أثناء معاملة جارية يُخرج نسخة قد تفشل في الفتح أو
تفقد آخر الصفوف. `VACUUM INTO` يكتب لقطة متّسقة من داخل SQLite نفسه (يحترم
القفل والمعاملات)، وهو أيضاً ما يجعل النسخة مضغوطة بلا صفحات حرّة.

أسماء الملفات تحمل النوع كبادئة والطابع الزمني كلاحقة، فالترتيب الأبجدي يساوي
الترتيب الزمني داخل النوع الواحد — وهذا ما يجعل التقليم مجرد `sorted()[:-keep]`.
نسخ `before-update-*` تُكتب من Electron (لحظة اكتمال تنزيل التحديث)، و
`before-restore-*` كذلك (لحظة الاستعادة والخدمة متوقفة) — هنا تُدرج في القائمة
وتُقلَّم بسقفها فقط. النسخ القديمة `egco-*.db` (ما قبل هذه الموجة) تُعرض بنوع
`legacy` ولا تُقلَّم تلقائياً: قرار حذفها للمستخدم.
"""
import datetime as dt
import logging
import re
import shutil
import threading
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.core import config
from app.db import models

logger = logging.getLogger(__name__)

#: كل نوع مع سقفه — الأعداد من م-٤٥: يومية ٣٠ (شهر كامل) · يدوية ٢٠ ·
#: قبل-تحديث ١٠ · قبل-استيراد ١٠ · قبل-استعادة ٥.
KEEP: Dict[str, int] = {
    'daily': 30,
    'manual': 20,
    'before-update': 10,
    'before-import': 10,
    'before-restore': 5,
    # التصفير يمحو كل شيء دفعةً واحدة، ولا شيء يسبقه يمكن الرجوع إليه غيره —
    # فسقفه أعلى من بقية النسخ التلقائية عمداً.
    'before-reset': 10,
}

#: النسخ التي تكتبها هذه الخدمة نفسها (لا Electron).
_SERVER_KINDS = ('daily', 'manual', 'before-import', 'before-reset')

#: اسم ملف نسخة صالح — بادئة معروفة، ثم شرطة، ثم محارف آمنة فقط، ثم `.db`.
#: هذا ما يحمي مسار الحذف من `../` أو أي مسار مطلق: لا شرطة مائلة، لا نقطتان
#: متتاليتان، لا شيء خارج [A-Za-z0-9._-].
_NAME_RE = re.compile(
    r'^(daily|manual|before-update|before-import|before-restore|before-reset|egco)'
    r'-[A-Za-z0-9._-]+\.db$')

#: مفتاح المجلد الخارجي في جدول app_settings (نفس جدول تخصيص الدفعات).
_EXTERNAL_DIR_KEY = 'backup_external_dir'

#: أقل من هذا الحجم لا يمكن أن يكون ملف SQLite (رأس الصفحة الأولى ١٠٠ بايت).
_MIN_DB_BYTES = 100


class BackupInfo(dict):
    """صف واحد في القائمة — dict حتى يُسلسَل مباشرة في استجابة FastAPI.

    المفاتيح: name · kind · size_bytes · created_at (ISO) · path.
    """


def backup_dir() -> Path:
    """`<EGCO_DATA_DIR>/backups` — نفس المجلد الذي يكتب فيه Electron
    `before-update-*`، فتظهر كل النسخ في قائمة واحدة."""
    d = config.settings.DATA_DIR / 'backups'
    d.mkdir(parents=True, exist_ok=True)
    return d


def db_path() -> Path:
    return config.settings.DB_PATH


def _stamp(now: Optional[dt.datetime] = None) -> str:
    """طابع ISO صالح لاسم ملف على كل الأنظمة: `2026-09-24T10-30-05`
    (النقطتان ممنوعتان في أسماء ملفات Windows)."""
    now = now or dt.datetime.now()
    return now.strftime('%Y-%m-%dT%H-%M-%S')


def _kind_of(name: str) -> str:
    for kind in KEEP:
        if name.startswith(kind + '-'):
            return kind
    return 'legacy'


def is_valid_name(name: str) -> bool:
    """يرفض أي اسم لا يطابق النمط الصارم — الدفاع الوحيد ضد traversal."""
    return bool(_NAME_RE.match(name)) and '..' not in name


def _info(p: Path) -> BackupInfo:
    st = p.stat()
    return BackupInfo(
        name=p.name,
        kind=_kind_of(p.name),
        size_bytes=st.st_size,
        created_at=dt.datetime.fromtimestamp(st.st_mtime).isoformat(timespec='seconds'),
        path=str(p),
    )


def list_backups() -> List[BackupInfo]:
    """كل النسخ في المجلد، الأحدث أولاً (بوقت التعديل — يشمل ما كتبه Electron)."""
    out = [_info(p) for p in backup_dir().glob('*.db') if is_valid_name(p.name)]
    out.sort(key=lambda b: b['created_at'], reverse=True)
    return out


def prune(kind: str, keep: Optional[int] = None) -> List[str]:
    """يُبقي آخر `keep` نسخة من النوع ويحذف الأقدم. يعيد أسماء ما حُذف.

    الترتيب أبجدي على الاسم: الطابع ISO يجعله زمنياً، وملفات `before-update-`
    تحمل رقم الإصدار قبل الطابع — ترتيبها الأبجدي قد يخالف الزمن بين إصدارين
    لكن السقف يبقى محفوظاً وهذا هو المهم هنا.
    """
    if kind not in KEEP:
        return []
    keep = KEEP[kind] if keep is None else keep
    files = sorted(p for p in backup_dir().glob(kind + '-*.db') if is_valid_name(p.name))
    removed: List[str] = []
    for old in files[:max(0, len(files) - keep)]:
        try:
            old.unlink()
            removed.append(old.name)
        except OSError:
            # نسخة عالقة (قفل مضاد فيروسات مثلاً) لا تستحق تعطيل النسخ التالي
            logger.warning('تعذّر حذف النسخة القديمة %s', old)
    return removed


def _vacuum_into(dest: Path) -> None:
    """لقطة متّسقة عبر اتصال sqlite3 مباشر — لا عبر SQLAlchemy حتى لا نتورّط
    في معاملة مفتوحة (`VACUUM` يرفض العمل داخل معاملة)."""
    src = db_path()
    if not src.exists():
        raise FileNotFoundError('لا توجد قاعدة بيانات بعد')
    # ملف بنفس الاسم يُفشل VACUUM INTO — لا يُستبدل بصمت
    if dest.exists():
        dest.unlink()
    conn = sqlite3.connect(str(src), isolation_level=None, timeout=30)
    try:
        # المسار يُمرَّر كمعامل لا بتضمين نصي — أسماء المجلدات قد تحمل علامات اقتباس
        conn.execute('VACUUM INTO ?', (str(dest),))
    finally:
        conn.close()


def verify_backup(path: Path) -> bool:
    """تفتح النسخة للقراءة وتتأكد أن فيها جداول — نسخة لا تُفتح ليست نسخة."""
    try:
        if path.stat().st_size < _MIN_DB_BYTES:
            return False
        conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        try:
            n = conn.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
            ok = conn.execute('PRAGMA quick_check').fetchone()[0]
        finally:
            conn.close()
        return n > 0 and ok == 'ok'
    except sqlite3.Error:
        return False


def _copy_external(src: Path, external_dir: Optional[str]) -> Optional[str]:
    """ينسخ النسخة إلى المجلد الخارجي إن ضُبط. يعيد نص تحذير عربي عند الفشل
    بدل رفع خطأ: المجلد قد يكون iCloud/Drive غير متاح الآن، ولا يجوز أن يمنع
    ذلك النسخة المحلية التي نجحت أصلاً."""
    if not external_dir:
        return None
    ext = Path(external_dir)
    if not ext.is_dir():
        return 'المجلد الخارجي غير موجود أو غير متاح الآن: %s' % external_dir
    try:
        shutil.copy2(src, ext / src.name)
        return None
    except OSError as e:
        return 'تعذّر النسخ إلى المجلد الخارجي: %s' % e


# م-٤٧ كشف سباقاً: طلبا `daily-if-due` في نفس الثانية (StrictMode في التطوير، أو
# نقرتان) مرّا معاً من فحص «لا نسخة اليوم» ومن فحص «الاسم غير موجود»، فكتبا
# `VACUUM INTO` على نفس المسار وفشل الثاني بـ500. قفل واحد للعملية يجعل الفحص
# والكتابة ذرّيين؛ مسارات FastAPI المتزامنة تعمل في threadpool فالقفل كافٍ.
_LOCK = threading.RLock()


def create_backup(kind: str, external_dir: Optional[str] = None,
                  now: Optional[dt.datetime] = None) -> BackupInfo:
    """نسخة جديدة من النوع المطلوب ثم تقليم نوعها. `warning` في النتيجة إن
    فشل النسخ الخارجي فقط."""
    if kind not in _SERVER_KINDS:
        raise ValueError('نوع نسخة غير معروف: %s' % kind)
    with _LOCK:
        return _create_backup_locked(kind, external_dir, now)


def _create_backup_locked(kind: str, external_dir: Optional[str],
                          now: Optional[dt.datetime]) -> BackupInfo:
    dest = backup_dir() / ('%s-%s.db' % (kind, _stamp(now)))
    # نسختان في نفس الثانية (استيراد دفعة ملفات) — لاحقة عدّاد بدل الاستبدال
    n = 1
    while dest.exists():
        n += 1
        dest = backup_dir() / ('%s-%s-%d.db' % (kind, _stamp(now), n))
    _vacuum_into(dest)
    if not verify_backup(dest):
        dest.unlink(missing_ok=True)
        raise RuntimeError('النسخة المأخوذة لا تُفتح — لم تُحفظ')
    info = _info(dest)
    warning = _copy_external(dest, external_dir)
    if warning:
        info['warning'] = warning
    info['pruned'] = prune(kind)
    return info


def latest(kind: str) -> Optional[BackupInfo]:
    for b in list_backups():
        if b['kind'] == kind:
            return b
    return None


def daily_if_due(external_dir: Optional[str] = None,
                 now: Optional[dt.datetime] = None) -> Optional[BackupInfo]:
    """نسخة يومية إن لم توجد واحدة خلال ٢٤ ساعة. تُستدعى عند كل إقلاع للواجهة
    (`POST /backups/daily-if-due`) فتصبح النسخة اليومية حتمية لمن يفتح التطبيق
    يومياً ولا تتكرر لمن يفتحه عشر مرات في اليوم."""
    now = now or dt.datetime.now()
    with _LOCK:
        return _daily_if_due_locked(external_dir, now)


def _daily_if_due_locked(external_dir: Optional[str], now: dt.datetime) -> Optional[BackupInfo]:
    last = latest('daily')
    if last is not None:
        age = now - dt.datetime.fromisoformat(last['created_at'])
        if age < dt.timedelta(hours=24):
            return None
    if not db_path().exists():
        return None
    return create_backup('daily', external_dir, now=now)


def delete_backup(name: str) -> bool:
    """يحذف نسخة بالاسم — بعد التحقق من النمط، ثم التحقق أن المسار المحلول
    يبقى داخل المجلد (طبقة ثانية لو تغيّر النمط يوماً)."""
    if not is_valid_name(name):
        raise ValueError('اسم نسخة غير صالح')
    root = backup_dir().resolve()
    target = (root / name).resolve()
    if target.parent != root:
        raise ValueError('اسم نسخة غير صالح')
    if not target.exists():
        return False
    target.unlink()
    return True


# ---------------------------------------------------------------- المجلد الخارجي

def get_external_dir(db: Session) -> Optional[str]:
    row = db.query(models.AppSetting).filter_by(key=_EXTERNAL_DIR_KEY).one_or_none()
    return (row.value or None) if row is not None else None


def set_external_dir(db: Session, path: Optional[str]) -> Optional[str]:
    """يحفظ المسار (أو يمحوه بـNone/فارغ). لا يتحقق من وجوده هنا: مجلد iCloud
    قد يكون غير مركّب لحظة الحفظ، والتحذير يظهر عند أول نسخة بدلاً من منع الضبط."""
    row = db.query(models.AppSetting).filter_by(key=_EXTERNAL_DIR_KEY).one_or_none()
    value = (path or '').strip()
    if row is None:
        row = models.AppSetting(key=_EXTERNAL_DIR_KEY)
        db.add(row)
    row.value = value
    db.commit()
    return value or None
