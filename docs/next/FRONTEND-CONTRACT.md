# عقد الواجهة — «أرخبيل» v1.0 (للوكلاء الستة: اليوم · الأطراف · المشاريع · النقد · التقارير · البيانات)

> المالك: الوكيل F (أساس الواجهة). هذا الملف **ملزم**؛ الأسماء والتواقيع أدناه نهائية.
> المرجع البصري والسلوكي: `docs/next/prototype/` (styles.css · ui.js · shell.js · sections/*). ما تراه هناك
> هو ما تبنيه — بمكوّنات `@/ui` بدل HTML النصي.

## ٠ · الملكية والحدود

| المسار | المالك |
|---|---|
| `apps/renderer/src/sections/<name>/**` | وكيل القسم `<name>` حصراً (`today` · `parties` · `projects` · `cash` · `reports` · `data`) |
| `src/{app,shell,ui,data,styles,lib,components,assets}/**`، `index.html`، `package.json`، `vite.config.ts`، `tsconfig.json`، `eslint.config.js` | F — **لا تعدّلها**. تحتاج شيئاً؟ اطلبه من F (أو المنسّق) |
| `src/pages/**` | الصفحات القديمة — للقراءة فقط؛ تُحذف حين يغطي قسمك كل بنودها في `docs/next/PARITY.md` |
| `src/lib/api.ts` | للقراءة فقط (عميل الخادم). نقاط جديدة تُضاف عبر F |

- لا `package.json` لكل قسم ولا تبعيات جديدة. لا `style={{}}` لقيم لون/مسافة — الرموز فقط.
- كل نص بالعربية، كل مبلغ بـ«ر.س» عبر `<Money>`، الأرقام عبر `<Num>`/`fmt`/`int` (تحترم تفضيل ١٢٣).
- **لا حساب مالي في الواجهة.** الأرقام من الخادم (Decimal). الجمع المسموح الوحيد: إجمالي صفوف مصفّاة/محددة
  في `DataTable` (بالهللات الصحيحة، `sumHalalas`) — وإن كان للمسار إجمالي من الخادم فاعرضه هو (`totals` prop).

## ١ · تسجيل القسم (المسارات والتبويبات)

ملف واحد لكل قسم: **`src/sections/<name>/index.tsx`** (أو `index.ts`) بتصدير افتراضي من النوع `SectionModule`.
`src/app/routes.tsx` (ملك F) يجمعها تلقائياً بـ`import.meta.glob('../sections/*/index.{ts,tsx}')` عند الإقلاع —
لا تعدّل أي ملف خارج مجلدك كي يظهر قسمك. التحميل محمي: قسمٌ يرمي خطأً عند الاستيراد أو لا يصدّر `SectionModule` افتراضياً
يُتجاهَل وتبقى صفحاته القديمة (لا ينهار الهيكل). `index` يصدّر **افتراضياً** كائن `SectionModule` — لا مكوّنات ولا ثوابت `ROUTES` بديلة.

```tsx
// src/sections/parties/index.tsx
import { lazy } from 'react';
import type { SectionModule } from '@/app/registry';

const mod: SectionModule = {
  section: 'parties',
  views: [
    {
      key: 'parties.suppliers',            // فريد عالمياً: '<section>.<name>'
      path: '/parties/suppliers',           // مسار react-router (HashRouter)
      tab: 'الموردون',                      // وجوده = يظهر تبويباً في شريط تبويبات القسم
      order: 10,                            // ترتيب التبويب (تصاعدي)
      title: 'الموردون',                    // عنوان النافذة + لوحة الأوامر
      component: lazy(() => import('./Suppliers')),   // تصدير افتراضي، كسول دائماً
      aliases: ['suppliers'],               // أسماء روابط الإشعارات/الخادم التي تقود هنا
      useBadge: () => useOverview().data?.needsTerm,  // اختياري: عدّاد أحمر على التبويب (hook)
    },
    {
      key: 'parties.supplier',
      path: '/parties/suppliers/:account',
      parentTab: 'parties.suppliers',      // تفاصيل بلا تبويب: أي تبويب يُضاء
      title: 'كشف مورد',
      component: lazy(() => import('./SupplierDetail')),
      aliases: ['supplier'],               // link {view:'supplier', params:{account:'211…'}} أو {id:…}
    },
  ],
  commands: [                               // اختياري: إجراءات في لوحة ⌘K
    { group: 'إجراءات', label: 'مورد جديد', sub: 'الأطراف', run: ({ go }) => go('parties.suppliers', { new: '1' }) },
  ],
};
export default mod;
```

```ts
// src/app/registry.ts — الأنواع النهائية
export type SectionKey = 'today' | 'parties' | 'projects' | 'cash' | 'reports' | 'data';
export interface ViewDef {
  key: string; path: string; title: string;
  component: React.ComponentType;          // React.lazy(() => import(...))
  section?: SectionKey;                     // يُملأ من SectionModule.section
  tab?: string; order?: number; parentTab?: string;
  aliases?: string[];
  useBadge?: () => number | null | undefined;
  /** مسارات قديمة تُحوَّل إلى هذا العرض (تُضاف إلى جدول التحويل). */
  redirectFrom?: string[];
}
export interface Command { group: string; label: string; sub?: string; keywords?: string; run: (ctx: { go: Go }) => void }
export interface SectionModule { section: SectionKey; views: ViewDef[]; commands?: Command[] }
export type Go = (viewKeyOrAlias: string, params?: Record<string, string | number | undefined>) => void;
```

**قاعدة الاستبدال:** عرضٌ من قسمك له نفس `key` (أو نفس `path`) لعرض قديم في الجدول أدناه **يحلّ محله**
تلقائياً — الصفحة القديمة تختفي من التوجيه دون لمس أي ملف. استعمل المفاتيح والمسارات التالية حرفياً:

| key (المؤقت = صفحة قديمة) | path | تبويب | المسار القديم المحوَّل |
|---|---|---|---|
| `today.summary` | `/today` | الملخص | `/` |
| `today.due` | `/today/due` | المستحقات | `/payables` |
| `today.calendar` | `/today/calendar` | التقويم | `/calendar` |
| `parties.suppliers` | `/parties/suppliers` | الموردون | `/suppliers` |
| `parties.supplier` | `/parties/suppliers/:account` | (تفاصيل → suppliers) | `/suppliers/:account` |
| `parties.contractors` | `/parties/contractors` | المقاولون | `/contractors` |
| `parties.contractor` | `/parties/contractors/:code` | (تفاصيل → contractors) | `/contractors/:code` |
| `parties.guarantees` | `/parties/guarantees` | الضمانات | `/guarantees` |
| `projects.list` | `/projects` | المشاريع | — |
| `projects.project` | `/projects/:project` | (تفاصيل → list) | — |
| `projects.budget` | `/projects/budget` | الموازنة | `/budget` |
| `projects.admin` | `/projects/admin` | إدارة المشاريع | `/settings/projects` |
| `cash.flow` | `/cash/flow` | التدفق النقدي | `/cashflow` |
| `cash.revenues` | `/cash/revenues` | الإيرادات | `/revenues` |
| `cash.loans` · `cash.obligations` · `cash.expenses` | `/cash/loans` … | (بلا تبويب) | `/loans` `/obligations` `/expenses` |
| `reports.report` | `/reports` | التقرير | `/report` |
| `data.import` | `/data/import` | الاستيراد | `/import` |
| `data.coverage` | `/data/coverage` | التغطية | `/coverage` |
| `data.settings` | `/data/settings` | الإعدادات | `/settings` |
| `data.trash` | `/data/trash` | سلة المحذوفات | `/settings/trash` |

- تبويبات جديدة (مثل `cash.collections`، `reports.exports`، `data.backups`) تُضاف بحرية بمفاتيح `<section>.<x>`.
- المسارات القديمة تبقى تعمل (تحويل `replace` مع الحفاظ على `?query`) — الصفحات القديمة تستعمل `<Link to="/suppliers/…">`.
- `/projects/budget` و`/projects/admin` ثابتان يغلبان `/projects/:project` (ترتيب react-router).
- شريط التبويبات يُبنى تلقائياً: يظهر إن كان للقسم ≥ ٢ تبويب. النقر على القسم في الشريط الجانبي يفتح آخر تبويب زاره المستخدم فيه.
- التنقل: `import { useGo, pathOf } from '@/shell'; const go = useGo(); go('parties.supplier', { account })` — المفتاح أو الاسم المستعار؛ المعاملات التي ليست في
  المسار تصير `?query`. أو `useNavigate()` من react-router مع `pathOf(key, params)`.
- المعاملات: `useParams()` و`useSearchParams()` من `react-router-dom` كالمعتاد.

## ٢ · الحاوية والـCSS

- الهيكل يرسم عرضك داخل: `<main> → .island-dock → .tabs → <div class="view sec-<section>"> {عرضك} </div>`.
- عرضك يبدأ بـ`<PageHeader>` ثم `<Grid>` من `<Island>`/`<Kpi>` — تماماً كـ`prototype/sections/<name>.js`.
- ملف CSS للقسم: `src/sections/<name>/<name>.css`، يُستورد في `index.tsx` أو المكوّن. **كل محدِّد يبدأ بـ`.sec-<name>`**
  (مثال `.sec-parties .sum{…}`) — انقل `prototype/sections/<name>.css` كما هو (هو أصلاً مسبوق بـ`.sec-<name>`).
- فئات النظام الجاهزة (من `src/styles/archipelago.css`، منقولة من النموذج): `.grid` `.c3 .c4 .c6 .c8 .c12` · `.isl` `.isl.click`
  `.isl.crit` · `.ih` · `.ph` · `.btn` `.btn.primary|danger|ghost|sm` · `.pill.d|w|o|n` · `.chip` · `.seg` · `.tbl-wrap` · `.cap`
  `.meta` `.hero` `.kpi` `.t-danger|t-ok|t-warn` · `.delta.bad|good` · `.num` `.cur` · `.dash` · `.empty-note` · `.disclose`
  · `.fresh.ok|old` · `.crumb` · `.sum` · `.cal` `.ev.*` · `.drop` · `.setrow` `.sw` · `.paper` · `.mini` · `.legend` · `.quality`.
- الألوان/المسافات: رموز `tokens.css` فقط — `--surface-1..3` `--text-1..3` `--border-1/2` `--divider` `--danger|warn|ok|info-{fg,bg,solid}`
  `--chart-1..4` `--chart-neg` `--brand-gold` `--brand-bronze` · المسافات `--s-1(4) --s-2(8) --s-3(12) --s-4(16) --s-5(20) --s-6(24) --s-8(32) --s-10(40) --s-12(48) --s-16(64)`
  · الخط `font: var(--t-title|t-heading|t-body|t-caption|n-hero|n-kpi|n-inline)` · نصف القطر `--r-control 8 · --r-card 14 · --r-island 20 · --r-pill`
  · الظل `--e-1..3` · الحركة `--d-fast|base|slow|spring` `--ease-out|in|inout|spring`.
- الحركة: `prefers-reduced-motion` مُعالَج عاماً. لا تحريك لعرض/ارتفاع؛ transform/opacity فقط.

## ٣ · البيانات — `@/data`

```ts
import { useOverview, useSuppliers, useApi, useApiMutation, invalidate, qk, api } from '@/data';
```
- **TanStack Query v5.** `staleTime 30s`، `refetchOnWindowFocus`، `placeholderData: keepPreviousData` (لا وميض عند تغيير الفرز/التصفية).
- **مفاتيح الاستعلام**: الجذر نص يطابق مفاتيح `invalidate` في SSE: `qk.<name>(...)` →
  `['dashboard', p]` `['overview']` `['today']` `['suppliers', q]` `['supplier', account, p]` `['contractors', q]` `['contractor', code]`
  `['guarantees']` `['projects']` `['project', name]` `['budget', …]` `['cashflow', p]` `['revenues', p]` `['coverage', days]`
  `['report', …]` `['backups']` `['trash', kind]` `['imports']` `['events', status]`.
- hooks جاهزة (كلها `UseQueryResult<T>`): `useDashboard(p)` · `useOverview()` · `useToday()` (`/api/v1/today` — إن لم يوجد بعد يعيد خطأ هادئاً)
  · `useSuppliers(q)` · `useSupplier(account, p)` · `useContractors(q)` · `useContractor(code)` · `useGuarantees()` · `useProjects()`
  · `useProject(name)` · `useBudget()` · `useCashflow(p)` · `useRevenues(p)` · `useCoverage(staleDays)` · `useBackups()` · `useTrash(kind?)` · `useImportHistory()`.
- نقطة لا hook لها: `useApi(['root', ...args], () => api.something(args), opts?)`.
- الطفرات:
```ts
const save = useApiMutation((b: Body) => api.updateSupplier(account, b), {
  invalidate: ['suppliers', 'supplier', 'overview'],   // جذور المفاتيح
  success: 'حُفظ المورد',                              // toast نجاح (اختياري)
  // الخطأ: toast خطأ تلقائياً برسالة الخادم العربية؛ errorToast:false لتعطيله
});
await save.mutateAsync(body);
```
  **لا تحديث تفاؤلي لأي رقم مالي.** التفاؤلي مسموح للأرشفة/التثبيت/السلة فقط.
- `invalidate(['suppliers'])` يدوياً؛ `invalidate('*')` الكل. أحداث `invalidate` من الخادم تُطبَّق تلقائياً.
- الفرز والتصفية **على الخادم** حين يدعمها المسار (`SupplierQuery.sort/dir/q/…`) — استعمل `DataTable mode="server"`.

## ٤ · مكتبة المكوّنات — `@/ui`

```ts
import { PageHeader, Grid, Island, Kpi, Money, Num, Pill, Chip, Seg, Tabs, Button, DataTable, Modal, confirm,
  toast, Drawer, useForm, Field, FormGrid, Sparkline, LineChart, ExportDialog, toCSV, EmptyState, Skeleton,
  fmt, int, compact, digits, dateTxt, ago, normAr, parseNum, sumHalalas, usePrefs, useCountUp, Icon } from '@/ui';
```

### ٤.١ تخطيط
| المكوّن | Props |
|---|---|
| `PageHeader` | `title: ReactNode` · `sub?: ReactNode` (سطر السياق) · `actions?: ReactNode` (أزرار يساراً) · `crumb?: {label, onClick}` (رابط رجوع فوق العنوان) |
| `Grid` | `children` — شبكة ١٢ عموداً بفجوة 16، أقصى 1360 |
| `Island` | `span?: 3\|4\|6\|8\|12` (افتراضي 12) · `title?: ReactNode` · `link?: {label, onClick}` (رابط «عرض الكل» في الرأس) · `actions?: ReactNode` · `crit?: boolean` (شريط أحمر 3px + نقطة) · `onClick?` (يصبح `.isl.click` قابلاً للوحة المفاتيح) · `i?: number` (ترتيب التتابع) · `className?` · `children` |
| `Button` | `kind?: 'primary'\|'danger'\|'ghost'` · `size?: 'sm'` · `icon?: IconName` · بقية خصائص `<button>` |

### ٤.٢ أرقام وشارات
| المكوّن | Props |
|---|---|
| `Money` | `value: number\|null` · `className?` · `count?: boolean` (عدّاد عند أول ظهور) · `countKey?: string` · `noCur?: boolean` — `null` → «—» |
| `Num` | `value` · `int?: boolean` · `className?` |
| `Kpi` | `label: ReactNode` · `value: number\|null` · `money?: boolean` (افتراضي true؛ false = عدد صحيح) · `tone?: 'danger'\|'ok'\|'warn'` · `size?: 'hero'\|'kpi'` · `hint?: ReactNode` (سطر `.meta`) · `spark?: number[]` · `badge?: ReactNode` · `badgeTone?: PillTone` · `crit?` · `onClick?` · `span?: 3\|4\|6\|8\|12` (افتراضي 3) · `i?` · `countKey?` |
| `Pill` | `tone?: 'danger'\|'warn'\|'ok'\|'neutral'` · `children` |
| `Chip` | `pressed?` · `onClick` · `count?: number` · `children` |
| `Seg` | `value` · `onChange(v)` · `options: {value, label}[]` · `label` (aria) |
| `Tabs` | `value` · `onChange(v)` · `tabs: {value, label, badge?}[]` · `label` — تبويبات داخل الصفحة بنفس شكل تبويبات القسم |

### ٤.٣ `DataTable<T>`
```tsx
<DataTable<Row>
  id="parties.suppliers"            // يحفظ الأعمدة المخفية (تفضيل محلي)
  rows={rows} rowKey="account"      // أو (r) => string
  columns={[
    { key: 'name', label: 'المورد', render: (r) => <b>{r.name}</b>, searchValue: (r) => r.name + ' ' + r.account },
    { key: 'outstanding', label: 'المستحق', money: true },
    { key: 'delay', label: 'التأخر', num: true, render: (r) => <Pill tone="danger">…</Pill>, sortValue: (r) => r.delayDays },
    { key: 'last', label: 'آخر حركة', date: true, hidden: true },
  ]}
  sort={{ key: 'outstanding', dir: 'desc' }}
  filters={[{ key: 'status', label: 'الحالة', options: [{ value: 'late', label: 'متأخر', test: (r) => r.delayDays > 0 }] }]}
  total={{ keys: ['outstanding'], label: 'الإجمالي' }}
  selectable selectionBar={{ label: 'المحدد', sumKey: 'outstanding', actions: [{ label: 'تسجيل دفعة', onClick: (chosen, clear) => … }] }}
  onRowClick={(r) => go('parties.supplier', { account: r.account })}
  toolbar={<Button size="sm" onClick={…}>تصدير</Button>}
  empty={{ icon: 'users', title: 'لا موردين بعد', body: '…', cta: 'استيراد', onCta: … }}
/>
```
- `Column<T>`: `key` · `label` · `money?` · `num?` (`decimals?`) · `date?` (`year?`) · `render?(r)` · `value?(r)` · `sortValue?(r)`
  · `searchValue?(r)` · `totalValue?(r)` · `sort?: false` · `hidden?` · `required?` (لا يُخفى) · `width?` · `className?`.
- أول نقرة على عمود رقمي = تنازلي، نصي = تصاعدي؛ الثالثة تعيد الافتراضي. `aria-sort` مضبوط.
- البحث بتطبيع عربي (`normAr`)؛ شرائح التصفية تعرض العدد لكل خيار؛ صف الإجمالي من **كل الصفوف المصفّاة**.
- لوحة المفاتيح: ↑/↓ بين الصفوف، Enter يفتح، Space يحدد. فوق ٢٠٠ صف: افتراضية (الصفوف المرئية فقط، رأس لاصق داخل
  إطار قابل للتمرير)، وتُعطَّل تلقائياً عند الطباعة.
- `mode="server"`: الجدول لا يفرز/يصفّي/يبحث محلياً؛ يبلّغ `onQueryChange({ q, sort, filters })` وأنت تمرّر الصفوف المرتبة
  من الخادم و`totals?: Record<key, number>` (إجماليات الخادم) و`filterCounts?: Record<filterKey, Record<value, number>>`.
- `density?: 'compact'` · `searchPlaceholder?` · `searchKeys?` · `search?: false` · `columnMenu?: false` · `rowClass?(r)` · `onSelect?(keys, rows)` · `selected?: Set<string>` (تحكّم خارجي).

### ٤.٤ طبقات
- `Modal`: `open` · `onClose` · `title` · `size?: 'sm'|'md'|'lg'` · `actions?: {label, kind?, onClick?(close), disabled?}[]` · `dirty?` (true = متسخة صراحةً)
  · `autoDirty?: false` (تعطيل التتبع التلقائي — لنوافذ بلا إدخال حقيقي؛ `dirty={false}` لم يعد يعطّله) · `testId?` · `children`. الحارس «تجاهل التغييرات غير المحفوظة؟» يعمل تلقائياً حين تُكتب أي قيمة داخل النافذة؛
  `close(true)` بعد الحفظ يتجاوزه. Esc/فخ تركيز/قفل تمرير/إعادة التركيز مضمّنة. خطأ يُرمى من `onClick` → toast خطأ والنافذة تبقى.
- `confirm({ title, body, danger?, confirmLabel?, cancelLabel? }): Promise<boolean>` — من أي مكان.
- `Drawer`: `open` · `onClose` · `title` · `actions?: ReactNode` (رأس) · `width?: number` · `children` — درج من اليسار بنمط درج الإشعارات.
- `toast(text, { kind?: 'ok'|'info'|'error', undo?: () => void, duration? })` → `{ close }`. للحذف/الأرشفة استعمل `undo` دائماً.

### ٤.٥ النماذج
```tsx
const form = useForm({ name: '', account: '', amount: null as number | null, date: '', projects: [] as string[] }, {
  account: { required: true, pattern: /^211\d+$/, message: 'رقم حساب المورد يبدأ بـ211' },
  amount: { required: true, min: 0.01 },
  name: (v) => (String(v).trim() ? null : 'الاسم مطلوب'),          // دالة مخصّصة → رسالة أو null
});
<Modal open={open} onClose={close} title="مورد جديد" dirty={form.dirty}
  actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', onClick: async (close) => {
    if (!form.validate()) return;                 // يعرض الأخطاء، يهزّ الحقل (m-shake)، يركّز أول خطأ
    await save.mutateAsync(form.values); close(true);
  } }]}>
  <FormGrid>
    <Field form={form} name="name" label="الاسم" required />
    <Field form={form} name="account" label="رقم الحساب" dir="ltr" />
    <Field form={form} name="amount" label="المبلغ" type="money" />
    <Field form={form} name="date" label="التاريخ" type="date" />
    <Field form={form} name="projects" label="المشاريع" type="multiselect" options={projects} full />
  </FormGrid>
</Modal>
```
- `type`: `text`(افتراضي) · `number` · `money` (نص + «ر.س»، يقبل ١٢٣ و٬ و(سالب)) · `date` · `month` · `select` · `multiselect` · `checkbox` · `textarea` · `tel` · `email`.
- خصائص `Field`: `label` · `required?` · `help?` · `placeholder?` · `options?: (string | {value, label})[]` · `full?` (عرض كامل) · `readOnly?` · `disabled?` · `dir?` · `min?` `max?` `step?` · `checkLabel?` · `rows?`.
- `form`: `values` · `set(name, v)` · `setValues(patch)` · `errors` · `setError(name, msg|null)` · `validate(): boolean` · `dirty` · `reset(values?)`.
  `money`/`number` تُقرأ أرقاماً (`null` إن فارغ، `NaN` إن تالف → «أدخل رقماً صحيحاً»).

### ٤.٦ مخططات وحالات
- `Sparkline`: `points: number[]` · `color?` (CSS var) — الأقدم يميناً.
- `LineChart`: `series: {name, values: (number|null)[], color?, dashed?}[]` · `dates?: string[]` · `xLabels?: string[]` · `height?` (280)
  · `negArea?` (افتراضي true: منطقة حمراء تحت الصفر للسلسلة الأولى + نقطة أول عجز) · `xTicks?` · `label` (aria).
- `EmptyState`: `icon?: IconName` · `title` · `body?` · `cta?` · `onCta?`. `Skeleton`: `rows?` — يظهر بعد 200ms فقط.
- `ExportDialog`: `open` · `onClose` · `title` · `fileName` (‎.csv) · `csv?: string` أو `columns+rows` (يُبنى بـ`toCSV`) · `xlsxUrl?: string`
  (رابط Excel من الخادم مثل `api.exportExcelUrl(params)` أو `api.projectSummaryExportUrl(...)`) · `pdf?: { filename, landscape? }`
  (في Electron: `window.egco.exportPdf` يطبع الصفحة الحالية إلى PDF؛ في المتصفح: `window.print()`). معاينة أول ٢٠٠ صف، «نسخ»، «تنزيل CSV».

### ٤.٦ب أيقونات
`<Icon name size? stroke? />` — الأسماء: `inbox search check file trash cloud bell alert users close archive columns chevron collapse sun grid trend
report db download copy edit plus more print upload filter refresh calendar link external arrowBack info lock star`. تحتاج غيرها؟ اطلبها من F.

### ٤.٧ تنسيق
`fmt(n)` مبلغ بخانتين و«−» · `int(n)` · `compact(n)` («4.71 م») · `digits(s)` · `dateTxt(d, {weekday?, year?})` · `ago(d)` · `normAr(s)`
· `parseNum(s)` · `sumHalalas(rows, get)`. المكوّن الذي يستدعي هذه مباشرة يستدعي `usePrefs()` ليُعاد رسمه عند تبديل ١٢٣/١٢٣.

## ٥ · الهيكل — `@/shell`

```ts
import { island, notify, useNotifications, openNotifications, openPalette } from '@/shell';
island.event('import', { pct: 42, file: 'كشف المنار.pdf' });   // S2 — pct>=100 أو done:true → ينكمش بعد 700ms
island.event('backup', { phase: 'start' });                     // S3 دائرة
island.event('backup', { phase: 'done', sizeKb: 812 });         // S3 ✓ «تم الحفظ» 1600ms
island.event('deficit', { detail: 'الرصيد يصبح −182,400.00 ر.س في 3 ديسمبر', ms: 6000 }); // S4 — «عرض» → النقد
island.event('idle');
notify.local({ severity: 'ok', title: 'اكتملت النسخة الاحتياطية', detail: '…', link: { view: 'data.settings' } });
const { items, unread } = useNotifications();
```
- الأولوية: S4 > S2 > S3 > (S1 | S0). S1 = يوجد غير مقروء. تفضيل «الجزيرة» مطفأ = S4 فقط.
- أحداث الخادم (SSE `GET /api/v1/events/stream`، أو استطلاع `/api/v1/events` كل 30ث) تُطبَّق تلقائياً: `notification` → الدرج
  (+ S4 لـ`danger` و`kind:'deficit'`، + إشعار نظام إن كانت النافذة غير مركّزة)، `invalidate` → `invalidate(keys)`، `progress` → S2/S3.
  **لا تفتح EventSource بنفسك.** تقدّم استيراد/نسخة تطلقه أنت محلياً → `island.event(...)` مباشرة.
- روابط الإشعارات `link: { view, params }` تُحلّ عبر `key` أو `aliases` في سجلّك (قسم §١)؛ `params.id` يملأ أول معامل مسار إن غاب اسمه.
- لوحة ⌘K: الصفحات (كل تبويب) + الموردون/المقاولون/المشاريع + `commands` من كل قسم. ⌘. يفتح الإشعارات.

## ٦ · ما يُمنع
- `fetch` مباشر لنقاط `/api/v1/*` خارج `@/data` (استثناء: روابط التنزيل `api.*ExportUrl`).
- localStorage لحالة مالية أو مشتركة. التفضيلات المحلية: `uiPref(key, fallback)` / `setUiPref(key, v)` من `@/ui`.
- `window.confirm/alert`. استعمل `confirm()`/`toast()`.
- أي نص إنجليزي ظاهر، أي لون hex في CSS القسم، أي `!important` جديد.

## ٧ · سجلّ التغييرات
- 2026-11-17 · مسودة أولى نهائية الأسماء (F).

## ٨ · معرّفات الاختبار (QA)
- `Modal`: `testId?` على النافذة، و`testId?` لكل إجراء في `actions`. الحارس: `unsaved-guard` · `unsaved-back` · `unsaved-discard`. التأكيد المشترك: `confirm-dialog` · `confirm-ok`.
- `DataTable`: `rowTestId?: (row) => string` → `data-testid` على كل `<tr>`.
- `Kpi` و`Island`: `testId?: string`.
- `Seg` و`Tabs`: كل خيار يقبل `testId?` — من استبدل `Seg` بأزرار عادية لأجل المعرّفات يعود إلى `Seg`.
- حارس النوافذ: يعمل تلقائياً عند أي إدخال حتى لو مُرِّر `dirty={false}`؛ للتعطيل استعمل `autoDirty={false}`، أو `data-no-dirty` على العنصر.
- 2026-11-18 · حارس تلقائي دائماً (autoDirty)، معرّفات الاختبار (§٨).
