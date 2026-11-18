# عقد نموذج «أرخبيل» الكامل — يُلزم كل الوكلاء

النموذج تطبيق ويب ساكن متعدد الملفات يُنشر كـ claude.ai Artifact. **كل ميزة في التطبيق الحقيقي
يجب أن تعمل هنا فعلاً** على بيانات مثال محفوظة في المتصفح: إضافة، تعديل، حذف، استرجاع، بحث،
تصفية، فرز، استيراد، تصدير، إشعارات، جزيرة، حركة.

المرجع البصري: `_v1-reference.html` (النسخة الأولى المنشورة) و`styles.css` (مستخرج منها) و
`/Users/abdallaalkhouli/Desktop/Anchor/EGCO/Dashboard/docs/product/DESIGN-DIRECTION-2026-11.md`
و`tokens-v2.css`. المرجع الوظيفي: صفحات التطبيق الحقيقي في
`/Users/abdallaalkhouli/Desktop/Anchor/EGCO/Dashboard/apps/renderer/src/pages/*.tsx` (قراءة فقط —
**لا تعدّل أي ملف في مستودع Dashboard إطلاقاً**؛ وكيل آخر يعمل هناك على إصدار سيُرفع).

## ١ · الملفات والملكية (حصرية — لا يلمس وكيل ملف غيره)

```
app/
  index.html        ← core   (الهيكل + تحميل السكربتات بالترتيب أدناه)
  styles.css        ← core   (الأساس المشترك؛ الوكلاء الآخرون لا يعدّلونه)
  store.js          ← core
  ui.js             ← core
  shell.js          ← core   (الشريط، الجزيرة، الدرج، التبويبات، الموجّه، لوحة «جرّب»)
  sections/today.js     + today.css     ← وكيل «اليوم»
  sections/parties.js   + parties.css   ← وكيل «الأطراف»
  sections/projects.js  + projects.css  ← وكيل «المشاريع»
  sections/cash.js      + cash.css      ← وكيل «النقد»
  sections/reports.js   + reports.css   ← وكيل «التقارير»
  sections/data.js      + data.css      ← وكيل «البيانات»
```
ترتيب التحميل في index.html (سكربتات عادية لا modules): `store.js` → `ui.js` → `shell.js` →
`sections/*.js` (الستة) → `EGCO.shell.start()` في سطر inline أخير. كل CSS قسم يُحمَّل بـ`<link>`
بعد styles.css. **لا مكتبات خارجية** إلا خط Cairo من Google Fonts.

قواعد CSS للأقسام: كل محدِّد يبدأ بـ`.sec-<اسم>` (مثلاً `.sec-parties .x`) — لا محدّدات عامة. استعمل
متغيرات styles.css فقط (لا لون/مسافة خام). الفئات المشتركة المتاحة: `.ph .grid .isl .c3 .c4 .c6 .c8 .c12
.crit .click .ih .cap .hero .kpi .num .cur .t-danger .t-ok .t-warn .meta .delta .pill(.d .w .o .n)
.btn(.primary .sm) .chip .seg .tbl-wrap table .tasks .chk .sev .sample .dash .disclose .sum .tabs`.

## ٢ · المتغير العام `window.EGCO`

### ٢.١ `EGCO.store` (store.js) — مصدر الحقيقة الوحيد
- الحالة في `EGCO.store.db` وتُحفظ في `localStorage['egco-proto-v2']` (try/catch؛ إن فشل تعمل بالذاكرة).
- `EGCO.store.reset()` يعيد بيانات المثال. `TODAY` ثابت = `new Date(2026,10,17)` (`EGCO.store.TODAY`).
- **الكيانات** (كلها `{id, ..., deletedAt: null|ISO}` — الحذف منطقي دائماً):
  - `projects {id,name,contractValue,budgetDelayPct}`
  - `suppliers {id,account:'211xxxx',name,projectIds:[],termDays,phone,notes}`
  - `invoices {id,supplierId,no,date:'YYYY-MM-DD',amount,projectId,importId}`
  - `payments {id,supplierId,date,amount,doc,importId}` — تُوزَّع FIFO على الأقدم
  - `contractors {id,code:'212xxxxx',name,projectIds,termDays|null,retentionRate,status:'active'|'paused'|'finished'|'disputed',statusNote}`
  - `contractorEntries {id,contractorId,date,kind:'opening'|'claim'|'payment'|'retention'|'deduction'|'invoice'|'other',claimNo,debit,credit,description,projectId,importId}`
  - `guarantees {id,contractorId,projectId,type,amount,issueDate,expiryDate,returnedAt|null}`
  - `receivables {id,projectId,from,docNo,amount,dueDate,status:'pending'|'approved'|'collected',collectedAt}`
  - `budgetMonths {id,projectId,month:'YYYY-MM',planned,actual,docNo}`
  - `imports {id,at,file,kind,partyType,partyId,added,matched,status:'ok'|'failed',error,snapshotBefore}`
  - `backups {id,at,kind:'daily'|'manual'|'before-import'|'before-restore',sizeKb,data}` (نسخة كاملة من db بلا backups)
  - `notes {id,at,sev:'d'|'w'|'o'|'i',title,detail,link:{view,params}|null,read,archived}`
  - `settings {bankBalance,defaultSupplierTerm,osNotifications,island,digits:'latin'|'arab',theme:'system'|'light'|'dark',externalBackupDir}`
- **CRUD عام:** `list(type,{withDeleted})` · `get(type,id)` · `create(type,obj)` · `update(type,id,patch)`
  · `remove(type,id)` (منطقي، يحذف التابعين منطقياً: مورد→فواتيره ودفعاته) · `restore(type,id)` (يعيد
  التابعين) · `purge(type,id)` (نهائي). كل كتابة تحفظ وتُطلق `change`.
- **الاشتقاقات (Decimal-ish: احسب بالهللات كأعداد صحيحة ثم /100):**
  `supplierPosition(id) → {open,overdue,due7,due30,oldestDays,invoices:[{...,remaining,dueDate,lateDays}],aging:{d0_30,d31_60,d61_90,d90p}}`
  `contractorPosition(id) → {balance (سالب=نحن ندين), owed, overdue|null, dueSoon|null, claims:[{...,dueDate,remaining,lateDays}]}` (overdue=null إن termDays=null)
  `totals() → {supplierOpen,supplierOverdue,supplierDue7,contractorOwed,contractorOverdue,withTerm,withoutTerm,receivableOpen,receivableOverdue,retentionHeld}`
  `projectPosition(id)` · `cashProjection(days) → [{date,balance,in,out,items}]` (يبدأ من bankBalance، يطرح الاستحقاقات، يضيف التحصيلات) ·
  `dueList({days}) → [{date,party,partyType,amount,late}]` · `calendar(year,month) → {'YYYY-MM-DD':[events]}` ·
  `staleness() → {newestInvoiceDays, coverage:[{supplierId,lastImportDays}]}`.
- **الأحداث:** `on(evt,fn)`/`off`. أحداث: `change` · `note` (إشعار جديد) · `import:progress {pct,file}` ·
  `import:done {importId,diff}` · `backup:start` · `backup:done`.
- **مولّد الإشعارات:** `store.notify({sev,title,detail,link})`. بعد كل استيراد يقارن `totals()` قبل/بعد
  ويخزّن `store.db.lastChange = {at,file,before,after,newInvoices,paidInvoices}` ويُطلق إشعارات
  (متأخر جديد، اكتمل الاستيراد). `store.checkAlerts()` يُشغَّل عند البدء وبعد كل change: عجز نقدي
  متوقع (أول يوم سالب في cashProjection(30))، ضمان ينتهي ≤٧ أيام، مستخلص صار متأخراً — بلا تكرار.
- **الاستيراد:** `store.importCSV(text, {fileName})` يحلّل CSV حقيقياً: الأعمدة
  `account,name,date,doc,description,debit,credit` (يقبل عناوين عربية: الحساب، الاسم، التاريخ، المستند،
  البيان، مدين، دائن). البادئة 211 → مورد (credit=فاتورة، debit=دفعة)، 212 → مقاول (classify بالبيان)،
  216 → ضمان. **معاينة أولاً:** `store.previewCSV(text) → {rows,parties:[{account,name,isNew,added,dupes}],errors}`
  ثم `store.commitImport(preview,{fileName})` يأخذ نسخة `before-import` ثم يكتب ويطلق التقدم على
  مراحل (setTimeout) ثم `import:done`. التكرار (نفس الحساب+التاريخ+المبلغ+المستند) يُتخطّى ويُعدّ «مطابق مسبقاً».
  `store.sampleCSV()` يعيد CSV مثال صالحاً للتجربة.
- **النسخ:** `store.backup(kind)` · `store.restoreBackup(id)` (يأخذ before-restore أولاً) ·
  `store.deleteBackup(id)`. تقليم: يومية ٣٠، يدوية ٢٠، قبل-استيراد ١٠. `store.dailyIfDue()` عند البدء.
- **الدمج:** `store.mergeProjects(fromId,intoId)` و`store.projectMergeSuggestions()` (تطابق بعد حذف «ال»).
- **التصدير:** `store.toCSV(rows, columns) → string`.

### ٢.٢ `EGCO.ui` (ui.js)
- تنسيق: `fmt(n)` (2 منازل، `−` حقيقي) · `int(n)` · `digits(str)` (يحترم settings.digits) · `money(n,cls)` →
  HTML · `dateTxt(dateOrIso,{weekday,year})` · `ago(iso)` · `esc(str)` (هروب HTML — **إلزامي لكل نص يُدخله المستخدم**).
- حركة: `countUp(el,to,from)` · `animateNumbers(root,first)` · `counted(n,cls,from)` → HTML بـdata-count ·
  `spark(points,color)` → SVG · `lineChart({series,height,negArea,xLabels})` → SVG.
- `toast(text,{undo,kind:'ok'|'info'|'error'})` — لأفعال المستخدم فقط.
- `modal({title,body(html),actions:[{label,kind,onClick(close,root)}],size:'md'|'lg',onOpen(root)})` → `{close,root}`؛
  حارس «تجاهل التغييرات غير المحفوظة؟» تلقائي لأي input تغيّر؛ فخ تركيز؛ Esc.
- `confirm({title,body,danger,confirmLabel}) → Promise<boolean>` (داخل الصفحة — `window.confirm` لا يعمل في Artifact).
- `form(fields) → html` و`readForm(root) → obj` و`validate(root, rules) → bool` (يهزّ الحقل الخاطئ `m-shake`).
  حقول: `{name,label,type:'text'|'number'|'date'|'select'|'textarea'|'money',options,required,value,help,min,max}`.
- `table({columns:[{key,label,num,render(row),sort:true,width}],rows,rowKey,onRowClick,selectable,selected:Set,onSelect,
  search:true,searchKeys,filters:[{key,label,options}],total:{label,keys:[...]},empty:{title,body,cta,onCta},density,
  columnMenu:true,id})` → عنصر DOM (فرز بالنقر على الرأس، بحث عربي يتجاهل الهمزات/التاء المربوطة، شرائح
  تصفية، تحديد مع شريط إجمالي، إخفاء أعمدة، رأس لاصق، صف إجمالي يحسب من الصفوف **المصفّاة**).
- `kpi({label,value,money:true,tone,hint,spark,onClick,crit})` → HTML لجزيرة KPI.
- `exportDialog({title,csv,fileName})` — بما أن التنزيل محجوب في Artifact: نافذة تعرض الملف جدولاً + زر
  «نسخ» (clipboard مع fallback تحديد النص) + محاولة تنزيل عبر Blob (قد لا يعمل — يُقال ذلك بصراحة).
- `emptyState({icon,title,body,cta,onCta})` · `skeleton(rows)`.

### ٢.٣ `EGCO.shell` (shell.js)
- `EGCO.shell.register(viewKey, {section, tab:'تسمية التبويب'|null, title, render(container, params), badge()=>n})`
  — `section` ∈ `today|parties|projects|cash|reports|data`. التبويبات تُرسم تلقائياً بترتيب التسجيل للعروض
  ذات `tab`. العروض بلا `tab` تفاصيل (مثل `supplier` بـ`params.id`).
- `EGCO.shell.go(viewKey, params)` · `EGCO.shell.current()` · `EGCO.shell.refresh()` (يعيد رسم العرض الحالي بلا حركة دخول).
  الموجّه يكتب `#view` في location.hash (رمز بسيط فقط) ويقرؤه عند البدء.
- العرض يُعاد رسمه تلقائياً عند `store change` (refresh بلا حركة).
- الجزيرة: `EGCO.shell.island.event('import'|'backup'|'deficit', data)` (الحالات S0–S4 وأولوياتها كما في v1).
  shell يستمع لأحداث store (`import:progress`, `backup:*`, `note` بشدة d) ويحرّك الجزيرة تلقائياً — الأقسام لا تحتاج استدعاءها.
- مركز الإشعارات (درج يسار) و`⌘/Ctrl+.` وعدّاد غير المقروء في الجزيرة والشريط.
- بحث شامل `⌘/Ctrl+K`: لوحة أوامر تبحث في الموردين/المقاولين/المشاريع/الصفحات وتفتحها.
- لوحة «جرّب» (قابلة للطي): استيراد CSV مثال · نسخة احتياطية · عجز نقدي (يخفض bankBalance) ·
  الأرقام 123/١٢٣ · الوضع · إعادة ضبط البيانات.
- الشريط الجانبي: ٦ وجهات بأيقونات + مؤشر منزلق + قابل للطي (248↔72) + شريط سفلي تحت 760px.

## ٣ · ما يملكه كل قسم (العروض التي يسجّلها)

| القسم | العروض (tab) | يجب أن يغطي وظيفياً كل ما في هذه الصفحات الحقيقية |
|---|---|---|
| today | `today`(اليوم) · `due`(المستحقات القادمة) · `calendar`(التقويم) | CommandCentre.tsx · Dashboard.tsx · Calendar.tsx |
| parties | `suppliers` · `contractors` · `guarantees` + تفاصيل `supplier` · `contractor` | Suppliers · SupplierDetail · Contractors · ContractorDetail · Guarantees · SupplierForm/ContractorForm/ManualEntryForm/RemindModal |
| projects | `projects` · `budget` · `merge` + تفاصيل `project` | Projects · ProjectDetail · Budget · ProjectAdmin |
| cash | `cash`(التدفق النقدي) · `collections`(التحصيلات) | CashFlow · Revenues |
| reports | `report`(تقرير المدير العام) · `exports`(التصدير) · `present`(عرض تقديمي، tab) | Report.tsx · Present.tsx · ExportMenu/PrintableList |
| data | `import`(رفع الملفات) · `coverage` · `backups` · `trash` · `settings` | Import · Coverage · Settings · Trash · (+ ما الجديد WhatsNewModal) |

## ٤ · قواعد الجودة
- عربي RTL كامل، المصطلحات: «المديونية المفتوحة» للإجمالي · «الرصيد» لطرف واحد · «متأخر» للتأخر الزمني حصراً.
- الأحمر للتأخر الزمني فقط. إشارة الكشف: سالب = نحن ندين لهم، ويُكتب بكلمة بجانب الرقم.
- لا رقم مخترع: المقاول بلا مدة → «—» مع السبب. كل إجمالي يُحسب من صفوفه.
- كل نص من المستخدم يمرّ بـ`ui.esc`. لا `alert/confirm/prompt/window.print`.
- يعمل بعرض 400px (جداول داخل `.tbl-wrap`) وفي الفاتح والداكن، ويحترم `prefers-reduced-motion`.
- الحركة: transform/opacity، ≤300ms للتفاعل، الأرقام لا ترتد.
- `node --check` على كل ملف JS تكتبه قبل التسليم.
