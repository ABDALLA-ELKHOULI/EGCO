# -*- coding: utf-8 -*-
"""ميزات المساعد الذكي المبنية على البيانات — الحساب دائماً في بايثون.

قاعدة مطلقة تحكم كل دالة هنا: النموذج (LLM) لا يحسب ولا يخترع أي رقم أبداً.
كل رقم يظهر في أي استجابة محسوب مسبقاً بكود بايثون حتمي (Decimal) ثم يُدرَج
كنص جاهز داخل الطلب المرسل للنموذج؛ النموذج فقط يقرأ نصاً ويكتب نصاً
(صياغة/تلخيص/شرح) ولا يُسمح له بإنتاج أي رقم جديد لم يُحسب مسبقاً.
الاستثناء الوحيد المُعلن هو /ai/parse-text حيث يستخرج النموذج مبلغين من نص
حر يلصقه المستخدم بنفسه (رسالة واتساب/إيميل) كاقتراح يُراجعه المستخدم قبل
أي حفظ — لا يُكتب شيء في قاعدة البيانات من هذا المسار إطلاقاً.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
import statistics
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import models
from app.domain import cashflow as CF
from app.domain import contractors as C
from app.domain.payables import D, money
from app.services import contractors_service as CS
from app.services import payables_service as PS
from app.services import budget_service as BS
from app.services import cashflow_service as CFS

ZERO = Decimal('0')

DISABLED_MSG = 'المساعد غير مفعّل — فعّله من الإعدادات'


# ================================================================== /ask

SCHEMA_DOC = """جداول قاعدة بيانات EGCO (SQLite) — القراءة فقط:

suppliers(id, account مفتاح المورد, name اسم المورد, project المشروع,
  term_raw نص مدة السداد الأصلي, term_kind نوع المدة (days/cash/claim), term_days عدد الأيام)
invoices(id, supplier_id, number رقم الفاتورة, date تاريخ الفاتورة, amount مبلغ الفاتورة,
  doc المستند, description الوصف, manual_due_date تاريخ استحقاق يدوي, source المصدر)
payments(id, supplier_id, date تاريخ الدفعة, amount مبلغ الدفعة, doc المستند,
  description الوصف, source المصدر)
contractors(id, code كود المقاول, name اسم المقاول, phone الهاتف,
  default_retention_rate نسبة التأمين الافتراضية, default_guarantee_days مدة الضمان)
contractor_entries(id, contractor_id, date التاريخ, debit مدين (دفعنا له),
  credit دائن (مستحق له من مستخلص), doc المستند, description الوصف,
  kind نوع الحركة (claim/payment/retention/deduction/invoice/opening/other),
  claim_no رقم المستخلص, project المشروع, source المصدر)
contractor_claims(id, contractor_id, project, number رقم المستخلص, date التاريخ,
  gross_cumulative الإجمالي التراكمي, previous_cumulative السابق التراكمي,
  retention_rate نسبة التأمين, retention_amount مبلغ التأمين,
  other_deductions خصومات أخرى, net_due الصافي المستحق)
contractor_guarantees(id, contractor_id, project, amount مبلغ الضمان المحتجز,
  retention_rate, finished_on تاريخ الإنجاز, guarantee_days مدة الضمان بالأيام,
  release_due تاريخ الإفراج المتوقع, released_on تاريخ الإفراج الفعلي)
budget_snapshots(id, project, month الشهر (أول يوم), serial الرقم التسلسلي,
  actual_month المنفذ الشهري, planned_month المخطط الشهري,
  deviation_month الانحراف الشهري, cum_actual المنفذ التراكمي,
  cum_planned المخطط التراكمي, delay_pct نسبة التأخر (كسر عشري),
  completion_pct نسبة الإنجاز (كسر عشري))

اصطلاح الإشارة (مهم):
- عند الموردين: outstanding/overdue موجب دائماً = مبلغ نحن مدينون به للمورد.
- عند المقاولين: balance = مجموع(debit) − مجموع(credit).
  balance موجب = المقاول مدين لنا. balance سالب = نحن مدينون للمقاول (الحالة الشائعة).
جميع الجداول تحمل عمود deleted_at — السجلات المحذوفة منطقياً deleted_at IS NOT NULL
ويجب استبعادها بشرط WHERE deleted_at IS NULL عند القراءة.
"""

_FORBIDDEN = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|PRAGMA|CREATE|REPLACE|VACUUM|'
    r'GRANT|REVOKE|TRUNCATE)\b', re.I)


def _strip_sql_comments(sql: str) -> str:
    sql = re.sub(r'--[^\n]*', ' ', sql)
    sql = re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S)
    return sql


def guard_select_sql(raw_sql: str) -> str:
    """يتحقق أن النص جملة SELECT واحدة آمنة فقط، ويضيف LIMIT 200 إن غاب.

    يرفع ValueError برسالة داخلية (غير معروضة) عند أي نص غير آمن أو غير
    مطابق — القرار كله كودي، لا يُعتمد على النموذج في هذا التحقق إطلاقاً.
    """
    sql = _strip_sql_comments(raw_sql or '').strip()
    if not sql:
        raise ValueError('empty')
    # اسمح بفاصلة منقوطة واحدة زائدة في النهاية فقط
    body = sql[:-1].strip() if sql.endswith(';') else sql
    if ';' in body:
        raise ValueError('multi-statement')
    if not re.match(r'^\s*SELECT\b', body, re.I):
        raise ValueError('not a select')
    if _FORBIDDEN.search(body):
        raise ValueError('forbidden keyword')
    if not re.search(r'\bLIMIT\b', body, re.I):
        body = body + ' LIMIT 200'
    return body


REFUSAL_ANSWER = 'لا يمكن تنفيذ هذا الاستفسار — يُسمح فقط باستعلامات قراءة (SELECT) بسيطة.'


def _db_path() -> str:
    return str(settings.DB_PATH)


def run_readonly_sql(sql: str) -> List[dict]:
    """تنفيذ SELECT واحد على اتصال SQLite للقراءة فقط، مع سقف 200 صف كودياً."""
    uri = 'file:' + _db_path() + '?mode=ro'
    conn = sqlite3.connect(uri, uri=True)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql)
        rows = cur.fetchmany(200)
        return [dict(r) for r in rows]
    finally:
        conn.close()


def ask(chat_fn, question: str) -> dict:
    """سؤال وجواب عربي عن قاعدة البيانات — خطوتان عبر النموذج، بلا أي حساب من طرفه.

    الخطوة الأولى تطلب من النموذج SQL واحداً بصيغة JSON بناءً على وصف مخطط
    ثابت (SCHEMA_DOC)؛ الكود وحده يتحقق من أمان هذا الاستعلام وينفّذه فعلياً
    عبر اتصال SQLite للقراءة فقط. الخطوة الثانية تعطي النموذج فقط الصفوف التي
    أعادتها قاعدة البيانات فعلياً (بعد قصّها) ليصوغ منها جملة عربية — لا يخترع
    النموذج أي رقم؛ كل رقم في الجواب مصدره صفوف حقيقية من قاعدة البيانات.
    """
    reply1 = chat_fn([
        {'role': 'system', 'content':
            'أنت مساعد استعلامات SQL للقراءة فقط. مخطط قاعدة البيانات:\n' + SCHEMA_DOC +
            '\nأعد JSON صارماً فقط بالشكل {"sql": "SELECT ..."} — جملة SELECT واحدة '
            'فقط، بلا أي تعليق أو شرح خارج الـJSON.'},
        {'role': 'user', 'content': question},
    ], json_mode=True)
    try:
        data = json.loads(_extract_json(reply1))
        raw_sql = str(data.get('sql') or '')
    except (ValueError, AttributeError):
        return {'answer': REFUSAL_ANSWER, 'sql': None, 'rows': []}

    try:
        safe_sql = guard_select_sql(raw_sql)
    except ValueError:
        return {'answer': REFUSAL_ANSWER, 'sql': None, 'rows': []}

    try:
        rows = run_readonly_sql(safe_sql)
    except sqlite3.Error:
        return {'answer': REFUSAL_ANSWER, 'sql': safe_sql, 'rows': []}

    rows = rows[:200]
    rows_json = json.dumps(rows, ensure_ascii=False, default=str)
    reply2 = chat_fn([
        {'role': 'system', 'content':
            'أنت مساعد يجيب بالعربية عن سؤال المستخدم اعتماداً حصراً على الصفوف '
            'المُعطاة أدناه (نتائج استعلام حقيقي على قاعدة البيانات). لا تخترع أرقاماً '
            'أو حقائق غير موجودة في هذه الصفوف. إن كانت الصفوف فارغة فقل ذلك بوضوح.'},
        {'role': 'user', 'content':
            'السؤال: {}\nالصفوف (JSON): {}'.format(question, rows_json)},
    ], json_mode=False)

    return {'answer': (reply2 or '').strip(), 'sql': safe_sql, 'rows': rows}


def _extract_json(raw: str) -> str:
    text = (raw or '').strip()
    fenced = re.search(r'```(?:json)?\s*(.*?)```', text, re.S)
    if fenced:
        return fenced.group(1).strip()
    m = re.search(r'\{.*\}', text, re.S)
    return m.group(0) if m else text


# ================================================================== /remind

def _oldest_overdue_invoice(p, today: dt.date) -> Optional[dict]:
    overdue = [i for i in p.invoices if i.remaining > 0 and i.due_date and i.due_date < today]
    if not overdue:
        return None
    inv = min(overdue, key=lambda i: i.due_date)
    return dict(number=inv.number, date=inv.due_date.isoformat(), amount=money(inv.remaining))


def build_remind_facts(db: Session, party_kind: str, key: str,
                       today: Optional[dt.date] = None) -> Optional[dict]:
    """يجمع أرقام الطرف الفعلية المحسوبة كودياً فقط — بلا أي تدخل من النموذج."""
    today = today or dt.date.today()
    if party_kind == 'supplier':
        ps = PS.positions(db, today=today, account=key)
        if not ps:
            return None
        p = ps[0]
        overdue_invoices = [i for i in p.invoices if i.remaining > 0 and i.due_date and i.due_date < today]
        return dict(
            partyKind='supplier', name=p.supplier.name, account=p.supplier.account,
            outstanding=money(p.outstanding), overdue=money(p.overdue),
            overdueCount=len(overdue_invoices),
            oldestOverdue=_oldest_overdue_invoice(p, today),
        )
    if party_kind == 'contractor':
        row = db.query(models.Contractor).filter_by(code=key).filter(
            models.Contractor.deleted_at.is_(None)).one_or_none()
        if row is None:
            return None
        detail = CS.contractor_detail_json(row, today)
        return dict(
            partyKind='contractor', name=row.name, code=row.code,
            balance=money(D(detail['balance'])),
            balanceLabel=('له' if D(detail['balance']) > 0 else 'لنا' if D(detail['balance']) < 0 else 'متسوٍّ'),
            lastPayment=detail['lastPayment'],
        )
    return None


def remind_message(chat_fn, facts: dict) -> str:
    """صياغة رسالة مطالبة عربية رسمية اعتماداً حصراً على الأرقام المحسوبة في facts."""
    lines = ['طرف: {} ({})'.format(facts['name'], facts.get('account') or facts.get('code'))]
    if facts['partyKind'] == 'supplier':
        lines.append('إجمالي المستحق: {:,.2f} ر.س'.format(facts['outstanding']))
        lines.append('المتأخر: {:,.2f} ر.س عبر {} فاتورة'.format(facts['overdue'], facts['overdueCount']))
        if facts['oldestOverdue']:
            o = facts['oldestOverdue']
            lines.append('أقدم فاتورة متأخرة: رقم {} بتاريخ استحقاق {} بمبلغ {:,.2f} ر.س'.format(
                o['number'], o['date'], o['amount']))
    else:
        lines.append('الرصيد الحالي: {:,.2f} ر.س ({})'.format(abs(facts['balance']), facts['balanceLabel']))
        if facts['lastPayment']:
            lines.append('آخر دفعة: {} بمبلغ {:,.2f} ر.س'.format(
                facts['lastPayment']['date'], facts['lastPayment']['amount']))
    reply = chat_fn([
        {'role': 'system', 'content':
            'اكتب رسالة متابعة/مطالبة عربية رسمية ومهذبة مناسبة لإرسالها عبر واتساب، '
            'اعتماداً حصراً على الأرقام والحقائق المذكورة أدناه دون إضافة أي رقم جديد.'},
        {'role': 'user', 'content': '\n'.join(lines)},
    ], json_mode=False)
    return (reply or '').strip()


# ================================================================== /budget-notes

def budget_deltas(detail: dict) -> dict:
    """فروق شهرية محسوبة كودياً من آخر لقطتين — لا حساب في النموذج."""
    months = detail['months']
    latest = months[-1]
    prev = months[-2] if len(months) >= 2 else None
    out = dict(project=detail['project'], latestMonth=latest['month'],
              actualMonth=latest['actualMonth'], plannedMonth=latest['plannedMonth'],
              deviationMonth=latest['deviationMonth'],
              delayPct=latest['delayPct'], completionPct=latest['completionPct'],
              prevMonth=None, spendDelta=None, delayDeltaPp=None, completionDeltaPp=None)
    if prev is not None:
        out['prevMonth'] = prev['month']
        out['spendDelta'] = round(latest['actualMonth'] - prev['actualMonth'], 2)
        if latest['delayPct'] is not None and prev['delayPct'] is not None:
            out['delayDeltaPp'] = round((latest['delayPct'] - prev['delayPct']) * 100, 2)
        if latest['completionPct'] is not None and prev['completionPct'] is not None:
            out['completionDeltaPp'] = round((latest['completionPct'] - prev['completionPct']) * 100, 2)
    return out


def budget_notes(chat_fn, deltas: dict) -> str:
    """ملاحظات مالية عربية على شكل نقاط — تصف فقط الفروق المحسوبة كودياً في deltas."""
    reply = chat_fn([
        {'role': 'system', 'content':
            'اكتب ملاحظات مالية عربية موجزة على شكل نقاط (سطر لكل نقطة يبدأ بـ«- ») '
            'تصف فقط الأرقام والفروق المُعطاة أدناه دون اختراع أي رقم إضافي.'},
        {'role': 'user', 'content': json.dumps(deltas, ensure_ascii=False)},
    ], json_mode=False)
    return (reply or '').strip()


# ================================================================== /summary

def build_summary_numbers(db: Session, parties: Optional[str], account: Optional[str],
                          project: Optional[str], contractor: Optional[str],
                          date_from: Optional[dt.date], date_to: Optional[dt.date],
                          today: Optional[dt.date] = None) -> dict:
    """أرقام ملخّص مختزلة كودياً — إجماليات وعدّادات فقط، بلا تفريغ صفوف خام."""
    today = today or dt.date.today()
    parties = parties or 'suppliers'
    if contractor:
        row = db.query(models.Contractor).filter_by(code=contractor).filter(
            models.Contractor.deleted_at.is_(None)).one_or_none()
        if row is None:
            return dict(scope='contractor', found=False)
        detail = CS.contractor_detail_json(row, today)
        return dict(scope='contractor', found=True, name=row.name,
                   balance=detail['balance'], duesTotal=detail['duesTotal'],
                   paidTotal=detail['paidTotal'], retentionTotal=detail['retentionTotal'])

    ps = [] if parties == 'contractors' else PS.positions(db, today, account=account)
    if project:
        ps = [p for p in ps if (p.supplier.project or '') == project]

    zero = Decimal('0')
    out = dict(scope='company' if not (account or project) else ('supplier' if account else 'project'),
               partiesMode=parties,
               supplierCount=len(ps),
               totalOutstanding=money(sum((p.outstanding for p in ps), zero)),
               totalOverdue=money(sum((p.overdue for p in ps), zero)),
               totalDueWithin7=money(sum((p.due_within_7 for p in ps), zero)),
               totalInvoiced=money(sum((p.total_invoiced for p in ps), zero)),
               totalPaid=money(sum((p.total_paid for p in ps), zero)))
    if date_from is not None:
        breakdowns = [PS.period_breakdown(p, date_from, date_to) for p in ps]
        out['openingBalance'] = money(sum((b['opening'] for b in breakdowns), zero))
        out['closingBalance'] = money(sum((b['closing'] for b in breakdowns), zero))
        out['invoicedInPeriod'] = money(sum((b['invoiced_in_period'] for b in breakdowns), zero))
        out['paidInPeriod'] = money(sum((b['paid_in_period'] for b in breakdowns), zero))

    if parties in ('contractors', 'both'):
        rows = CS.contractors_list_json(db, today)
        out['contractorCount'] = rows['count']
        out['owedToContractors'] = rows['totals']['owedToContractors']
        out['owedToUs'] = rows['totals']['owedToUs']
        out['retentionHeld'] = rows['totals']['retentionHeld']
    return out


def executive_summary(chat_fn, numbers: dict) -> str:
    """3-5 جمل عربية رسمية تلخص الأرقام المحسوبة كودياً في numbers فقط."""
    reply = chat_fn([
        {'role': 'system', 'content':
            'اكتب ملخصاً تنفيذياً بالعربية من 3 إلى 5 جمل رسمية، اعتماداً حصراً على '
            'الأرقام المُعطاة أدناه دون اختراع أي رقم أو حقيقة إضافية.'},
        {'role': 'user', 'content': json.dumps(numbers, ensure_ascii=False)},
    ], json_mode=False)
    return (reply or '').strip()


# ================================================================== /brief

def build_brief_digest(db: Session, days: int, today: Optional[dt.date] = None) -> dict:
    """موجز رقمي محسوب بالكامل كودياً عبر استعلامات على قاعدة البيانات."""
    today = today or dt.date.today()
    start = dt.datetime.combine(today - dt.timedelta(days=days), dt.time.min)
    limit = today + dt.timedelta(days=days)

    new_invoices = db.query(models.Invoice).filter(
        models.Invoice.created_at >= start, models.Invoice.deleted_at.is_(None)).count()
    new_payments = db.query(models.Payment).filter(
        models.Payment.created_at >= start, models.Payment.deleted_at.is_(None)).count()
    new_entries = db.query(models.ContractorEntry).filter(
        models.ContractorEntry.created_at >= start, models.ContractorEntry.deleted_at.is_(None)).count()
    new_budget = db.query(models.BudgetSnapshot).filter(
        models.BudgetSnapshot.created_at >= start).count()

    inv_sum = sum((D(i.amount) for i in db.query(models.Invoice).filter(
        models.Invoice.created_at >= start, models.Invoice.deleted_at.is_(None)).all()), ZERO)
    pay_sum = sum((D(p.amount) for p in db.query(models.Payment).filter(
        models.Payment.created_at >= start, models.Payment.deleted_at.is_(None)).all()), ZERO)

    guarantees = db.query(models.ContractorGuarantee).filter(
        models.ContractorGuarantee.deleted_at.is_(None),
        models.ContractorGuarantee.released_on.is_(None)).all()
    releasing_soon = []
    for g in guarantees:
        due, status = CS.guarantee_release(g, today)
        if due is not None and today <= due <= limit:
            releasing_soon.append(dict(project=g.project, contractor=g.contractor.code,
                                       amount=money(g.amount or 0), releaseDue=due.isoformat()))

    return dict(
        windowDays=days, from_=start.date().isoformat(), to=today.isoformat(),
        newInvoicesCount=new_invoices, newInvoicesTotal=money(inv_sum),
        newPaymentsCount=new_payments, newPaymentsTotal=money(pay_sum),
        newContractorEntriesCount=new_entries,
        newBudgetSnapshotsCount=new_budget,
        guaranteesReleasingSoon=releasing_soon,
    )


def brief_text(chat_fn, digest: dict) -> str:
    """موجز عربي قصير يصف فقط الأرقام المحسوبة كودياً في digest."""
    reply = chat_fn([
        {'role': 'system', 'content':
            'اكتب موجزاً إخبارياً عربياً قصيراً (فقرة أو نقاط قصيرة) يصف فقط الأرقام '
            'المُعطاة أدناه دون اختراع أي رقم إضافي.'},
        {'role': 'user', 'content': json.dumps(digest, ensure_ascii=False)},
    ], json_mode=False)
    return (reply or '').strip()


# ================================================================== /anomalies

def find_anomalies(db: Session, today: Optional[dt.date] = None) -> List[dict]:
    """اكتشاف الحالات الشاذة بالكامل عبر كود حتمي — النموذج لا يقرر شيئاً هنا."""
    today = today or dt.date.today()
    items: List[dict] = []

    # (a) near-duplicate payments: same supplier, same amount, within 3 days, different doc
    suppliers = db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None)).all()
    for s in suppliers:
        pays = [p for p in s.payments if p.deleted_at is None]
        pays.sort(key=lambda p: p.date)
        for i in range(len(pays)):
            for j in range(i + 1, len(pays)):
                a, b = pays[i], pays[j]
                if abs((b.date - a.date).days) > 3:
                    break
                if D(a.amount) == D(b.amount) and (a.doc or '') != (b.doc or ''):
                    items.append(dict(
                        kind='duplicate_payment', account=s.account, name=s.name,
                        amount=money(a.amount), date1=a.date.isoformat(), date2=b.date.isoformat(),
                        doc1=a.doc, doc2=b.doc, link='#/suppliers/{}'.format(s.account)))

    # (b) supplier invoice amount > 3x median invoice amount for that supplier
    for s in suppliers:
        invs = [i for i in s.invoices if i.deleted_at is None]
        amounts = [float(D(i.amount)) for i in invs]
        if len(amounts) < 3:
            continue
        med = statistics.median(amounts)
        if med <= 0:
            continue
        for i in invs:
            if float(D(i.amount)) > med * 3:
                items.append(dict(
                    kind='outlier_invoice', account=s.account, name=s.name,
                    amount=money(i.amount), median=round(med, 2), invoiceNumber=i.number,
                    date=i.date.isoformat(), link='#/suppliers/{}'.format(s.account)))

    # (c) retention rate change between consecutive claims of one contractor+project
    contractors = db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None)).all()
    for c in contractors:
        by_project: Dict[str, list] = {}
        for cl in c.claims:
            if cl.deleted_at is not None:
                continue
            by_project.setdefault(cl.project or '', []).append(cl)
        for project, claims in by_project.items():
            claims.sort(key=lambda x: x.date)
            for i in range(1, len(claims)):
                r0, r1 = claims[i - 1].retention_rate, claims[i].retention_rate
                if r0 is not None and r1 is not None and r0 != r1:
                    items.append(dict(
                        kind='retention_rate_change', code=c.code, name=c.name, project=project,
                        from_=round(r0 * 100, 2), to=round(r1 * 100, 2),
                        claimNumber=claims[i].number, date=claims[i].date.isoformat(),
                        link='#/contractors/{}'.format(c.code)))

    # (d) entries dated in the future
    future_entries = db.query(models.ContractorEntry).filter(
        models.ContractorEntry.deleted_at.is_(None),
        models.ContractorEntry.date > today).all()
    for e in future_entries:
        items.append(dict(
            kind='future_dated_entry', code=e.contractor.code, name=e.contractor.name,
            date=e.date.isoformat(), amount=money(D(e.debit or 0) - D(e.credit or 0)),
            description=e.description, link='#/contractors/{}'.format(e.contractor.code)))

    return items


def phrase_anomalies(chat_fn, items: List[dict]) -> List[dict]:
    """يصوغ عناوين/تفاصيل عربية لكل شذوذ مُكتشف كودياً مسبقاً — لا يقرر ما هو الشذوذ."""
    if not items:
        return []
    reply = chat_fn([
        {'role': 'system', 'content':
            'لكل عنصر في القائمة أدناه، اكتب عنواناً عربياً قصيراً (title) وتفصيلاً '
            'عربياً واضحاً (detail) يصف الحالة باستخدام الأرقام والحقائق المُعطاة فقط '
            'دون اختراع أي رقم. أعد JSON فقط بالشكل '
            '{"items": [{"title": "...", "detail": "...", "link": "..."}]} '
            'بنفس عدد وترتيب العناصر المُعطاة، مع إعادة قيمة link كما وردت في كل عنصر.'},
        {'role': 'user', 'content': json.dumps(items, ensure_ascii=False)},
    ], json_mode=True)
    try:
        data = json.loads(_extract_json(reply))
        out = data.get('items') or []
        if len(out) == len(items):
            for o, src in zip(out, items):
                o.setdefault('link', src.get('link'))
            return out
    except (ValueError, AttributeError):
        pass
    # fallback حتمي إن فشل النموذج — لا نُسقط الاستجابة أبداً
    return [dict(title=it['kind'], detail=json.dumps(it, ensure_ascii=False), link=it.get('link'))
            for it in items]


# ================================================================== /parse-text

def parse_text_proposal(chat_fn, db: Session, text: str) -> dict:
    """يستخرج النموذج مقترحاً من نص حر — المبالغ هنا فقط مستخرجة بالنموذج،
    والمستخدم يراجعها قبل أي حفظ؛ لا يُكتب شيء في قاعدة البيانات من هذا المسار.
    مطابقة الطرف (key/partyKind) لا تُترك للنموذج إطلاقاً — تُصحَّح كودياً عبر
    مطابقة نصية مع قوائم الموردين والمقاولين الفعلية.
    """
    reply = chat_fn([
        {'role': 'system', 'content':
            'استخرج من رسالة واتساب/إيميل مالية بيانات JSON بالشكل: '
            '{"partyKind": "supplier|contractor|null", "partyName": "اسم الطرف كما ورد", '
            '"date": "YYYY-MM-DD أو null", "debit": رقم أو null, "credit": رقم أو null, '
            '"description": "نص", "claimNo": "رقم المستخلص إن وجد أو null"}. '
            'لا تكتب أي شيء خارج الـJSON.'},
        {'role': 'user', 'content': text},
    ], json_mode=True)
    try:
        data = json.loads(_extract_json(reply))
    except (ValueError, AttributeError):
        data = {}

    proposal = dict(
        partyKind=data.get('partyKind'), key=None,
        date=data.get('date'), debit=data.get('debit'), credit=data.get('credit'),
        description=data.get('description') or '', claimNo=data.get('claimNo'),
    )
    party_name = (data.get('partyName') or '').strip()
    kind, key = _match_party(db, party_name)
    if kind:
        proposal['partyKind'] = kind
        proposal['key'] = key
    return proposal


def _match_party(db: Session, name: str) -> tuple:
    if not name:
        return None, None
    norm = C._norm_ar(name)
    for s in db.query(models.Supplier).filter(models.Supplier.deleted_at.is_(None)).all():
        if norm and (norm in C._norm_ar(s.name) or C._norm_ar(s.name) in norm):
            return 'supplier', s.account
    for c in db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None)).all():
        if norm and (norm in C._norm_ar(c.name) or C._norm_ar(c.name) in norm):
            return 'contractor', c.code
    return None, None


# ================================================================== /what-if

def _trim_cf(cf: dict) -> dict:
    fd = cf['summary']['firstDeficit']
    return dict(
        firstDeficitDate=fd['from_'] if fd else None,
        minBalance=str(cf['summary']['minBalance']),
        buckets=[dict(date=p['from'], in_=str(p['inflow']), out=str(p['outflow']),
                     balance=str(p['balance'])) for p in cf['periods']],
    )


def what_if_shift(db: Session, party_kind: str, key: str, shift_days: int,
                  today: Optional[dt.date] = None) -> Optional[dict]:
    """يعيد حساب التدفق النقدي (14 يوماً) مرتين: كما هو، ثم مع إزاحة استحقاقات
    الطرف المحدد shiftDays يوماً — حساب Decimal كودي بالكامل، بلا أي تدخل من النموذج."""
    today = today or dt.date.today()

    if party_kind == 'supplier':
        ps = PS.positions(db, today=today, account=key)
        if not ps:
            return None
    elif party_kind == 'contractor':
        row = db.query(models.Contractor).filter_by(code=key).filter(
            models.Contractor.deleted_at.is_(None)).one_or_none()
        if row is None:
            return None
    else:
        return None

    recv_items, _ = CFS._receivable_items(db)
    pay_items_before = CFS._payable_items(db, today)

    # after: shift this supplier's due amounts by shiftDays (contractors carry no due
    # dates in the cashflow model, so a contractor shift is a no-op — reported as such).
    pay_items_after = list(pay_items_before)
    if party_kind == 'supplier':
        pay_items_after = []
        for p in PS.positions(db, today=today, include_empty=True):
            for inv in p.invoices:
                if inv.remaining > 0 and inv.due_date is not None:
                    d = inv.due_date
                    if p.supplier.account == key:
                        d = d + dt.timedelta(days=shift_days)
                    pay_items_after.append(CF.CashItem(date=d, amount=inv.remaining))

    periods_before = CF.build_periods(recv_items, pay_items_before, today, weeks=2)
    periods_after = CF.build_periods(recv_items, pay_items_after, today, weeks=2)

    def _to_json(periods):
        total_inflow = sum((p.inflow for p in periods), ZERO)
        summary = CF.summarise(periods, has_receivables=total_inflow > 0)
        fd = summary['first_deficit']
        return dict(
            asOf=today.isoformat(), openingBalance=0.0, periodDays=CF.PERIOD_DAYS,
            periods=[{'label': p.label, 'from': p.from_date.isoformat(), 'to': p.to_date.isoformat(),
                     'inflow': money(p.inflow), 'outflow': money(p.outflow), 'net': money(p.net),
                     'balance': money(p.balance), 'inflowCount': p.inflow_count,
                     'outflowCount': p.outflow_count, 'deficit': p.deficit} for p in periods],
            summary=dict(totalInflow=money(summary['total_inflow']),
                        totalOutflow=money(summary['total_outflow']),
                        netTotal=money(summary['net_total']), minBalance=money(summary['min_balance']),
                        firstDeficit=(dict(label=fd.label, from_=fd.from_date.isoformat(),
                                          to=fd.to_date.isoformat(), amount=money(fd.balance))
                                     if fd else None),
                        hasReceivables=summary['has_receivables']),
        )

    before = _to_json(periods_before)
    after = _to_json(periods_after)
    return dict(before=_trim_cf(before), after=_trim_cf(after))


def what_if_narrative(chat_fn, before: dict, after: dict, shift_days: int) -> str:
    """يصف الفرق بين before/after بالعربية اعتماداً حصراً على القيم المحسوبة كودياً."""
    reply = chat_fn([
        {'role': 'system', 'content':
            'اكتب فقرة عربية قصيرة تصف أثر تأجيل/تقديم استحقاقات هذا الطرف {} يوماً على '
            'التدفق النقدي، اعتماداً حصراً على قيم before/after المُعطاة أدناه دون '
            'اختراع أي رقم إضافي.'.format(shift_days)},
        {'role': 'user', 'content': json.dumps(dict(before=before, after=after), ensure_ascii=False)},
    ], json_mode=False)
    return (reply or '').strip()


# ================================================================== import classification

def suggest_account_kind(account: Optional[str], name: str, excerpt: str) -> Optional[Dict]:
    """اقتراح تصنيف حساب برقم بادئة غير معروفة (ليس 211/212/216) — استدعاء واحد رخيص
    للنموذج، اقتراح فقط لا قرار؛ المستخدم يقرر دائماً من واجهة التصنيف.

    يعيد None بصمت عند تعطيل الذكاء الاصطناعي أو فشل الاستدعاء أو ردّ غير صالح —
    لا يرفع أي استثناء أبداً، هذه الميزة لا يجوز أن تعطّل تدفق التصنيف اليدوي.
    """
    from app.services import ai_service
    try:
        if not ai_service.load_settings().get('enabled'):
            return None
        reply = ai_service.chat([
            {'role': 'system', 'content':
                'صنّف حساباً محاسبياً برقم بادئة غير معروفة إلى واحد فقط من: '
                'supplier (مورد) أو contractor (مقاول/متعامل) أو guarantee (ضمان) أو '
                'ignore (تجاهل). أعد JSON صارماً فقط بالشكل '
                '{"kind": "supplier|contractor|guarantee|ignore", '
                '"reason": "جملة عربية قصيرة"} بلا أي شرح خارج الـJSON.'},
            {'role': 'user', 'content':
                'رقم الحساب: {}\nالاسم كما ورد بالملف: {}\nمقتطف من نص الملف:\n{}'.format(
                    account or '?', name or '', (excerpt or '')[:2000])},
        ], json_mode=True)
        data = json.loads(_extract_json(reply))
        kind = data.get('kind')
        if kind not in ('supplier', 'contractor', 'guarantee', 'ignore'):
            return None
        return dict(kind=kind, reason=str(data.get('reason') or ''))
    except Exception:
        return None  # اقتراح أفضل-جهد فقط — أي عطل هنا لا يوقف التصنيف اليدوي


# ================================================================== /priorities

# وزن التأخر بالأيام ووزن المبلغ المتأخر ومكافأة الاستحقاق خلال 7 أيام — ثوابت كودية
W_OVERDUE_AMOUNT = Decimal('1')
W_AGE_DAY = Decimal('50')
BONUS_DUE_WITHIN_7 = Decimal('5000')


def build_priorities(db: Session, budget: Optional[Decimal] = None,
                     today: Optional[dt.date] = None) -> dict:
    """ترتيب مبني بالكامل على كود حتمي — لا قرار للنموذج في الترتيب أو الأرقام."""
    today = today or dt.date.today()
    items = []

    for p in PS.positions(db, today=today):
        for inv in p.invoices:
            if inv.remaining <= 0 or inv.due_date is None:
                continue
            age = (today - inv.due_date).days
            if age <= 0 and (inv.due_date - today).days > 7:
                continue  # not overdue and not due soon — not a priority
            score = W_OVERDUE_AMOUNT * inv.remaining + W_AGE_DAY * Decimal(max(age, 0))
            due_within_7 = 0 <= (inv.due_date - today).days <= 7
            if due_within_7:
                score += BONUS_DUE_WITHIN_7
            if age > 0:
                reason = 'متأخر {} يوماً — {:,.2f} ر.س'.format(age, float(inv.remaining))
            else:
                reason = 'يستحق خلال {} أيام — {:,.2f} ر.س'.format(
                    (inv.due_date - today).days, float(inv.remaining))
            items.append(dict(
                partyKind='supplier', key=p.supplier.account, name=p.supplier.name,
                amount=money(inv.remaining), score=float(score), reason=reason,
                link='#/suppliers/{}'.format(p.supplier.account)))

    for row in db.query(models.Contractor).filter(models.Contractor.deleted_at.is_(None)).all():
        detail = CS.contractor_detail_json(row, today)
        bal = D(detail['balance'])
        if bal < 0:
            score = W_OVERDUE_AMOUNT * abs(bal)
            items.append(dict(
                partyKind='contractor', key=row.code, name=row.name,
                amount=money(abs(bal)), score=float(score),
                reason='رصيد مستحق للمقاول — {:,.2f} ر.س'.format(float(abs(bal))),
                link='#/contractors/{}'.format(row.code)))

    items.sort(key=lambda x: (-x['score'], x['key']))
    items = items[:10]

    if budget is not None:
        cum = ZERO
        for it in items:
            amt = D(it['amount'])
            fits = (cum + amt) <= D(budget)
            it['fitsInBudget'] = fits
            if fits:
                cum += amt
        remaining = D(budget) - cum
        budget_info = dict(budget=money(budget), allocated=money(cum), remaining=money(remaining))
    else:
        budget_info = None

    return dict(items=items, budget=budget_info)


def priorities_narrative(chat_fn, result: dict) -> str:
    """شرح نثري عربي للقائمة المبنية كودياً بالكامل — لا رقم جديد من النموذج."""
    reply = chat_fn([
        {'role': 'system', 'content':
            'اكتب فقرة عربية موجزة تشرح قائمة الأولويات أدناه (مبنية مسبقاً بالكامل) '
            'دون اختراع أي رقم أو ترتيب جديد — فقط اشرح ما هو موجود.'},
        {'role': 'user', 'content': json.dumps(result, ensure_ascii=False)},
    ], json_mode=False)
    return (reply or '').strip()
