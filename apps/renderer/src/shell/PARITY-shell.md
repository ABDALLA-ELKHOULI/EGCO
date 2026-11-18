# تكافؤ الهيكل (shell) — بنود PARITY.md المسندة لـF

المسارات نسبةً إلى `apps/renderer/src/`. ✅ مغطّى · ◐ مغطّى بتغيير مقصود · ❌ ناقص.

| البند | الحالة | أين في النسخة الجديدة | ملاحظة |
|---|---|---|---|
| P-001 إقلاع ٥ محاولات (1.2s×n) | ✅ | app/App.tsx:84-98 | + تحميل سجل الأقسام بالتوازي |
| P-002 شاشة فشل الإقلاع + «إعادة المحاولة» | ✅ | app/App.tsx:102-109 | |
| P-003 «جارٍ التشغيل…» | ✅ | app/App.tsx:111 | |
| P-004 إعادة تشغيل الخدمة | ◐ | app/App.tsx:54-68 | setApiBase + إعادة قناة الأحداث + إبطال الذاكرة؛ الشريط صار toast + إشعار في المركز؛ الفشل → شاشة فشل الإقلاع |
| P-006 HashRouter | ✅ | app/App.tsx:115 | |
| P-007 حاجز أخطاء، resetKey = المسار | ✅ | shell/Shell.tsx:115، shell/ViewBoundary.tsx | |
| P-018 شريط يمين بمجموعات | ◐ | shell/Sidebar.tsx، shell/sections.ts | ست وجهات (التصميم المعتمد) بدل ست مجموعات؛ كل الصفحات تبويبات (app/routes.tsx) |
| P-019 تنبيه المستحقات (overdue) | ◐ | app/routes.tsx:22 (useBadge على today.due) | نقطة الشريط صارت عدّاداً على التبويب |
| P-020 تنبيه الموردين (needsTerm) | ◐ | app/routes.tsx:23 (parties.suppliers) | كذلك |
| P-022 تنبيه التغطية (withoutData) | ◐ | app/routes.tsx:24 (data.coverage) | كذلك (+ cash.flow عند nextDeficit) |
| P-023 شارة «قريباً» للقروض/الالتزامات/المصاريف | ◐ | app/routes.tsx:60-65 | الصفحات (ComingSoon) تعمل على /cash/loans… والمسارات القديمة تُحوَّل؛ لا تبويب لها — قرار لوكيل النقد |
| P-024 طي الشريط محفوظ `egco.sidebar.collapsed` | ✅ | ui/prefs.ts:26، shell/Sidebar.tsx:63-65 | العدّاد يبقى ظاهراً مطوياً؛ title لكل عنصر |
| P-025 الشعار واسم الشركة | ✅ | shell/Sidebar.tsx:44-45 | الشعار الكامل يحمل الاسم؛ علامة الرافعة عند الطي |
| P-026 الشريط يعمل إن فشل overview | ✅ | app/routes.tsx:22-25 | الشارات 0 عند الخطأ؛ التذييل «الخدمة غير متاحة» |
| P-385 شاشة الخطأ + إعادة المحاولة + إعادة التحميل + التفاصيل | ✅ | shell/ViewBoundary.tsx:17-30 | |
| P-386 Kpi | ✅ | ui/charts.tsx:98 | الصفحات القديمة تبقى على components/ui.tsx |
| P-387 ErrorState | ✅ | ui/primitives.tsx:136 (EmptyState icon="alert") | |
| P-388 EmptyState بثلاث حالات | ✅ | ui/primitives.tsx:136 | icon: upload/search/check حسب الحالة |
| P-389 Money · Card · Pill · State | ✅ | ui/primitives.tsx:14,32,107 (Island بدل Card)، Skeleton بدل State | |
| P-390 أيقونات مسماة | ✅ | ui/Icon.tsx + components/Icon.tsx (باقٍ للقديم) | |
| P-393 ApiError برسائل عربية | ✅ | lib/api.ts:29 (كما هو)، data/client.ts:7 | |
| P-394 initApi + setApiBase | ✅ | lib/api.ts:9,25؛ App.tsx:57 | |
| P-395 الوضع قبل أول رسم | ✅ | main.tsx:8، ui/prefs.ts (applyTheme) | |
| P-396 GET /health | ✅ | app/App.tsx:87 | |
| P-536 `egco-theme` | ◐ | ui/prefs.ts:24 | نفس المفتاح؛ بلا قيمة = «تلقائي» (يتبع النظام) بدل فاتح دائماً |
| P-537 `egco.sidebar.collapsed` | ✅ | ui/prefs.ts:26 | |
| P-552 ثوابت الصفحات | ✅ | لا تخص الهيكل — تبقى في الصفحات القديمة؛ DataTable يفترض فوق ٢٠٠ صف بدل القصّ | على وكلاء الأقسام الحفاظ عليها |
