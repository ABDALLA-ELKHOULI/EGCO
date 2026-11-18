# PARITY — قسم «النقد» (S4)

المصدر القديم ← المكان الجديد. الحالة: ✅ منفَّذ ومُتحقَّق في المتصفح · 🔷 منفَّذ، tsc نظيف (المشروع كله)، **لم يُجرَّب في المتصفح بعد** · ❌ غير مغطّى · ⛔ يحتاج الخادم/قراراً.
العروض: `cash.flow` (`/cash/flow`، يحوّل `/cashflow`) · `cash.revenues` (`/cash/revenues`، يحوّل `/revenues`) · `cash.collections` = اسم مستعار لـ`cash.revenues` (النموذج يسمّيها «التحصيلات»؛ العقد يحجز `cash.revenues` للاستبدال).

## البنية المقرّرة

```
sections/cash/
  index.tsx            SectionModule: cash.flow, cash.revenues (+aliases cashflow/collections/revenues), أوامر ⌘K
  cash.css             نقل prototype/sections/cash.css كما هو (.sec-cash …)
  types.ts             ✅ أنواع الاستجابات حرفياً من cashflow_service.py / revenues.py
  api.ts               ✅ مؤقت — يُحذف حين يصل @/data (العقد §٦)
  hooks.ts             ✅ useCashflow · useBreakdown · useScenarioRows · useRevenues · useCashMutation · revenueMutations · invalidateCash
  logic/money.ts       ✅ هللات صحيحة + تواريخ ISO بالـUTC
  logic/scenario.ts    ✅ applyScenario (فروق فوق فترات الخادم) · assertBaselineMatches · toItems/itemKey · حفظ عبر uiPref
  logic/recon.ts       ✅ outflowTerms/inflowTerms (ترتيب المعادلة + المصطلح القابل للتفصيل) · hasDrift · RECON_DIFF_REASONS
  logic/collections.ts ✅ revenueState · collectionsKpis (in30/thisMonth/undated/late) · daysLate · unitsForClient
  logic/prefs.ts       ✅ HORIZONS · PERIOD_PRESETS · clamp · parseParties · loadPrefs/savePrefs (uiPref + ترحيل مفتاح القديم)
  CashFlowView.tsx     ← PageHeader + فلاتر + Callouts + HeroIsland(LineChart) + ScenarioIsland + KpiCarousel + PeriodTables + ReconIsland
  RevenuesView.tsx     ← 4×Kpi + DataTable(mode=server) + RevenueModal + CollectModal
  parts/BreakdownModal.tsx · parts/ExplainDot.tsx · parts/KpiCarousel.tsx · parts/ReconFooter.tsx
  parts/ReconDiffAsk.tsx · parts/ScenarioPanel.tsx · parts/PeriodTable.tsx · parts/RevenueForm.tsx · parts/WhatIfServer.tsx
```

## CashFlow.tsx (1090 سطراً)

| P-id | # | القدرة | القديم file:line | الجديد | الحالة |
|---|---|---|---|---|---|
| P-442 | 1 | جلب /cashflow مع إلغاء السباق (seq) | CashFlow.tsx:124-136 | hooks.ts `useCashflow` (AbortController؛ لاحقاً TanStack `['cashflow',p]`) | 🔷 |
| P-204,P-207 | 2 | فلتر المشروع في الرابط `?project=` | :87,142-146,208-211 | CashFlowView: `<select>` المشاريع من `d.projects`؛ يبقى في `?project` | 🔷 |
| P-204,P-205,P-212 | 3 | فلتر الأطراف `?parties=` افتراضي both، يُرسل صراحةً | :88-92,148-152,245-253 | `Seg` كلاهما/موردون/مقاولون · `prefs.parseParties` · api يرسل parties دائماً | 🔷 |
| P-204,P-210 | 4 | طول الفترة `?period_days=` 1..92 + مخصّص | :40-43,93-98,154-170,223-243 | `prefs.PERIOD_PRESETS/clampPeriodDays` + خيار «مخصّص» بحقل أيام | 🔷 |
| P-209 | 5 | الأفق بالأسابيع 13/26/52/104 | :217-222 | `prefs.HORIZONS` (+٥ أسابيع للنموذج «٣٠ يوماً») كـ`Seg` | 🔷 |
| P-208 | 6 | الرصيد الافتتاحي + زر «تطبيق» | :85,99,138-140,212-216 | حقل في رأس البطل («البنك اليوم») يُرسل opening_balance. **لا يُحفظ** — ⛔ رصيد بنكي على الخادم مطلوب كي يعمل «جزيرة الإعداد» في النموذج | 🔷 (تراجع يدوي) / ⛔ |
| P-206 | 7 | تحذير «لا تحصيلات» / تحذيرات الخادم | :193-205 | Callouts `.sec-cash-call.w` تعرض `d.warnings` حرفياً + زر «أضف تحصيلاً» → `cash.revenues?new=1` | 🔷 |
| P-218 | 8 | أول عجز (التاريخ والمبلغ) | :260-265 | Pill «عجز من …» في رأس البطل؛ النقر يثبّت الفترة ويمرّر إليها | 🔷 |
| P-219 | 9 | مستحق مقاولين بلا تواريخ (callout) | :180,267-272 | Callout يعرض `undatedContractorDues` حين parties≠suppliers | 🔷 |
| P-220 | 10 | ملاحظة نطاق رصيد المقاولين مع فلتر مشروع | :274-279 | Callout `.i` يعرض `contractorBalanceScopeNote` حين project≠'' | 🔷 |
| P-221 | 11 | مخطط أعمدة داخل/خارج لكل فترة (عجز بالأحمر) | :282-312 | HeroIsland: `LineChart` للرصيد (+ منطقة سالبة) وأعمدة داخل/خارج أسفله كما في النموذج | 🔷 (ينتظر LineChart) |
| P-221 | 12 | شريط الرصيد التراكمي لكل فترة | :314-323 | تلميح المخطط (hover/لوحة مفاتيح) + عمود الرصيد في جدول الفترات | 🔷 |
| P-222,P-211 | 13 | «كل صف = N أيام» + شرح الأعمدة | :329-332 | سطر `.cap` فوق الجدول + ExplainDot `cashflowColumns` | 🔷 |
| P-222 | 14 | جدول الفترات: متوقّع · محصّل فعلي · خارج · صافي · رصيد · شارة عجز | :333-387 | PeriodTable — النموذج يفصل الداخل/الخارج في جزيرتين c6 قابلتين للتوسيع؛ نُبقي أيضاً عمودي «المحصّل الفعلي» و«الرصيد» (لا نقص) | 🔷 |
| P-223,P-443 | 15 | كل خلية مبلغ قابلة للنقر → تفصيل بفترتها (`period=from`) | :355-375 | `useBreakdown(q, term, period.from)` من صف الفترة | 🔷 |
| P-222 | 16 | حدّ ٦٠ صفاً + رسالة | :44,348,388-392 | `prefs.MAX_RENDERED_PERIOD_ROWS` + نفس الرسالة | 🔷 |
| **P-224**,P-596 | 17 | المطابقة: مجدول+متأخر+بعد+بلا تواريخ(−دائن−زائد)=المديونية، شارة «مطابق بالهللة»/«فرق غير مفسَّر» | :411-544 | ReconFooter ← `recon.outflowTerms` + `hasDrift` | 🔷 |
| P-225 | 18 | معادلة الداخل = المستحق المفتوح | :511-528 | `recon.inflowTerms` | 🔷 |
| **P-224**,P-443 | 19 | كل مصطلح خارج قابل للنقر → تفصيل | :484-499 | `term`/`rule` في `ReconTermView` | 🔷 |
| P-226 | 20 | نص الإفصاح «لا شيء من هذه الثلاثة داخل الرصيد» + horizonEnd | :530-536 | `.disclose` في ReconIsland | 🔷 |
| **P-227**,P-444,P-546 | 21 | سؤال سبب الفرق + حفظه (POST reconciliation-note) + «تغيير التفسير» | :553-625 | ReconDiffAsk ← `cashApi.saveReconNote` + `RECON_DIFF_REASONS` | 🔷 (⛔ api.* غير موجود في lib/api.ts) |
| P-213,P-539 | 22 | الشريط المنزلق ٣ صفحات: أسهم RTL، لوحة مفاتيح، سحب، نقاط، حفظ الصفحة | :61-67,105-107,627-714 · Carousel.tsx:15-88 | KpiCarousel (نسخة النموذج: track بـtransform، `inert` للشرائح المخفية) · `prefs.kpiView` + ترحيل `egco.cashflow.kpiView` | 🔷 |
| P-214,P-598 | 23 | «الحالي»: داخل متوقّع · محصّل خلال المدى · خارج · صافي · أدنى رصيد — كلها قابلة للنقر | :729-772 | الشريحة ١ — النموذج يضيف «الرصيد بعد الأفق» في البطل | 🔷 |
| P-215 | 24 | «أدنى رصيد» ينقل لفترته ويبرزها ٢.٢ث (مطابقة بقيمة الخادم لا حساب) | :113-122,758-763 | `jumpToMin`: فهرس الفترة ذات `balance===summary.minBalance` (بالهللة)، تثبيت + تمرير + `.sec-cash-pin` | 🔷 |
| P-216 | 25 | «المتأخر»: خارج/داخل متأخر، أدنى رصيد لو سُدّد/حُصّل اليوم، جدول أعمار ٤ فئات | :779-825 | الشريحة ٢ من `overdueView` كما هو + `prefs.ageBucketLabel` + نقر الخارج المتأخر → term=overdue | 🔷 |
| P-217,P-598 | 26 | «المتوقع مقابل الفعلي» + الفجوة | :833-851 | الشريحة ٣ من `forecastVsActual` | 🔷 |
| **P-228**,P-443,P-597 | 27 | نافذة «من أين جاء هذا الرقم؟»: ٣ أشكال صفوف، روابط للمورد/المقاول، إجمالي، «أول ٥٠٠ صف» | :10-36,857-978 | BreakdownModal ← `useBreakdown` + type guards في types.ts؛ الروابط عبر `go('parties.supplier',{account})`/`go('parties.contractor',{code})`؛ + تصدير CSV (النموذج) | 🔷 |
| P-211,P-370 | 28 | نقاط الشرح ExplainDot (cashflowHorizon/Columns/Reconciliation/NetPeriod/MinBalance) | :244,331,477,755,762 · Explain.tsx:9-55 | parts/ExplainDot: نفس `EXPLANATIONS` من lib/explanations.ts داخل `Modal` الجديد (ⓘ) + تعريفات النموذج الإضافية (end/today/lateOut/lateIn/exp/act/gap) | 🔷 |
| P-229,P-490 | 29 | بطاقة «ماذا لو؟» عبر الذكاء (/ai/what-if) — تظهر فقط إن كان المساعد مفعّلاً | :980-1090 | WhatIfServer داخل لوحة السيناريو («اسأل المساعد») — الأرقام من الخادم، النص فقط من المساعد | 🔷 |
| P-221 | 30 | حالة فارغة «لا حركة نقدية في هذا الأفق» | :181-182,285-287 | EmptyState داخل البطل | 🔷 |
| —  31 | ErrorState + إعادة المحاولة / «جارٍ التحميل» | :172-173 | `Skeleton` + جزيرة خطأ بزر `refetch` | 🔷 |

### جديد من النموذج (فوق القديم)
| القدرة | prototype/sections/cash.js | الجديد | الحالة |
|---|---|---|---|
| سيناريو: تأجيل بند N يوماً، سداد متأخر بتاريخ، تحصيل افتراضي، حذف/مسح مع تراجع، حفظ | :413-421,537-552,568-577 | `logic/scenario.ts` (فروق فوق فترات الخادم، خط الأساس متقطع، `skipped` معروض) + ScenarioPanel | 🔷 |
| «أضف للتحصيلات» من تحصيل افتراضي (scn-commit) | :545-550 | `revenueMutations.create` ثم إزالة التعديل | 🔷 |
| مخطط تفاعلي: تلميح، تثبيت بالنقر/Enter، أسهم ±1/±7، Esc، إبراز صفوف الفترة | :446-505 | HeroIsland فوق `LineChart` (أو SVG محلي إن لم يدعم LineChart التثبيت) | 🔷 |
| جداول داخل/خارج قابلة للتوسيع بالبنود | :387-401 | PeriodTable + `useBreakdown(term, period)` عند التوسيع | 🔷 |
| افتراض +٣٠ يوماً لمستخلصات بلا تاريخ (assumeTerm) | :97-105,355 | **حُسم: لا يُنقل** (اختراع تاريخ) | — |
| جزيرة إعداد الرصيد البنكي عند غيابه | :239-253 | `BankSetup` + «تعديل الرصيد» على `GET/PUT /api/v1/settings/bank-balance` (طلب مباشر؛ 404 ⇒ حقل يدوي غير محفوظ) | 🔷 ⛔ B |
| شارة تبويب: عجز خلال ٣٠ يوماً / تحصيلات متأخرة | :757-763 | `useBadge`: `summary.firstDeficit?1:0` · `totals.overdueOpen>0` عدد ⛔ (الخادم يعيد المبلغ لا العدد) | 🔷 |

## Revenues.tsx (394 سطراً) ← `cash.revenues`

| P-id | # | القدرة | القديم | الجديد | الحالة |
|---|---|---|---|---|---|
| P-231 | 32 | KPI مستحق مفتوح / محصّل / إجمالي + شرح | Revenues.tsx:125-134 | Kpi من `totals.open/collected/all` + ExplainDot revenuesOpen/Collected/Total | 🔷 |
| —  33 | KPI النموذج: متأخر · خلال ٣٠ يوماً · محصّل هذا الشهر (نقر → تفصيل) | cash.js:684-693 | متأخر = `totals.overdueOpen` (خادم) · ٣٠ يوماً/هذا الشهر = `collectionsKpis` بالهللات ⛔ يفضَّل نقلها للخادم | 🔷 |
| P-230,P-233,P-492 | 34 | بحث (عميل/وحدة)، مشروع، حالة، مدى تاريخ استحقاق، مدى مبلغ — على الخادم | :17-23,38-44,158-175 | DataTable `mode="server"` → `RevenuesQuery` | 🔷 |
| P-230,P-233 | 35 | فرز على الخادم بستة أعمدة | :24,43,158-176 · revenues.py `_SORT_KEYS` | `RevenueSortKey` | 🔷 |
| P-230 | 36 | debounce ٢٠٠ms + seq | :46-64 | keepPreviousData + debounce البحث في الجدول | 🔷 |
| P-232 | 37 | عدّاد النتائج + «مسح كل التصفية» | :136-139 | شريط أدوات DataTable | 🔷 |
| P-235 | 38 | حالتان فارغتان (بلا بيانات / بلا نتائج) مع CTA | :143-152 | `empty` prop | 🔷 |
| P-234 | 39 | خلية بلا تاريخ «—» بتلميح «لا يدخل توقع التدفق» + callout عدد بلا تاريخ | :190-193 · cash.js:681 | `.dash` + Callout من `totals.undatedOpen` | 🔷 |
| P-233 | 40 | شارة الحالة؛ النموذج «متأخر N يوماً» | :195-197 · cash.js:705-709 | `revenueState`/`daysLate` | 🔷 |
| P-233 | 41 | المصدر يدوي/ملف | :198 | عمود «المصدر» (مخفي افتراضياً) | 🔷 |
| P-236,P-240,P-493 | 42 | إضافة تحصيل (نموذج: عميل datalist، مشروع datalist، وحدة مقترحة حسب العميل، مبلغ>0، استحقاق، حالة، تاريخ تحصيل إلزامي إن محصّل، ملاحظات) | :221-226,260-358 | RevenueForm بـ`useForm` + `unitsForClient` | 🔷 |
| P-238,P-494 | 43 | تعديل | :86-104,228-247 | نفس النافذة | 🔷 |
| P-237,P-494 | 44 | «تحصيل» سريع (تاريخ اليوم) | :201-206,238-239 | CollectModal → `revenueMutations.collect` + toast تراجع | 🔷 |
| —  45 | إلغاء التحصيل (النموذج) | cash.js:719 | `revenueMutations.uncollect` + تراجع | 🔷 |
| P-239,P-495 | 46 | حذف مع تأكيد + تنبيه «صف مستورد — يمكن إعادة رفعه» | :249-255,360-394 | `confirm({danger})` بنفس النص + toast تراجع ⛔ (لا مسار استعادة للتحصيل؟ يُتحقَّق من /trash) | 🔷 |
| —  47 | النقر على الصف = تعديل؛ `?new=1` يفتح الإضافة؛ `?id=` يفتح التحرير | cash.js:702,740-741 | onRowClick + useSearchParams | 🔷 |
| —  48 | تصدير CSV | cash.js:725-729 | ExportDialog (`columns+rows`) | 🔷 |
| —  49 | حالات «قيد الاعتماد/معتمد» | cash.js:621-626 | ⛔ الخادم يعرف `open|collected` فقط — لا تُعرض حالة لا يخزّنها الخادم | ⛔ |

## PeriodBar.tsx / Carousel.tsx / Explain.tsx
| القدرة | القديم | الجديد |
|---|---|---|
| من/إلى تاريخ + تطبيق | PeriodBar.tsx:6-27 | **غير مستعمل في النقد** (يستعمله Report/Dashboard) — يبقى على وكيلي اليوم/التقارير. في التحصيلات: فلتر مدى التاريخ في DataTable (#34) |
| Carousel العام | Carousel.tsx:15-88 | KpiCarousel داخل القسم؛ المكوّن العام يخص صفحة المقاولين (وكيل الأطراف) |
| ExplainDot | Explain.tsx:9-55 | parts/ExplainDot (#28) |

## ثغرات الخادم / طلبات (لـB وF)
1. **F:** `api.cashflowBreakdown(p)` و`api.saveCashflowReconNote(b)` في lib/api.ts (القديم كان يجلبهما بـfetch مباشر — ممنوع بالعقد §٦). و`qk.cashflowBreakdown`.
2. **F:** `@/data` و`@/ui` (index، Kpi، DataTable، useForm/Field، LineChart، ExportDialog) غير موجودة بعد ⇒ لا يمكن بناء العروض بـtsc نظيف.
3. **B:** رصيد بنكي محفوظ على الخادم (PLAN: «الرصيد البنكي») — وإلا يبقى opening_balance حقلاً مؤقتاً غير محفوظ.
4. **B:** `id` في صفوف `/cashflow/breakdown` (المفتاح الحالي مركّب من الحقول — `scenario.itemKey`).
5. **B:** breakdown لمصطلحات الداخل: `overdueIn`، `beyondIn`، `undatedIn` (معادلة الداخل غير قابلة للنقر الآن).
6. **B:** `totals.in30`، `totals.collectedThisMonth`، `totals.overdueOpenCount` في /revenues (تُحسب الآن في الواجهة بالهللات).
7. **حُسم (موافَق):** العقد §٢ «لا حساب مالي في الواجهة» مقابل السيناريو. المنفَّذ: فروق صحيحة بالهللات فوق خط أساس الخادم المعروض بجانبه، مع حارس `assertBaselineMatches`. بديل أنظف: `POST /cashflow/scenario` على الخادم بنفس شكل `Tweak[]`.

## بنود PARITY.md المُسندة إلى «cash» خارج الصفحتين

| P-id | القدرة | الجديد | الحالة |
|---|---|---|---|
| P-014 | مسارا `/cashflow` `/revenues` | `redirectFrom` في index.tsx (`cash.flow`/`cash.revenues`) — العقد §١ | 🔷 |
| P-015, P-241–P-244 | `/loans` `/obligations` `/expenses` «قريباً» (قالب ComingSoon) | `cash.loans`·`cash.obligations`·`cash.expenses` بلا تبويب (LoansView/ObligationsView/ExpensesView + parts/ComingSoon) بنفس النصوص؛ رابط «الموازنة» → `/projects/budget` | 🔷 |
| P-016, P-253–P-262, P-398, P-448 | التقويم `/calendar` | **حُسم: قسم «اليوم»** — ليس هنا | — |
| P-009, P-397 | `/payables` (today/cash) | today.due (العقد) — ليس هنا | — |
| P-021 | نقطة تنبيه التدفق في الشريط الجانبي | shell (F) — `useBadge` لـ`cash.flow` يغذّيها من `summary.firstDeficit` | 🔷 |
| P-370 | ExplainDot + ٣٢ مقياساً في lib/explanations.ts | parts/ExplainDot يستورد `EXPLANATIONS` كما هي (قراءة فقط) | 🔷 |
| P-596 | مطابقة بالهللة (حارس ٤٧٤٬١٤٧٫١٠) | الحساب يبقى على الخادم؛ الواجهة تعرض `difference` فقط (`recon.hasDrift`، ε=0.005 حرفياً) | 🔷 |
| P-597 | Σ صفوف التفكيك = الرقم، حتى مع القص | BreakdownModal يعرض `total` من الخادم لا مجموع الصفوف المعروضة + ملاحظة «أول ٥٠٠ صف» | 🔷 |
| P-598 | المتوقع والمحصّل منفصلان | لا يُجمعان في أي مكوّن؛ إفصاح نصي في شريحتي ١ و٣ | 🔷 |

### البنود عالية الخطورة (P-224 · P-227 · P-228) — ضمانات التصميم
- **P-224/P-225:** كل مصطلح يُقرأ من `reconciliation.outflow|inflow` كما هو؛ لا جمع في الواجهة. `credits`/`excess` تُعرض بإشارة «−» مكتومة **فقط إن ≠ 0** (CashFlow.tsx:500-501) ولا تدخل الحساب (الخادم أصلاً لا يطرح credits — `_combine_outflow`). الشارة من `difference` وحده.
- **P-227:** يظهر السؤال فقط حين `hasDrift(outflow.difference)`؛ التفسير المحفوظ يُعرض بدل السؤال مع «تغيير التفسير»؛ «أخرى» تتطلب نصاً غير فارغ؛ الحفظ يبطل `cashflow` (يعيد الجلب ليظهر `reconciliationNote`). النطاق = (parties, project) كما في الخادم — تغيير الفلتر يعرض تفسير ذلك النطاق.
- **P-228:** الإجمالي في تذييل النافذة = `BreakdownResponse.total` (الخادم)، لا مجموع الصفوف المعروضة (قد تُقصّ عند ٥٠٠). الأعمدة حسب نوع أول صف — يُحفظ سلوك القديم؛ لكن مع parties=both قد تختلط صفوف مورد ومقاول في نفس المصطلح ⇒ الجديد يعرض **جدولاً لكل نوع** (type guards في types.ts) بدل افتراض نوع الصف الأول (خلل كامن في CashFlow.tsx:912-921,958).

## الملفات المنفَّذة (المرحلة B)
`index.tsx` · `CashFlowView.tsx` · `RevenuesView.tsx` · `LoansView.tsx` · `ObligationsView.tsx` · `ExpensesView.tsx` · `cash.css`
· `parts/{BreakdownModal,BreakdownLite,ExplainDot,KpiCarousel,PeriodTable,BarsStrip,ReconFooter,ScenarioPanel,WhatIfServer,RevenueForm,ComingSoon}.tsx`

## فروق معروفة / متابعة
- **المخطط:** `LineChart` من @/ui لا يدعم التلميح/التثبيت بالنقر ولا الأعمدة ⇒ الأعمدة في `BarsStrip` (نقر = تثبيت الفترة في الجدول)، والتثبيت/التمرير عبر الجدول. تلميح المخطط التفاعلي من النموذج (أسهم ±١/±٧، Enter، Esc) ❌ ينتظر دعماً في LineChart أو قراراً بمخطط محلي.
- **أدنى رصيد:** القديم يبرز الصف ٢٫٢ث ثم يزيله؛ الجديد يثبّته (`.sec-cash-pin`) حتى نقرة أخرى — أوضح، وموثّق هنا كفرق مقصود.
- **التحصيلات — «مسح كل التصفية»:** DataTable `mode="server"` لا يقبل حالة استعلام متحكَّماً بها، فالزر يمسح مدى التاريخ/المبلغ وحالة الطلب، لكن قد يبقى نص البحث/الشريحة ظاهراً في الجدول. **طلب لـF:** prop `query` متحكَّم به.
- **حذف تحصيل بلا تراجع:** `receivables` ليست ضمن أنواع سلّة المحذوفات (`TrashKind`) ⇒ `confirm({danger})` بدل toast تراجع. **طلب لـB/F:** إضافة النوع للسلّة.
- **BUG-006 (أُصلح):** `/settings/bank-balance` = `{balance: نص|null, at}` (API-CONTRACT §٤). يُطلب مباشرةً (404 وحده ⇒ تراجع لحقل يدوي). مع رصيد محفوظ لا يُرسل `opening_balance` فيبدأ الخادم منه (`openingBalanceSource:"bank"`) — مُتحقَّق على نسخة خادم في scratchpad: ‏PUT 820000.00 ⇒ ‏/cashflow openingBalance=820000.0 source=bank و/today kpis.bankBalance=820000.00.
- **ESLint:** لم يُشغَّل — `npx eslint` في هذه البيئة لا يجد `typescript` (إعداد الأداة).
