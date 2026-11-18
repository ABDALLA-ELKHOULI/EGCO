# API-CONTRACT — الموجة ٠ (الخادم B)

> المرجع الوحيد لكل مسار جديد/معدَّل في `services/api` لهذه الموجة. وكلاء الواجهة يكتبون
> ضدّه حرفياً. أي مسار غير مذكور هنا **لم يتغيّر شكله** (والأرقام الذهبية تحرس قيمه).
> البادئة لكل المسارات: `http://127.0.0.1:<port>/api/v1`.

## ٠ · قواعد عامة

| القاعدة | التفصيل |
|---|---|
| **المبالغ في الحقول الجديدة نصوص Decimal** | `"125000.50"` — دائماً منزلتان، بلا فواصل. الواجهة تنسّق فقط (لا جمع على float). الحقول **القديمة** تبقى أرقاماً كما كانت. |
| **`null` يعني «غير معروف»** | لا يُستبدل بصفر أبداً. مبلغ إسناد غير مُدخل = `null`، هامش بلا قيمة عقد = `null`، تأخر مقاول بلا مدة = `null`. |
| **معرّف الطرف** | `partyId` = **رقم الحساب** للمورد (`account`، مثل `"2110001"`) و**الكود** للمقاول (`code`، مثل `"2120001"`) — نفس المفتاح الذي تستعمله `/suppliers/{account}` و`/contractors/{code}`. |
| **معرّف المشروع** | `projectId` = uuid ثابت من سجل المشاريع (`project_registry`). كل مسار `/projects/{id}` يقبل **المعرّف أو الاسم** (توافق رجعي). الاسم قد يتغيّر بالدمج؛ المعرّف لا. |
| **التواريخ** | `YYYY-MM-DD` للأيام، ISO كامل (`2026-11-17T09:12:03`) للطوابع، بالتوقيت المحلي. |
| **الأخطاء** | `{"detail": "نص عربي"}` مع 404/409/422 كما في بقية المسارات. |
| **`link` / `action`** | `{view, params}` — `view` من: `today, suppliers, supplier, contractors, contractor, projects, project, cash, collections, guarantees, calendar, reports, import, settings, trash`. `params.id` = partyId / projectId / معرّف السجل. |

---

## ١ · الأحداث والإشعارات

### نموذج الحدث (Event)

```json
{
  "id": 42,
  "at": "2026-11-17T09:12:03",
  "kind": "overdue_new",
  "severity": "danger",
  "title": "فاتورة متأخرة جديدة — شركة الحديد الموحدة",
  "detail": "F-1002 · 50,000.00 ر.س · تأخرت ٣ أيام",
  "link": {"view": "supplier", "params": {"id": "2110001"}},
  "read": false,
  "archived": false
}
```

- `id` عدد صحيح متزايد (يُستعمل كـ`Last-Event-ID`).
- `severity`: `danger | warn | ok | info`.
- `kind` (القائمة مغلقة؛ الواجهة تتجاهل ما لا تعرفه):

| kind | severity | متى | dedupe |
|---|---|---|---|
| `overdue_new` | danger | فاتورة مورد عبرت تاريخ استحقاقها (مرة لكل فاتورة) | `overdue:<invoiceId>` |
| `claim_overdue` | danger | مستخلص مقاول (له مدة سداد) تأخر (مرة لكل مستخلص) | `claim_overdue:<code>:<doc/claimNo>:<dueDate>` |
| `guarantee_due` | warn | ضمان يحين فكّه خلال ≤٧ أيام أو حان (مرة لكل ضمان/تاريخ) | `guarantee:<guaranteeId>:<releaseDue>` |
| `cash_deficit` | danger | أول يوم سالب في إسقاط ٣٠ يوماً (مرة لكل تاريخ) | `deficit:<date>` |
| `stale_statement` | warn | آخر حركة لمورد/مقاول > ٦٠ يوماً (مرة لكل طرف/شهر) | `stale:<type>:<id>:<YYYY-MM>` |
| `import_done` | ok | اكتمل رفع ملف | — |
| `import_failed` | danger | فشل رفع ملف | — |
| `backup_done` | ok | نسخة احتياطية (يدوية/يومية) | `backup:<name>` |
| `backup_failed` | danger | فشل نسخة | — |
| `update_available` | info | يُرسله Electron | `update:<version>` |

المولّد يعمل: عند الإقلاع · بعد كل رفع (نجح/فشل) · بعد كل نسخة · وعند الطلب (`POST /events/generate`).
`dedupe_key` يمنع التكرار: نفس الحدث لا يُنشأ مرتين ولو أُعيد التوليد ألف مرة.

**التجميع:** أول توليد لقاعدة (لا أحداث مولَّدة سابقاً) يُنشئ **حدثاً ملخّصاً واحداً لكل نوع** بدل حدث لكل بند،
مثل `«١٥٩ فاتورة متأخرة لدى ١٤ مورداً — 5,785,058.35 ر.س»`؛ وبعده حدث لكل انتقال **جديد** فقط، ويُلخَّص
إن تجاوز الجديد ٥ في دفعة واحدة (مع لاحقة السياق، مثل «… بعد استيراد كشف.pdf»). البنود المُلخَّصة لا تعود فرادى.
روابط الملخّص (قوائم مصفّاة): `overdue_new` → `{view:"suppliers",params:{filter:"overdue"}}` ·
`claim_overdue` → `{view:"contractors",params:{filter:"overdue"}}` · `guarantee_due` → `{view:"guarantees",params:{filter:"due7"}}` ·
`stale_statement` → `{view:"import",params:{filter:"stale"}}`. `cash_deficit` لا يُلخَّص (حدث واحد أصلاً).

### المسارات

| المسار | الوصف |
|---|---|
| `GET /events?status=unread\|all&limit=50` | الأحدث أولاً. `unread` = غير مقروء وغير مؤرشف. `all` = غير المؤرشف كله. `limit` ١–٥٠٠ (افتراضي ٥٠). يعيد **مصفوفة** Event. |
| `GET /events/unread-count` | `{"count": 7}` |
| `POST /events/{id}/read` | يعيد Event بعد التعديل. 404 إن لم يوجد. |
| `POST /events/read-all` | `{"updated": 12}` |
| `POST /events/{id}/archive` | يعيد Event (`archived: true`، ويُعلَّم مقروءاً). |
| `POST /events/generate` | يشغّل المولّد الآن → `{"created": 3}` |
| `POST /events/external` | من Electron: `{"kind":"update_available","title":"...","detail":"...","version":"1.0.1"}` → Event (أو الحدث القائم إن تكرّر). `kind` المسموح هنا: `update_available` فقط. |
| `GET /events/stream` | SSE — انظر أدناه. |

### SSE — `GET /events/stream`

```
retry: 3000

id: 42
event: notification
data: {"id":42,"at":"…","kind":"overdue_new",…}

event: invalidate
data: {"keys":["suppliers","overview","today","projects","cash","calendar","reports"]}

event: progress
data: {"kind":"import","pct":40,"file":"كشف-2110001.pdf"}

: heartbeat
```

- **heartbeat** تعليق `: heartbeat` كل ٢٠ ثانية.
- **Last-Event-ID**: عند إعادة الاتصال (ترويسة `Last-Event-ID` أو `?lastEventId=`) تُعاد كل أحداث `notification` ذات `id` أكبر (حتى ٢٠٠) قبل البث الحيّ.
- `invalidate` لا يحمل `id` (عابر). يُرسل بعد **كل** طلب كتابة ناجح (POST/PUT/PATCH/DELETE بحالة < 400) — عدا مسارات القراءة بـPOST (معاينة، مسح، تصنيف، أسئلة الذكاء) ومسارات `/events/*` نفسها.
- `progress` عابر؛ `pct` ٠–١٠٠، `file` اسم الملف فقط (لا المسار). يُرسل للرفع المفرد (٠ ثم ١٠٠) وللدفعة (لكل ملف) وللنسخ.

**مفاتيح `invalidate`** (تطابق مفاتيح TanStack Query في الواجهة):

| بادئة المسار المكتوب | keys |
|---|---|
| `/suppliers`, `/manual`, `/invoices` | `suppliers, overview, today, projects, cash, calendar, reports, coverage` |
| `/contractors` | `contractors, overview, today, projects, cash, calendar, reports, guarantees` |
| `/import` | `suppliers, contractors, overview, today, projects, cash, calendar, reports, coverage, imports, guarantees, revenues, budget` |
| `/revenues` | `revenues, cash, overview, today, projects` |
| `/budget` | `budget, projects, today` |
| `/projects`, `/project-admin` | `projects, suppliers, contractors, today, overview` |
| `/trash` | كل المفاتيح أعلاه + `trash` |
| `/reset` | `*` (أبطل كل شيء) |
| `/backups` | `backups` |
| `/settings` | `settings, cash, today, overview` |
| `/cashflow` | `cash` |
| `/ai` | `ai` |

---

## ٢ · `GET /today` — الصفحة الرئيسية بطلب واحد

```json
{
  "generatedAt": "2026-11-17T09:12:05",
  "asOf": "2026-11-17",
  "lastEventId": 42,
  "kpis": {
    "supplierOpen": "245000.50",
    "supplierOverdue": "155000.50",
    "supplierDue7": "0.00",
    "contractorOwed": "350000.00",
    "contractorOverdue": "150000.00",
    "withTerm": 1,
    "withoutTerm": 2,
    "bankBalance": null,
    "bankBalanceAt": null,
    "cashLow": "-245000.50",
    "cashLowDate": "2026-11-17",
    "firstDeficitDate": "2026-11-17"
  },
  "tasks": [
    {"id": "overdue:supplier:2110002", "severity": "danger",
     "title": "سداد متأخر — مصنع الخرسانة الجاهزة",
     "detail": "متأخر ٣٤٠ يوماً", "amount": "75000.50",
     "action": {"label": "افتح المورد", "view": "supplier", "params": {"id": "2110002"}}}
  ],
  "lastChange": {
    "at": "2026-11-17T08:59:00",
    "file": "كشف-2110001.pdf",
    "before": {"supplierOpen": "195000.50", "supplierOverdue": "…", "supplierDue7": "…",
               "contractorOwed": "…", "contractorOverdue": "…", "invoiceCount": 5, "openInvoiceCount": 4},
    "after":  {"…": "نفس المفاتيح"},
    "newInvoices": 1,
    "paidInvoices": 0
  },
  "staleness": {
    "newestInvoiceDays": 10,
    "newestInvoiceDate": "2026-11-07",
    "coverage": [
      {"partyType": "supplier", "partyId": "2110002", "name": "مصنع الخرسانة الجاهزة",
       "lastActivity": "2025-10-13", "lastActivityDays": 400,
       "lastImportAt": null, "file": null, "stale": true}
    ]
  },
  "quality": [
    {"severity": "warn", "text": "موردان بلا مدة سداد — لا يُحسب لها تأخّر حتى تُحدَّد", "view": "suppliers"}
  ],
  "projects": [
    {"id": "6c1f…", "name": "السدن", "budgetDelayPct": 0.1596,
     "contractValue": null, "executed": "190000.00", "margin": null}
  ],
  "aging": {"d0_30": "50000.00", "d31_60": "0.00", "d61_90": "0.00", "d90p": "195000.50"},
  "cash30": [{"date": "2026-11-17", "balance": "-155000.50"}, "… ٣٠ عنصراً"],
  "cashBasis": "no_bank_balance"
}
```

- **مصادر الأرقام** (لا حساب جديد): `supplier*` = نفس `/overview.payables`؛ `contractor*` و`withTerm/withoutTerm` = نفس `/overview.contractors` (`owedToContractors`, `overdue`).
- `aging` = المتبقي على فواتير الموردين المفتوحة حسب **عمر الفاتورة من تاريخها** (تعريف النموذج).
- `cash30` = ٣٠ يوماً تبدأ اليوم. رصيد اليوم = `bankBalance` (أو صفر إن لم يُدخل — `cashBasis: "no_bank_balance"`)، ناقص المتأخر الآن كله (فواتير موردين مفتوحة بتاريخ استحقاق ≤ اليوم) زائد تحصيلات متأخرة، ثم كل يوم ± ما يستحق فيه. **الموردون + التحصيلات فقط** (مثل `/cashflow?parties=suppliers`). `cashLow`/`cashLowDate` = أدنى نقطة؛ `firstDeficitDate` = أول يوم < 0 أو `null`.
- `cashBasis`: `"bank"` حين يوجد رصيد بنكي محفوظ، وإلا `"no_bank_balance"` — والواجهة يجب أن تقول ذلك.
- `lastChange` = آخر رفع ناجح سُجّلت له لقطة؛ `null` قبل أول رفع.
- `staleness.coverage` = الموردون والمقاولون مرتّبون بالأقدم؛ `stale` = لا حركة إطلاقاً أو آخر حركة > ٦٠ يوماً. `lastImportAt/file` من سجل الرفع لنفس الحساب (أو `null`).
- `tasks` حتى ١٢ عنصراً، مرتّبة: danger ثم warn ثم info، ثم بالمبلغ تنازلياً. أنواعها: `overdue:supplier:<account>`، `overdue:contractor:<code>`، `guarantee:<id>`، `needs_term`، `deficit`.
- `projects[].margin` = `contractValue − executed`؛ `null` إن لم تُدخل قيمة العقد.

---

## ٣ · م-٥٠ — أطراف المشروع بمبالغ

### سجل المشاريع وقيمة العقد

المشاريع في القاعدة **أسماء نصية** على الحركات (`Supplier.project`، `ContractorEntry.project`،
`party_projects.project`). أُضيف `project_registry` (id ثابت ↔ اسم) يُملأ تلقائياً من كل الأسماء
المعروفة (بعد توحيد الإملاء: «سدن» = «السدن»). الدمج في `POST /project-admin/merge` يُحدّث السجل
وروابط الأطراف **ومبالغها** — لا يُيتَّم مبلغ أبداً (انظر «الدمج» أدناه).

**إضافات على مسارات قائمة (مفاتيح جديدة فقط):**
- `GET /projects` → كل `rows[i]` يحمل الآن: `id`, `contractValue` (نص|null), `assignedTotal` (نص), `executed` (نص), `margin` (نص|null), `supplierCost` (نص), `contractorCost` (نص).
- `GET /projects/{id}` (معرّف أو اسم) → نفس المفاتيح أعلاه + `parties` (مصفوفة كما في `GET /projects/{id}/parties`).

| المسار | الجسم/الاستجابة |
|---|---|
| `GET /projects/registry` | `[{"id","name","contractValue","contractValueAt","notes","aliases":["سدن"]}]` |
| `PUT /projects/{id}` | جسم `{"contractValue": "1500000.00" \| null, "notes": "…"}` (كل حقل اختياري؛ `null` يمسح القيمة) → عنصر registry |

`executed` = `supplierCost + contractorCost` حيث `supplierCost` = Σ فواتير موردي المشروع (نفس `totalInvoiced` في الصف) و`contractorCost` = Σ دائن قيود المقاولين من نوع مستخلص (`kind='claim'`) الموسومة بالمشروع.
`margin` = `contractValue − executed` أو `null`.

### `GET /projects/{id}/parties`

```json
[
  {"partyType": "supplier", "partyId": "2110001", "name": "شركة الحديد الموحدة",
   "account": "2110001", "amount": "300000.00", "notes": "",
   "invoiced": "150000.00", "paid": "30000.00", "open": "120000.00", "overdue": "70000.00",
   "attribution": "single", "linked": true},
  {"partyType": "supplier", "partyId": "2110009", "name": "مورد في مشروعين",
   "account": "2110009", "amount": null, "notes": "",
   "invoiced": null, "paid": null, "open": null, "overdue": null,
   "attribution": "shared", "linked": true},
  {"partyType": "contractor", "partyId": "2120001", "name": "مقاولات البناء الحديث",
   "account": "2120001", "amount": "500000.00", "notes": "عقد الهيكل",
   "claimed": "350000.00", "paid": "100000.00", "open": "250000.00", "overdue": null,
   "attribution": "entries", "linked": true}
]
```

- **صف لكل رابط** (`party_projects` غير المحذوف) — يظهر الطرف ولو بلا أي حركة.
- `amount` = قيمة الإسناد على هذا المشروع؛ **`null` = لم تُدخل** (ليس صفراً).
- الموردون: `invoiced/paid/open/overdue` = أرقام المورد كاملةً **فقط إن كان مرتبطاً بهذا المشروع وحده** (`attribution: "single"`). فواتير الموردين لا تحمل مشروعاً، فمورد في عدة مشاريع → كلها `null` و`attribution: "shared"` (لا نوزّع تخميناً).
- المقاولون (`attribution: "entries"`): من قيود الدفتر الموسومة بهذا المشروع: `claimed` = Σ دائن، `paid` = Σ مدين، `open` = `max(claimed − paid, 0)`؛ `overdue` = Σ متبقي مستخلصات المشروع المتأخرة **إن كان للمقاول مدة سداد** وإلا `null`.
- كل الحقول per-party (لا إجماليات هنا؛ الإجماليات في صف المشروع: `assignedTotal`).
- مقاول له قيود في المشروع بلا رابط صريح يظهر أيضاً بـ`linked: false`, `amount: null` (حتى لا يختفي من يعمل فعلاً).

### الكتابة

| المسار | الجسم | الاستجابة |
|---|---|---|
| `PUT /projects/{id}/parties/{partyType}/{partyId}` | `{"amount": "300000.00" \| null, "notes": "…"}` | عنصر الطرف كما في GET (201 إن أُنشئ الرابط، 200 إن عُدّل) |
| `DELETE /projects/{id}/parties/{partyType}/{partyId}` | — | `{"deleted": true}` — حذف منطقي؛ إعادة الإضافة تُحيي الرابط بمبلغه الجديد |

`partyType` ∈ `supplier | contractor`. `amount` نص أو رقم، ≥ ٠، منزلتان. 404 إن لم يوجد المشروع/الطرف، 422 لمبلغ غير صالح.
إنشاء الرابط يُبقي `Supplier.project` (العمود المفرد) متزامناً مع أول مشروع كما يفعل نموذج تعديل المورد.

### من جهة الطرف

`GET /suppliers/{account}/projects` و`GET /contractors/{code}/projects`:

```json
[{"projectId": "6c1f…", "name": "السدن", "amount": "300000.00", "notes": "",
  "invoiced": "150000.00", "open": "120000.00", "attribution": "single"}]
```
(للمقاول `claimed` بدل `invoiced`.)

### بحث الأطراف للمنتقي

`GET /parties/search?q=حديد&type=supplier|contractor&limit=20` →
`[{"partyType":"supplier","partyId":"2110001","name":"شركة الحديد الموحدة","account":"2110001","projects":["السدن"]}]`
بحث عربي مطبَّع (همزات/تاء مربوطة/هاء فارسية) على الاسم والحساب. `type` اختياري. `q` فارغ = الأوائل أبجدياً.

### الدمج (`POST /project-admin/merge`) — سلوك جديد

عند دمج «سدن» في «السدن»: روابط الأطراف تنتقل؛ إن كان الطرف مرتبطاً بالاسمين: يُبقى مبلغ الهدف إن وُجد، وإلا مبلغ المصدر؛ وإن اختلف المبلغان يُضاف للملاحظة سطر «مبلغ مدموج من سدن: …» (لا جمع تلقائي — قد يكون نفس العقد مُدخلاً مرتين). قيمة العقد تنتقل إن لم تكن للهدف قيمة.

---

## ٤ · الرصيد البنكي

| المسار | |
|---|---|
| `GET /settings/bank-balance` | `{"balance": "820000.00" \| null, "at": "2026-11-17T09:00:00" \| null}` |
| `PUT /settings/bank-balance` | `{"balance": "820000.00" \| null}` → نفس الشكل. `null` يمسح. |

يُستعمل في `/today` (`kpis.bankBalance`, `cash30`) وكقيمة افتراضية لـ`opening_balance` في `/cashflow`
**فقط حين لا يُمرَّر الباراميتر** (الاستجابة تحمل `openingBalanceSource: "query"|"bank"|"none"`).

---

## ٥ · التدفق النقدي (مسارات قائمة + إضافات)

- `GET /cashflow?weeks=26&from=YYYY-MM-DD&opening_balance=&project=&parties=suppliers|contractors|both&period_days=14` — كما كان، + `openingBalanceSource`.
- `GET /cashflow/breakdown?term=…&side=outflow|inflow&period=YYYY-MM-DD&weeks=&from=&project=&parties=&period_days=`
  - `side=outflow` (افتراضي): `term` ∈ `scheduled|overdue|undated|beyond` (موردون/مقاولون حسب `parties`)، و`collected|forecast` (تحصيلات) كما كان.
  - `side=inflow` (جديد): `term` ∈ `scheduled|overdue|undated|beyond` على التحصيلات المفتوحة — نفس أقسام `reconciliation.inflow`.
  - **كل صف يحمل الآن `id` ثابتاً**: فاتورة → `inv:<invoiceId>`، ضمان → `gua:<guaranteeId>`، رصيد مقاول بلا تاريخ → `con:<code>`، تحصيل → `rec:<receivableId>`. وكذلك `kind` ∈ `invoice|guarantee|contractor_balance|receivable`.
  - الاستجابة: `{"term","side","total","truncated","rows":[…]}`.
- `POST /cashflow/reconciliation-note` جسم `{"parties","project"|null,"noteCode","noteText"|null}` — كما كان.

## ٦ · التحصيلات

`GET /revenues` → `totals` يحمل الآن إضافةً: `in30` (رقم: مفتوح يستحق خلال ٣٠ يوماً من اليوم)، `collectedThisMonth` (رقم)، `overdueCount` (عدد). وكل صف يحمل `approval` ∈ `pending|approved` (القائم افتراضياً `approved`)، ويُقبل `approval` في POST/PUT `/revenues`. لا يؤثر `approval` على أي حساب (المعلَّق ما زال متوقَّعاً في التدفق).

## ٧ · النسخ الاحتياطي والتقدّم

`POST /backups` و`POST /backups/daily-if-due` كما كانا، ويولّدان الآن حدث `backup_done`/`backup_failed` + `progress` عبر SSE.
`POST /import` و`POST /import/batch` كما كانا، ويولّدان `progress`، حدث `import_done`/`import_failed`، لقطة قبل/بعد (لـ`/today.lastChange`)، ثم يشغّلان المولّد.

## ٨ · التقارير

`GET /reports/analysis?parties=suppliers|contractors|both&…` — كما كان، و`summary` يحمل إضافةً
(كلها أرقام كالحقول القائمة):

```json
"summary": {
  "outstanding": 595000.5,
  "supplierOutstanding": 245000.5,
  "contractorOutstanding": 350000.0,
  "ageingTotal": 245000.5,
  "period_movement": {"opening": 0.0, "invoiced": 245000.5, "paid": 0.0, "closing": 245000.5}
}
```
- `outstanding == supplierOutstanding + contractorOutstanding` دائماً (مختبَر). **لا تجمع الواجهة المقاولين فوقه.**
- `ageingTotal` = مجموع شرائح الأعمار (موردون فقط، بلا الفواتير غير المؤرخة — الفرق في `ageingUndated`).

`GET /reports/gm` (جديد — تقرير المدير العام/الشرائح بلا حساب في المتصفح):

```json
{
  "asOf": "2026-11-17",
  "supplierOpen": "245000.50",
  "supplierOpenPrevMonth": "195000.50",
  "supplierOpenPrevMonthDate": "2026-10-18",
  "supplierOpenChange": "50000.00",
  "contractorOwed": "350000.00",
  "bank": {"balance": null, "at": null},
  "cash30": [{"date": "2026-11-17", "balance": "…"}],
  "cashLow": "…", "cashLowDate": "…", "firstDeficitDate": null, "cashBasis": "no_bank_balance",
  "collections": {"open": "…", "overdue": "…", "in30": "…", "collectedThisMonth": "…"},
  "budget": [{"project": "السدن", "month": "2026-10-01", "delayPct": 0.1596,
              "cumPlanned": "…", "cumActual": "…"}],
  "guaranteesExpiring": [{"id": "…", "contractorCode": "2120001", "contractorName": "…",
                          "project": "…", "amount": "…", "releaseDue": "2026-11-20"}]
}
```
- `supplierOpenPrevMonth` = رصيد الموردين المفتوح كما كان **بتاريخ اليوم−٣٠** (حركات حتى ذلك التاريخ فقط، نفس المحرك).
- `guaranteesExpiring` = ضمانات غير مُفرج عنها يحين فكّها خلال ٣٠ يوماً أو حان.

---

## ٩ · إضافات أخرى

### إنشاء/حذف مشروع
| المسار | |
|---|---|
| `POST /projects` | `{"name":"برج الواحة","contractValue":"1000000.00"\|null}` → 201 عنصر registry. **409** إن وُجد مشروع بنفس الاسم بعد تجاهل «ال»/الهمزات/التاء المربوطة: `{"detail":"المشروع موجود باسم «السدن»"}`. 422 لاسم فارغ. |
| `DELETE /projects/{id}` | حذف منطقي لمشروع **بلا بيانات** → `{"deleted":true,"id":"…"}`. وإلا **409**: `{"detail":{"message":"…","linked":{"suppliers":1,"contractorEntries":0,"parties":1,"budgetMonths":0,"receivables":0}}}` — الواجهة تعرض الدمج. «غير محدد» → 422. |

المشروع المُنشأ بلا حركات يظهر في `GET /projects` صفاً بأصفار (`totals.count` يشمله) وفي `/projects/registry`.

**اسم العرض في السجل** (`name`): صيغة الموردين إن وُجدت (هي ما يعرضه `/projects.rows[].project`)، وإلا الأقصر. بقية الصيغ في `aliases`. الربط الآمن دائماً بـ`id`.

### المقاولون
- `GET /contractors/{code}` يحمل الآن `status` و`statusNote`.
- `POST /contractors/bulk-term` جسم `{"termDays": 30, "onlyWithoutTerm": true}` → `{"updated": 392, "termDays": 30, "onlyWithoutTerm": true}`. `termDays` عدد صحيح ٠–٣٦٥٠ (422 غير ذلك). `onlyWithoutTerm` افتراضياً `true` (لا يمسّ من ضُبطت مدته يدوياً).

### تأكيد المعرّفات
`{partyId}` في كل مسارات م-٥٠ و`/suppliers/{account}/projects` و`/contractors/{code}/projects` = **رقم حساب المورد / كود المقاول** — ثابت ولن يتغيّر.

---

## حالة التنفيذ (تُحدَّث أثناء العمل)

| البند | الحالة |
|---|---|
| الأرقام الذهبية + الأداء (selectinload/لقطة الطلب/فهارس) | ✅ منفّذ، الأرقام مطابقة |
| تفكيك `summary` في `/reports/analysis` + `/reports/gm` | ✅ منفّذ ومختبَر |
| م-٥٠ (السجل، الأطراف، قيمة العقد، البحث، الدمج، إنشاء/حذف مشروع) | ✅ منفّذ ومختبَر |
| الأحداث + SSE + invalidate + progress | ✅ منفّذ ومختبَر |
| `/today` | ✅ منفّذ ومختبَر |
| الرصيد البنكي، التدفق (`id`/`side`/`openingBalanceSource`)، التحصيلات (`in30`…/`approval`) | ✅ منفّذ ومختبَر |
| المقاولون: `status` في التفاصيل، `bulk-term` | ✅ منفّذ ومختبَر |
