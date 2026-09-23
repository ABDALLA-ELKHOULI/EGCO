# -*- coding: utf-8 -*-
"""مُغلّف موحّد لتحويل استثناء بايثون إلى `HTTPException` (م-٣٨).

قبل هذا الملف: تسعة مواضع في `budget.py`/`ai.py` كانت تكتب
`raise HTTPException(NNN, detail=str(e))` مباشرة. الأربعة المجرَّبة فعلياً كانت
آمنة لأن استثناءاتها مخصّصة برسالة عربية من مصدرها — لكن أي استثناء آخر (عطل
غير متوقع في مكتبة، `KeyError`، إلخ) كان سيصل المستخدم كنص إنجليزي خام داخل
`ErrorState`.

القاعدة هنا: استثناء "معروف" (رسالته عربية جاهزة للعرض من مصدرها) يمرّ كما هو
بالحالة (status) التي يحدّدها المستدعي؛ أي استثناء آخر يتحوّل دائماً إلى رسالة
عربية عامة واحدة بالحالة 500، مع تسجيل الاستثناء الأصلي كاملاً (traceback) في
سجل الخادم — لا يُفقَد شيء، فقط لا يصل نص إنجليزي خام للواجهة.
"""
from __future__ import annotations

import logging
from typing import Tuple, Type

from fastapi import HTTPException

from app.ingest.friendly_errors import FriendlyFileError
from app.ingest.budget_xlsx import BudgetParseError
from app.ingest.csv_statement import CsvStatementParseError
from app.ingest.receivables_excel import ReceivablesExcelParseError
from app.ingest.suppliers_excel import SuppliersParseError
from app.ingest.debts_report_xls import DebtsReportParseError
from app.ingest.receivables_legacy import ReceivablesParseError
from app.ingest.pdf_statement import StatementParseError
from app.ingest.contractors_balance_xls import ContractorsBalanceParseError
from app.services import ai_service as _ai_service_mod

logger = logging.getLogger(__name__)

#: رسالة عربية عامة واحدة — لا تكشف أي تفصيل تقني، فالتفصيل مسجَّل في اللوق.
GENERIC_MESSAGE = 'حدث خطأ غير متوقع — سُجّلت التفاصيل'

#: استثناءات "معروفة" في هذا المشروع — رسالتها عربية جاهزة للعرض من مصدرها
#: مباشرة (ValueError هنا يُفترض دائماً أنه رُفع عمداً برسالة عربية، وفق
#: نمط budget_service.upsert_manual الحالي — وليس ValueError عرضياً من مكتبة).
_FRIENDLY_EXC: Tuple[Type[Exception], ...] = (
    FriendlyFileError,
    ValueError,
    BudgetParseError,
    CsvStatementParseError,
    ReceivablesExcelParseError,
    SuppliersParseError,
    DebtsReportParseError,
    ReceivablesParseError,
    StatementParseError,
    ContractorsBalanceParseError,
)


def friendly_http_error(e: Exception, status: int = 422) -> HTTPException:
    """يبني `HTTPException` مناسباً لاستثناء مُلتَقط في مسار API.

    الاستعمال: `except Exception as e: raise friendly_http_error(e, 404) from e`
    (وليس `raise ... from None` — السبب الأصلي يبقى في traceback للتشخيص محلياً
    حتى مع الاستثناءات المعروفة).

    - استثناء معروف (`_FRIENDLY_EXC`): `HTTPException(status, detail=str(e))` —
      نفس الحالة التي كان المستدعي سيستعملها يدوياً.
    - أي استثناء آخر: تُسجَّل تفاصيله الكاملة عبر `logger.exception`، ويعود
      دائماً `HTTPException(500, detail=GENERIC_MESSAGE)` بلا أي نص إنجليزي خام.
    """
    # ai_service.AiError مفحوصة عبر خاصية الوحدة الحيّة (`_ai_service_mod.AiError`)
    # لا عبر استيراد اسمٍ مباشر: `tests/conftest.py::api_client` يعيد تحميل
    # `app.services.ai_service` بـ`importlib.reload` قبل كل اختبار، فيُعاد تعريف
    # صنف `AiError` من جديد (كائن صنف مختلف بنفس الاسم) — استيراد الاسم مباشرة
    # هنا كان سيجمّد المرجع القديم، فيفشل isinstance بصمت بعد أول إعادة تحميل
    # (وُجد فعلاً: 502 المتوقعة تحوّلت 500 عامة — راجع test_extract_bad_provider_502).
    if isinstance(e, _FRIENDLY_EXC) or isinstance(e, _ai_service_mod.AiError):
        return HTTPException(status, detail=str(e))
    logger.exception('استثناء غير متوقع في مسار API')
    return HTTPException(500, detail=GENERIC_MESSAGE)
