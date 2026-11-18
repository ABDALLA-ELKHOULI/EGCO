# PARITY — قسم «التقارير» (S5)

كل قدرة في v0.13.0 لصفحة التقرير ومكوّناتها ← مكانها في `sections/reports/**`.
✅ = منقول في النموذج/الخطافات (المرحلة A) · 🅱 = يُرسم في المرحلة B · ⛔ = محجوب بمسار خادم.

## أ · `pages/Report.tsx`

| # | القدرة (old file:line) | المكان الجديد | الحالة |
|---|---|---|---|
| 1 | تبويبان: تقرير الفترة / التحليل الدوري (17-53) | وجهة «تقرير» بتبويبين داخليين + وجهة «تصدير» | 🅱 |
| 2 | صيغة تفصيلي / ملخّص بالمشروع (23, 40-50) | تبويب «ملخّص بالمشروع» داخل التقرير | 🅱 |
| 3 | النطاق في الرابط: account/contractor/project/parties (63-95) | `AnalysisParams` + بحث الرابط في `ReportView` | 🅱 |
| 4 | ScopeBar (شركة/مورد/مشروع/مقاول) + أطراف (119-120) | منتقي نطاق من `useScopes()` | ✅ hook · 🅱 UI |
| 5 | PeriodBar من/إلى، افتراضي 2026-01-01→اليوم (66-67, 121) | حقلا تاريخ في لوحة «إعداد التقرير» | 🅱 |
| 6 | حارس تسلسل ضد ردود قديمة (98-113) | `useLoad` في `hooks.ts` (ثم TanStack) | ✅ |
| 7 | خطأ + إعادة محاولة / حالة تحميل (122-123) | `Loaded.error/reload` | ✅ |
| 8 | ملخّص المشروع: منتقي مشروع + أطراف (افتراضي both) (132-204) | `useProjectSummary` + `ProjectSummarySheet` | ✅ hook · 🅱 |
| 9 | تصدير Excel لملخّص المشروع (163-165, 194) | `projectSummaryExportUrl` | ✅ |
| 10 | PDF أفقي لملخّص المشروع (170-173) | `exportPdf(pdfNames.projectSummary(), true)` | ✅ |
| 11 | ورقة الملخّص: ٤ KPI بمسمّيات «في هذا المشروع»، جدول ٩ أعمدة، tfoot، «—» للمقاولين بلا تأخر، contractorScopeNote، تذييل (207-290) | `ProjectSummarySheet` يقرأ `ProjectSummaryPayload` | 🅱 |
| 12 | زر «الملخص التنفيذي (AI)» يظهر فقط إن كان الذكاء مفعّلاً، خطأ تحته (293-326) | `requestAiSummary` + `useAiEnabled` | ✅ fn · 🅱 |
| 13 | مسودة AI: «راجعها قبل الاعتماد»، نسخ، إغلاق، no-print (516-529) | `AiDraft` | 🅱 |
| 14 | أولويات السداد: AI ثم رجوع حتمي، ملاحظة الرجوع، ميزانية، تحديث (338-438) | `fetchPriorities` / `usePriorities` | ✅ |
| 15 | «ضمن الميزانية» محسوب محلياً تراكمياً (377-410) | **يُستبدل** بـ `fitsInBudget` من الخادم (ai_features_service.py:716-723) | ✅ (إصلاح) |
| 16 | ورقة A4: شعار، شركة/إدارة، عنوان، النطاق مطبوع، رقم الوثيقة/الإصدار/الأساس/التصنيف (494-514) | `ReportPaper` ← `GmReport.meta` | 🅱 |
| 17 | افتتاحي/حركة/ختامي للموردين فقط + ExplainDot (447-450, 533-561) | `GmReport.opening` | ✅ model · 🅱 |
| 18 | KPI: مفوتر/مسدد/مفتوحة/[أرصدة لنا/الصافي]/متأخر + ExplainDot (563-583) | `GmReport.summary/hasCreditBalance` | ✅ · 🅱 |
| 19 | فقرة سردية lede (584-603) | `ReportLede` | 🅱 — انظر الخلل ١ |
| 20 | أعمار الديون + بلا تاريخ + الإجمالي (607-643) | `GmReport.ageing/ageingUndated` | ✅ · 🅱 — انظر الخلل ٢ |
| 21 | جدول السداد + PartyCell (اسم أول + «و N آخرون» + tooltip) (645-661, 793-811) | `schedule` + `PartyCell` | 🅱 |
| 22 | قسم المقاولين: الرصيد باتجاهه «له/لنا»، المشاريع، آخر دفعة، tfoot (665-705) | `GmReport.contractors` + `balanceView` | ✅ · 🅱 |
| 23 | ترقيم أقسام بلا فجوات (454-457) | `visibleSections()` | ✅ |
| 24 | ملاحظات ومخاطر (711-723) | `GmReport.notes` | ✅ |
| 25 | تذييل التوقيعات الثلاثة + «وثيقة داخلية · serial» (725-733) | `ReportPaper` footer | 🅱 |
| 26 | أزرار: وضع العرض / Excel / PDF + «جارٍ إنشاء PDF…» + خطأ التصدير (480-492) | شريط أفعال الصفحة | ✅ fns · 🅱 |
| 27 | التحليل الدوري: تقسيم ربع/نصف/سنة، السنة 2024-2026، Excel (840-890) | `usePeriodic` + `periodicExportUrl` | ✅ · 🅱 (السنوات من coverage لا ثابتة) |
| 28 | التغطية + تنبيه الفترات الجزئية (901-908) | `PeriodicView` | 🅱 |
| 29 | جدول الفترات ٧ أعمدة + «جزئي» (910-948) | `PeriodicView` | 🅱 |
| 30 | جدول المقارنة مع السابقة وYoY + لون الإشارة (950-978, 1008-1011) | `PeriodicView` | 🅱 |
| 31 | أعمدة التوزيع على المشاريع + أعلى ٥ موردين لآخر فترة مكتملة (980-1031) | `PeriodicView` | 🅱 |
| 32 | شرائح: غلاف، KPI، أعمار، جدول (١٠)، أعلى الموردين (٨)، مقاولون، ملاحظات، إجراءات (1036-1265) | `buildSlides()` — بيانات مُنمَّطة | ✅ |
| 33 | `contractorsSection`/`PartyPill`/`PartyCell` مُصدَّرة لصفحات أخرى (752, 779, 793) | ⚠ تُستورد من Report.tsx في صفحات أخرى — يُنقل `PartyCell/PartyPill` إلى ui/ (وكيل F) قبل حذف الصفحة | ⛔ تنسيق |

## ب · `components/Present.tsx`

| # | القدرة | المكان الجديد | الحالة |
|---|---|---|---|
| 34 | ملء الشاشة، Esc يغلق، ←/PageDown/مسافة تالٍ، →/PageUp سابق (21-37) | `keyToAction()` (+Home/End/N/F من النموذج) | ✅ |
| 35 | فئة `presenting` على html (32-35) | `PresentOverlay` | 🅱 |
| 36 | عدّاد، سابق/تالي معطّلان عند الطرفين (44-53) | `PresentOverlay` | 🅱 |
| 37 | تذييل الشركة + رقم الشريحة (62-65) | `SlideView` | 🅱 |
| 38 | «تصدير العرض PDF» يطبع **كل** الشرائح أفقياً (46, 69-84) | `present-print-only` + `exportPdf(pdfNames.slides(), true)` | ✅ fn · 🅱 |
| + | جديد من النموذج: ملاحظات المتحدث، نقاط تنقّل، نقر للتقدّم، حبس Tab، إعادة التركيز، شاشة مصغّرات «ابدأ من شريحة» | `PresentView` | 🅱 |

## ج · `components/ExportMenu.tsx`

| # | القدرة | المكان الجديد | الحالة |
|---|---|---|---|
| 39 | ١٣ صيغة مقاولين مجمّعة (قوائم/بالمشروع/تدقيق/شامل) (81-92) | `CONTRACTOR_EXPORT_GROUPS` (معاد تصديره) | ✅ |
| 40 | «مشروع واحد…» يطلب مشروعاً قبل التنزيل — لا ٤٢٢ (52-70, 96-111) | حقل مشروع شرطي في حوار التصدير | 🅱 |
| 41 | الصيغة تحمل تصفية الجدول الحالية (params) | `contractorsExportUrl(format, params)` | ✅ |
| 42 | `StatementExportButton` كشف حساب مفرد في صفّ المقاول (119-129) | **ليس من S5** — يبقى في قسم الأطراف (S2) | ↗ S2 |
| 43 | إغلاق بالنقر خارجاً/Esc، تموضع fixed (27-50) | Modal/Popover من ui/ (F) | 🅱 |

## د · `components/PrintableList.tsx`

| # | القدرة | المكان الجديد | الحالة |
|---|---|---|---|
| 44 | ورقة PDF مشتركة لقوائم الموردين/المقاولين — يستعملها S2 | **مستهلكوها في S2**؛ S5 يوفّر `exportPdf` و`pdfNames.list` ومفتاح الاتجاه المشترك | ↗ S2 + ✅ helpers |
| 45 | عمودي/أفقي A4 يُتذكَّر `egco-print-landscape` (17, 60-65) | `ReportPrefs.landscape` على نفس المفتاح | ✅ |
| 46 | `.print-landscape` تقود @page مع علم التصدير معاً (110-115) | `ReportPaper` className | 🅱 (يحتاج قاعدة @page من styles/ — F) |
| 47 | سطر التصفية مطبوع، عدد، تنبيه warnBanner، إجماليات أعلى الورقة، footNote (125-191) | مكوّن `PrintSheet` عام — يُقترح في ui/ (F) | ⛔ تنسيق |
| 48 | لا table-scroll في الطباعة (155-159) | قاعدة في `PrintSheet` | 🅱 |

## هـ · من النموذج المعتمد (جديد)

| القدرة | المكان | الحالة |
|---|---|---|
| لوحة «إعداد التقرير»: نطاق، تاريخ إصدار، مفاتيح الأقسام، ملاحظة تنفيذية تُحفظ تلقائياً | `ReportPrefs` + `loadPrefs/savePrefs` | ✅ model · 🅱 |
| «نسخ كنص» | `reportText()` + `copyText()` | ✅ |
| أعلى المتأخرات (٥) | `GmReport.overdueTop` — موردون فقط | ✅ |
| قرارات مطلوبة | `buildDecisions()` | ✅ |
| الموازنة / التدفق النقدي / التحصيلات / Δ عن الشهر الماضي | `Unavailable` صريح | ⛔ خادم |
| شاشة «التصدير» بكتالوج | `CATALOG` — كل بطاقة مسار خادم موجود | ✅ · 🅱 |
| CSV/HTML نسخاً فقط | **مرفوض**: التطبيق يملك PDF/XLSX حقيقيين | — |

## و · مطابقة مع `docs/next/PARITY.md` (البنود التي موطنها reports)

| P-id | البند هنا | المكان الجديد |
|---|---|---|
| P-016 | مسار `/report` | `reports.report` → `/reports` + `redirectFrom` |
| P-300 / P-301 | ١، ٢ | تبويبات داخلية في `ReportView` |
| P-302 | ٣ | بحث الرابط ↔ `AnalysisParams` |
| P-303 / P-378 / P-379 | ٤، ٥ | `ReportSetup` (نطاق بمجموعات «لديهم كشوفات/بلا»، أطراف، من/إلى) ← `useScopes` |
| P-304 / P-432 | ٦، ٧ | `useAnalysis` |
| P-305 | ١٦ | شارة `scopeLabel` |
| P-306 / P-486 | ١٢، ١٣ | `requestAiSummary` + `AiDraft` |
| P-307 / P-330 / P-369 / P-581 | ٣٢، ٣٤-٣٨ | `buildSlides` + `keyToAction` + `PresentView` + `pdfNames.slides` (أفقي) |
| P-308 / P-438 / P-576 | ٢٦ | `analysisExportUrl` |
| P-309 / P-579 | ٢٦ | `exportPdf(pdfNames.report(), landscape)` |
| P-310, P-320 | ١٦، ٢٥ | `ReportPaper` |
| P-311 | ٢٣ | `visibleSections` |
| P-312 | ١٧ | `GmReport.opening` (الحركة من الخادم — طلب B) |
| P-313 / P-370 | ١٨ | KPI + ExplainDot (مكوّن Explain من components/ — F) |
| P-314 | ١٩ | `ReportLede` — **بلا** العدّ المزدوج (خلل ١) |
| P-315 | ٢٠ | قسم الأعمار — «مجموع الفئات» للموردين فقط (خلل ٢) |
| P-316 | ٢١ | قسم الجدول + `PartyCell` |
| P-317 | ٢٢ | قسم المقاولين — «له» بلا أحمر (انظر أدناه) |
| P-318 / P-435 / P-491 / P-074(جزء reports) | ١٤، ١٥ | `usePriorities` — «ضمن الميزانية» من `fitsInBudget` |
| P-319 | ٢٤ | قسم الملاحظات |
| P-321 / P-433 / P-436 | ٨ | `ProjectSummaryView` |
| P-322 / P-434 / P-578 | ٩ | `projectSummaryExportUrl` |
| P-323 / P-580 | ١٠ | `pdfNames.projectSummary` أفقي |
| P-324 | ١١ | `ProjectSummarySheet` |
| P-325 / P-437 / P-577 | ٢٧ | `PeriodicView` + `periodicExportUrl` |
| P-326…P-329 | ٢٨-٣١ | `PeriodicView` |
| P-551 (جزء reports) | ٥، ٢٧ | بداية التقرير 2026-01-01 تبقى افتراضياً؛ سنوات الدوري من `coverage` بدل 2024–2026 الثابتة |
| P-079 | — | وجهة واردة: `go('reports.report', { account })` من كشف المورد (S2 يستدعيها) |
| P-108 / P-188 | — | PDF إجماليات المشاريع / تقرير الموازنة: ملكية مشتركة؛ S5 يوفّر `exportPdf`؛ الورقة نفسها عند S2/S3 |
| P-364 | ٣٩-٤١ | **ref → parties** — التنفيذ في S2؛ `ExportsView` مُطلِق فقط يستدعي نفس المسار `contractorsExportUrl` (lib/api) |
| P-366…P-368 / P-542 | ٤٤-٤٨ | **ref → parties** (والـshell للمفتاح)؛ S5 لا يعيد تنفيذها — يقرأ/يكتب نفس `egco-print-landscape` فقط |

**قاعدة لون مُصحَّحة (من المنسّق):** Report.tsx:773 و:1181 لوّنا رصيد المقاول «له» بالأحمر. الأحمر للتأخر الزمني
وحده؛ `balanceView` يعيد لوناً محايداً مع «نحن ندين لهم» / «يدينون لنا» (P-591، A-008).

## الأخطاء المكتشفة في v0.13.0 (أرقام معروضة — تستحق الإبلاغ فوراً)

1. **عدّ مزدوج لمستحق المقاولين** — `Report.tsx:596-600`: «فيصبح إجمالي الالتزام» = `s.outstanding + con.owed`،
   لكن الخادم أضاف مستحق المقاولين إلى `summary.outstanding` سلفاً (`report_service.py:178`
   `outstanding + c_outstanding`). مع parties=both/contractors يُعرض الرقم مضاعفاً بمستحق المقاولين.
2. **«مجموع الفئات» خاطئ مع المقاولين** — `Report.tsx:625`: `s.outstanding − ageingUndated`؛ `s.outstanding`
   يشمل المقاولين بينما الأعمار للموردين فقط، فيزيد سطر «مجموع الفئات» بمستحق المقاولين، و«المديونية المفتوحة
   كاملةً» تحت جدول الأعمار يخلط نطاقين.
3. (منهجي) `Report.tsx:541-551` يطرح مفوتر−مسدد في المتصفح، و`:410` يجمع «ضمن الميزانية» محلياً.

## طلبات من الخادم (وكيل B) — حواجز

- `summary.supplier_outstanding` و`summary.contractor_outstanding` منفصلين (يحلّ ١ و٢ بلا حساب في الواجهة).
- `meta.period_movement` (مفوتر − مسدد في الفترة) و`ageingTotal`.
- `summary.supplier_outstanding_30d_ago` أو مسار مقارنة — لـ«Δ عن الشهر الماضي».
- مسار تقرير موحّد (`/reports/gm` أو حقول في `/today`) يضمّ: أدنى رصيد ٣٠ يوماً، رصيد البنك، الداخل/الخارج،
  التحصيلات المفتوحة/المتأخرة، الموازنة المخطط/الفعلي، الضمانات المنتهية — كي لا يجمع القسم ستّ حمولات.
- تأخر المقاولين: النموذج يفترض «مدة سداد للمقاول»؛ الخادم لا يحسبه (صحيح). يبقى «— بلا مدة».

## بنية المكوّنات — منفَّذة (المرحلة B)

```
index.tsx            SectionModule: reports.report (/reports ← /report) · reports.present · reports.exports + أوامر ⌘K
uikit.ts             نقطة استيراد @/ui الوحيدة (تُستبدل بـ export * from '@/ui' حين يصل الفهرس)
types.ts hooks.ts model.ts slides.ts exports.ts useReportParams.ts
ReportView.tsx       تبويبات: تقرير الفترة (لوحة إعداد + ReportPaper) · ملخّص بالمشروع · التحليل الدوري
ReportPaper.tsx      ورقة A4 (١١ قسماً قابلة للإخفاء، ترقيم بلا فجوات، توقيعات، مسودة AI)
PrioritiesBlock.tsx  ScopeSelect.tsx  ProjectSummaryTab.tsx  PeriodicTab.tsx  parts.tsx
PresentView.tsx      مصغّرات + PresentOverlay (بوابة إلى body، حبس Tab، ملء الشاشة، N/F/Home/End، طباعة كل الشرائح)
SlideBodyView.tsx    يرسم SlideBody للعرض وللطباعة
ExportsView.tsx      كتالوج: التحليل · الدوري · ملخّص المشروع · المقاولون (١٣ صيغة + مشروع شرطي) · الموردون · الموازنة
reports.css          منقول من النموذج بلا hex + @page rp-portrait/rp-landscape + قواعد الطباعة
```

الحالة: كل بنود 🅱 أعلاه مرسومة الآن؛ ⛔ تبقى معلّقة على الخادم/F. التحقق في المتصفح على بيانات حقيقية = الموجة ٢ (Q).
