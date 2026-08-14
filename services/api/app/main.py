# -*- coding: utf-8 -*-
"""نقطة تشغيل الخدمة — a private child process of the Electron app."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.session import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    init_db()
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
