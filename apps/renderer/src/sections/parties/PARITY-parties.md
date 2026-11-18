# PARITY-parties.md — قسم «الأطراف» (S2)

جرد كل قدرة في الملفات القديمة التي يستبدلها هذا القسم، مربوطة ببنود `docs/next/PARITY.md` (P-NNN)
وبموطنها الجديد. **لا تُحذف صفحة قديمة قبل أن يصير كل سطر هنا ✅.**

- المرجع: v0.13.0 — `pages/{Suppliers,SupplierDetail,Contractors,ContractorDetail,Guarantees}.tsx`،
  `components/{SupplierForm,ContractorForm,ManualEntryForm,RemindModal,ColumnMenu,ExportMenu}.tsx`،
  `lib/api.ts`، `lib/delay.ts`.
- `AiRescueModal.tsx` **ليس من هذا القسم**: مستدعاه الوحيد `pages/Import.tsx` (P-279/P-371/P-480/P-482 → data).
- الحالة: ☐ لم يُنفَّذ · ▣ نُفّذ في المرحلة ب (tsc strict + eslint نظيفان) **ولم يُتحقَّق بعد في المتصفح على بيانات حقيقية** (مهمة Q) · ✅ نُفّذ وتحقّق.
- «المنطق» = `sections/parties/logic/*.ts` (نقي، بلا React) · «الخطاف» = `hooks.ts` · «العميل» = `api.ts`.
- المكوّنات تحت `sections/parties/` (البنية في §٩). المكوّنات المشتركة (Modal بحارس، DataTable بقوائم أعمدة،
  Toast، KPI، Carousel، PrintableList، ExplainDot، CopyButton، AiBlock، useAiEnabled) يملكها F (shell/ui).

---

## ١ · المسارات (P-010…P-012)

| P | القديم | القدرة | الموطن الجديد | الحالة |
|---|---|---|---|---|
| P-010 | App.tsx:176-177 | `/suppliers`، `/suppliers/:account` | `index.ts` → `SuppliersView`، `SupplierView` (وجهة parties، تبويب «الموردون») | ▣ |
| P-011 | App.tsx:178-179 | `/contractors`، `/contractors/:code` | `ContractorsView`، `ContractorView` | ▣ |
| P-012 | App.tsx:180 | `/guarantees` | `GuaranteesView` | ▣ |
| جديد | prototype parties.js:979-986 | شارة عدد على كل تبويب (موردون متأخرون · مقاولون متأخرون بمدة · ضمانات مستحقة) | `index.ts` badge من `totals` | ▣ |

## ٢ · قائمة الموردين — Suppliers.tsx (P-052…P-075)

| P | القديم (سطر) | القدرة | الموطن الجديد | الحالة |
|---|---|---|---|---|
| P-052 | 21-43, 108-126 | كل التصفية/الترتيب على الخادم (q, project, status, delay, min/max_outstanding, date_from/to, sort, dir)؛ debounce ٢٠٠ms؛ إهمال الاستجابة المتأخرة (seq) | `logic/suppliers.supplierQuery` + `hooks.useSuppliers` (٢٠٠ms + seq) | ▣ |
| P-053 | 204 | بحث بالاسم أو رقم الحساب (حقل أعلى الجدول، min 300px) | `SuppliersView` شريط الأدوات → `q` | ▣ |
| P-054 | 208 | عدّاد «N نتيجة · مفتوح X ر.س» | `SuppliersView` (من `count`/`totals.outstanding`) | ▣ |
| P-055 | 50-59, 210 | «تصدير Excel» = المجموعة المصفّاة نفسها | `api.suppliersExportUrl(query)` → ExportDialog | ▣ |
| P-056 / P-554 | 86-106, 133-154, 211 | «PDF»: PrintableList بأعمدة المورد·الحساب·المشروع·الحالة·التأخر·المفتوح (بلا «آخر دفعة» عمداً) + سطر الإجمالي + سطر التصفية + «متأخر ضمن التصفية» | `print/SuppliersPrint.tsx` على PrintableList المشترك | ▣ |
| P-057 | 61-73, 217-231 | شرائح «N تصفية نشطة» بـ× لكل واحدة + «مسح الكل» + «متأخر ضمن التصفية: X» | `logic/suppliers.supplierChipLabels` + `logic/table.filterLine` | ▣ |
| P-058 | 253-255 | عمود المورد: ترتيب أ←ي/ي←أ + تصفية نصية | DataTable عمود `name` (sort+filter text → q) | ▣ |
| P-059 | 256-258 | عمود رقم الحساب: ترتيب + تصفية نصية «211…» (تُرسل عبر q) | عمود `account` (filter → `account` → q) | ▣ |
| P-060 | 259-263 | عمود المشروع: ترتيب + قائمة المشاريع (من `projects` في الاستجابة) | عمود `project` | ▣ |
| P-061 | 264-268 | عمود الحالة: «الأحرج أولاً/الأهدأ أولاً» + تصفية بالحالات الخمس (STATUS) | عمود `status` | ▣ |
| P-062 | 270-274 | عمود التأخر (قبل المفتوح، م-٣٥): ترتيب + تصفية بشرائح DELAY_BUCKETS مع hint | عمود `delay` | ▣ |
| P-063 | 275-280 | عمود المديونية المفتوحة: ترتيب + مدى min/max ر.س؛ **لون محايد** (م-٣٥) | عمود `outstanding` | ▣ |
| P-064 | 281-286, 354-363 | عمود آخر دفعة (مبلغ + تاريخ، أو «لا دفعات»): ترتيب + مدى تاريخ | عمود `lastPaymentDate` | ▣ |
| P-065 | 300-304 | «التغطية: من … إلى …» تحت الاسم (firstActivity/lastActivity) | خلية `name` | ▣ |
| P-066 | 306-318 | المدة سطر تحت الحساب («٤٥ يوم» أو النص)؛ شارة «مدة السداد غير محدّدة» لـ unset | `logic/suppliers.termText` | ▣ |
| P-067 | 319-329 | مشاريع متعددة: الأول + «+N» + title بالكل | `logic/suppliers.projectsSummary` | ▣ |
| P-068 | 291-295 | تلوين الصف: متأخر/قريب/مسدَّد | `logic/suppliers.supplierRowTone` | ▣ |
| P-069 | 331-346, 409-437 | النقر على مبلغ التأخر ← نافذة «توزيع المتأخر» (٧ شرائح، الفارغة باهتة، إجمالي، أقصى تأخر، «فتح كشف المورد») | `components/DelayBreakdownModal.tsx` + `logic/suppliers.delayBreakdown` | ▣ |
| P-070 | 232-245 | فراغان: «لا نتائج مطابقة» + مسح / «لم تُرفع قائمة الموردين بعد» + رفع الملف (→ data) | `SuppliersView` EmptyState | ▣ |
| P-071 | 196, 388-393 | «إضافة مورد» في نافذة بحارس تعديلات (dirty) | `components/SupplierFormModal.tsx` | ▣ |
| P-072 | 169-182, 366, 395-407 | تعديل ✎ (name, project, term, projects) | نفس النافذة، isEdit | ▣ |
| P-073 | 368, 551-608 | حذف: تأكيد؛ ٤٠٩ (له حركات) ← اكتب رقم الحساب ← force | `components/DeletePartyModal.tsx` + `logic/contractors.canForceDelete` | ▣ |
| P-074 | 191-201, 450-549 | «أولويات السداد» (AI فقط): ميزانية اختيارية، يعمل تلقائياً بلا ميزانية، جدول #·الاسم·مورد/مقاول·المبلغ·السبب·«ضمن الميزانية» (تراكم محلي) + السرد + إفصاح التقدير | `components/PrioritiesPanel.tsx` + `logic/suppliers.fitBudget` + `api.aiPriorities` | ▣ |
| P-074+ | prototype 246-277 | النموذج المعتمد يجعل الأولويات **حتمية بلا AI** (تعمل والمساعد معطّل) | `api.priorities` (GET /reports/priorities الحتمي) — عرض AI السردي فوقه حين يُفعَّل | ▣ |
| P-075 | 379-385 | «للسداد اليومي: المستحقات القادمة» | رابط إلى وجهة today | ▣ |
| جديد | prototype 162-165 | بطاقات KPI أعلى القائمة: المفتوح · متأخر · خلال ٧ أيام · عدد الفواتير المفتوحة | من `totals` (outstanding/overdue/dueWithin7) — **بلا حساب محلي** | ▣ |
| جديد | prototype 221-236 | تحديد صفوف ← «قائمة الدفع» (متأخر + ٧ أيام) + تصدير | مجموع بالهللات `sumCents` على أرقام الخادم فقط | ▣ |

## ٣ · كشف المورد — SupplierDetail.tsx (P-076…P-097)

| P | القديم (سطر) | القدرة | الموطن الجديد | الحالة |
|---|---|---|---|---|
| P-076 | 410-418 | ترويسة: الاسم، الحساب، المشروع، المدة (يوماً أو النص)، عدد الفواتير | `SupplierView` رأس | ▣ |
| P-077 | 419-421, 323-335, 692-697 | «إضافة مديونية» (ManualEntryForm invoice) | `components/ManualEntryModal.tsx` mode=invoice + `api.addManualInvoice` | ▣ |
| P-078 | 422-424, 337-350, 699-704 | «تسجيل دفعة» | نفس النافذة mode=payment | ▣ |
| P-079 | 425-427 | «استخراج التحليل» → `/report?account=` | زر → وجهة reports | ▣ |
| P-080 / P-372 | 428-430, 764-766 | «صياغة مطالبة» (يظهر فقط حين AI مفعّل) | `components/RemindModal.tsx` | ▣ |
| P-081 | 179-200, 431-434 | تفعيل/إيقاف «تخصيص الدفعات» (إعداد عام، متوقف افتراضياً، فشل القراءة صامت) | `hooks.useAllocationSetting` | ▣ |
| P-082 | 435 | «رجوع» → /suppliers | فتات الخبز «→ الموردون» | ▣ |
| P-083 | 438-443 | «N دفعة/دفعات بانتظار التخصيص» (مفرد/جمع) — فقط عند التفعيل | `SupplierView` تنبيه من `unallocatedCount` | ▣ |
| P-084 | 445-448 | «فئات الأعمار محسوبة من تاريخ الاستحقاق» + ExplainDot ageingByDueDate | `SupplierView` | ▣ |
| P-085 | 450-455 | needsManualDueDate: «مدة هذا المورد «X» — يحتاج إدخال تاريخ يدوياً» | `SupplierView` تنبيه | ▣ |
| P-086 | 457-468 | KPIs: المفوتر · المسدد · المديونية المفتوحة (hero + شرح outstanding) · متأخر (أحمر/alert + شرح) | `SupplierView` | ▣ |
| P-087 | 470-498 | شريط ٧ شرائح تأخر قابلة للنقر (الفارغة معطّلة) تصفّي الفواتير + «عرض الكل» | `SupplierView` + `logic/suppliers.pipeInvoices({bucket})` | ▣ |
| P-088 | 500-524 | الفواتير: عنوان «المفتوحة/كل الفواتير»، «إظهار المسددة»، سطر شريحة مختارة، «عرض N من M» دائماً، «مسح تصفية الأعمدة»، «إلغاء التصفية» | `logic/suppliers.pipeInvoices` + `invoiceFiltering` | ▣ |
| P-089 | 14-22, 147-153, 202-290, 529-551 | أعمدة بفرز وتصفية **محلية موثّقة**: رقم (نص) · التاريخ (مدى) · الاستحقاق (مدى) · المبلغ/المسدد/المتبقي (مدى) · الحالة (٥ خيارات) | `logic/suppliers.{invoiceStatusKey,INVOICE_STATUS_OPTIONS,pipeInvoices}` + `logic/table` | ▣ |
| P-090 | 558-561 | شارة «يدوي» | خلية الرقم | ▣ |
| P-091 | 352-378, 571-578, 706-736 | تعديل/حذف مديونية يدوية (تأكيد بالمبلغ) | `ManualEntryModal` + تأكيد حذف | ▣ |
| P-092 | 380-392, 579-590, 738-762 | «تحديد/تعديل الاستحقاق» لفاتورة من كشف (تاريخ أو فارغ = مسح) | `components/DueDateModal.tsx` + `logic/suppliers.invoiceActions` | ▣ |
| P-093 | 599-626 | بطاقة «دفعات بانتظار التخصيص»: تاريخ·مبلغ·وصف + **سبب التعليق** + «تخصيص» | `components/PendingAllocations.tsx` | ▣ |
| P-094 | 47-145 | نافذة «تخصيص دفعة»: مرشّح واحد ← سطر كامل؛ لا مرشّحين ← على الحساب؛ مربعات فواتير بمبلغ مقترح min(متبقي، باقي الدفعة)؛ «على الحساب»؛ الحفظ مشروط بالتساوي | `components/AllocationModal.tsx` + `logic/suppliers.{initialAllocation,toggleAllocInvoice,allocationTotals,allocationBody}` (هللات صحيحة بدل ±0.01) | ▣ |
| P-095 | 207-321, 628-689 | جدول الدفعات: التاريخ (مدى) · المستند (نص) · الوصف (نص) · المبلغ (مدى)؛ «N دفعة»؛ «عرض N من M» عند التصفية؛ مسح | `logic/suppliers.pipePayments` | ▣ |
| P-096 | 668-677 | «تخصيص» لكل دفعة (عند التفعيل) لتعديل تخصيص سابق — المرشّحون = الفواتير المفتوحة | `AllocationModal` | ▣ |
| P-097 | 394-406, 678-681, 778-789 | حذف دفعة يدوية (تأكيد) | تأكيد حذف + `api.deleteManualPayment` | ▣ |
| P-406 | الخادم | `DELETE …/allocate` بلا مستدعٍ | **يُضاف** زر «إلغاء التخصيص» في `AllocationModal` → `api.clearAllocation` | ▣ |
| P-382 | ManualEntryForm.tsx:14-102 | نموذج: المبلغ >٠ مطلوب · التاريخ (اليوم) · الاستحقاق للفاتورة («يُحسب من مدة المورد إن تُرك فارغاً») · الوصف · رقم مرجعي · dirty | `ManualEntryModal` + `logic/suppliers.{validateManual,manualBody}` | ▣ |
| جديد | prototype 449-456 | معاينة «الرصيد بعد المديونية/الدفعة» + تحذير «الدفعة أكبر من المفتوح» | `logic/suppliers.manualPreview` | ▣ |
| جديد | prototype 354-355 | «تصدير الكشف» و«حذف» من رأس الكشف | ExportDialog + `DeletePartyModal` | ▣ |
| **م-٥٠** | — | بطاقة «المشاريع» بمبلغ لكل مشروع + إضافة/تعديل/إزالة إسناد | §٧ | ▣ |

## ٤ · قائمة المقاولين — Contractors.tsx + ExportMenu.tsx (P-098…P-135، P-364، P-365)

| P | القديم (سطر) | القدرة | الموطن الجديد | الحالة |
|---|---|---|---|---|
| P-098 | 17-31 | الإشارة: سالب «له» محايد · موجب «لنا» أخضر · صفر «متوازن»؛ الأحمر للتأخر فقط (م-٣٦) | `logic/contractors.balanceView` (+ words «نحن ندين لهم/يدينون لنا» من النموذج) | ▣ |
| P-099 | 33-40 | ألوان الحالة: نشط ok · متوقف/نزاع warn · مغلق muted · قائمة سوداء red | `logic/contractors.STATUS_TONE/statusLabel` | ▣ |
| P-100 | 397-408 | إفصاحا الترويسة (معنى الإشارة، «متأخر لمن له مدة؛ بلا مدة —») | `ContractorsView` | ▣ |
| P-101 | 100-115, 178-196 | تصفية/ترتيب على الخادم (q, project, direction, status, sort, dir) ٢٠٠ms + seq؛ أي تغيير يعيد الصفحة ١ | `logic/contractors.contractorQuery` + `hooks.useContractors` | ▣ |
| P-102 | 414-423 | KPIs: مستحق للمقاولين (hero، **بلا أحمر**) · مستحق لنا (أخضر) · الضمانات المحتجزة — مع شروح | `ContractorsView` | ▣ |
| P-103 | 424-435 | KPI «متأخر (لمن له مدة سداد)» أحمر عند >٠ + «N بلا مدة — غير محسوب · المتأخر على M» | من `totals.overdueTotal/withTermCount/withoutTermCount` | ▣ |
| P-104 | 439-443 | بحث بالاسم/الرمز + «N مقاولاً» | `ContractorsView` | ▣ |
| P-105 | 95-98, 225-243, 444-455, 700-764 | تبديل «قائمة / تجميع بالمشروع»: مجموعات قابلة للطي (▾/◂)، الأكبر «له» أولاً، الأبناء الأشد سالبية أولاً، «— بلا مشروع —»، مقاول متعدد يُحتسب بكامل رصيده + إفصاح النطاق؛ على المجموعة الكاملة لا الصفحة | `components/ProjectGroupsView.tsx` + `logic/contractors.groupByProject` (هللات) | ▣ |
| P-106 / P-364 | 456؛ ExportMenu.tsx:15-114 | «تصدير Excel ▾» بأربع مجموعات؛ «مشروع واحد…» يطلب اختيار مشروع قبل التنزيل (لا ٤٢٢)؛ يحمل التصفية الحالية؛ Esc/نقر خارجاً | `components/ContractorExportMenu.tsx` + `logic/contractors.exportMenuGroups` + `api.contractorsExportUrl` | ▣ |
| P-107 / P-570 | 159-176, 247-268, 457 | «PDF» القائمة: المقاول·الرمز·المشروع·الرصيد (|x| + له/لنا)·الضمان + إجمالي (٦ خلايا) + تذييل له/لنا | `print/ContractorsPrint.tsx` | ▣ |
| P-108 / P-571 | 148-151, 328-365, 458-459 | «PDF إجماليات المشاريع» من `totals.byProject` (ترتيب الخادم) + ملخص ٣ أرقام + تذييل | `print/ProjectTotalsPrint.tsx` | ▣ |
| P-109 / P-572 | 138-157, 270-326, 630-631 | 🖶 «كشف حساب» PDF لصفّ: يجلب الكشف، كل الحركات بلا تصفية، ملخص (ختامي له/لنا، مدين، دائن، الضمان)، تحذير «لا كشف مرفوع» من `hasStatement` الصف، حالتا تحميل/خطأ + رجوع | `print/StatementPrint.tsx` (+ `ENTRY_KIND` للنوع) | ▣ |
| P-110 / P-365 / P-567 | 629؛ ExportMenu.tsx:116-129 | 📄 «تصدير كشف الحساب (Excel)» لكل صف: `format=single_statement&code=` + التصفية | `components/StatementExportButton.tsx` | ▣ |
| P-111 | 121-128, 464-475 | شرائح التصفية + «مسح الكل» | `logic/contractors.contractorChipLabels` | ▣ |
| P-112 | 494-496 | عمود المقاول: ترتيب + نص | DataTable | ▣ |
| P-113 | 497-499 | عمود الرمز: ترتيب + نص «212…» (عبر q) | DataTable | ▣ |
| P-114 | 500-504 | عمود المشروع: تصفية بالقائمة **بلا ترتيب** (المشاريع من الصفوف) | `logic/contractors.knownProjects` | ▣ |
| P-115 | 505-510 | عمود الاتجاه (sort=balance): «الأشد استحقاقاً له/لنا» + تصفية له/لنا/متوازن | `DIRECTIONS` | ▣ |
| P-116 | 511-516 | عمود الحالة: ترتيب + الحالات الست | `CONTRACTOR_STATUSES` | ▣ |
| P-117 | 517-519, 595-610 | عمود «متأخر» (م-٤٦): مبلغ أحمر + «N مستخلص · أقدمها D يوماً» / «—» بتلميح «اضبط مدة السداد» / «لا تأخر» بتلميح المدة؛ ترتيب | `logic/contractors.overdueCell` | ▣ |
| P-118 | 520-522, 611-615 | «الضمان المحتجز»: «غير معروف» بلا كشف / «لا يوجد» / المبلغ؛ ترتيب | `logic/contractors.retentionCell` | ▣ |
| P-119 | 523-527, 616-626 | «آخر دفعة» و«آخر حركة» + ترتيب | DataTable | ▣ |
| P-120 | 547-549 | نقطة «ضمانات مستحقة الصرف: N» (releaseAlerts) | خلية الاسم | ▣ |
| P-121 | 534-555 | شارة «بلا كشف مرفوع» بتلميح (hasStatement من الخادم، م-٢٦) | خلية الاسم | ▣ |
| P-122 | 556-558 | الهاتف تحت الاسم | خلية الاسم | ▣ |
| P-123 | 580-594 | ملاحظة الحالة مقتطعة ١٦٠px + كاملة عند التحويم | خلية الحالة | ▣ |
| P-124 | 86-93, 113-115, 219-223, 645-663 | ترقيم محلي ٥٠ (الأولى/السابقة/a / b/التالية/الأخيرة + «عرض a–b من N»)؛ الإجماليات تبقى للمجموعة كاملة | `logic/table.paginate` (أو ترقيم DataTable) | ▣ |
| P-125 | 476-486 | فراغان: لا نتائج / لم تُرفع بيانات المقاولين | EmptyState | ▣ |
| P-126 | 367-378, 409-411, 666-671 | «إضافة مقاول» بحارس | `components/ContractorFormModal.tsx` | ▣ |
| P-127 | 380-393, 632-633, 673-687 | تعديل (الرمز مقفل؛ يُرسل paymentTermDays واللائحة) | نفس النافذة | ▣ |
| P-128 | 634, 982-1040 | حذف بخطوتين (اكتب الرمز → force) | `DeletePartyModal` | ▣ |
| P-129 / P-540 | 66-68, 766-849 | «نظرة المقاولين» Carousel ٤ صفحات، الصفحة محفوظة `egco.contractors.overviewView`؛ مستقلة عن تصفية الجدول؛ خطأ + إعادة | `components/ContractorsOverview.tsx` + `hooks.useContractorsOverview` + Carousel (F) | ▣ |
| P-130 | 829, 851-887 | «التوزيع على المشاريع»: المُبلَّغ إن وُجد وإلا المشتق؛ شريط نسبي **بلا أحمر**؛ العدد؛ إفصاح النطاق | `ContractorsOverview` | ▣ |
| P-131 | 830, 889-913 | «أكبر ١٠ مقاولين بالمستحق» (مُبلَّغ إن وُجد) + روابط + إفصاح | `ContractorsOverview` | ▣ |
| P-132 | 831, 915-936 | «الضمانات المستقلة (216)»: إجمالي + عدد + إفصاح الفرق عن «المحتجزة» | `ContractorsOverview` | ▣ |
| P-133 | 832, 938-980 | «اختلافات الرصيد»: الملف/المحسوب/الفرق، all-clear، «لا استيراد بعد»، تاريخ آخر استيراد | `ContractorsOverview` | ▣ |
| P-134 | 802-818 | فراغ النظرة قبل أي استيراد + «رفع الملفات» | `ContractorsOverview` | ▣ |
| P-135 | 836-846 | إفصاح «المُبلَّغ مقابل المشتقّ» (لا يُجمعان) | `ContractorsOverview` | ▣ |
| P-555…P-569 | lib/api.ts:436-494 | **١٤ صيغة Excel**: full · creditors · debtors · by_status · missing_statement · project_totals · by_project_creditors · by_project_debtors · single_project (project) · reported_vs_derived · balanced_dormant · opening_vs_activity · full_report (١١ ورقة) · single_statement (code، من زر الصف) — كلها تحترم q/project/direction/status/sort/dir | `ContractorExportMenu` (١٣) + `StatementExportButton` (١) | ▣ |
| **P-450/451 فجوة** | ContractorForm بلا status | `status`/`statusNote` تُعرض وتُصفّى لكن **لا نموذج يضبطها** في v0.13 | يُضاف: حقلا الحالة + السبب في `ContractorFormModal`، ونافذة سريعة «تغيير الحالة» (`components/StatusModal.tsx`، النموذج المعتمد 781-797) مع تراجع؛ السبب مطلوب لـ متوقف/متنازع/قائمة سوداء — `logic/contractors.{STATUS_NEEDS_NOTE,validateContractor,contractorBody}`. **لا حاجة خادم:** ContractorIn/Update يقبلانهما (PARITY P-450/451). | ▣ |
| جديد | prototype 552, 616-629 | «مدة افتراضية…» تُطبَّق على من بلا مدة فقط + تراجع | حلقة `api.updateContractor(code,{paymentTermDays})` — **يُفضَّل مسار خادم جماعي** (طلب لـ B، انظر §١٠) | ☐ |

## ٥ · كشف المقاول — ContractorDetail.tsx (P-136…P-163)

| P | القديم (سطر) | القدرة | الموطن الجديد | الحالة |
|---|---|---|---|---|
| P-136 | 235-246 | ترويسة: الاسم، الرمز، الهاتف، نسبة الضمان، مدة الضمان، مدة السداد، الملاحظات (+ الحالة وسببها من النموذج) | `ContractorView` رأس | ▣ |
| P-137 | 247, 643-661 | «تعديل» (ContractorForm كامل، الرمز مقفل) | `ContractorFormModal` | ▣ |
| P-138 | 248, 663-679 | «إضافة حركة» | `components/EntryFormModal.tsx` | ▣ |
| P-139 | 249-251, 681-683 | «صياغة مطالبة» (AI) | `RemindModal` partyKind=contractor | ▣ |
| P-140 | 252, 685-701, 772-818 | «قيد من نص» (AI): لصق ← تحليل ← يفتح نموذج الحركة مملوءاً (date/debit/credit/description) للمراجعة — لا حفظ مباشر | `components/ParseTextModal.tsx` + `api.aiParseText` + `logic/contractors.entryFormInitial(draft)` | ▣ |
| P-141 | 255 | «رجوع» | فتات الخبز | ▣ |
| P-142 | 258-261 | KPI «الرصيد (له/لنا)» hero، alert عند السالب، شرح contractorBalance | `ContractorView` | ▣ |
| P-143 | 198-204, 262-265 | المستخلصات (duesTotal من الدفتر لا جدول الوثائق) · المدفوع · الضمان المحتجز (مجموع غير المصروفة) + شرح | `logic/contractors.heldRetention` | ▣ |
| P-144 | 267-281 | تفصيل جانب المدين = debitTotal + «الرصيد = المدين − الدائن…» | `logic/contractors.debitBreakdown` | ▣ |
| P-145 | 283-298 | «الاستحقاق» بلا مدة: النص التفسيري + «اضبط مدة السداد» (يفتح التعديل) | `ContractorView` بطاقة | ▣ |
| P-146 | 300-308 | متأخر (أحمر) · خلال ٧ (ذهبي) · خلال ٣٠ · أقدم تأخر | `ContractorView` | ▣ |
| P-147 | 309-320 | أعمار m1…m6_plus (عند متأخر > ٠) | `logic/contractors.CLAIM_BUCKETS` | ▣ |
| P-148 | 321-353 | جدول استحقاق المستخلصات بعد FIFO: المستخلص·المشروع·التاريخ·الاستحقاق·المبلغ·المسدَّد·المتبقي·التأخر؛ صف أحمر للمتأخر؛ «لم يحن/مسدَّد» | `logic/contractors.claimDueTone` | ▣ |
| P-149 | 358-377 | بطاقات perProject (الرصيد له/لنا + عدد الحركات) تصفّي الدفتر **والمستخلصات** معاً | `ContractorView` + `EntryFilters.project`/`ClaimFilters.project` مشترك | ▣ |
| P-150 | 379-403 | الدفتر: عنوان بالمشروع، إفصاح «مدين = دفعنا/خُصم · دائن = استحق له»، «مسح تصفية الأعمدة»، «إظهار الكل»، فراغان (مع CTA) | `logic/contractors.entryColumnFiltering` | ▣ |
| P-151 | 68-80, 121-160, 409-432 | أعمدة الدفتر محلياً: التاريخ (مدى) · النوع (٧) · الوصف (نص، غير حساس لحالة الأحرف) · المشروع (قائمة) · مدين/دائن (مدى) + فرز | `logic/contractors.pipeEntries` | ▣ |
| P-152 | 442-444 | «#claimNo» بجوار النوع | خلية النوع | ▣ |
| P-153 | 224-231, 446-458 | تغيير مشروع **أي** حركة (حتى المستوردة) من قائمة في الصف (+ المشروع الحالي إن لم يكن معروفاً) | `api.updateEntry(code,id,{project})` | ▣ |
| P-154 | 462-474, 703-710 | تعديل/حذف اليدوية؛ حذف المستوردة معطّل بتلميح «تُحذف من الملفات المرفوعة» | `ContractorView` | ▣ |
| P-155 | 838-932 | نموذج الحركة: التاريخ · الجانب · المبلغ ≥٠ · الوصف (مطلوب) · المشروع (قائمة + «مشروع جديد…») · التصنيف (٧) | `EntryFormModal` + `components/ProjectField.tsx` + `logic/contractors.{entryFormInitial,entryBody,KIND_SIDE}` | ▣ |
| جديد | prototype 816-832 | معاينة الرصيد بعد الحركة؛ اختيار النوع يضبط الجانب افتراضياً؛ قيد تأمين تلقائي اختياري عند المستخلص | `logic/contractors.entryPreview` (القيد التلقائي يُرسل حركتين منفصلتين — بقرار المستخدم فقط) | ▣ |
| جديد | prototype 681-683, 751 | عمود «الرصيد الجاري» في الدفتر مع تمييز انقلاب الاتجاه | `logic/contractors.withRunningBalance` | ▣ |
| P-156 | 484-500 | «المستخلصات» سجل وثائق اختياري + إفصاح أن مستخلصات الكشف في الدفتر | `ContractorView` | ▣ |
| P-157 | 82-91, 162-196, 498-588 | أعمدة: الرقم (نص) · المشروع (مشترك) · التاريخ (مدى) · التراكمي (+سابق) · أعمال الفترة · التأمين (+٪ + خصومات) · الصافي (مدى)؛ «عرض N من M» | `logic/contractors.pipeClaims/claimCurrentWork` | ▣ |
| P-158 | 492-494, 571-581, 712-738 | إضافة/تعديل/حذف مستخلص يدوي؛ المستورد يُوسم «كشف» | `components/ClaimFormModal.tsx` | ▣ |
| P-159 | 934-1059 | حساب حي: أعمال الفترة؛ تأمين مقترح من النسبة (افتراضي المقاول) قابل للكتابة فوقه؛ الصافي كذلك؛ المشروع والرقم مطلوبان؛ تقريب خانتين | `logic/contractors.{claimFormInitial,claimMath,claimBody}` (هللات) | ▣ |
| P-160 | 591-640 | بطاقات الضمانات: المشروع، الحالة (DUE_STATUS)، المبلغ (+٪)، إنهاء الأعمال، المدة، استحقاق الصرف (ملوّن)، الصرف الفعلي، ملاحظات | `ContractorView` + `GUARANTEE_DUE` | ▣ |
| P-161 | 595, 630-633, 740-765 | إضافة/تعديل/حذف ضمان | `components/GuaranteeFormModal.tsx` | ▣ |
| P-162 | 1061-1137 | نموذج الضمان: المشروع (مطلوب) · المبلغ · النسبة ٠–١٠٠ · إنهاء الأعمال · المدة · استحقاق الصرف · الصرف الفعلي · ملاحظات | `logic/contractors.{guaranteeFormInitial,guaranteeBody}` | ▣ |
| P-163 | 820-836 | «تأكيد الحذف» عام | Modal (F) `kind:danger` | ▣ |
| جديد | prototype 701-703 | «تصدير الكشف» و«حذف» و«تغيير الحالة» من رأس الكشف | `StatementExportButton` + `DeletePartyModal` + `StatusModal` | ▣ |
| **م-٥٠** | — | «المشاريع» بمبلغ لكل مشروع | §٧ | ▣ |

## ٦ · الضمانات — Guarantees.tsx (P-164…P-169)

| P | القديم (سطر) | القدرة | الموطن الجديد | الحالة |
|---|---|---|---|---|
| P-164 | 41-46 | ترويسة «ضمانات المقاولين» + الوصف | `GuaranteesView` | ▣ |
| P-165 | 48-63 | KPIs: المحتجز حسب الكشوف (hero) · حسب المستخلصات · مستحقة الصرف (due+overdue، أحمر عند overdue) — شروح | `GuaranteesView` | ▣ |
| P-166 | 65-71 | فراغ «لم تُرفع ضمانات بعد» + رفع | EmptyState | ▣ |
| P-167 | 20-24, 74-112 | حسابات ٢١٦: الحساب·الاسم·المقاول المرتبط (رابط يوقف انتشار النقر / «غير مرتبط»)·الرصيد·الحركات·آخر حركة·المطابقة؛ الصف يفتح النافذة | `logic/guarantees.matchState` | ▣ |
| P-168 | 13-18, 114-146 | المتتبَّعة: المقاول (رابط)·المشروع·المبلغ·نسبة الاستقطاع (×١٠٠)·موعد الفك·الحالة؛ فراغ → «المقاولون» | `logic/guarantees.ratePct` + `GUARANTEE_DUE` | ▣ |
| P-169 | 157-215 | نافذة حساب ضمان: KPI الرصيد + المطابقة (شرح بالمتتبَّع = الرصيد − الفرق) + الحركات؛ تحميل/خطأ/إعادة | `components/GuaranteeAccountModal.tsx` + `hooks.useGuaranteeAccount` + `logic/guarantees.trackedOf` | ▣ |
| ملاحظة | prototype 853-966 | نموذج الضمان في النموذج الأولي (نوع/إصدار/انتهاء/إعادة) **لا يطابق البيانات الحقيقية** | يُعتمد شكل التصميم (KPIs، جدول بقائمة أعمدة، شارة حالة، تصدير) على حقول v0.13 الحقيقية؛ «تسجيل الإعادة» ↔ `releasedOn` عبر `updateGuarantee` | ▣ |

## ٧ · م-٥٠ · مشاريع الطرف بمبالغ (جديد)

| القدرة | الموطن | الحالة |
|---|---|---|
| بطاقة «المشاريع» في كشف المورد وكشف المقاول: المشروع (رابط لصفحة المشروع) · المبلغ المُسند · المنفّذ · المدفوع · المفتوح · ملاحظات؛ «—» لا صفر لمن بلا مبلغ | `components/PartyProjectsCard.tsx` + `hooks.usePartyProjects` + `GET /{suppliers\|contractors}/{id}/projects` | ▣ |
| إجمالي المُسند + «N بلا مبلغ — خارج الإجمالي» (من الخادم `totalAmount`، وإلا جمع بالهللات للعرض) | `logic/partyProjects.assignedTotal` | ▣ |
| إضافة إسناد: مشروع (قائمة + اقتراح المشابه بالتطبيع العربي، منع التكرار) + مبلغ اختياري + ملاحظات | `components/PartyProjectModal.tsx` + `logic/partyProjects.{validatePartyProject,partyProjectBody}` | ▣ |
| تعديل المبلغ/الملاحظات (تعديل متفائل يُعاد للخلف عند الخطأ) | `usePartyProjects.upsert` → `PUT /projects/{p}/parties/{type}/{id}` | ▣ |
| إزالة إسناد + toast «تراجع» يعيد نفس المبلغ والملاحظات | `usePartyProjects.remove` → `DELETE …` | ▣ |
| نسبة المنفّذ إلى المُسند (عرض فقط) | `logic/partyProjects.executedPct` | ▣ |
| المزامنة مع لائحة `projects` في نموذج المورد/المقاول (party_projects نفس الجدول) | الإبطال يشمل supplier/contractor/projects بعد أي تغيير | ▣ |

## ٨ · المكوّنات المشتركة التي يستهلكها القسم (يملكها F)

| P | القديم | ما يحتاجه القسم | الحالة |
|---|---|---|---|
| P-362 | Modal.tsx | حارس dirty (م-٣٤) لكل نماذج القسم، فخ التركيز، Esc | ينتظر F |
| P-363 | ColumnMenu.tsx:37-184 | قائمة عمود: ترتيب بتسميات مخصّصة (إعادة النقر تلغي)، تصفية text/select(+hint)/range(+وحدة)/dateRange، نقطة نشطة، موضع fixed يتبع التمرير (م-٣٩) | `logic/table.{toggleSort,ColFilter}` جاهز؛ العرض من DataTable (F) |
| P-366…P-368 | PrintableList | الطباعة الأربع (P-554، P-570، P-571، P-572) | ينتظر F |
| P-370 | Explain.tsx | ExplainDot لـ outstanding, overdue, ageingByDueDate, contractorsOwed, contractorsOwedToUs, contractorsRetention, contractorBalance, retentionHeld, guaranteeStatementsHeld, guaranteeTrackedHeld, guaranteeDueSoon, guaranteeAccountMatch | ينتظر F |
| P-372 / P-374 | RemindModal + CopyButton | مسودة قابلة للتعديل، «إعادة الصياغة»، «نسخ» أساسي، «إغلاق» عبر الحارس (dirty = تعديل يدوي فقط) | `components/RemindModal.tsx` (القسم) فوق Modal/CopyButton |
| P-373 / P-376 | AiBlock + useAiEnabled | إخفاء كل أزرار AI أثناء التحميل والتعطيل (أولويات، مطالبة، قيد من نص) | ينتظر F |
| P-377 | Carousel | نظرة المقاولين | ينتظر F |
| P-391 | lib/delay.ts | DELAY_BUCKETS + bucketOfDays (مصدر واحد) | يُعاد تصديره من `logic/suppliers` ✅ |
| P-392 | lib/format.ts | ar/arDate/arRange/sar/dueLabel/dueTone/STATUS | يُستورد كما هو |

## ٩ · بنية المكوّنات (المرحلة ب)

```
sections/parties/
  index.ts                 تسجيل الوجهات الخمس + الشارات
  types.ts api.ts hooks.ts ✅ (المرحلة أ)
  logic/ money table arabic suppliers contractors guarantees partyProjects  ✅
  views/
    SuppliersView.tsx      KPIs · أولويات · DataTable (أعمدة P-058…P-064) · شرائح · قائمة الدفع · PDF/Excel
    SupplierView.tsx       رأس · تنبيهات · KPIs · شرائح التأخر · الفواتير · بانتظار التخصيص · الدفعات · المشاريع (م-٥٠)
    ContractorsView.tsx    KPIs · نظرة · قائمة/تجميع · ترقيم · ExportMenu · ٣ PDF
    ContractorView.tsx     رأس · KPIs+تفصيل المدين · الاستحقاق · بطاقات المشاريع · الدفتر · المستخلصات · الضمانات · المشاريع (م-٥٠)
    GuaranteesView.tsx     KPIs · حسابات ٢١٦ · المتتبَّعة
  components/
    SupplierFormModal ContractorFormModal StatusModal ProjectChips ProjectField
    ManualEntryModal DueDateModal AllocationModal PendingAllocations DelayBreakdownModal
    PrioritiesPanel DeletePartyModal RemindModal ParseTextModal
    EntryFormModal ClaimFormModal GuaranteeFormModal GuaranteeAccountModal
    ContractorExportMenu StatementExportButton ContractorsOverview ProjectGroupsView
    PartyProjectsCard PartyProjectModal
  print/ SuppliersPrint ContractorsPrint ProjectTotalsPrint StatementPrint
```

## ١٠ · قرارات وعوائق

1. **م-٥٠ الخادم:** `GET /api/v1/{suppliers|contractors}/{id}/projects` غير موجود بعد في `services/api` (B). النوع
   المفترض في `types.ts` (`PartyProjectsResponse`) يُطابَق مع `docs/next/API-CONTRACT.md` حين يصدر. الكتابة
   تُعاد عبر مسار المشروع نفسه الذي يستعمله قسم المشاريع (`PUT|DELETE /projects/{p}/parties/{type}/{id}`) —
   مصدر كتابة واحد للعلاقة. يحتاج تأكيداً من B أن `{id}` = الحساب/الرمز (لا المعرّف الداخلي).
2. **حالة المقاول (فجوة v0.13):** تُغلق في الواجهة فقط — لا حاجة خادم.
3. **«مدة افتراضية» الجماعية (من النموذج):** ممكنة بحلقة PUT لكل مقاول (٣٩٢+ طلباً)؛ الأفضل مسار جماعي
   `PUT /contractors/payment-term {days, onlyUnset:true}` من B. لا تُشحن قبل قراره.
4. **قائمة الدفع (من النموذج):** تجمع أرقام الخادم بالهللات للعرض فقط؛ التصدير CSV عبر ExportDialog (F).
5. **تخصيص الدفعات:** المقارنة بالهللات الصحيحة بدل ±0.01 القديمة — أدق ولا تغيّر الحالات الصالحة.
6. **المرحلة ب** تنتظر `docs/next/FRONTEND-CONTRACT.md` (DataTable، Modal، KPI، Carousel، PrintableList، ExportDialog، وجهات الهيكل). `tsc --strict` نظيف على ملفات القسم الحالية.

## ١١ · المرحلة ب — ما نُفّذ وما بقي (2026-11-18)

- الملفات: `index.tsx` · `Suppliers.tsx` · `SupplierDetail.tsx` · `Contractors.tsx` · `ContractorDetail.tsx` · `Guarantees.tsx` ·
  `components/{shared,PartyProjects}.tsx` · `parties.css` (منقول من النموذج + إضافات بالرموز فقط).
- قوائم الأعمدة القديمة (ColumnMenu) صارت شريط تصفية `.pt-xfil` فوق كل جدول (نص/قائمة/مدى/مدى تاريخ) + ترتيب رأس DataTable
  (`mode="server"` — الخادم يرتّب القوائم؛ الجداول المتداخلة تُرتَّب بمنطق القسم كالاستثناء الموثّق). تسميات اتجاه الترتيب المخصّصة
  («الأحرج أولاً»…) استُبدلت بـaria-sort القياسي — القدرة نفسها (ترتيب كل عمود بالاتجاهين) باقية.
- **عائق خادم (للمنسّق/B):** `GET /contractors/{code}` لا يعيد `status`/`statusNote` — الكشف يأخذهما مؤقتاً من صفّ القائمة. أضيفوهما إلى
  `contractor_detail_json`. **وم-٥٠:** `GET /{suppliers|contractors}/{id}/projects` غير موجود بعد؛ البطاقة تعرض اللائحة بلا مبالغ عند ٤٠٤.
- لم يُنفَّذ (مُؤجَّل بقرار): «مدة افتراضية» الجماعية (§١٠-٣).

## ١٢ · تدقيق A-005 / A-006 — بنود نُفّذت ولم تُدرج سابقاً

الحالة ▣ = منفّذ (tsc+eslint نظيفان)، لم يُتحقَّق بعد في المتصفح على بيانات حقيقية. «العميل» = `api.ts`.

| P | الموطن (ملف:سطر) | الحالة |
|---|---|---|
| P-380 | `Suppliers.tsx:250` SupplierFormModal (الحساب مقفل عند التعديل، ٢١١ عند الإنشاء) + `components/shared.tsx` ProjectChips (★ الأساسي، Enter، datalist، اقتراح المشابه) + `logic/suppliers.ts` validateSupplier/supplierBody | ▣ |
| P-381 | `Contractors.tsx:289` ContractorFormModal (+ الحالة وسببها) + `logic/contractors.ts` validateContractor/contractorBody (مدة السداد الفارغة = null صريح) | ▣ |
| P-400 | GET /suppliers — العميل:32 ← `hooks.ts` useSuppliers ← `Suppliers.tsx` (q/project/status/delay/min-max/date/sort/dir). overdue_only/has_data/min-max_delay_days ما زالت غير مستعملة كما في v0.13 | ▣ |
| P-401 | GET /suppliers/export.xlsx — العميل:39 ← `Suppliers.tsx:151` (ExportDialog xlsxUrl بنفس الاستعلام) | ▣ |
| P-402 | GET settings/payment-allocation — العميل:49 ← hooks useAllocationSetting ← `SupplierDetail.tsx:32` | ▣ |
| P-403 | PUT settings/payment-allocation — العميل:50 ← `SupplierDetail.tsx:33,113` | ▣ |
| P-405 | POST …/allocate — العميل:54 ← `SupplierDetail.tsx` AllocationModal | ▣ |
| P-406 | DELETE …/allocate — العميل:58 ← زر «إلغاء التخصيص» في AllocationModal (جديد) | ▣ |
| P-407 | GET /suppliers/{account} — العميل:33 ← hooks useSupplier ← `SupplierDetail.tsx:29` (date_from/to غير مستعملين كما في v0.13) | ▣ |
| P-408 | POST /suppliers — العميل:34 ← SupplierFormModal | ▣ |
| P-409 | PUT /suppliers/{account} — العميل:35 ← SupplierFormModal (تعديل) | ▣ |
| P-410 | DELETE /suppliers/{account}[force] — العميل:37 ← `components/shared.tsx` DeletePartyModal | ▣ |
| P-411 | POST /manual/invoices — العميل:41 ← `SupplierDetail.tsx` ManualEntryModal | ▣ |
| P-412 | PUT /manual/invoices/{id} — العميل:42 ← ManualEntryModal (تعديل) | ▣ |
| P-413 | DELETE /manual/invoices/{id} — العميل:43 ← `SupplierDetail.tsx:51` | ▣ |
| P-414 | POST /manual/payments — العميل:44 ← ManualEntryModal (payment) | ▣ |
| P-415 | DELETE /manual/payments/{id} — العميل:45 ← `SupplierDetail.tsx:52` | ▣ |
| P-416 | PUT /invoices/{id}/due-date — العميل:46 ← `SupplierDetail.tsx:267` DueDateModal | ▣ |
| P-445 | GET /contractors — العميل:62 ← hooks useContractors ← `Contractors.tsx:40` (+ status=overdue). has_guarantees غير مستعمل كما في v0.13 | ▣ |
| P-446 | GET /contractors/overview — العميل:63 ← hooks useContractorsOverview ← Contractors.tsx ContractorsOverviewView | ▣ |
| P-447 | GET /contractors/export.xlsx — العميل:80 ← Contractors.tsx ContractorExportMenu (١٣) + زر 📄 للصف + «تصدير الكشف» في ContractorDetail (single_statement) | ▣ |
| P-449 | GET /contractors/{code} — العميل:64 ← hooks useContractor ← ContractorDetail.tsx و StatementPrint. ⚠ لا يعيد status/statusNote (طلب لـB) | ▣ |
| P-450/451 | POST/PUT /contractors — العميل:65-66 ← ContractorFormModal + StatusModal | ▣ |
| P-452 | DELETE /contractors/{code}[force] — العميل:68 ← DeletePartyModal | ▣ |
| P-453…P-455 | entries POST/PUT/DELETE — العميل:69-71 ← ContractorDetail.tsx EntryModal، تغيير مشروع الحركة في الصف، الحذف | ▣ |
| P-456…P-458 | claims POST/PUT/DELETE — العميل:72-74 ← ContractorDetail.tsx ClaimModal والحذف | ▣ |
| P-459…P-461 | guarantees POST/PUT/DELETE — العميل:75-78 ← ContractorDetail.tsx GuaranteeModal والحذف | ▣ |
| P-462 | GET /guarantees — العميل:84 ← hooks useGuarantees ← `Guarantees.tsx` | ▣ |
| P-463 | GET /guarantees/{account} — العميل:85 ← hooks useGuaranteeAccount ← Guarantees.tsx AccountModal | ▣ |
| P-484 | POST /ai/remind — العميل:96 ← `components/shared.tsx` RemindModal ← SupplierDetail.tsx:205، ContractorDetail.tsx:255 | ▣ |
| P-489 | POST /ai/parse-text — العميل:101 ← ContractorDetail.tsx:419 ParseTextModal → يملأ EntryModal (لا حفظ مباشر) | ▣ |
| P-553 | XLSX الموردين — `Suppliers.tsx:151` (xlsxUrl من الخادم بالتصفية الحالية) | ▣ |

**A-006 — الملكية:**
- **parties يملك** صيغ تصدير المقاولين الأربع عشرة (P-364، P-555…P-569) وطباعاتها الأربع (P-554، P-570…P-572) وزر تفعيل/إيقاف تخصيص الدفعات (P-081، P-402/403). reports/data يربطان فقط («ref → parties»).
- **P-366…P-368 (PrintableList: الورقة، الاتجاه `egco-print-landscape`، اسم الملف و`exportPdf`):** القسم يملك **استعمالها** في الطباعات الأربع
  (`Suppliers.tsx:303`، `Contractors.tsx:349,364,386`). المكوّن نفسه في `components/PrintableList.tsx` ملك F ولم يُعدَّل — إن نُقل إلى `@/ui` يُبدَّل الاستيراد فقط.
- **P-370 (ExplainDot):** المكوّن عام → **ref** (F). القسم يملك استدعاءات المقاييس الخاصة بالأطراف فقط: outstanding، overdue، ageingByDueDate
  (SupplierDetail.tsx:130,132,138)، contractorsOwed/OwedToUs/Retention (Contractors.tsx:112-115)، contractorBalance/retentionHeld (ContractorDetail.tsx:141,145)،
  guaranteeStatementsHeld/TrackedHeld/DueSoon/AccountMatch (Guarantees.tsx:60-62,107).
- **مفقود فعلاً:** لا شيء من القائمة أعلاه. المؤجَّل الوحيد: «مدة افتراضية» الجماعية (§١٠-٣، يحتاج مسار خادم).
