# -*- coding: utf-8 -*-
"""تسجيل المسارات — the one place a new feature plugs its endpoints in."""
from fastapi import APIRouter

from app.api.routes import (ai, backups, budget, cashflow, contractors, coverage,
                            dashboard, guarantees, imports, invoices, manual,
                            events, overview, parties, project_admin, projects, reports,
                            reset, revenues, settings as settings_routes, suppliers,
                            today, trash)
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
api_router.include_router(revenues.router, prefix='/revenues', tags=['revenues'])
api_router.include_router(guarantees.router, prefix='/guarantees', tags=['guarantees'])
# ---- م-٣٠ · م-٣١
api_router.include_router(trash.router, prefix='/trash', tags=['trash'])
api_router.include_router(project_admin.router, prefix='/project-admin', tags=['project-admin'])
# ---- م-٤٥ · م-١٣
api_router.include_router(backups.router, prefix='/backups', tags=['backups'])
# ---- تصفير البيانات
api_router.include_router(reset.router, prefix='/reset', tags=['reset'])
# ---- أرخبيل (الموجة ٠): م-٥٠ · الرصيد البنكي
api_router.include_router(parties.router, prefix='/parties', tags=['parties'])
api_router.include_router(settings_routes.router, prefix='/settings', tags=['settings'])
api_router.include_router(events.router, prefix='/events', tags=['events'])
api_router.include_router(today.router, prefix='/today', tags=['today'])
