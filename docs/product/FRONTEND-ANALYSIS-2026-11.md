# تحليل الواجهة الأمامية — EGCO Dashboard · ٢٠٢٦-١١-١٧

النطاق: `apps/renderer/src` + `apps/desktop/src` بما فيها تغييرات v0.13.0 غير المُودَعة. قراءة فقط.

## الملخص

| المقياس | القيمة |
|---|---|
| أسطر TS/TSX/CSS | ١٧٬٠٨٠ |
| الصفحات / المكوّنات | ٢٢ / ٢١ (`ui.tsx` = ٩٥ سطراً فقط) |
| أكبر الملفات | Import 1643 · Report 1265 · ContractorDetail 1139 · CashFlow 1090 · Budget 1090 · Contractors 1040 |
| ESLint | **٢٤٤ مشكلة (٢٣٤ خطأ)**، ١٦٥ موضع `any` صريح |
| `style={{}}` | ٥٧٥ (كان ٥٤٩ — يزداد) |
| `!important` في tokens.css | ١٩ · ألوان hex خام: ٤٥ (أغلبها تعريفات رموز، مقبول) |
| الحزمة | **حزمة JS واحدة 598.7 kB (161 kB gzip)** + CSS 30 kB — لا تقسيم شيفرة |
| التبعيات وقت التشغيل | react, react-dom, react-router-dom فقط |
| `lazy`/`Suspense` | صفر |
| `AbortController` | صفر |
| جداول `<table>` | ٥٤ — لا مكوّن Table موحّد، لا افتراضية |
| Toast / مركز إشعارات / Notification أصلي | لا يوجد |
| Electron | contextIsolation+sandbox+nodeIntegration=false ✓، جسر ضيّق ✓، electron-updater ✓، شريط عنوان `hiddenInset` على macOS فقط |

**الحكم:** الأساس سليم (أمان Electron، رموز مشتقة من Figma، حالات فراغ/خطأ ممنهجة، ترتيب على الخادم). لكن الواجهة «صفحات عملاقة مكتفية بذاتها»: كل صفحة تعيد كتابة الجلب والفرز والجدول والتصدير، بلا ذاكرة مؤقتة ولا حالة عامة ولا طبقة تغذية راجعة. هذا ما يمنع الحركة والإشعارات والجزيرة اليوم — ليس نقص مكتبة، بل نقص طبقتين: **البيانات** و**الحدث/الإشعار**.

---

## أهم ١٢ مشكلة (مرتبة بالأثر)

| # | المشكلة | الدليل | الإصلاح | الجهد |
|---|---|---|---|---|
| ١ | كل صفحة تجلب من الصفر عند كل تنقّل؛ لا ذاكرة، لا إلغاء، سباقات تُحلّ يدوياً بعدّاد `seq` | `pages/Suppliers.tsx:117-123` (seq.current + setTimeout)، `lib/api.ts:31` (`call` بلا cache/signal)، صفر AbortController | TanStack Query (‏~13 kB gz) مع `queryKey` لكل نقطة في api.ts و`signal` مُمرَّر لـfetch | M |
| ٢ | صفحات عملاقة تخلط الجلب+الحساب+العرض | `pages/Import.tsx` 1643، `Report.tsx` 1265، `ContractorDetail.tsx` 1139 | تفكيك إلى `features/<x>/{api,hooks,components}`؛ المجلد `features/` موجود وفارغ | L |
| ٣ | لا مكوّن جدول موحّد: ٥٤ `<table>` بفرز/تذييل/تصدير مكرّر | `components/ColumnMenu.tsx` (Th فقط)، `CashFlow.tsx:348` قصّ يدوي لـ٦٠ صفاً بدل افتراضية | `<DataTable>` (رأس لاصق، فرز خادمي، صف إجماليات، تصدير، افتراضية) | L |
| ٤ | ٢٣٤ خطأ ESLint / ١٦٥ `any` — أنواع API غير معرّفة فتتسرّب `any` إلى الجداول المالية | `Dashboard.tsx:183`، `ProjectDetail.tsx:125`، `Report.tsx:993` `(b: any)` | أنواع استجابة في `lib/api.ts` (أو توليدها من OpenAPI لـFastAPI عبر `openapi-typescript`) | M |
| ٥ | حزمة واحدة 599 kB، كل الصفحات تُحمَّل عند الإقلاع | `app/App.tsx:6-27` استيراد ثابت لـ٢٢ صفحة | `React.lazy` لكل مسار + `Suspense` مع Skeleton | S |
| ٦ | لا تغذية راجعة للإجراءات (حفظ/حذف/استيراد) — لا Toast | grep `toast` = صفر؛ الرسائل نصوص سطرية في كل صفحة | `ToastProvider` + `useToast()`؛ لاحقاً يصبّ في مركز الإشعارات | S |
| ٧ | ٥٧٥ `style={{}}` يخالف قاعدة «لا مسافة خارج tokens.css» | حتى `ui.tsx:24` `style={{ flex: 1 }}` | فئات أداة (`.grow`, `.stack-*`) + قاعدة ESLint مخصّصة تمنع style الحرفي | M |
| ٨ | لا مؤشرات تحميل هيكلية؛ `State` نص فقط | `components/ui.tsx:45` | `<Skeleton>` / `<TableSkeleton rows>` | S |
| ٩ | الحركة جزئية: انتقالات على الشريط الجانبي فقط، و`prefers-reduced-motion` يغطي الشريط فقط | `styles/tokens.css:239-323` | تعميم `@media (prefers-reduced-motion)` على `*` + رموز حركة مستعملة في المكوّنات الجديدة | S |
| ١٠ | لا قناة أحداث من الخادم: الأرقام لا تتحدّث بعد استيراد/نسخ احتياطي إلا بإعادة تحميل الصفحة | لا `EventSource`؛ الجسر يبث فقط `update:status` و`app:backend-restarted` (`preload/index.ts:58-71`) | نقطة SSE `/api/events` + `queryClient.invalidateQueries` حسب نوع الحدث | M |
| ١١ | وصولية: ٦٤ سمة role/aria و١٣ معالج لوحة مفاتيح لـ٢٢ صفحة؛ أسهم `→/←` حرفية في ٥ صفحات | `Report.tsx` (٤ مواضع)، `Budget.tsx` | أيقونات اتجاهية تنقلب بـ`[dir=rtl]`، فخ تركيز في Modal/Drawer، `aria-sort` في DataTable | M |
| ١٢ | شريط العنوان غير موحّد: `hiddenInset` على macOS و`default` على ويندوز — لا مكان للجزيرة | `desktop/src/main/index.ts:154` | `titleBarStyle:'hidden'` + `titleBarOverlay` على ويندوز، شريط سحب `-webkit-app-region: drag` في الواجهة | S |

ملاحظات إضافية: `Modal.tsx` (136) موجود لكن لا Drawer؛ `ExportMenu.tsx` مستعمل في ٤ صفحات فقط بينما `*ExportUrl` مكرّر في `api.ts:478`؛ أربع توجيهات `eslint-disable` لم تعد لازمة.

---

## البنية المقترحة للإصدار الجديد

### هيكل المجلدات
```
apps/renderer/src/
  app/            App.tsx · routes.tsx (lazy) · providers.tsx (Query, Toast, Notify, Theme)
  shell/          TitleBar · Island · Sidebar · NotificationCenter · CommandPalette
  ui/             مكتبة المكوّنات (أدناه) — بلا استدعاء API إطلاقاً
  data/           client.ts (call + signal) · queryClient.ts · keys.ts · events.ts (SSE) · types.gen.ts
  features/<domain>/   suppliers · contractors · cashflow · budget · report · import ...
      api.ts (useXQuery/useXMutation) · components/ · Page.tsx
  lib/            format · explanations · delay (كما هي)
  styles/         tokens.css (رموز فقط) · base.css · utilities.css · components/*.css
```

### طبقة البيانات
- **TanStack Query v5** (~13 kB gz). لماذا لا طبقة يدوية: نحتاج dedupe + cache + invalidation بالحدث + optimistic + retry — كتابتها يدوياً تعيد اختراع ٨٠٪ منها.
- `staleTime: 30s`، `gcTime: 5min`، `refetchOnWindowFocus: true` (عودة المستخدم للنافذة = تحديث هادئ).
- `keys.ts` مركزي: `['suppliers', query]`, `['contractor', code]`… الفرز والتصفية **تبقى على الخادم** (قاعدة CLAUDE.md) — تدخل في المفتاح فقط، مع `placeholderData: keepPreviousData` لمنع الوميض.
- الطفرات: `useMutation` + `onSuccess → invalidate + toast`. التفاؤلية فقط للحالات غير الرقمية (تثبيت، أرشفة، نقل لسلة المحذوفات) — **لا تفاؤلية على أي رقم مالي**.
- حالة UI عامة صغيرة (الفترة، النطاق، الشريط المطوي، الإشعارات): Zustand (~1 kB) أو `useSyncExternalStore` — بلا Redux.
- الأنواع: `openapi-typescript` من `/openapi.json` لـFastAPI → `types.gen.ts` يقضي على معظم الـ`any`.

### مكتبة المكوّنات (القائمة الكاملة)
**أساس:** Button · IconButton · Icon (موجود) · Link · Input · NumberInput (أرقام عربية/لاتينية) · Select · Combobox · DateRange · Checkbox · Switch · Radio · Field/Label/Hint/Error · Tooltip · Kbd.
**عرض:** Kpi (موجود) · Money (موجود) · Pill (موجود) · Badge · Card (موجود) · Stat-delta · Sparkline · Explain (موجود) · Divider · Avatar/Initials.
**تخطيط:** PageHeader (عنوان + فتات + إجراءات) · Toolbar (بحث، مرشحات، تصدير) · FilterChips · Tabs · SplitView · Stack/Inline · Section.
**بيانات:** DataTable (أعمدة مُعرّفة، فرز خادمي، `aria-sort`، رأس وعمود لاصقان، صف إجماليات، تحديد، افتراضية) · TableSkeleton · Pagination · ExportMenu (موجود، يُعمَّم) · EmptyState/ErrorState (موجودان).
**طبقات:** Modal (موجود، يُضاف فخ تركيز) · Drawer (تفاصيل مورد/مقاول بدل التنقّل) · Popover · Menu · ConfirmDialog · CommandPalette (⌘K).
**تغذية راجعة:** Toast · Progress (للاستيراد) · Skeleton · Spinner · Banner (إعادة تشغيل الخدمة، بديل الحالي في App.tsx) · Island · NotificationCenter.

### نظام الحركة — الاختيار: **CSS أولاً + `motion` (Framer Motion v11+) للجزيرة والقوائم فقط**
- CSS يكفي لـ٨٠٪: hover، فتح Drawer/Modal، Toast دخول، Skeleton shimmer — برموز `--motion-fast/base` و`--ease-base` الموجودة أصلاً.
- `motion` بالاستيراد المصغّر `m` + `LazyMotion` + `domAnimation` ≈ **~15–18 kB gz** (مقابل ~34 kB للحزمة الكاملة). مبرَّر لشيئين يصعبان في CSS: تحوّل الجزيرة بين أحجامها (layout animation) و`AnimatePresence` لخروج الإشعارات/الصفوف.
- يُحمَّل كسولاً مع `shell/` فلا يؤثر في أول رسم. الإجمالي بعد التقسيم أصغر من الحزمة الحالية.
- `useReducedMotion()` + قاعدة CSS عامة: `@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}`.
- قاعدة منتج: **الأرقام لا تتحرك** (لا عدّادات متدحرجة على مبالغ مالية) — الحركة للحاويات فقط.

### مركز الإشعارات والجزيرة
**النموذج:**
```ts
type Notice = { id; kind: 'info'|'success'|'warn'|'error'|'progress'; source: 'import'|'backup'|'update'|'backend'|'due'|'ai';
  title; body?; progress?; action?: {label; to?|run?}; createdAt; read: boolean; sticky?: boolean; os?: boolean }
```
**المخزن:** `notify` store (Zustand) — `push / update(id) / dismiss / markRead`، يُحفظ آخر ٢٠٠ في SQLite عبر `/api/notifications` (لا localStorage — يجب أن ينجو من إعادة التثبيت).

**المصادر:**
1. **SSE من FastAPI** `GET /api/events` (`StreamingResponse`): `import.progress`, `import.done`, `backup.done`, `data.changed{scope}`, `due.upcoming` (استحقاقات خلال ٧ أيام — الحساب على الخادم). `data/events.ts` يفتح `EventSource`، يعيد الاتصال تلقائياً، ويوزّع: `data.changed → invalidateQueries`، والباقي → `notify.push`.
2. **Electron IPC** الموجود: `update:status` و`app:backend-restarted` → `notify.push` (يحلّ محل الشريط الخاص في App.tsx).
3. **الطفرات المحلية** عبر `useToast`.

**العرض:**
- **Island** (`shell/Island.tsx`): كبسولة في وسط شريط العنوان المخصّص. ثلاث حالات: `idle` (نقطة/ساعة/حالة الخدمة) → `compact` (أيقونة + عنوان، ٤ث) → `expanded` (تقدّم الاستيراد، زر إجراء). تعرض إشعاراً واحداً نشطاً بأولوية `progress > error > warn > success`؛ الباقي يتراكم في المركز. `role="status"` و`aria-live="polite"` (assertive للأخطاء).
- **NotificationCenter**: Drawer من اليسار (الشريط الجانبي يمين) بمجموعات «اليوم/سابقاً»، تصفية حسب المصدر، «تعليم الكل كمقروء»، شارة عدد على زر الجرس.
- **Toast**: للمستخدم الذي أطلق الإجراء فقط؛ يُسجَّل أيضاً في المركز.

**إشعارات النظام الأصلية:**
- main: `ipcMain.handle('notify:os', (_, {title, body, id}) => new Notification({title, body, silent:false}).on('click', () => { win.show(); win.webContents.send('notify:clicked', id) }).show())`.
- preload: `notifyOS(n)` و`onNotificationClick(cb)` فقط — يبقى الجسر ضيّقاً.
- السياسة: تُرسل للنظام فقط إذا `os:true` **و**النافذة غير مركّزة (`document.hasFocus()===false`) — استيراد طويل انتهى، نسخة احتياطية فشلت، تحديث جاهز، استحقاق اليوم. تفضيل تشغيل/إيقاف في الإعدادات. على ويندوز يلزم `app.setAppUserModelId('com.egco.dashboard')`.
- `app.setBadgeCount(unread)` على macOS.

**شريط العنوان (شرط للجزيرة):**
- `titleBarStyle: 'hidden'` على كل المنصات + `titleBarOverlay: {color: var(--sidebar-bg), symbolColor, height: 40}` على ويندوز؛ `trafficLightPosition` على macOS (أزرار macOS تبقى يساراً حتى في RTL؛ الجزيرة في الوسط فلا تصادم).
- `shell/TitleBar.tsx`: `-webkit-app-region: drag`، وعناصره التفاعلية `no-drag`. ارتفاع ٤٠px يُضاف كرمز `--titlebar-h`.

### الافتراضية للجداول
- `@tanstack/react-virtual` (~5 kB gz)، مدمج في `DataTable` ويتفعّل فوق ٢٠٠ صف (جدول الـ٥٩٩ صفاً، الكشوف، معاينة الاستيراد `Import.tsx:1472`).
- تبقى `<table>` دلالية: صفّا حشو أعلى/أسفل (`padding rows`) بدل `div` مطلقة، لتبقى الطباعة و`PrintableList` و`aria-rowcount/rowindex` تعمل.
- عند الطباعة/PDF تُعطَّل الافتراضية (`beforeprint`) فتُعرض كل الصفوف.
- يُزال القصّ اليدوي `CashFlow.tsx:44` (`MAX_RENDERED_PERIOD_ROWS = 60`).
- الإجماليات تأتي من الخادم دائماً (لا تُجمع من الصفوف المرئية).

---

## خطة الترحيل صفحة-صفحة

**المرحلة ٠ — الأساس (لا تغيير مرئي، ١ أسبوع):** `providers.tsx` + queryClient · `data/client.ts` بإضافة `signal` لـ`call` الحالي (يُعاد استعماله كما هو) · `routes.tsx` بـlazy (مكسب فوري للحزمة) · أنواع OpenAPI · إصلاح أخطاء ESLint الآلية · قاعدة reduced-motion عامة.

**المرحلة ١ — الهيكل (١ أسبوع):** TitleBar + Island + ToastProvider + notify store + SSE + `notify:os`. يُنقل شريط «إعادة تشغيل الخدمة» و`WhatsNewModal` (يبقى، لكن يُطلق من المركز) وحالة التحديث في Settings إلى المركز.

**المرحلة ٢ — المكوّنات (١–٢ أسبوع):** DataTable + Toolbar + PageHeader + Skeleton + Drawer + Tabs. يُعاد استعمال: `ColumnMenu.Th` (منطق الفرز)، `ExportMenu`، `EmptyState/ErrorState`، `Kpi/Card/Pill/Money`، `Modal`، `Icon`، `Explain`، `PeriodBar/ScopeBar` (تدخل في Toolbar).

**المرحلة ٣ — الصفحات، من الأصغر/الأكثر استعمالاً إلى الأعقد:**

| الترتيب | الصفحة | ما يُفعل | يُعاد استعماله |
|---|---|---|---|
| ١ | Obligations, Loans, Expenses, Projects (صغيرة) | تجربة النمط: useQuery + PageHeader + DataTable | كل ui الحالي |
| ٢ | Dashboard, CommandCentre | Skeleton، invalidate بـ`data.changed` | Kpi, Explain, Carousel |
| ٣ | Suppliers → SupplierDetail | إزالة `seq` اليدوي، Drawer للتفاصيل، SupplierForm كـuseMutation | SupplierForm, RemindModal |
| ٤ | Contractors → ContractorDetail (مع تغييرات v0.13.0) | نفس نمط ٣؛ تقسيم Detail إلى Tabs | ContractorForm |
| ٥ | Guarantees, Coverage, Calendar, Revenues | DataTable + Toolbar | lib/delay |
| ٦ | CashFlow, Budget | افتراضية، إزالة القصّ اليدوي | منطق العرض الحالي كمكوّنات فرعية |
| ٧ | Import | تفكيك إلى خطوات (رفع/معاينة/مطابقة/تأكيد) + تقدّم عبر SSE → Island | AiRescueModal, ManualEntryForm |
| ٨ | Report | تفكيك الأقسام إلى مكوّنات؛ طباعة تعطّل الافتراضية | PrintableList, Present, exportPdf |
| ٩ | Settings, Trash, ProjectAdmin | تفضيلات الإشعارات، useMutation + toast + تراجع | — |

كل صفحة تُرحَّل تُغلق شرط: صفر `any`، صفر `style={{}}`، لقطة Playwright موجودة (`npm run e2e`) لا تتغيّر رقمياً.

**الحزمة المتوقعة:** المدخل الأولي ≈ react+router+shell+query ≈ 70–80 kB gz بدل 161 kB، وكل صفحة 5–25 kB gz عند الطلب.
