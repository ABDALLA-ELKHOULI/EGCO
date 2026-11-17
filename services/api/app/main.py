import logging
# -*- coding: utf-8 -*-
"""نقطة تشغيل الخدمة — a private child process of the Electron app."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.session import init_db
from app.testing_seed import seed_if_requested


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    init_db()
    seed_if_requested()  # م-٤٧: بيانات مصنوعة للاختبارات — فقط EGCO_SEED=1 وقاعدة فارغة
    # م-٤٥: النسخة اليومية عند إقلاع الخادم لا عند فتح شاشة الإعدادات — من لا يفتح
    # الإعدادات أبداً كان بلا نسخة يومية. الفشل هنا لا يمنع الإقلاع: تطبيق لا يفتح
    # بسبب تعذّر نسخة أسوأ من يوم بلا نسخة.
    try:
        from app.services import backup_service
        from app.db.session import SessionLocal
        from sqlalchemy import text as _sql
        with SessionLocal() as db:
            ext = backup_service.get_external_dir(db)
            # قاعدة بلا أي طرف (أول تشغيل، أو خادم اختبار) — نسخة منها لا تحمي شيئاً
            # وتزاحم النسخ الحقيقية على سقف الثلاثين.
            has_data = db.execute(_sql(
                'SELECT (SELECT COUNT(*) FROM suppliers) + (SELECT COUNT(*) FROM contractors)'
            )).scalar()
        if has_data:
            backup_service.daily_if_due(ext)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception('تعذّرت النسخة اليومية عند الإقلاع')
    yield


app = FastAPI(title=settings.APP_NAME, version='0.1.0',
              docs_url='/docs' if settings.DEBUG else None, lifespan=lifespan)

# Vite dev server in development; file:// in the packaged app.
app.add_middleware(CORSMiddleware,
                   allow_origins=['http://localhost:5173'],
                   allow_methods=['*'], allow_headers=['*'])
app.include_router(api_router)


@app.get('/health')
def health() -> dict:
    return {'status': 'ok', 'version': app.version, 'db': str(settings.DB_PATH)}
