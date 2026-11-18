# QA — قفل السلوك (e2e) · المالك: Q

## التشغيل
```
cd apps/renderer
E2E_API_PORT=8797 E2E_WEB_PORT=5197 E2E_TMP_ROOT=<scratch> npx playwright test e2e/behaviour --reporter=line
```
playwright.config.ts يشغّل بنفسه `scripts/e2e-backend.mjs` (EGCO_SEED=1، قاعدة مؤقتة جديدة) و Vite، ويوقفهما في النهاية.
headless فقط. workers=1 (قاعدة مشتركة؛ كل spec ينظّف ما يصنعه في afterEach عبر API).

## المواصفات السلوكية — `apps/renderer/e2e/behaviour/`
تؤكّد قدرات مرئية للمستخدم لا بنية DOM: محددات بالدور/النص العربي، `data-testid` إن وُجد (`tid()` في helpers.ts)،
والتحقق من الأرقام مقابل الخادم. مسارات الشاشات في `helpers.ts → R` (تُحدَّث هناك وحدها حين تتغيّر).

| spec | يقفل |
|---|---|
| supplier-lifecycle | إضافة مورد ← يظهر ← حذف ← في المحذوفات ← استرجاع ← يعود |
| totals | المديونية المفتوحة 245,000.50 = الخادم، ونفسها في /payables و /suppliers و /projects |
| unsaved-guard | Escape على نموذج متغيّر يسأل؛ «عودة» تحفظ القيمة؛ «تجاهل» يغلق؛ نموذج نظيف يُغلق بلا سؤال |
| import-history | CSV عبر API ← يظهر في سجل الرفع باسم الملف والمورد؛ الإجمالي لا يتغيّر |
| bundle-import | v0.13.1 كشوف مجمّعة: PDF حقيقي (e2e/fixtures/make_bundle_pdf.py) بـ٣ حسابات ← معاينة ٣ (٢ مطابق/١ لا) ← حفظ ٢ وحجز الثالث ← كل حساب على صاحبه ← إعادة الرفع لا تضيف ← يظهر في الواجهة |
| contractor-overdue | م-٤٦: بلا مدة سداد لا رقم تأخر؛ بعد ضبط المدة يظهر مبلغ الخادم |
| project-merge | م-٣٠: دمج مصدر في هدف (معاينة يدوية أو تلقائية، تأكيد إن وُجد) ← المورد ينتقل والمصدر يختفي |
| budget-months | إضافة شهر ← تعديل ← حذف (confirm قديم أو حوار جديد) ← التراكمي للشهر التالي يعود كما كان |
| backup | «نسخة الآن» ← نسخة يدوية جديدة في الخادم والرسالة تظهر |
| m50-parties | م-٥٠: إسناد مورد ومقاول بمبلغ من صفحة المشروع · نفس المورد في مشروعين بمبلغين · تعديل · إزالة + «تراجع» · المبلغ ينجو من الدمج |
| bank-cash | إدخال رصيد البنك من التدفق ← openingBalanceSource=bank ← /today cashBasis=bank ويظهر الرقم |
| theme | داكن ← يثبت بعد reload ← فاتح (يقبل زر التبديل القديم وأزرار فاتح/داكن الجديدة) |
| sections-smoke | كل مسار مسجّل في `src/sections/<قسم>/index.tsx` يُقرأ آلياً ويفتح بلا خطأ كونسول ولا «تعذّر عرض الصفحة» |

## النتائج
| التاريخ | البناء | النتيجة |
|---|---|---|
| 2026-11-17 | الواجهة القديمة (قبل تسجيل الأقسام) | 8/10 أولاً؛ بعد إصلاح محددَين في الاختبار (تطابق جزئي لمبلغ، تنقّل hash بلا reload) — كل السلوكيات ناجحة على القديم |
| 2026-11-18 | أقسام today/parties/projects/cash/reports/data مسجّلة (تعديل حيّ جارٍ) | 33/36 ناجح. الفاشلة: budget-months (BUG-001 خادم)، unsaved-guard (BUG-002)، project-merge (أُصلح المحدد بعد ظهور حوار التأكيد الجديد ← ناجح ×٢ في التشغيل التالي) |

| 2026-11-18 (بعد موجة البناء، test-ids مفعّلة) | كل الأقسام + مسارات B الجديدة | **38/40** (سلوك + دخان الأقسام). فاشل: bank-cash (BUG-006)، unsaved-guard «عودة» (BUG-002 reopened). BUG-001 verified |
| 2026-11-18 (خوادم جديدة، كاش Vite ممسوح) | بعد إصلاحات BUG-002/006/007 | **39/40**. فاشل: bank-cash في خطوة «اليوم» (BUG-008 جديد). BUG-002/006/007 verified |
| 2026-11-18 (نهائي — خوادم جديدة، كاش Vite ممسوح) | بعد إصلاحات BUG-004/008 + SSE + الجزيرة | **40/40** (26 سلوك + 14 دخان أقسام)، 0 متذبذب، 0 متخطّى. كل الأخطاء P0–P1 verified؛ مفتوح فقط BUG-005 (بيئة) |

المواصفات القديمة في `e2e/*.spec.ts` (smoke/totals/suppliers/visual…) تعتمد مسارات وأصنافاً قديمة (`.kpi .value`، `/settings/trash`)
وستنكسر تباعاً مع استبدال الصفحات — `behaviour/` هو المرجع؛ القديمة تُحذف/تُحدَّث حين يُحذف مسارها.

## data-testid المطلوبة من وكلاء الأقسام
تُضاف على العنصر التفاعلي نفسه. الاختبارات تعمل بدونها (بديل دلالي) لكن هذه تُثبّتها ضد تغيير النصوص.

| test-id | العنصر | القسم المالك |
|---|---|---|
| `supplier-add` | زر فتح نموذج إضافة مورد | parties |
| `contractor-add` | زر إضافة مقاول | parties |
| `party-row-<account>` | صف المورد/المقاول في القائمة | parties |
| `contractor-overdue` | قيمة «متأخر» في بطاقة المقاول | parties |
| `kpi-outstanding` | قيمة المديونية المفتوحة (اليوم/الموردون/المشاريع) | today · parties · projects |
| `merge-from` / `merge-into` | قائمتا المصدر والهدف في الدمج | projects |
| `merge-run` | زر تنفيذ الدمج | projects |
| `budget-manage` | زر «إدارة الأشهر» لمشروع | projects |
| `budget-month-add` | زر إضافة شهر | projects |
| `budget-month-row-<YYYY-MM>` | صف شهر في إدارة الموازنة | projects |
| `backup-now` | زر «نسخة الآن» | data |
| `import-history-row` | صف في سجل الرفع | data |
| `trash-row-<type>-<id>` · `trash-restore` | صف المحذوفات وزر الاسترجاع | data |
| `theme-light` / `theme-dark` / `theme-auto` | أزرار المظهر | data |
| `unsaved-guard` | الحوار alertdialog لتأكيد التجاهل (+ `unsaved-back` / `unsaved-discard`) | F (ui/Modal) |
| `confirm-dialog` · `confirm-ok` | حوار التأكيد العام | F (ui) |
