# PARITY — قسم «المشاريع» (S3)

كل قدرة في الصفحات القديمة ← مكانها الجديد (بنود docs/next/PARITY.md ذات الموطن «projects»: P-013, P-170..P-203, P-358..P-361, P-421, P-440, P-441, P-464..P-476, P-485, P-573..P-575).
🟡 = مُنفَّذ ويمرّ tsc strict، **لم يُشغَّل في التطبيق بعد** (ينتظر جولة Q بالمتصفح وخادم م-٥٠) · ✅ = مُتحقَّق تشغيلاً · ⚠ = فرق مقصود موثَّق.
المسارات نسبةً إلى `apps/renderer/src/`.

## Projects.tsx → views/ProjectsView.tsx
| # | القدرة | القديم | الجديد | الحالة |
|---|---|---|---|---|
| P1 | تحميل GET /projects + خطأ بإعادة محاولة + تحميل | pages/Projects.tsx:10-23 | hooks.ts `useProjects` (TanStack عبر @/data) | 🟡 |
| P2 | KPI: مديونية الموردين المفتوحة + شرح ExplainDot `projectsTotals` | :35-36 | ProjectsView KPI row | 🟡 |
| P3 | KPI: المتأخر (أحمر/تنبيه إن >0) + ExplainDot `overdue` | :37-38 | ProjectsView | 🟡 |
| P4 | KPI: مستحق للمقاولين · مستحق لنا · إجمالي الالتزام (hero) | :39-41 | ProjectsView | 🟡 |
| P5 | ملاحظة أن الأرقام هي نفس شاشتي المقاولين/الموازنة | :43-46 | ProjectsView disclose | 🟡 |
| P6 | جدول: المشروع (رابط) · الموردون + «منهم لديهم كشوفات» · مفتوح (أحمر إن متأخر) · متأخر · للمقاولين · لنا · الالتزام · تأخر الموازنة٪/«لا موازنة» | :50-110 | ProjectsView DataTable | 🟡 |
| P7 | تنبيه صيغ الاسم المدموجة `mergedSpellingAlert` | :67-71 | ProjectsView صف + رابط «دمج» | 🟡 |
| P8 | حالة فارغة «لا توجد مشاريع» | :51-52 | EmptyState | 🟡 |
| P9 | أشرطة مقارنة المديونية بين المشاريع | :114-135 | ProjectsView chart island | 🟡 |
| P10 | **جديد** حكم يكسب/يخسر + ترتيب الخطر | — (النموذج projects.js:64-118) | logic/verdict.ts `verdictOf`/`riskRank` | 🟡 |

## ProjectDetail.tsx → views/ProjectView.tsx
| # | القدرة | القديم | الجديد | الحالة |
|---|---|---|---|---|
| D1 | تحميل باسم المشروع مع حارس تسلسل | pages/ProjectDetail.tsx:9-24 | hooks.ts `useProject` (seq guard) | 🟡 |
| D2 | رأس: الاسم + عدد الموردين + رجوع | :35-41 | ProjectView header (crumb) | 🟡 |
| D3 | KPI ستة: مفتوح(+شرح) · متأخر(+شرح) · للمقاولين · لنا · الالتزام · تأخر الموازنة | :43-53 | ProjectView | 🟡 |
| D4 | ملاحظة دمج صيغ الاسم | :54-59 | ProjectView | 🟡 |
| D5 | جدول المقاولين: اسم(رابط) · كود · رصيد مطلق + اتجاه | :62-88 | views/ProjectView.tsx `ConBalance` | 🟡 ⚠ **صُحّح لا نُقل**: القديم يلوّن السالب أحمر بعبارة «لنا عليه» (عكس الاصطلاح). الآن سالب = «نحن ندين له»، بلا أحمر (الأحمر للمتأخر زمنياً فقط) |
| D6 | جدول الموردين: اسم(رابط) · حساب · المدة (أيام/نص) · مفتوح · متأخر · حالة فارغة | :89-118 | ProjectView suppliers island | 🟡 |
| D7 | الاستحقاقات القادمة ٩٠ يوماً (٨ أعمدة، مبلغ، تاريخ، عدد فواتير) | :120-137 | ProjectView schedule chart | 🟡 |
| D8 | **م-٥٠** أطراف المشروع بمبالغ: إضافة (بحث) · تعديل مبلغ/ملاحظات · إزالة بتراجع · مُسند/منفّذ/مدفوع/مفتوح لكل طرف وإجمالي | — | components/PartiesPanel + hooks `useProjectParties` + logic/parties.ts | 🟡 |
| D9 | **م-٥٠** لوحة الحكم: العقد مقابل المُسند مقابل المنفّذ، لا هامش بلا قيمة عقد | — | components/VerdictPanel + logic/verdict.ts | 🟡 |
| D10 | زر الموازنة / دمج في مشروع آخر (من النموذج) | — | ProjectView actions → budget/merge | 🟡 |

## Budget.tsx → views/BudgetView.tsx (+ components)
| # | القدرة | القديم | الجديد | الحالة |
|---|---|---|---|---|
| B1 | ألوان بالاتجاه monthTone/cumTone (لا عتبة) | pages/Budget.tsx:24-43 | logic/budget.ts | 🟡 |
| B2 | سهم الاتجاه يتحسّن/يتفاقم ن.م | :45-55 | logic/budget.ts `trendOf` + مكوّن | 🟡 |
| B3 | فلاتر خادم: مشروع · مدينة · من/إلى شهر · حالة · لها مستخلصات + debounce 200ms + حارس تسلسل | :65-99, 304-347 | BudgetView + `STATUS_LABEL` | 🟡 |
| B4 | رقائق التصفية + «مسح الكل» + سطر ملخّص (عدد + إجمالي فعلي/مخطط) | :108-122, 337-347 | BudgetView | 🟡 |
| B5 | تصدير Excel بنفس التصفية | :126-133, 284 | BudgetView (ExportDialog من F) | 🟡 |
| B6 | طباعة/PDF بالتصفية عبر PrintableList (أعمدة+إجماليات+ملخّص) | :138, 220-260 | BudgetView | 🟡 |
| B7 | رفع ملفات .xlsx متعددة، رفض غيرها، نتيجة جزئية/كاملة بالتفاصيل | :140-196 | BudgetView + `splitBudgetFiles` | 🟡 |
| B8 | تقرير الموازنة الكامل (وثيقة) + تصدير PDF عبر window.egco.exportPdf/print | :859-924 | components/BudgetDoc | 🟡 |
| B9 | قسم مشروع في الوثيقة: KPI + أشرطة فعلي/مخطط + المستخلصات (معلّق إن بلا مبلغ/تاريخ) | :926-993 | BudgetDoc | 🟡 |
| B10 | ملاحظات AI للموازنة (مشروطة بـ useAiEnabled) | :995-1033 | BudgetDoc | 🟡 |
| B11 | جدول الأشهر في الوثيقة + نطاق التغطية | :852-857, 1035-1067 | BudgetDoc | 🟡 |
| B12 | بطاقة مشروع: آخر شهر/وثيقة/مصدر + ٤ KPI + تراكمي + جدول أشهر (مصدر يدوي/ملف، مرفق) | :399-466 | BudgetView ProjectCard | 🟡 |
| B13 | تجميع حسب المشروع بالترتيب العربي | :262-272 | logic/budget.ts `groupByProject` | 🟡 |
| B14 | حالة فارغة: لا نتائج للتصفية / لم تُرفع بيانات (CTA استيراد) | :363-372 | EmptyState | 🟡 |
| B15 | لوحة إدارة مشروع: الأشهر + تعديل + حذف (تأكيد يذكر إعادة حساب التراكمي) + المدينة | :470-575 | BudgetView drawer | 🟡 |
| B16 | التزامات مقاولي المشروع | :577-606 | BudgetView drawer | 🟡 |
| B17 | نموذج إدخال يدوي/تعديل: معاينة محسوبة من الخادم (debounce) + أثر السلسلة | :608-760 | components/BudgetEntryForm | 🟡 |
| B18 | مستخلصات: إضافة/تعديل/حذف صفوف | :648-652, 773-815 | BudgetEntryForm | 🟡 |
| B19 | إرفاق ملف (pickFile → budgetUploadAttachment) | :654-670 | BudgetEntryForm | 🟡 |
| B20 | حفظ مع تعارض مصدرين → حوار اختيار (cumActual/delayPct) | :672-700, 764-770, 828-850 | components/ConflictDialog | 🟡 |
| B21 | مشروع جديد — إدخال يدوي (اسم قابل للتحرير) | :291, 389-394 | BudgetEntryForm projectEditable | 🟡 |
| B23 | **جديد** حذف شهر عبر confirm() بدل window.confirm | :486 | BudgetView ManageDrawer | 🟡 |
| B22 | **النموذج** تعارض أشهر مكرّرة + منحنى تراكمي | projects.js:42-60, 425-447 | logic/budget.ts `conflictMonths`/`cumulative` | 🟡 |

## ProjectAdmin.tsx → views/MergeView.tsx
| # | القدرة | القديم | الجديد | الحالة |
|---|---|---|---|---|
| M1 | تحميل المشاريع والمكرّرات المحتملة | pages/ProjectAdmin.tsx:26-32 | hooks `useProjectAdmin` | 🟡 |
| M2 | بطاقة «مشاريع تبدو مكرّرة» بأزرار كل زوج | :85-104 | MergeView + `mergePairs` | 🟡 |
| M3 | دمج يدوي: مصدر/هدف + منع نفس المشروع | :106-128 | MergeView + `canPreview` | 🟡 |
| M4 | معاينة الأثر بالجدول والعدد | :43-53, 133-144 | MergeView + `impactLines` (تسميات عربية للجداول) | 🟡 |
| M5 | تنفيذ الدمج + رسالة عدد الصفوف + إعادة تحميل + أخطاء | :55-71 | MergeView + `affectedTotal` | 🟡 |
| M6 | رجوع للإعدادات | :78 | التنقل عبر تبويب القسم | 🟡 |

## مسارات API المستعملة
GET /projects · GET /projects/{name} · GET /project-admin · GET /project-admin/merge/preview · POST /project-admin/merge ·
GET /budget/overview · GET /budget · GET /budget/project/{name} · POST /budget/preview · POST/PUT/DELETE /budget · PUT /budget/project/{name}/city ·
POST /budget/import · POST /import/budget-attachment · GET /budget/export.xlsx · POST /ai/budget-notes ·
**جديد م-٥٠:** GET /projects/{id}/parties · PUT/DELETE /projects/{id}/parties/{partyType}/{partyId}

## ملاحظات التنفيذ (المرحلة ب)
- التسجيل: `index.tsx` يصدّر افتراضياً `SectionModule` بالمفاتيح `projects.list/project/budget/admin` والمسارات حرفياً من FRONTEND-CONTRACT §١؛ `redirectFrom` لـ`/budget` و`/settings/projects`.
- م-٥٠ مكتوب ضد API-CONTRACT §٣ حرفياً: `GET /projects/{id}/parties` (مصفوفة)، `PUT/DELETE …/parties/{partyType}/{partyId}` (partyId = الحساب/الكود)، `GET /parties/search`، `PUT /projects/{id}` لقيمة العقد. المبالغ نصوص Decimal تُعرض فقط؛ لا جمع/طرح مالي في الواجهة — الهامش `margin` من الخادم، والإجمالي `assignedTotal` من الخادم، وصف «إجمالي المعروض» من DataTable (sumHalalas).
- لا تحديث تفاؤلي لأي مبلغ؛ الإزالة بـtoast «تراجع» يعيد PUT بنفس المبلغ والملاحظات.
- ⚠ البطاقات/الجدول في قائمة المشاريع، ومقارنة المديونية، ولوحة الحكم من النموذج؛ إنشاء/حذف مشروع (النموذج) **غير مُنفَّذ** — لا مسار خادم له في API-CONTRACT.
- ⚠ «ملاحظات مالية» في الوثيقة لا تُحفظ (كما في القديم تماماً).
