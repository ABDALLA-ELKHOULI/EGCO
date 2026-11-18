# -*- coding: utf-8 -*-
"""«احفظ رغم الفرق» لحسابات بعينها داخل كشف مجمّع.

`import_service.import_bundle` يقبل `allow_unreconciled` للملف كله؛ قرار المستخدم
هنا أضيق: حسابان يختلفان عن إجماليهما المطبوع بهللتين، رآهما بالاسم والفرق ووافق
عليهما وحدهما. فلا يُعاد حفظ الملف كله ولا يُفتح الباب لحساب لم يره — نمرّ على
أقسام الملف ونحفظ الحسابات المختارة فقط عبر `commit_statement` نفسه (بوابة
التوجيه بالبادئة والتكرار كما هي، لا نسخة ثانية منها).
"""
from __future__ import annotations

from typing import Dict, Iterable, List

from sqlalchemy.orm import Session

from app.ingest import statement_bundle
from app.ingest.pdf_statement import StatementParseError
from app.services import import_service


def is_bundle(path: str, source: str) -> bool:
    return import_service._is_real_bundle(path, source)


def commit_accounts(db: Session, path: str, accounts: Iterable[str]) -> dict:
    wanted = {str(a).strip() for a in accounts if str(a).strip()}
    if not wanted:
        raise StatementParseError('لم تُحدَّد أي حسابات لحفظها رغم الفرق')
    sections = statement_bundle.split(path)
    found = [s for s in sections if s.account in wanted]
    missing = sorted(wanted - {s.account for s in found})
    if missing:
        raise StatementParseError('الحسابات التالية غير موجودة في الملف: %s' % '، '.join(missing))
    import_service.backup_db()
    texts = {statement_bundle.section_path(path, s.account): s.text for s in found}
    rows: List[dict] = []
    with statement_bundle.serving(texts):
        for sec in found:
            vpath = statement_bundle.section_path(path, sec.account)
            row = dict(account=sec.account, pages=[sec.first_page, sec.last_page])
            try:
                res = import_service.commit_statement(
                    db, vpath, allow_unreconciled=True, source='pdf_statement', backup=False)
            except Exception as e:  # noqa: BLE001 — حساب معطوب لا يُسقط الآخر
                db.rollback()
                row.update(status='read_error', message=str(e))
                rows.append(row)
                continue
            row.update(status='saved' if res.get('saved') else (res.get('reason') or 'not_saved'),
                       name=res.get('name') or res.get('suggestedName') or res.get('supplierName') or '',
                       reconciled=res.get('reconciled'), difference=res.get('difference'),
                       added=res.get('added', res.get('invoiceCount')),
                       skipped=res.get('skipped'))
            rows.append(row)
    counts: Dict[str, int] = {}
    for r in rows:
        counts[r['status']] = counts.get(r['status'], 0) + 1
    return dict(bundle=True, path=path, accounts=len(rows), counts=counts,
                saved=counts.get('saved', 0), forcedAccounts=sorted(wanted),
                problems=[r for r in rows if r['status'] != 'saved'], rows=rows)
