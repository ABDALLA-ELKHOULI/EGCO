# -*- coding: utf-8 -*-
"""Shared fixtures — every test that touches the database gets an isolated, throwaway
EGCO_DATA_DIR so nothing ever writes to the user's real app-data."""
import importlib
import os

import pytest


# --- بوابة عيّنات الاختبار (م-١٤) --------------------------------------------
# كثير من الاختبارات هنا تعتمد على ملفات حقيقية غير موجودة في المستودع: بعضها
# design/samples/* (مستبعد عمداً من git)، وبعضها مسارات مطلقة على جهاز المطوّر
# (~/Downloads/*.pdf، ~/Downloads/*.xls، ملف report4.html خارج المستودع تماماً).
# محلياً غيابها يُخطّى بأمان — لا داعي لتعطيل عمل المستخدم على جهازه. لكن في CI
# (لا توجد هذه الملفات على أي جهاز CI إطلاقاً) كان التخطّي يمرّ صامتاً فيُخرج
# البناء "أخضر" بلا أن يكون قد شغّل ٢٠٪+ من السويّة فعلياً. الحل: نفس الفحص،
# لكن حين CI=true يتحوّل التخطّي إلى فشل صريح يسمّي الملف الناقص، بدل أن يختفي.
#
# راجع docs/testing-samples.md لمعرفة أي الملفات يلزم وضعها يدوياً لتشغيل
# السويّة كاملة على جهاز جديد.

def _in_ci():
    """أي قيمة غير فارغة لـCI تُعتبر تفعيلاً — هذا هو المتغيّر القياسي الذي تضبطه
    GitHub Actions ومعظم أنظمة CI الأخرى تلقائياً."""
    return bool(os.environ.get('CI'))


def sample_missing(*paths, kind='exists'):
    """للاستخدام داخل pytest.mark.skipif(...) — يُقيَّم عند تحميل الوحدة (نفس توقيت
    os.path.exists القديم)، فيبقى الاستبدال شفافاً محلياً. في CI يُفشل الجمع
    (collection) صراحة بدل أن يُعيد True هادئة تتحول إلى SKIPPED."""
    check = os.path.isdir if kind == 'isdir' else os.path.exists
    missing = [p for p in paths if not check(p)]
    if not missing:
        return False
    if _in_ci():
        pytest.fail(
            'CI: ملف/مجلد عيّنة ناقص ولا يمكن تشغيل هذا الاختبار بلا فشل صريح: '
            + '، '.join(missing) + ' — راجع docs/testing-samples.md',
            pytrace=False,
        )
    return True


def require_sample(*paths):
    """للاستخدام داخل جسم الاختبار (بدل pytest.skip المباشر). محلياً يتخطّى كما
    كان تماماً؛ في CI يُفشل الاختبار صراحة بدل أن يُبلَّغ عنه SKIPPED بصمت."""
    missing = [p for p in paths if not os.path.exists(p)]
    if not missing:
        return
    if _in_ci():
        pytest.fail(
            'CI: ملف/مجلد عيّنة ناقص ولا يمكن تشغيل هذا الاختبار بلا فشل صريح: '
            + '، '.join(missing) + ' — راجع docs/testing-samples.md',
            pytrace=False,
        )
    pytest.skip('عيّنة غير متاحة على هذا الجهاز: ' + '، '.join(missing))
# ------------------------------------------------------------------------------


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
