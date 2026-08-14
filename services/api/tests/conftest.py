# -*- coding: utf-8 -*-
"""Shared fixtures — every test that touches the database gets an isolated, throwaway
EGCO_DATA_DIR so nothing ever writes to the user's real app-data."""
import importlib
import os

import pytest


@pytest.fixture()
def api_client(tmp_path, monkeypatch):
    """A FastAPI TestClient wired to a fresh temp database.

    Reloads app.core.config / app.db.session / app.main so `settings.DATA_DIR` picks up
    the temp dir — those modules compute paths at import time.
    """
    monkeypatch.setenv('EGCO_DATA_DIR', str(tmp_path / 'data'))

    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.db.session as session_mod
    importlib.reload(session_mod)
    import app.services.payables_service as payables_service_mod
    importlib.reload(payables_service_mod)
    import app.services.report_service as report_service_mod
    importlib.reload(report_service_mod)
    import app.services.periods_service as periods_service_mod
    importlib.reload(periods_service_mod)
    import app.services.import_service as import_service_mod
    importlib.reload(import_service_mod)
    import app.services.export_service as export_service_mod
    importlib.reload(export_service_mod)
    import app.api.routes.dashboard as dashboard_route
    importlib.reload(dashboard_route)
    import app.api.routes.suppliers as suppliers_route
    importlib.reload(suppliers_route)
    import app.api.routes.manual as manual_route
    importlib.reload(manual_route)
    import app.api.routes.imports as imports_route
    importlib.reload(imports_route)
    import app.services.contractors_service as contractors_service_mod
    importlib.reload(contractors_service_mod)
    import app.services.contractor_report_service as contractor_report_service_mod
    importlib.reload(contractor_report_service_mod)
    import app.api.routes.contractors as contractors_route
    importlib.reload(contractors_route)
    import app.api.routes.reports as reports_route
    importlib.reload(reports_route)
    import app.services.ai_service as ai_service_mod
    importlib.reload(ai_service_mod)
    import app.services.ai_features_service as ai_features_service_mod
    importlib.reload(ai_features_service_mod)
    import app.api.routes.ai as ai_route
    importlib.reload(ai_route)
    import app.api.router as router_mod
    importlib.reload(router_mod)
    import app.main as main_mod
    importlib.reload(main_mod)

    from fastapi.testclient import TestClient
    with TestClient(main_mod.app) as client:
        yield client
