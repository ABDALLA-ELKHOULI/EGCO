# -*- coding: utf-8 -*-
"""تسجيل المسارات — the one place a new feature plugs its endpoints in."""
from fastapi import APIRouter

from app.api.routes import (ai, budget, cashflow, contractors, coverage,
                            dashboard, imports, invoices, manual, overview,
                            projects, reports, suppliers)
from app.core.config import settings

api_router = APIRouter(prefix=settings.API_PREFIX)
api_router.include_router(dashboard.router, prefix='/dashboard', tags=['dashboard'])
api_router.include_router(suppliers.router, prefix='/suppliers', tags=['suppliers'])
api_router.include_router(imports.router, prefix='/import', tags=['import'])
api_router.include_router(reports.router, prefix='/reports', tags=['reports'])
api_router.include_router(manual.router, prefix='/manual', tags=['manual'])
# ---- v0.3
api_router.include_router(coverage.router, prefix='/coverage', tags=['coverage'])
api_router.include_router(invoices.router, prefix='/invoices', tags=['invoices'])
api_router.include_router(projects.router, prefix='/projects', tags=['projects'])
api_router.include_router(cashflow.router, prefix='/cashflow', tags=['cashflow'])
api_router.include_router(overview.router, prefix='/overview', tags=['overview'])
# ---- v0.4
api_router.include_router(contractors.router, prefix='/contractors', tags=['contractors'])
api_router.include_router(budget.router, prefix='/budget', tags=['budget'])
# ---- v0.5
api_router.include_router(ai.router, prefix='/ai', tags=['ai'])
