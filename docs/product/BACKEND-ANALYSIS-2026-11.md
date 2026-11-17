# تحليل الخادم — EGCO Dashboard (نوفمبر ٢٠٢٦)

> مراجعة قراءة فقط لـ`services/api/` بما فيها تغييرات v0.13.0 غير المُودَعة (النسخ الاحتياطي، تأخر المقاولين، البذر).
> القياس على قاعدة مصنوعة في scratchpad (٣٠٠ مورد × ٩٠ حركة = ٢٧ ألف صف، ٣٥٠ مقاولاً × ٨٠ قيداً = ٢٨ ألف صف) عبر `TestClient`، مع عدّاد استعلامات SQL على المحرّك.

## ١ · الملخص

- **الحساب سليم ومركزي في `domain/`** (Decimal، دوال نقية، مختبرة)، لكن **كل طلب يعيد حساب كل شيء من الصفر** عبر ORM بتحميل كسول. النتيجة: `/overview` يستغرق **١٢–١٦ ثانية و٤٬٢٩١ استعلاماً** على بيانات بحجم واقعي-كبير. هذا هو العائق الأول أمام «تطبيق حيّ».
- `PS.positions()` تُستدعى **٦ مرات في طلب `/overview` واحد** (مباشرة، `_coverage`، ثلاث مرات داخل `cashflow`، و`projects_service`) و`contractors_list_json` مرتين.
- **التخزين `Float`** في كل أعمدة المبالغ؛ Decimal يبدأ فقط عند القراءة عبر `D(str(float))`. صحيح عملياً اليوم لكنه هشّ، والقيود الفريدة تقارن floats.
- **لا سجل أحداث ولا لقطات** — `ImportLog` يسجّل عدّاداً لا «ماذا تغيّر». لا SSE/WebSocket؛ الواجهة تستطلع.
- **الهجرات يدوية** تعمل في كل إقلاع بلا رقم إصدار للمخطط.
- **٥٨٣ اختباراً ناجحاً في ٤:٣٣ دقيقة** — بطيئة لبوابة شحن، وجزء معتبر يعتمد على عيّنات حقيقية خارج المستودع.
- **الأمان المحلي معقول** (127.0.0.1، CORS ضيّق، حماية traversal في النسخ) لكن لا رمز مصادقة، والمسارات تقرأ أي ملف مطلق يُمرَّر لها.

### القياس (ثانية تشغيل، بعد الإحماء)

| المسار | الزمن | استعلامات SQL | الحجم |
|---|---:|---:|---:|
| `GET /overview` | **12,331ms** | **4,291** | 3KB |
| `GET /cashflow` | 3,942ms | 1,815 | 4KB |
| `GET /projects` | 3,579ms | 610 | 3KB |
| `GET /reports/priorities` | 3,380ms | 1,653 | 2KB |
| `GET /contractors/overview` | 2,374ms | 13 | 1KB |
| `GET /contractors` | 2,078ms | 6 | 159KB |
| `GET /suppliers` | 1,967ms | 1,505 | 224KB |
| `GET /dashboard` | 1,839ms | 602 | **1.2MB** |
| `GET /reports/analysis` | 1,341ms | 602 | **1.1MB** |
| `GET /coverage` | 1,255ms | 602 | 57KB |
| `GET /contractors/claims-due` | 607ms | 2 | 88KB |
| `GET /suppliers/{account}` | 11ms | 6 | 17KB |

ملفّ التشخيص لـ`overview()`: ٨٫٠ ث من ١٢٫١ داخل ٦ استدعاءات لـ`payables_service.positions` (`payables_service.py:96`)، ٣٫٩ ث في `cashflow_service.cashflow` (`:634`)، ٢٫٨ ث في استدعاءين لـ`contractors_list_json`. المقاولون بطيئون رغم ٦ استعلامات فقط — الكلفة في Python (بناء ٢٨ ألف كائن ORM ثم `D()` ١٤٦ ألف مرة).

### الحجم والبنية

أكبر الملفات (أسطر): `services/import_service.py` 1718 · `services/export_service.py` 1250 · `services/contractors_service.py` 777 · `services/cashflow_service.py` 747 · `services/ai_features_service.py` 738 · `services/ai_service.py` 703 · `services/budget_service.py` 588 · `domain/payables.py` 539 · `api/routes/contractors.py` 533 · `api/routes/suppliers.py` 488 · `api/routes/ai.py` 462 · `db/session.py` 457 · `api/routes/imports.py` 453 · `db/models.py` 446 · `services/payables_service.py` 321.

أطول الدوال: `import_service.batch_import` (180 سطراً، `:1538`) · `report_service.build` (166، `:42`) · `import_service.commit_statement` (165، `:1155`) · `export_service.build_budget_export_workbook` (144) · `contractors_service.contractors_list_json` (137، `:408`) · **`routes/suppliers.list_suppliers` (137، `:73`)** · `overview_service.overview` (125، `:184`) · `payables.allocate_smart` (123) · `import_service.commit_contractors_balance` (121) · `cashflow_service.cashflow` (113) · `routes/revenues.list_revenues` (98، `:60`).

الطبقات: `ingest/` (محلّلات ملفات، نقية تقريباً) → `domain/` (حساب Decimal نقي — **الطبقة الأفضل**) → `services/` (تجميع + ORM) → `api/routes/`. **الانكسارات:** ١١ ملف routes من ١٩ يستعلم ORM مباشرة (١٠٦ موضع `db.query`/`db.commit` في routes)، و`list_suppliers` و`list_revenues` يحويان منطق تصفية/ترتيب/إجماليات كاملاً؛ `routes/dashboard.py:26` (`/day`) يبني جدول السداد بنفسه؛ `routes/trash.py:58` يقرأ الجداول مباشرة. `testing_seed.py` يستدعي دوال المسارات — مقبول كقرار (نفس مسار الإدخال) لكنه يؤكد أن المنطق يعيش في routes.

---

## ٢ · أهم ١٢ مشكلة (مرتّبة بالأثر)

### ١. إعادة الحساب الكامل المتكرر داخل الطلب الواحد — `/overview` ١٢ ث · جهد M
**الدليل:** `overview_service.py:186` و`:51` (`_coverage`) يستدعيان `PS.positions` كلٌّ على حدة؛ `cashflow_service.py:161,180,345` ثلاث مرات أخرى؛ `projects_service.py:43` مرة سادسة و`:85` يعيد `contractors_list_json` كاملاً فقط ليأخذ `totals.byProject`، و`overview_service.py:79` يستدعيه مرة ثانية.
**الإصلاح:** كائن «لقطة طلب» `Snapshot(db, today)` بـ`functools.cached_property` لـ`positions`, `contractor_rows`, `cashflow` يُمرَّر للخدمات بدل `db`. لا يغيّر أي حساب — فقط يمنع تكراره. متوقّع: ÷٥ على overview.

### ٢. N+1 في `positions()` — ١٥٠٠–٤٣٠٠ استعلام · جهد S
**الدليل:** `payables_service.py:113-127`: `row.invoices`/`row.payments` علاقتان كسولتان (`models.py:72-73` بلا `lazy=`)، و`_load_decisions` استعلام لكل مورد. ٣٠٠ مورد = ٦٠٢ استعلام لكل استدعاء.
**الإصلاح:** `q.options(selectinload(Supplier.invoices), selectinload(Supplier.payments))` + تحميل `PaymentAllocation` دفعة واحدة `IN (...)` وتوزيعه في dict. ٣ استعلامات بدل ٦٠٢. نفس الشيء لـ`Contractor.entries/claims/guarantees` (`models.py:182-184`).

### ٣. أعمدة المبالغ `Float` · جهد L (مرحلي)
**الدليل:** `models.py:90,114,134,200-201,233-238,255,354,366-367,432` وكل أعمدة الموازنة `:277-287`. التحويل `D()` يمرّ عبر `str(float)` (`payables.py:25-31`) فيُنقذ القيم ذات منزلتين — لكن: (أ) أي قيمة محسوبة تُخزَّن (`ContractorClaim.net_due`, `retention_amount`, `GuaranteeAccount.balance`) تُخزَّن float بعد حساب؛ (ب) **القيود الفريدة على float** (`uq_invoice_identity`, `uq_payment_identity`, `uq_contractor_entry_identity` تتضمن `amount`/`debit`/`credit`) — مطابقة إعادة الاستيراد تعتمد على تساوي floats، و`import_service.py:975,1286` يبحث بـ`amount=` حرفياً؛ (ج) SQLite `SUM()` على هذه الأعمدة — إن استُعمل يوماً — يعطي float.
**الإصلاح:** `TypeDecorator` باسم `Money` يخزّن **TEXT أو INTEGER هللات** ويعيد `Decimal`، مع هجرة نسخ-وتحقّق (انظر المرحلة ٣). لا تُلمس قبل وجود Alembic واختبار مساواة على نسخة بيانات حقيقية.

### ٤. لا طبقة أحداث/تغيير — الرؤية الجديدة بلا أساس · جهد M
**الدليل:** لا جدول أحداث؛ `ImportLog` (`models.py:437`) يحفظ `imported/skipped/issues` فقط؛ لا قيم قبل/بعد؛ تنبيهات `overview_service.py:219-282` تُبنى نصاً عند الطلب ولا تُخزَّن فلا يُعرف «جديد» من «قديم». لا SSE/WebSocket في أي مسار (`StreamingResponse` يُستعمل فقط لتنزيل xlsx).
**الإصلاح:** القسم ٣ أدناه.

### ٥. تقريب مزدوج وجمع floats مقرّبة · جهد S
**الدليل:** `routes/dashboard.py:69-70` — `money(sum((i['amount'] for i in suppliers), 0.0))` يجمع قيماً خرجت سلفاً من `money()` (floats) — نفس النمط الذي يحذّر منه CLAUDE.md §٢. `import_service.py:419-420` `round(float(...),2)` بدل `money()`. `report_service.py:135` `outstanding_f = float(outstanding)` ثم يُستعمل في مقارنات. `periods_service.py:116,127` `float(sum(...))`.
**الإصلاح:** التجميع على Decimal قبل `money()` دائماً؛ قاعدة lint بسيطة (grep في الاختبارات) تمنع `sum(` على قيم مسلسلة و`round(float(`.

### ٦. «المديونية حسب المشروع» محسوبة في ٤ أماكن · جهد M
**الدليل:** `contractors_service._by_project_breakdown` (`:542`)، `contractors_service._by_project_debt` (`:769`)، `export_service._contractor_project_balances` (`:429,803`)، `contractor_report_service.entries_by_project` (`routes/reports.py:126`)؛ وللموردين `projects_service.list_projects` و`export_service._project_totals` (`:396`). كل نسخة تُبنى بتصفية مختلفة قليلاً (party_projects مقابل `entry.project`) — مصدر «شاشتين تتناقضان».
**الإصلاح:** دالة واحدة في `domain/` (`project_balances(rows) -> Dict[str, Decimal]`) واختبار هوية: مجموع كل نسخة = الإجمالي.

### ٧. دوال ضخمة في الاستيراد · جهد M
**الدليل:** `import_service.py` ١٧١٨ سطراً؛ `batch_import` ١٨٠، `commit_statement` ١٦٥، `commit_contractors_balance` ١٢١، `commit_debts_report` ٩٨ — كلٌّ يخلط: تحليل، مطابقة هوية، إحياء المحذوف منطقياً، تصنيف البادئة، كتابة ImportLog.
**الإصلاح:** استخراج `upsert_ledger_rows(model, identity_cols, rows, import_log_id)` مشترك + نقطة خطاف واحدة `after_commit(import_log)` (هي ما سيولّد الأحداث). يُقسَّم الملف إلى `imports/{suppliers,contractors,debts,budget,receivables}.py`.

### ٨. منطق أعمال في routes · جهد M
**الدليل:** `routes/suppliers.py:73-210` (`list_suppliers` ١٣٧ سطراً: تصفية+ترتيب+إجماليات)، `routes/revenues.py:60` (٩٨)، `routes/dashboard.py:26-70` (`/day` يحسب جداول السداد ويجمع)، `routes/trash.py:58+`. ١٠٦ موضع ORM في routes.
**الإصلاح:** نقلها إلى `services/` كما هي حرفياً (اختبارات المسار تبقى ثابتة)، ثم routes = تحقق مدخلات + استدعاء + تسلسل.

### ٩. الهجرات اليدوية في كل إقلاع · جهد M
**الدليل:** `session.py:113-182` — ١٤ `_migrate_add_column` + `_rebuild_identity_constraints` (إعادة بناء جداول بإعادة تسمية، `:30-80`) + ٤ هجرات بيانات تفحص علَم `AppSetting`. لا `schema_version`؛ `PRAGMA table_info` لكل عمود في كل إقلاع؛ `_rebuild_identity_constraints` يعيد بناء جداول مالية بـSQL نصّي مركّب بـf-string. `_backup_before_migrations` (`:83`) موجود — جيد — لكن فشل منتصف إعادة البناء خارج معاملة واحدة شاملة لكل الخطوات (هجرات البيانات بعد `engine.begin()` في معاملات منفصلة `:179-182`). لا `PRAGMA foreign_keys=ON` ولا `journal_mode=WAL` (`session.py:18`).
**الإصلاح:** Alembic مع `render_as_batch=True` (لـSQLite)، مراجعة أساس `baseline` تطابق المخطط الحالي (`stamp` للقواعد القائمة)، وتحويل الهجرات اليدوية إلى مراجعات متسلسلة. WAL ضروري قبل SSE (قارئ دائم + كاتب).

### ١٠. لا فهارس على أنماط الاستعلام الفعلية · جهد S
**الدليل:** لا فهرس على `deleted_at` في أي جدول، ولا على `invoices.date`/`payments.date`/`contractor_entries.date`، ولا مركّب `(contractor_id, deleted_at)`. `PartyProject` مفهرس جيداً. الأثر اليوم أصغر من N+1 لكنه يظهر بعد إصلاح #٢.
**الإصلاح:** `Index('ix_inv_sup_del', 'supplier_id', 'deleted_at')` وما يماثله للمدفوعات والقيود، و`(date)` لاستعلامات التقويم/التدفق.

### ١١. السويّة بطيئة وتعتمد على عيّنات خارجية · جهد M
**الدليل:** `583 passed in 273.51s` (٤:٣٣). `conftest.py` يتخطّى ما ليس موجوداً من `design/samples/*` و`~/Downloads/*` إلا بـ`EGCO_REQUIRE_SAMPLES=1` — فـCI أخضر لا يعني تغطية الاستيراد الحقيقي. **غير مغطى:** الأداء (لا اختبار عدد استعلامات)، الهجرات على قاعدة قديمة فعلية (عدا `test_migrate_211`, `test_import_log_backfill`)، التزامن، مسارات الأمان (path input)، اتساق «حسب المشروع» عبر الخدمات الأربع. **مغطى جيداً:** domain للمديونية/التخصيص/التأخر، الإشارة، البادئات، التكرار القريب، المهملات، النسخ الاحتياطي.
**الإصلاح:** fixture قاعدة بذرة على مستوى الجلسة (`scope='session'` + نسخ ملف SQLite لكل اختبار بدل إعادة `init_db`)، `pytest-xdist -n auto`، واختبار `assert_max_queries(n)` لأهم ٥ مسارات.

### ١٢. الأمان المحلي: لا مصادقة + قراءة ملفات بمسار حرّ · جهد S
**الدليل:** الخادم على `127.0.0.1` (`run_api.py:16`) وCORS `['http://localhost:5173']` (`main.py:43`) — لكن **أي عملية محلية** (أو صفحة ويب تصل عبر طلبات «بسيطة»/DNS-rebinding بلا فحص Host) تستطيع: قراءة أي ملف عبر `routes/imports.py:62-87` و`routes/ai.py:95` (`Path(body.path)` بلا قيد على المجلد)، تغيير `baseUrl` لمزوّد AI (`routes/ai.py:61`) فتُرسَل بيانات مالية لعنوان آخر، تغيير مجلد النسخ الخارجي (`routes/backups.py:58`). مفتاح AI مخزَّن نصاً في `DATA_DIR/ai-settings.json` (`ai_service.py:112,140`) — مُقنَّع في الاستجابة (`routes/ai.py:58`) وهذا جيد. حماية traversal في حذف النسخ سليمة (`backup_service.py:256-258`).
**الإصلاح:** رمز سرّي عشوائي يولّده Electron عند الإقلاع ويمرّره بالبيئة، يُطلب في ترويسة `X-EGCO-Token` (middleware واحد)؛ `TrustedHostMiddleware(['127.0.0.1','localhost'])`؛ مفتاح AI في Keychain عبر `safeStorage` في Electron.

---

## ٣ · تصميم طبقة الأحداث والإشعارات ومسار «اليوم»

### ٣.١ جدول `events`

```sql
CREATE TABLE events (
  id            TEXT PRIMARY KEY,          -- uuid
  seq           INTEGER NOT NULL UNIQUE,   -- تسلسل أحادي للـSSE (Last-Event-ID)
  created_at    DATETIME NOT NULL,
  kind          VARCHAR(40) NOT NULL,      -- انظر الأنواع
  severity      VARCHAR(10) NOT NULL,      -- info | warning | danger | success
  entity_type   VARCHAR(20),               -- supplier | contractor | project | receivable | guarantee | import | system
  entity_key    VARCHAR(60),               -- account/code/project — ما تحتاجه الواجهة للربط
  title         TEXT NOT NULL,             -- نص عربي جاهز
  before_json   TEXT,                      -- {"outstanding":"125000.00", ...} — Decimal كنص
  after_json    TEXT,
  delta         TEXT,                      -- Decimal كنص، اختياري
  source        VARCHAR(20) NOT NULL,      -- import | boot | daily | manual
  import_log_id TEXT,                      -- ربط بالاستيراد المولِّد
  dedupe_key    VARCHAR(120),              -- مثل 'overdue_crossed:2110001:2026-11-17'
  read_at       DATETIME,
  dismissed_at  DATETIME,
  deleted_at    DATETIME                   -- اتساقاً مع الحذف المنطقي
);
CREATE INDEX ix_events_unread ON events(read_at, seq);
CREATE UNIQUE INDEX ux_events_dedupe ON events(dedupe_key) WHERE dedupe_key IS NOT NULL;
```

ومعه جدول `party_snapshots(taken_at, source, import_log_id, party_type, party_key, outstanding, overdue, due_within_7, last_movement)` — **صف لكل طرف لكل لقطة** (المبالغ TEXT Decimal). المولّد يقارن آخر لقطتين؛ لا يُعاد الحساب من الحركات لمعرفة «ماذا تغيّر».

### ٣.٢ أنواع الأحداث (البداية)

| kind | severity | المولِّد | المعنى |
|---|---|---|---|
| `import_committed` | success | import | استيراد اكتمل: n صف، طرف، فرق الرصيد |
| `balance_changed` | info | import | رصيد طرف تغيّر (قبل/بعد/الفرق) |
| `reconcile_mismatch` | warning | import | الرصيد المحسوب ≠ المطبوع في الكشف |
| `overdue_crossed` | danger | daily/boot | فاتورة/مستخلص عبرت تاريخ الاستحقاق اليوم |
| `due_soon` | info | daily | استحقاق خلال ٧ أيام (مرة لكل بند) |
| `bucket_escalated` | warning | daily | بند انتقل من شريحة 31–60 إلى 61–90 مثلاً |
| `cash_deficit_new` / `cash_deficit_resolved` | danger / success | import, daily | ظهور/زوال عجز متوقع |
| `guarantee_release_due` | info | daily | ضمان يحين إطلاقه |
| `stale_party` | warning | daily | طرف بلا حركة > ٩٠ يوماً (مرة واحدة) |
| `needs_term` | warning | import | طرف أُنشئ بلا مدة سداد |
| `backup_failed` / `backup_taken` | danger / info | boot, daily | حالة النسخ الاحتياطي |

قاعدة CLAUDE.md «لا تخترع رقماً» تنطبق: لا حدث تأخر لمقاول بلا `payment_term_days`.

### ٣.٣ المولّد

- `services/events_service.py`: `take_snapshot(db, source, import_log_id)` ثم `diff_and_emit(prev, cur)`؛ يعمل بـ`Snapshot` من المشكلة #١ (حساب واحد).
- **نقاط التشغيل:** (أ) خطاف `after_commit(import_log)` في الاستيراد (المشكلة #٧)؛ (ب) في `lifespan` بعد `init_db` (`main.py:17`) — يلحق ما فات منذ آخر تشغيل؛ (ج) مهمة يومية: `asyncio` task في `lifespan` تستيقظ عند منتصف الليل المحلي (التطبيق قد يبقى مفتوحاً أياماً). كلها idempotent عبر `dedupe_key`.
- بعد الإدراج: `broker.publish(event)` — طابور `asyncio.Queue` لكل مشترك في الذاكرة (عملية واحدة، لا حاجة لـRedis).

### ٣.٤ SSE: `GET /api/v1/events/stream`

```
event: event
id: 1842
data: {"id":"…","seq":1842,"kind":"balance_changed","severity":"info",
       "entity":{"type":"supplier","key":"2110001","name":"شركة الحديد الموحدة"},
       "title":"ارتفع رصيد شركة الحديد الموحدة بـ 50,000.00 ر.س",
       "before":{"outstanding":"120000.00"},"after":{"outstanding":"170000.00"},
       "delta":"50000.00","createdAt":"2026-11-17T09:12:03","read":false}

event: invalidate
data: {"scopes":["overview","suppliers","cashflow"]}

: keepalive
```
- يدعم `Last-Event-ID` → يعيد ما بعد `seq` من الجدول ثم يتابع حيّاً.
- حدث `invalidate` يخبر الواجهة أي استعلامات (React Query keys) تُبطَل — يُغني عن الاستطلاع.
- keepalive كل ١٥ ث. يتطلب WAL (المشكلة #٩) حتى لا يحجب القارئ الكاتب.
- مسارات مرافقة: `GET /events?unread=1&limit=50`، `POST /events/read {ids|upTo}`، `POST /events/{id}/dismiss`.

### ٣.٥ المسار الموحّد `GET /api/v1/today`

يستبدل ٥–٧ طلبات للصفحة الرئيسية بطلب واحد مبني على `Snapshot` واحد (هدف: < ٥٠٠ms على القاعدة المقيسة):

```json
{
  "asOf": "2026-11-17",
  "generatedAt": "2026-11-17T09:12:05",
  "lastEventSeq": 1842,
  "kpis": {
    "suppliersOutstanding": "1250000.00", "suppliersOverdue": "310000.00",
    "contractorsOwed": "870000.00", "contractorsOverdue": "95000.00",
    "dueWithin7": "120000.00", "guaranteesHeld": "400000.00"
  },
  "sinceLastVisit": {
    "since": "2026-11-15T18:00:00",
    "events": [ /* أحدث الأحداث غير المقروءة، بشكل SSE نفسه */ ],
    "kpiDelta": { "suppliersOutstanding": "50000.00", "suppliersOverdue": "-12000.00" }
  },
  "dueToday": [ {"type":"invoice","partyKey":"2110001","amount":"30000.00","dueDate":"2026-11-17"} ],
  "dueThisWeek": [ ],
  "cash": { "nextDeficit": null, "minBalance": "…", "hasReceivables": false },
  "alerts": [ /* نفس alerts الحالية + kind ثابت لكل واحد */ ],
  "coverage": { /* coverageSummary الحالي حرفياً */ },
  "topProjects": [ ]
}
```
- **المبالغ كنص Decimal** في المسارات الجديدة (لا float عبر JSON). الواجهة تنسّق فقط.
- `kpiDelta` = الفرق بين اللقطة الحالية وأقرب لقطة قبل `since` (يُمرَّر `?since=` أو يُحفظ آخر زيارة في `app_settings`).
- يبقى `/overview` كما هو حتى تنتقل الواجهة (لا كسر).

---

## ٤ · خطة إعادة الهيكلة على مراحل (لا تكسر الأرقام)

**البوابة لكل مرحلة:** اختبار «أرقام ذهبية» جديد يُكتب **أولاً**: يشغّل `overview`, `contractors_list_json`, `cashflow`, `projects`, `reports/analysis` على قاعدة البذر (`testing_seed`) وعلى نسخة حقيقية محلية (بـ`EGCO_REQUIRE_SAMPLES`) ويحفظ JSON المخرج؛ كل مرحلة يجب أن تُخرج **نفس JSON بايتاً ببايت**.

| المرحلة | المحتوى | الجهد | الخطر على الأرقام |
|---|---|---|---|
| ٠ | اختبار الأرقام الذهبية + `assert_max_queries` + fixture قاعدة مشتركة + xdist | S | لا شيء |
| ١ | `selectinload` في `positions` والمقاولين؛ تحميل القرارات دفعة واحدة؛ فهارس | S | منعدم (نفس البيانات) |
| ٢ | `Snapshot` لكل طلب يُمرَّر للخدمات؛ إزالة الاستدعاءات المكررة | M | منخفض |
| ٣ | Alembic + baseline + WAL + foreign_keys | M | منخفض (نسخة قبل الهجرة موجودة) |
| ٤ | جداول `events` و`party_snapshots`، المولّد، SSE، `/today` | M | لا شيء (إضافي) |
| ٥ | توحيد «حسب المشروع» في domain؛ نقل منطق routes إلى services؛ تقسيم `import_service` | M–L | متوسط — الأرقام الذهبية تحرسه |
| ٦ | `Money` TypeDecorator → تخزين نصي/هللات؛ هجرة تنسخ الجدول وتتحقق `SUM` قبل/بعد لكل طرف وترفض عند أي فرق | L | عالٍ — آخر مرحلة، على نسخة حقيقية أولاً |
| ٧ | رمز المصادقة المحلي + TrustedHost + safeStorage للمفتاح | S | لا شيء |

المرحلة ٧ مستقلة ويمكن تقديمها في أي وقت.

---

## ٥ · ما يجب ألا يُلمس

- **`app/domain/`** (`payables.py`, `contractors.py`, `cashflow.py`, `periods.py`): دوال نقية مختبرة على كشوف حقيقية — تُستدعى ولا يُعاد كتابتها. خصوصاً `D()`/`money()`، `allocate_smart`، `compute_contractor_delay`، `DELAY_BUCKETS`.
- **اصطلاح الإشارة** في القيود (`ContractorEntry`: balance = Σdebit − Σcredit، موجب = يدينون لنا) و**قاعدة البادئة** ٢١١/٢١٢/٢١٦ و`_migrate_211_contractors_to_suppliers`.
- **أعمدة الهوية الفريدة** (`uq_*_identity`) — تعكس حالات حقيقية موثّقة (فاتورتان بنفس الرقم ومستندين مختلفين). أي تغيير فيها يكسر إعادة الاستيراد.
- **فصل `reported_balance` عن الرصيد المشتق** (`models.py:165-170`) — مرجع لا مصدر حقيقة؛ لا يُدمج.
- **`payment_term_days = NULL` يعني «غير محدد» لا صفراً** — لا افتراض عام.
- **محلّلات `ingest/`** — مضبوطة على تخطيطات ملفات حقيقية (Persian heh، النص الملتصق، بادئة الفرع). تُغلَّف ولا تُعاد كتابتها.
- **`_backup_before_migrations`** و`backup_service` (VACUUM INTO، حماية traversal) — يبقيان قبل أي هجرة بما فيها Alembic.
- **نصوص التنبيهات العربية** في `overview_service.py` (تمييز العدد، التواريخ العربية، الإفصاح عن الناقص) — تُنقل كما هي إلى مولّد الأحداث.
