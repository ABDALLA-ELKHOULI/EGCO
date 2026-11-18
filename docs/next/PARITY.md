# PARITY.md — جرد تكافؤ v0.13.0 (بوابة «لا نقص»)

**المرجع:** وسم `v0.13.0` (commit `7292093`) في worktree `Dashboard-next` على الفرع `next/arkhabeel`.
مُشتق من قراءة الكود لا من التخمين: كل صفحة في `apps/renderer/src/pages/*.tsx`، كل مكوّن في
`apps/renderer/src/components/*.tsx`، `lib/*`، كل مسار في `services/api/app/api/routes/*.py`،
و`apps/desktop/src/{main,preload}` **كما هي في الوسم** (`git show v0.13.0:…`) — تعديلات وكيل D غير
المودعة (شريط عنوان، إشعارات نظام، شارة) جديدة ولا تُعدّ بنود تكافؤ.

**القاعدة (PLAN.md §١):** لا تُحذف صفحة قديمة قبل أن تُعلَّم كل بنودها ✅ في الصفحة الجديدة. بوابة الإغلاق
تفشل لأي بند ☐ أو ❌. الموطن الجديد = أحد الأقسام الستة (today · parties · projects · cash · reports · data)
أو `shell` (الهيكل/مكتبة UI المشتركة — وكيل F) أو `desktop` (وكيل D). عمود الحالة: ☐ لم يُنقل · ✅ نُقل
وتحقّق · ❌ أُسقط (يتطلب قرار المستخدم صراحةً). يُشار للبنود بأرقامها `P-NNN` ولا يُعاد ترقيمها.

## الإجماليات

| القسم | النطاق | عدد البنود |
|---|---|---|
| ١ · الواجهة (٢٢ صفحة + ٢١ مكوّناً + lib) | P-001 … P-395 | 395 |
| ٢ · مسارات الخادم | P-396 … P-509 | 114 |
| ٣ · سطح المكتب (IPC) | P-510 … P-535 | 26 |
| ٤ · الإعدادات والتخزين | P-536 … P-552 | 17 |
| ٥ · التصديرات | P-553 … P-582 | 30 |
| ٦ · ثوابت البيانات | P-583 … P-607 | 25 |
| **المجموع** | | **607** |

## ما يبدو ميتاً أو غير مستعمل أو معطوباً (مُعلَّم — لا يُحذف)

**مسارات بلا مستدعٍ في الواجهة:**
- `GET /suppliers/payment-allocation/pending-count` — لا شاشة تعرض العدد (مرشّح لنقطة تنبيه).
- `DELETE /suppliers/{a}/payments/{id}/allocate` — لا زر «إلغاء تخصيص»؛ التعديل يتم بإعادة التخصيص فقط.
- `GET /import/near-duplicates?account=` — التحذير يصل ضمن `preview`/`import` بدلاً منه.
- `POST|GET|DELETE /budget/{id}/comments[/{cid}]` — ثلاثة مسارات تعليقات موازنة بلا أي واجهة.
- `PUT /budget/project/{name}/city` — `api.budgetSetCity` معرَّف ولا يُستدعى؛ لا طريقة في الواجهة لضبط مدينة المشروع (فلتر «المدينة» يعتمد على ما في الملف).
- `api.importHistory()` معرَّف وغير مستعمل (Import.tsx يستدعي `/import/history` مباشرة بمعاملات التصفية).

**معاملات خادم مقبولة ولا تُرسل من أي شاشة:** `/dashboard` date_from/date_to · `/suppliers` overdue_only/has_data/min_delay_days/max_delay_days · `/suppliers/{a}` date_from/date_to · `/projects` q/date_from/date_to/min_outstanding · `/coverage` q/project/state (التصفية محلية) · `/cashflow` و`/breakdown` from · `/contractors` has_guarantees · `/contractors/claims-due` date_from/date_to · `/budget/project/{n}` from/to · `/revenues` date_field · `/reports/analysis` period_from (قديم).

**قدرات خادم بلا واجهة تحرير:** حالة المقاول `status` و`statusNote` تُعرض وتُصفّى في القائمة لكن لا نموذج يضبطها (ContractorForm لا يحويها).

**أعطال/تناقضات قائمة يجب ألا تُنقل كما هي:**
- `lib/whatsNew.ts`: مصفوفة WHATS_NEW غير مرتّبة (0.13.0، 0.12.0، 0.10.0، 0.11.0، 0.11.1) بينما `toursSince` يقطع بعد فهرس الإصدار المرئي، وزر «ما الجديد في هذا الإصدار» في الإعدادات يعرض `WHATS_NEW[length-1]` = 0.11.1 لا 0.13.0.
- اصطلاح لون رصيد المقاول غير موحّد: `ProjectDetail.tsx:78-81` يلوّن السالب أحمر ويسمّيه «لنا عليه» (معكوس)، و`Report.tsx:772` يلوّن «له» أحمر، بينما `Contractors.tsx` (م-٣٦) محايد. KPI «مستحق للمقاولين» في ProjectDetail بلون أحمر أيضاً.
- `Settings.tsx` BACKUP_KIND_LABEL لا يعرف `before-reset` (يظهر الاسم الخام).
- تصفية/ترتيب محلي (استثناءات موثّقة): جداول كشف المورد، دفتر المقاول، المستخلصات، التغطية، وترقيم صفحات المقاولين — مخالفة لقاعدة «الترتيب على الخادم» لكنها بلا سطر إجماليات.
- صفحات «قريباً» (`/loans`، `/obligations`، `/expenses`) إطارات بلا بيانات — تُنقل كإطارات أو يُتخذ قرار صريح.

## أكثر ١٠ قدرات عرضة للضياع في إعادة التصميم
1. **(P-224، P-227، P-228) تفكيك «من أين جاء هذا الرقم؟» في التدفق النقدي + سطر المطابقة بالهللة + سؤال تفسير الفرق** (CashFlow) — منطق معقّد غير ظاهر للمصمم.
2. **(P-273، P-274) نافذة «حساب جديد لم نره من قبل» وتمييز unknown_supplier عن النجاح** (Import) — كان خللاً صامتاً «تم» بلا حفظ.
3. **(P-288) تصنيف الحسابات ذات البادئة غير 211/212/216 قبل الحفظ** (Import ClassifyModal + Settings) — بوابة سلامة البيانات.
4. **(P-109، P-364، P-555…P-572) ١٤ صيغة تصدير المقاولين + كشف الحساب PDF/Excel لكل صف** (ExportMenu/Contractors).
5. **(P-093، P-094) تخصيص الدفعات الاختياري ودفعات «بانتظار التخصيص»** (SupplierDetail) — مخفي خلف إعداد متوقف افتراضياً.
6. **(P-362) حارس الإغلاق «تجاهل التغييرات غير المحفوظة؟» + فخ التركيز في كل النوافذ** (Modal) — سلوك مكتبة سهل النسيان عند استبدالها.
7. **(P-135 وأمثالها) إفصاحات النطاق والإشارة** (المُبلَّغ مقابل المشتقّ، «لا يُحسب للمقاولين»، «—» لا صفر لمن بلا مدة سداد، «الأرقام أعلاه لا تتأثر بتصفية الجدول») — نصوص صغيرة تُحذف أول ما يُعاد التصميم.
8. **(P-201، P-202) تعارض الموازنة ملف/يدوي الإلزامي + الحساب الحي من الخادم + أثر السلسلة** (Budget ManualEntryForm).
9. **(P-296، P-299) الحذف التقريبي للاستيرادات القديمة (legacy، نافذة ٣ دقائق) + قسم الحركات المكرّرة القائمة** (Import).
10. **(P-004، P-517، P-522، P-528) مسارات Electron للبيانات: استعادة نسخة بإيقاف الخدمة/before-restore، تصدير متّسق VACUUM INTO، نسخة before-update، شريط إعادة تشغيل الخدمة** (desktop + App.tsx).

---

## ١ · الواجهة (صفحات ومكوّنات)
### 1.1 الهيكل العام — App / Sidebar / ErrorBoundary
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-001 | app/App.tsx:98-120 | إقلاع بخمس محاولات متباعدة (1.2s×n) لـ initApi + health قبل عرض أي شاشة | GET /health | shell | ☐ |
| P-002 | app/App.tsx:122-135 | شاشة فشل الإقلاع «تعذّر الاتصال بالخدمة المحلية» + نص الخطأ + زر «إعادة المحاولة» (يعيد initApi) | GET /health | shell | ☐ |
| P-003 | app/App.tsx:136 | حالة «جارٍ التشغيل…» قبل الجاهزية | — | shell | ☐ |
| P-004 | app/App.tsx:83-94,142-152 | شريط إعادة تشغيل الخدمة الخلفية: عند recovered يحدّث apiBase بصمت ويعرض «انقطع الاتصال… ثم عاد تلقائياً» + زر إغلاق؛ عند الفشل يعود لشاشة فشل الإقلاع | IPC backend:restarted | shell | ☐ |
| P-005 | app/App.tsx:46-75 | جولة «ما الجديد»: مقارنة egco-last-seen-version مع إصدار التطبيق، عرض toursSince(lastSeen)؛ أول تشغيل يسجّل بصمت؛ الإغلاق يسجّل الإصدار | IPC app:info | shell | ☐ |
| P-006 | app/App.tsx:140 | HashRouter (التطبيق المحزوم يُحمَّل عبر file://) — كل الروابط العميقة بصيغة #/path | — | shell | ☐ |
| P-007 | app/App.tsx:169-199 | ErrorBoundary حول كل الصفحات، resetKey = المسار (التنقل يمسح الخطأ) | — | shell | ☐ |
| P-008 | app/App.tsx:174 | مسار `/` → لوحة القيادة CommandCentre | — | today | ☐ |
| P-009 | app/App.tsx:175 | مسار `/payables` → «المستحقات القادمة» (Dashboard.tsx) | — | today/cash | ☐ |
| P-010 | app/App.tsx:176-177 | مسارا `/suppliers` و `/suppliers/:account` | — | parties | ☐ |
| P-011 | app/App.tsx:178-179 | مسارا `/contractors` و `/contractors/:code` | — | parties | ☐ |
| P-012 | app/App.tsx:180 | مسار `/guarantees` | — | parties | ☐ |
| P-013 | app/App.tsx:181-183 | مسارات `/budget` `/projects` `/projects/:project` | — | projects | ☐ |
| P-014 | app/App.tsx:184-185 | مسارا `/cashflow` `/revenues` | — | cash | ☐ |
| P-015 | app/App.tsx:187-189 | مسارات مخفية «قريباً»: `/loans` `/obligations` `/expenses` (ComingSoon) | — | cash | ☐ |
| P-016 | app/App.tsx:190-193 | مسارات `/coverage` `/calendar` `/import` `/report` | — | data/cash/data/reports | ☐ |
| P-017 | app/App.tsx:194-196 | مسارات `/settings` `/settings/trash` `/settings/projects` (الأخيرتان بلا عنصر في الشريط؛ تُفتحان من الإعدادات) | — | data | ☐ |
| P-018 | components/Sidebar.tsx:29-80 | الشريط الجانبي على اليمين بست مجموعات: نظرة عامة · التزاماتنا · السيولة · المشاريع · التحليل · البيانات + الإعدادات أسفله | — | shell | ☐ |
| P-019 | components/Sidebar.tsx:41 | نقطة تنبيه «المستحقات القادمة» عند overdue>0 | GET /overview | shell | ☐ |
| P-020 | components/Sidebar.tsx:42,111 | نقطة تنبيه «الموردون» عند needsTerm>0 (موردون أُنشئوا تلقائياً بلا مدة سداد) | GET /overview | shell | ☐ |
| P-021 | components/Sidebar.tsx:52,107 | نقطة تنبيه «التدفق النقدي» عند وجود cash.nextDeficit | GET /overview | shell | ☐ |
| P-022 | components/Sidebar.tsx:77,108 | نقطة تنبيه «تغطية الكشوفات» عند coverage.withoutData>0 | GET /overview | shell | ☐ |
| P-023 | components/Sidebar.tsx:54-56,160 | شارة «قريباً» على القروض/الالتزامات الشهرية/المصاريف التشغيلية | — | shell | ☐ |
| P-024 | components/Sidebar.tsx:91-98,121-131 | طيّ/توسيع الشريط، محفوظ في localStorage `egco.sidebar.collapsed` ('1'/'0')؛ نقاط التنبيه تبقى ظاهرة عند الطي؛ title للعنصر عند الطي | — | shell | ☐ |
| P-025 | components/Sidebar.tsx:132-150 | الشعار (logo-mark) واسم الشركة «إعمار الخليج / المصرية للمقاولات» | — | shell | ☐ |
| P-026 | components/Sidebar.tsx:114 | الشريط يعمل بلا تنبيهات إن فشل جلب overview (صمت) | — | shell | ☐ |

### 1.2 لوحة القيادة — pages/CommandCentre.tsx (`/`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-027 | pages/CommandCentre.tsx:19-25 | تحميل/خطأ مع زر إعادة المحاولة | GET /overview | today | ☐ |
| P-028 | pages/CommandCentre.tsx:47 | ترويسة بتاريخ «asOf» | GET /overview | today | ☐ |
| P-029 | pages/CommandCentre.tsx:53-61 | شبكة التنبيهات (danger/warning/note) أو «لا توجد تنبيهات — كل الالتزامات ضمن مواعيدها» | GET /overview (alerts) | today | ☐ |
| P-030 | pages/CommandCentre.tsx:64 | KPI «المديونية المفتوحة» (hero) + نقطة شرح outstanding | GET /overview | today | ☐ |
| P-031 | pages/CommandCentre.tsx:66-73 | KPI «المتأخر» أحمر مع تنبيه + شرح overdue | GET /overview | today | ☐ |
| P-032 | pages/CommandCentre.tsx:74 | KPI «مستحق خلال ٧ أيام» ذهبي + شرح | GET /overview | today | ☐ |
| P-033 | pages/CommandCentre.tsx:76-80 | KPI «الموردون» العدد + «N منهم لديهم كشوفات» | GET /overview | today | ☐ |
| P-034 | pages/CommandCentre.tsx:84-112 | بطاقة «التغطية»: نسبة٪ + شريط تقدّم + عدد بلا كشوفات + عدد القديمة + زر «عرض فجوات التغطية» → #/coverage + شرح supplierCoverage | GET /overview | today | ☐ |
| P-035 | pages/CommandCentre.tsx:114-137 | بطاقة «السيولة»: أدنى رصيد + «أول عجز: الشهر بمقدار»؛ أو «لم تُرفع بيانات التحصيلات» + زر فتح التدفق | GET /overview (cash) | today | ☐ |
| P-036 | pages/CommandCentre.tsx:141-177 | «أعلى المشاريع مديونية»: أعلى ٥ بمديونية>0، شريط نسبي، المتأخر بالأحمر، رابط للمشروع، «+N مشاريع بلا مديونية» | GET /overview (projects) | today | ☐ |
| P-037 | pages/CommandCentre.tsx:187-191 | قسم المساعد يختفي إن كان AI معطلاً ويعرض AiDisabledHint | GET /ai/settings | today | ☐ |
| P-038 | pages/CommandCentre.tsx:273-285,316-322 | «اسأل بياناتك»: سؤال حر (Enter يرسل) → جواب + «عرض بيانات الإثبات» (أول ٢٠ صفاً) + «الاستعلام (SQL)» | POST /ai/ask | today | ☐ |
| P-039 | pages/CommandCentre.tsx:261,325 | «الموجز الأسبوعي» (٧ أيام) | POST /ai/brief | today | ☐ |
| P-040 | pages/CommandCentre.tsx:265,327-349 | «مراجعة الحركات غير المعتادة» مع روابط لكل بند؛ «لا شذوذ ملحوظ» | POST /ai/anomalies | today | ☐ |

### 1.3 المستحقات القادمة — pages/Dashboard.tsx (`/payables`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-041 | pages/Dashboard.tsx:15,42 | فلاتر في URL: `?project=` و `?status=` (overdue/soon) قابلة للربط العميق | GET /dashboard?project= | today | ☐ |
| P-042 | pages/Dashboard.tsx:54-57 | حالة فارغة «ابدأ من رفع كشف حساب» | — | today | ☐ |
| P-043 | pages/Dashboard.tsx:83 | زر «رفع كشف حساب» → /import | — | today | ☐ |
| P-044 | pages/Dashboard.tsx:87-95 | قائمة مشاريع + قائمة حالة (متأخر/مستحق قريباً) | GET /projects | today | ☐ |
| P-045 | pages/Dashboard.tsx:99-106 | KPIs: متأخر عن موعده · مستحق خلال ٧ أيام · المديونية المفتوحة (مع شروح) | GET /dashboard | today | ☐ |
| P-046 | pages/Dashboard.tsx:109-122 | سطر المقاولين: متأخر المقاولين «غير مجموع مع الموردين» + عدد المقاولين بلا مدة سداد (رابط) | GET /overview | today | ☐ |
| P-047 | pages/Dashboard.tsx:123-127 | تنبيه contractors_overdue من overview | GET /overview | today | ☐ |
| P-048 | pages/Dashboard.tsx:129-135 | «سُدّد هذا العام X من إجمالي Y (نسبة)» | GET /dashboard | today | ☐ |
| P-049 | pages/Dashboard.tsx:138-172 | جدول «ادفع اليوم» (المورد·المشروع·الفاتورة·الاستحقاق·الحالة·المبلغ) + تذييل الإجمالي خلال ٧ أيام + تلوين متأخر/قريب + رابط المورد؛ حالة فارغة all-clear | GET /dashboard | today | ☐ |
| P-050 | pages/Dashboard.tsx:175-195 | مخطط أعمدة «الاستحقاقات القادمة — ٩٠ يوماً» (٨ أعمدة، أحمر للمتأخر، عدد الفواتير) + ملاحظة عدد التواريخ المتأخرة المستبعدة | GET /dashboard | today | ☐ |
| P-051 | pages/Dashboard.tsx:197-210 | «أعمار الديون»: لم يحن · ١–٣٠ · ٣١–٦٠ · ٦١–٩٠ · ٩٠+ | GET /dashboard (ageing) | today | ☐ |

### 1.4 الموردون — pages/Suppliers.tsx (`/suppliers`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-052 | pages/Suppliers.tsx:32-43,117-126 | تصفية/ترتيب على الخادم (q, project, status, delay, min/max_outstanding, date_from/to, sort, dir) مع debounce 200ms وإهمال الاستجابات المتأخرة (seq) | GET /suppliers | parties | ☐ |
| P-053 | pages/Suppliers.tsx:204 | بحث بالاسم أو رقم الحساب | GET /suppliers?q | parties | ☐ |
| P-054 | pages/Suppliers.tsx:208 | عدّاد «N نتيجة · مفتوح X ر.س» | GET /suppliers | parties | ☐ |
| P-055 | pages/Suppliers.tsx:52-59,210 | «تصدير Excel» يصدّر المجموعة المصفّاة الحالية فقط | GET /suppliers/export.xlsx | parties | ☐ |
| P-056 | pages/Suppliers.tsx:93-152,211 | «PDF» عبر PrintableList (المورد·الحساب·المشروع·الحالة·التأخر·المفتوح) + سطر إجماليات + سطر التصفية | — | parties | ☐ |
| P-057 | pages/Suppliers.tsx:61-73,217-231 | شريط التصفيات النشطة (chips) مع × لكل واحدة + «مسح الكل» + «متأخر ضمن التصفية» | — | parties | ☐ |
| P-058 | pages/Suppliers.tsx:253-255 | عمود «المورد»: ترتيب أ←ي + تصفية نصية في قائمة العمود | — | parties | ☐ |
| P-059 | pages/Suppliers.tsx:256-258 | عمود «رقم الحساب»: ترتيب + تصفية نصية (211…) | — | parties | ☐ |
| P-060 | pages/Suppliers.tsx:259-263 | عمود «المشروع»: ترتيب + تصفية بقائمة المشاريع | — | parties | ☐ |
| P-061 | pages/Suppliers.tsx:264-268 | عمود «الحالة»: ترتيب (الأحرج أولاً) + تصفية بالحالات | — | parties | ☐ |
| P-062 | pages/Suppliers.tsx:270-274 | عمود «التأخر» (م-٣٥ قبل المفتوح): ترتيب + تصفية بشرائح التأخر DELAY_BUCKETS | — | parties | ☐ |
| P-063 | pages/Suppliers.tsx:275-280 | عمود «المديونية المفتوحة»: ترتيب + تصفية بمدى (min/max ر.س)؛ لون محايد | — | parties | ☐ |
| P-064 | pages/Suppliers.tsx:281-286 | عمود «آخر دفعة» (مبلغ+تاريخ أو «لا دفعات»): ترتيب + تصفية بمدى تاريخ | — | parties | ☐ |
| P-065 | pages/Suppliers.tsx:300-304 | سطر «التغطية: من … إلى …» تحت اسم المورد | — | parties | ☐ |
| P-066 | pages/Suppliers.tsx:310-317 | مدة السداد تحت رقم الحساب + شارة «مدة السداد غير محدّدة» لـ termKind=unset | — | parties | ☐ |
| P-067 | pages/Suppliers.tsx:322-328 | مشاريع متعددة: الأول + شارة «+N» و title بالكامل | — | parties | ☐ |
| P-068 | pages/Suppliers.tsx:293-295 | تلوين الصف: متأخر/قريب/مسدَّد | — | parties | ☐ |
| P-069 | pages/Suppliers.tsx:334-345,409-437 | النقر على التأخر يفتح نافذة «توزيع المتأخر» بالشرائح + الإجمالي + «فتح كشف المورد» | — | parties | ☐ |
| P-070 | pages/Suppliers.tsx:236-244 | حالتا فراغ: «لا نتائج مطابقة» + مسح التصفية / «لم تُرفع قائمة الموردين بعد» + رفع الملف | — | parties | ☐ |
| P-071 | pages/Suppliers.tsx:196,388-393 | «إضافة مورد» (نافذة بحارس تعديلات غير محفوظة) | POST /suppliers | parties | ☐ |
| P-072 | pages/Suppliers.tsx:366,395-407 | تعديل مورد ✎ (الاسم، المشروع، المدة، المشاريع) | PUT /suppliers/{account} | parties | ☐ |
| P-073 | pages/Suppliers.tsx:368,551-606 | حذف مورد: تأكيد عادي، وإن كانت له حركات → حذف نهائي بكتابة رقم الحساب (force) | DELETE /suppliers/{account}[?force=true] | parties | ☐ |
| P-074 | pages/Suppliers.tsx:191-201,459-547 | «أولويات السداد» (AI فقط): ميزانية اختيارية، جدول #/الاسم/نوع الطرف/المبلغ/السبب/«ضمن الميزانية» (تراكمي محلي) + سرد المساعد + إفصاح أن «ضمن الميزانية» تقدير محلي | POST /ai/priorities | parties/reports | ☐ |
| P-075 | pages/Suppliers.tsx:381-385 | رابط «للسداد اليومي: المستحقات القادمة» | — | parties | ☐ |

### 1.5 كشف مورد — pages/SupplierDetail.tsx (`/suppliers/:account`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-076 | pages/SupplierDetail.tsx:412-417 | ترويسة: الاسم، الحساب، المشروع، مدة السداد، عدد الفواتير | GET /suppliers/{account} | parties | ☐ |
| P-077 | pages/SupplierDetail.tsx:419,692-697 | «إضافة مديونية» يدوية (ManualEntryForm invoice) | POST /manual/invoices | parties | ☐ |
| P-078 | pages/SupplierDetail.tsx:422,699-704 | «تسجيل دفعة» يدوية | POST /manual/payments | parties | ☐ |
| P-079 | pages/SupplierDetail.tsx:425 | «استخراج التحليل» → /report?account= | — | parties→reports | ☐ |
| P-080 | pages/SupplierDetail.tsx:428-430,764 | «صياغة مطالبة» (AI) → RemindModal supplier | POST /ai/remind | parties | ☐ |
| P-081 | pages/SupplierDetail.tsx:185-200,431-434 | تفعيل/إيقاف «تخصيص الدفعات» (إعداد عام، افتراضياً متوقف) | GET/PUT /suppliers/settings/payment-allocation | parties/data | ☐ |
| P-082 | pages/SupplierDetail.tsx:435 | زر «رجوع» → /suppliers | — | parties | ☐ |
| P-083 | pages/SupplierDetail.tsx:438-443 | تنبيه «N دفعات بانتظار التخصيص» | GET /suppliers/{account} | parties | ☐ |
| P-084 | pages/SupplierDetail.tsx:445-448 | إفصاح «فئات الأعمار محسوبة من تاريخ الاستحقاق» + شرح ageingByDueDate | — | parties | ☐ |
| P-085 | pages/SupplierDetail.tsx:450-455 | تنبيه needsManualDueDate: المدة نصية — الاستحقاق يُدخل يدوياً | — | parties | ☐ |
| P-086 | pages/SupplierDetail.tsx:457-468 | KPIs: إجمالي المفوتر · المسدد · المديونية المفتوحة (hero+شرح) · متأخر (شرح) | GET /suppliers/{account} | parties | ☐ |
| P-087 | pages/SupplierDetail.tsx:473-498 | شريط شرائح التأخر (٧ شرائح) قابلة للنقر لتصفية الفواتير + «عرض الكل» | — | parties | ☐ |
| P-088 | pages/SupplierDetail.tsx:501-524 | جدول الفواتير: المفتوحة فقط / «إظهار المسددة»، «عرض N من M»، «مسح تصفية الأعمدة»، «إلغاء التصفية» | — | parties | ☐ |
| P-089 | pages/SupplierDetail.tsx:529-551 | أعمدة الفواتير بفرز وتصفية محلية: الفاتورة (نص) · تاريخ الفاتورة (مدى) · الاستحقاق (مدى) · المبلغ/المسدد/المتبقي (مدى) · الحالة (متأخرة/قريباً/غير مستحقة/بانتظار تاريخ/مسددة) | — | parties | ☐ |
| P-090 | pages/SupplierDetail.tsx:560 | شارة «يدوي» للفواتير اليدوية | — | parties | ☐ |
| P-091 | pages/SupplierDetail.tsx:571-578,706-736 | تعديل/حذف مديونية يدوية (تأكيد) | PUT/DELETE /manual/invoices/{id} | parties | ☐ |
| P-092 | pages/SupplierDetail.tsx:579-590,738-762 | «تحديد/تعديل الاستحقاق» لفاتورة من كشف (تاريخ أو فارغ) | PUT /invoices/{id}/due-date | parties | ☐ |
| P-093 | pages/SupplierDetail.tsx:599-626 | بطاقة «دفعات بانتظار التخصيص» مع سبب التعليق وزر «تخصيص» | — | parties | ☐ |
| P-094 | pages/SupplierDetail.tsx:50-145 | نافذة «تخصيص دفعة»: اختيار فاتورة/فواتير بمبالغ مقترحة، أو «على الحساب»؛ الحفظ مشروط بتساوي المجموع مع الدفعة (±0.01) | POST /suppliers/{a}/payments/{id}/allocate | parties | ☐ |
| P-095 | pages/SupplierDetail.tsx:628-689 | جدول الدفعات: التاريخ (مدى) · المستند (نص) · الوصف (نص) · المبلغ (مدى) مع فرز، عدّاد، مسح تصفية | — | parties | ☐ |
| P-096 | pages/SupplierDetail.tsx:668-677 | زر «تخصيص» لكل دفعة (عند التفعيل) لتعديل تخصيص سابق | POST allocate | parties | ☐ |
| P-097 | pages/SupplierDetail.tsx:678-681,778-789 | حذف دفعة يدوية (تأكيد) | DELETE /manual/payments/{id} | parties | ☐ |

### 1.6 المقاولون — pages/Contractors.tsx (`/contractors`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-098 | pages/Contractors.tsx:27-31 | اصطلاح العرض: رصيد سالب = «له» (محايد اللون)، موجب = «لنا» (أخضر)، صفر = «متوازن»؛ الأحمر محجوز للتأخر (م-٣٦) | — | parties | ☐ |
| P-099 | pages/Contractors.tsx:35-38 | ألوان شارات الحالة: نشط ok · متوقف/نزاع warn · مغلق muted · قائمة سوداء red | — | parties | ☐ |
| P-100 | pages/Contractors.tsx:400-407 | نصوص إفصاح الترويسة: معنى الإشارة، و«متأخر يُحسب لمن له مدة سداد فقط؛ من لا مدة له يظهر —» | — | parties | ☐ |
| P-101 | pages/Contractors.tsx:100-107,187-196 | تصفية/ترتيب على الخادم (q, project, direction, status, sort, dir) debounce 200ms + seq | GET /contractors?… | parties | ☐ |
| P-102 | pages/Contractors.tsx:418-423 | KPIs: إجمالي مستحق للمقاولين (hero) · إجمالي مستحق لنا · الضمانات المحتجزة (مع شروح) | GET /contractors | parties | ☐ |
| P-103 | pages/Contractors.tsx:426-434 | KPI «متأخر (لمن له مدة سداد)» أحمر عند >0 + سطر «N بلا مدة — تأخرهم غير محسوب · المتأخر على M» | GET /contractors (totals.overdueTotal/withTermCount/withoutTermCount) | parties | ☐ |
| P-104 | pages/Contractors.tsx:440,443 | بحث بالاسم/الرمز + عدّاد «N مقاولاً» | — | parties | ☐ |
| P-105 | pages/Contractors.tsx:446-455,700-764 | تبديل العرض: «قائمة» / «تجميع بالمشروع» (مجموعات قابلة للطي، مرتبة بالأكبر «له»، أبناء مرتبون بالرصيد) + إفصاح النطاق | — | parties | ☐ |
| P-106 | pages/Contractors.tsx:456 | قائمة «تصدير» (ExportMenu) بالمجموعة المصفّاة الحالية — ١٤ صيغة | GET /contractors/export.xlsx | parties | ☐ |
| P-107 | pages/Contractors.tsx:165-176,248-268,457 | «PDF» قائمة المقاولين (المقاول·الرمز·المشروع·الرصيد(له/لنا)·الضمان) + تذييل له/لنا | — | parties | ☐ |
| P-108 | pages/Contractors.tsx:332-365,458 | «PDF إجماليات المشاريع» من totals.byProject (المشروع·العدد·له·لنا) + ملخص + تذييل | GET /contractors | parties/reports | ☐ |
| P-109 | pages/Contractors.tsx:153-157,273-326,630 | 🖶 طباعة «كشف حساب» مقاول PDF: كل الحركات (التاريخ·النوع·الوصف·المشروع·مدين·دائن) + ملخص (الرصيد الختامي، مدين، دائن، الضمان) + تحذير «لا كشف مرفوع» | GET /contractors/{code} | parties | ☐ |
| P-110 | pages/Contractors.tsx:629 | زر تصدير كشف حساب Excel لكل صف (StatementExportButton) | GET /contractors/export.xlsx?format=statement&code= | parties | ☐ |
| P-111 | pages/Contractors.tsx:121-128,464-475 | شريط التصفيات النشطة + مسح الكل | — | parties | ☐ |
| P-112 | pages/Contractors.tsx:494-496 | عمود المقاول: ترتيب + تصفية نصية | — | parties | ☐ |
| P-113 | pages/Contractors.tsx:497-499 | عمود الرمز: ترتيب + تصفية نصية (212…) | — | parties | ☐ |
| P-114 | pages/Contractors.tsx:500-504 | عمود المشروع: تصفية بالقائمة (بلا ترتيب) | — | parties | ☐ |
| P-115 | pages/Contractors.tsx:505-510 | عمود الاتجاه (الرصيد): ترتيب + تصفية مستحق له/لنا/متوازن | — | parties | ☐ |
| P-116 | pages/Contractors.tsx:511-516 | عمود الحالة: ترتيب + تصفية بالحالات الست | — | parties | ☐ |
| P-117 | pages/Contractors.tsx:517-519,595-610 | عمود «متأخر» (م-٤٦): مبلغ + «N مستخلص · أقدمها D يوماً» / «—» بتلميح «اضبط مدة السداد» / «لا تأخر»؛ ترتيب | — | parties | ☐ |
| P-118 | pages/Contractors.tsx:520-522,611-615 | عمود «الضمان المحتجز»: «غير معروف» لمن بلا كشف / «لا يوجد»؛ ترتيب | — | parties | ☐ |
| P-119 | pages/Contractors.tsx:523-527,616-626 | أعمدة «آخر دفعة» و«آخر حركة» مع ترتيب | — | parties | ☐ |
| P-120 | pages/Contractors.tsx:547-549 | نقطة «ضمانات مستحقة الصرف» (releaseAlerts) بجوار الاسم | — | parties | ☐ |
| P-121 | pages/Contractors.tsx:550-555 | شارة «بلا كشف مرفوع» (hasStatement=false) بتلميح | — | parties | ☐ |
| P-122 | pages/Contractors.tsx:556-558 | رقم الهاتف تحت الاسم | — | parties | ☐ |
| P-123 | pages/Contractors.tsx:580-594 | ملاحظة الحالة (statusNote) مقتطعة + كاملة عند التحويم | — | parties | ☐ |
| P-124 | pages/Contractors.tsx:92,647-663 | ترقيم صفحات محلي ٥٠ صفاً (الأولى/السابقة/التالية/الأخيرة + «عرض a–b من N»)؛ يعود للأولى عند تغيير التصفية | — | parties | ☐ |
| P-125 | pages/Contractors.tsx:476-486 | حالتا فراغ: لا نتائج مطابقة / لم تُرفع بيانات المقاولين | — | parties | ☐ |
| P-126 | pages/Contractors.tsx:409,666-671 | «إضافة مقاول» (ContractorForm، حارس تعديلات) | POST /contractors | parties | ☐ |
| P-127 | pages/Contractors.tsx:632,673-687 | تعديل مقاول (الرمز مقفل) | PUT /contractors/{code} | parties | ☐ |
| P-128 | pages/Contractors.tsx:634,983-1040 | حذف مقاول بخطوتين (كتابة الرمز عند وجود حركات → force) | DELETE /contractors/{code}[?force=true] | parties | ☐ |
| P-129 | pages/Contractors.tsx:68,780-849 | «نظرة المقاولين» Carousel بأربع صفحات، الصفحة الفعالة محفوظة في localStorage `egco.contractors.overviewView` | GET /contractors/overview | parties | ☐ |
| P-130 | pages/Contractors.tsx:829,854-887 | صفحة «التوزيع على المشاريع» (مُبلَّغ إن وُجد وإلا مشتق) شريط نسبي + عدد + إفصاح النطاق | GET /contractors/overview | parties | ☐ |
| P-131 | pages/Contractors.tsx:830,891-913 | صفحة «أكبر ١٠ مقاولين بالمستحق» | GET /contractors/overview | parties | ☐ |
| P-132 | pages/Contractors.tsx:831,919-936 | صفحة «الضمانات المستقلة (216)» إجمالي + عدد + إفصاح الفرق عن الضمانات المحتجزة | GET /contractors/overview | parties | ☐ |
| P-133 | pages/Contractors.tsx:832,941-980 | صفحة «اختلافات الرصيد» (رصيد الملف/المحسوب/الفرق) من آخر تقرير مديونيات مجمّع، مع all-clear | GET /contractors/overview | parties/data | ☐ |
| P-134 | pages/Contractors.tsx:805-818 | حالة فراغ النظرة قبل أي استيراد + زر «رفع الملفات» | — | parties | ☐ |
| P-135 | pages/Contractors.tsx:839-846 | إفصاح «المُبلَّغ vs المشتقّ» (تقرير المديونيات المجمّع مقابل الحركات) | GET /contractors/overview | parties | ☐ |

### 1.7 كشف مقاول — pages/ContractorDetail.tsx (`/contractors/:code`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-136 | pages/ContractorDetail.tsx:237-245 | ترويسة: الاسم، الرمز، الهاتف، نسبة الضمان الافتراضية، مدة الضمان، مدة السداد، الملاحظات | GET /contractors/{code} | parties | ☐ |
| P-137 | pages/ContractorDetail.tsx:247,643-661 | «تعديل» بطاقة المقاول (ContractorForm كامل: هاتف، ملاحظات، نسبة/مدة ضمان، مدة سداد) | PUT /contractors/{code} | parties | ☐ |
| P-138 | pages/ContractorDetail.tsx:248,663-679 | «إضافة حركة» يدوية | POST /contractors/{code}/entries | parties | ☐ |
| P-139 | pages/ContractorDetail.tsx:251,681 | «صياغة مطالبة» (AI) للمقاول | POST /ai/remind | parties | ☐ |
| P-140 | pages/ContractorDetail.tsx:252,685-701,776-818 | «قيد من نص» (AI): لصق رسالة واتساب/بريد → اقتراح يملأ نموذج الحركة للمراجعة (لا حفظ مباشر) | POST /ai/parse-text | parties | ☐ |
| P-141 | pages/ContractorDetail.tsx:255 | زر «رجوع» | — | parties | ☐ |
| P-142 | pages/ContractorDetail.tsx:259-261 | KPI «الرصيد (له/لنا)» hero + شرح contractorBalance | GET /contractors/{code} | parties | ☐ |
| P-143 | pages/ContractorDetail.tsx:262-265 | KPIs: إجمالي المستخلصات (duesTotal من الدفتر) · إجمالي المدفوع · الضمان المحتجز (مجموع الضمانات غير المصروفة، محلي) + شرح | GET /contractors/{code} | parties | ☐ |
| P-144 | pages/ContractorDetail.tsx:269-281 | تفصيل جانب المدين: مدفوعات + خصومات + تأمينات + فواتير/افتتاحي = إجمالي المدين؛ وإفصاح «الرصيد = المدين − الدائن» | GET /contractors/{code} | parties | ☐ |
| P-145 | pages/ContractorDetail.tsx:286-298 | بطاقة «الاستحقاق» بلا مدة: نص تفسيري + زر «اضبط مدة السداد» | — | parties | ☐ |
| P-146 | pages/ContractorDetail.tsx:300-308 | KPIs الاستحقاق: متأخر · خلال ٧ أيام · خلال ٣٠ يوماً · أقدم تأخر | GET /contractors/{code} (delay) | parties | ☐ |
| P-147 | pages/ContractorDetail.tsx:309-320 | شرائح التأخر الشهرية (m1..m6_plus) | — | parties | ☐ |
| P-148 | pages/ContractorDetail.tsx:321-353 | جدول استحقاق المستخلصات (المستخلص·المشروع·التاريخ·الاستحقاق·المبلغ·المسدَّد·المتبقي·التأخر) بعد FIFO | — | parties | ☐ |
| P-149 | pages/ContractorDetail.tsx:358-377 | بطاقات المشاريع (perProject: الرصيد له/لنا + عدد الحركات) قابلة للنقر لتصفية الدفتر والمستخلصات | — | parties | ☐ |
| P-150 | pages/ContractorDetail.tsx:380-403 | دفتر الحساب: عنوان بالمشروع المصفّى، إفصاح «مدين = دفعنا/خُصم · دائن = استحق له»، «مسح تصفية الأعمدة»، «إظهار الكل»، حالتا فراغ | — | parties | ☐ |
| P-151 | pages/ContractorDetail.tsx:409-432 | أعمدة الدفتر بفرز وتصفية محلية: التاريخ (مدى) · النوع (٧ أنواع) · الوصف (نص) · المشروع (قائمة) · مدين/دائن (مدى) | — | parties | ☐ |
| P-152 | pages/ContractorDetail.tsx:443 | رقم المستخلص #claimNo بجوار النوع | — | parties | ☐ |
| P-153 | pages/ContractorDetail.tsx:446-458 | تغيير مشروع أي حركة مباشرة من قائمة في الصف (حتى المستوردة) | PUT /contractors/{code}/entries/{id} | parties | ☐ |
| P-154 | pages/ContractorDetail.tsx:463-473,703-710 | تعديل/حذف الحركات اليدوية؛ زر حذف معطّل للحركات المستوردة بتلميح «تُحذف من الملفات المرفوعة» | PUT/DELETE /contractors/{code}/entries/{id} | parties | ☐ |
| P-155 | pages/ContractorDetail.tsx:863-932 | نموذج الحركة: التاريخ (مطلوب) · الجانب مدين/دائن · المبلغ (≥0 مطلوب) · الوصف (مطلوب) · المشروع (قائمة + «مشروع جديد…») · التصنيف (٧) | — | parties | ☐ |
| P-156 | pages/ContractorDetail.tsx:484-500 | «المستخلصات» (سجل وثائق اختياري) + إفصاح أن مستخلصات الكشف في الدفتر | — | parties | ☐ |
| P-157 | pages/ContractorDetail.tsx:522-544 | أعمدة المستخلصات: الرقم (نص) · المشروع · التاريخ (مدى) · التراكمي (+سابق) · أعمال الفترة · التأمين (+نسبة+خصومات) · الصافي (مدى)؛ «عرض N من M» | — | parties | ☐ |
| P-158 | pages/ContractorDetail.tsx:492,571-581,712-738 | إضافة/تعديل/حذف مستخلص يدوي؛ المستورد يُوسم «كشف» | POST/PUT/DELETE /contractors/{code}/claims[/{id}] | parties | ☐ |
| P-159 | pages/ContractorDetail.tsx:939-1059 | نموذج المستخلص بحساب حي: أعمال الفترة = التراكمي − السابق؛ تأمين مقترح من النسبة (افتراضي المقاول) قابل للتعديل؛ الصافي = أعمال − تأمين − خصومات قابل للتعديل؛ المشروع والرقم مطلوبان؛ تقريب ٢ | — | parties | ☐ |
| P-160 | pages/ContractorDetail.tsx:591-640 | «الضمانات» بطاقات: المشروع، الحالة (مستحق الصرف/يقترب/مجدول/صُرف)، المبلغ، النسبة، إنهاء الأعمال، المدة، استحقاق الصرف، تاريخ الصرف، ملاحظات | GET /contractors/{code} | parties | ☐ |
| P-161 | pages/ContractorDetail.tsx:595,630-633,740-765 | إضافة/تعديل/حذف ضمان | POST/PUT/DELETE /contractors/{code}/guarantees[/{id}] | parties | ☐ |
| P-162 | pages/ContractorDetail.tsx:1061-1137 | نموذج الضمان: المشروع (مطلوب) · المبلغ · النسبة ٠–١٠٠ · إنهاء الأعمال · مدة الضمان (يوم) · استحقاق الصرف · الصرف الفعلي · ملاحظات | — | parties | ☐ |
| P-163 | pages/ContractorDetail.tsx:820-836 | نافذة «تأكيد الحذف» العامة | — | parties | ☐ |

### 1.8 الضمانات — pages/Guarantees.tsx (`/guarantees`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-164 | pages/Guarantees.tsx:43-44 | ترويسة «ضمانات المقاولين» — مطابقة كشوف ٢١٦ بالضمانات المتتبَّعة | — | parties | ☐ |
| P-165 | pages/Guarantees.tsx:50-61 | KPIs: المحتجز حسب الكشوف (hero) · المحتجز حسب المستخلصات · مستحقة الصرف (عدد، أحمر عند متأخر) — كلها مع شروح | GET /guarantees | parties | ☐ |
| P-166 | pages/Guarantees.tsx:65-71 | حالة فراغ «لم تُرفع ضمانات بعد» + رفع الملفات | — | parties | ☐ |
| P-167 | pages/Guarantees.tsx:74-112 | جدول «حسابات الضمان (كشوفات ٢١٦)»: الحساب·الاسم·المقاول المرتبط (رابط/«غير مرتبط»)·الرصيد·عدد الحركات·آخر حركة·المطابقة (مطابق/فرق X) — الصف قابل للنقر | GET /guarantees | parties | ☐ |
| P-168 | pages/Guarantees.tsx:114-146 | جدول «ضمانات المقاولين المتتبَّعة»: المقاول·المشروع·المبلغ·نسبة الاستقطاع·موعد الفك·الحالة؛ فراغ → زر «المقاولون» | GET /guarantees | parties | ☐ |
| P-169 | pages/Guarantees.tsx:157-214 | نافذة حساب ضمان: KPI الرصيد + المطابقة (شرح guaranteeAccountMatch بالمتتبَّع = الرصيد − الفرق) + جدول الحركات (التاريخ·المستند·الوصف·مدين·دائن) | GET /guarantees/{account} | parties | ☐ |

### 1.9 المشاريع — pages/Projects.tsx (`/projects`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-170 | pages/Projects.tsx:37-45 | KPIs: مديونية الموردين المفتوحة · المتأخر · مستحق للمقاولين · مستحق لنا من المقاولين · إجمالي الالتزام (hero) | GET /projects | projects | ☐ |
| P-171 | pages/Projects.tsx:46-49 | إفصاح: أرقام المقاولين نفس شاشة المقاولين؛ تأخر الموازنة من آخر شهر مُدخَل | — | projects | ☐ |
| P-172 | pages/Projects.tsx:56-111 | جدول المشاريع: المشروع (رابط) · الموردون (+N لديهم كشوفات) · المفتوح · المتأخر · مستحق للمقاولين · مستحق لنا · إجمالي الالتزام · تأخر الموازنة٪ («لا موازنة») | GET /projects | projects | ☐ |
| P-173 | pages/Projects.tsx:70-74 | تنبيه «يضم صيغ الاسم: …» (mergedSpellingAlert) | GET /projects | projects | ☐ |
| P-174 | pages/Projects.tsx:115-134 | مخطط «مقارنة المديونية المفتوحة بين المشاريع» (أشرطة أفقية) | — | projects | ☐ |
| P-175 | pages/Projects.tsx:53-55 | حالة «لا توجد مشاريع بعد» | — | projects | ☐ |

### 1.10 تفاصيل مشروع — pages/ProjectDetail.tsx (`/projects/:project`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-176 | pages/ProjectDetail.tsx:38-41 | ترويسة: اسم المشروع، عدد الموردين، «رجوع» | GET /projects/{project} | projects | ☐ |
| P-177 | pages/ProjectDetail.tsx:44-54 | KPIs: المفتوحة · المتأخر · مستحق للمقاولين · مستحق لنا · إجمالي الالتزام (hero) · تأخر الموازنة٪ | GET /projects/{project} | projects | ☐ |
| P-178 | pages/ProjectDetail.tsx:55-60 | إفصاح دمج صيغ الاسم (المطبِّع يتجاهل «ال» والمسافات فقط) | — | projects | ☐ |
| P-179 | pages/ProjectDetail.tsx:63-87 | «مقاولو المشروع»: المقاول·الكود·الرصيد·الاتجاه — ⚠ يعرض السالب أحمر «لنا عليه» عكس اصطلاح الإشارة (انظر الثوابت) | GET /projects/{project} | projects | ☐ |
| P-180 | pages/ProjectDetail.tsx:88-118 | «الموردون»: المورد (رابط)·الحساب·المدة·المفتوح·المتأخر | GET /projects/{project} | projects | ☐ |
| P-181 | pages/ProjectDetail.tsx:120-137 | «الاستحقاقات القادمة — ٩٠ يوماً» أعمدة (٨) | GET /projects/{project} (schedule) | projects | ☐ |

### 1.11 الموازنة التقديرية — pages/Budget.tsx (`/budget`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-182 | pages/Budget.tsx:32-42 | تلوين بالاتجاه لا بالعتبة: انحراف الشهر >0 أخضر/<0 أحمر؛ التأخر التراكمي <0 أخضر/>0 أحمر (بلا عتبة ١٠٪) | — | projects | ☐ |
| P-183 | pages/Budget.tsx:45-54 | سهم الاتجاه بين شهرين «↓ يتحسّن / ↑ يتفاقم X ن.م / = بلا تغيّر» (delayDeltaPp) | — | projects | ☐ |
| P-184 | pages/Budget.tsx:66-99 | فلاتر خادم: المشروع · المدينة · من شهر · إلى شهر · الحالة (متقدّم/متأخر/مطابق) · «لها مستخلصات فقط»؛ debounce + seq | GET /budget?project,city,from_month,to_month,status,has_claims | projects | ☐ |
| P-185 | pages/Budget.tsx:113-122,346-357 | سطر التصفية النشطة + مسح الكل + «N شهر · إجمالي الفعلي X مقابل مخطط Y» | GET /budget | projects | ☐ |
| P-186 | pages/Budget.tsx:126-133,284 | «تصدير Excel (بالتصفية)» | GET /budget/export.xlsx | projects | ☐ |
| P-187 | pages/Budget.tsx:220-259,285-287 | «طباعة/PDF (بالتصفية)» عبر PrintableList: المشروع·المدينة·الشهر·الفعلي·المخطط·انحراف·تراكمي فعلي·تراكمي مخطط·التأخر٪·الحالة·المصدر + إجماليات + ملخص | GET /budget | projects | ☐ |
| P-188 | pages/Budget.tsx:280-282,859-924 | «تقرير الموازنة (طباعة/PDF)» وثيقة رسمية: ترويسة الشركة، الفترة المغطاة، تاريخ الإصدار، عدد المشاريع، أساس الاحتساب، التصنيف، قسم لكل مشروع، تواقيع (إعداد/مراجعة/اعتماد) | GET /budget/overview + IPC export:pdf | projects/reports | ☐ |
| P-189 | pages/Budget.tsx:865-871 | حفظ PDF أصلي `EGCO-موازنة-YYYY-MM-DD.pdf` (أو window.print خارج Electron) + خطأ التصدير | IPC export:pdf | projects | ☐ |
| P-190 | pages/Budget.tsx:926-989 | قسم مشروع في الوثيقة: آخر تقرير/رقم التقرير/تاريخ الصدور، ٥ مؤشرات، جدول الأشهر، شريطا التراكمي فعلي/مخطط، «مستخلصات الشهر الأخير» («لم يصدر بعد») | — | projects | ☐ |
| P-191 | pages/Budget.tsx:995-1033 | «ملاحظات مالية» لكل مشروع في الوثيقة + «مسودة بالذكاء الاصطناعي» (لا تُحفظ تلقائياً) | POST /ai/budget-notes | projects | ☐ |
| P-192 | pages/Budget.tsx:140-206,289-291 | «رفع تقرير الموازنة»: اختيار ملفات متعدد، قبول .xlsx فقط (رسالة المسح الضوئي)، استيراد ملف بملف، ملخص «تم استيراد N لقطة وتحديث M لمشاريع…»/جزئي/فشل + قائمة التفاصيل | IPC dialog:pickFiles + POST /budget/import | projects/data | ☐ |
| P-193 | pages/Budget.tsx:142-147 | رسالة «اختيار الملفات متاح داخل التطبيق فقط» خارج Electron | — | projects | ☐ |
| P-194 | pages/Budget.tsx:363-381 | حالتا فراغ (لا نتائج مطابقة/لم تُرفع بيانات) | — | projects | ☐ |
| P-195 | pages/Budget.tsx:399-466 | بطاقة مشروع: العنوان+المدينة، آخر شهر/رقم وثيقة/المصدر، KPIs (الفعلي/المخطط/الانحراف/نسبة الإنجاز)، سطر التراكمي والتأخر + السهم، جدول الأشهر (الشهر·الفعلي·المخطط·الانحراف·التأخر·الاتجاه·المصدر يدوي/ملف + 📎 مرفق) | GET /budget | projects | ☐ |
| P-196 | pages/Budget.tsx:409,470-571 | «إدارة الأشهر ومقاولو المشروع»: جدول الأشهر الكامل (مع تراكمي فعلي/مخطط) + تعديل + إضافة شهر | GET /budget/project/{name} | projects | ☐ |
| P-197 | pages/Budget.tsx:485-497,545-548 | حذف شهر بتأكيد «سيُعاد حساب تراكمي الأشهر التالية» | DELETE /budget/{id} | projects | ☐ |
| P-198 | pages/Budget.tsx:577-601 | «التزامات مقاولي هذا المشروع» (منفصلة، لا تُجمع مع الموازنة) | GET /budget/project/{name} | projects | ☐ |
| P-199 | pages/Budget.tsx:288,388-392 | «مشروع جديد — إدخال يدوي» (اسم المشروع قابل للكتابة) | POST /budget | projects | ☐ |
| P-200 | pages/Budget.tsx:608-825 | نموذج الشهر: المشروع · الشهر (مقفل عند التعديل) · رقم الوثيقة · تاريخ الإصدار · الفعلي · المخطط · المستخلصات (رقم/مبلغ/تاريخ، إضافة/حذف) · الملاحظات؛ الحفظ يتطلب شهراً ومشروعاً | POST /budget · PUT /budget/{id} | projects | ☐ |
| P-201 | pages/Budget.tsx:636-646,748-763 | حساب حي من الخادم (debounce 300ms): انحراف الشهر، تراكمي فعلي/مخطط، نسبة الإنجاز + «سيتغيّر N شهراً تالياً» (chainImpact) | POST /budget/preview | projects | ☐ |
| P-202 | pages/Budget.tsx:764-769,818-847 | كشف التعارض (ملف vs يدوي على التراكمي/التأخر) وحوار إلزامي «الاحتفاظ بالحالية / اعتماد الجديدة» (forceConflict) | POST /budget/preview · POST/PUT /budget | projects | ☐ |
| P-203 | pages/Budget.tsx:654-670,800-808 | «إرفاق الملف الأصلي (PDF/Excel)» → نسخة مرجعية مربوطة بالشهر + «يوجد مرفق سابق» | IPC dialog:pickFile + POST /import/budget-attachment | projects | ☐ |

### 1.12 التدفق النقدي — pages/CashFlow.tsx (`/cashflow`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-204 | pages/CashFlow.tsx:87-97,142-159 | معاملات URL: `?project=`، `?parties=` (suppliers/contractors؛ both افتراضي يُحذف)، `?period_days=` (1–92، 14 افتراضي يُحذف) | GET /cashflow | cash | ☐ |
| P-205 | pages/CashFlow.tsx:129-130 | الواجهة ترسل parties=both صراحةً (افتراضي الخادم suppliers للتوافق الخلفي) | GET /cashflow | cash | ☐ |
| P-206 | pages/CashFlow.tsx:193-205 | تحذيرات: بلا تحصيلات (bad) أو تحذيرات الخارج (warn) من warnings[] | GET /cashflow | cash | ☐ |
| P-207 | pages/CashFlow.tsx:208-211 | قائمة المشروع | GET /cashflow (projects) | cash | ☐ |
| P-208 | pages/CashFlow.tsx:212-216 | الرصيد الافتتاحي (يطبَّق بزر «تطبيق») | GET /cashflow?opening_balance | cash | ☐ |
| P-209 | pages/CashFlow.tsx:217-222 | الأفق: ١٣/٢٦ (افتراضي)/٥٢/١٠٤ أسبوعاً (يطبَّق بزر «تطبيق») | GET /cashflow?weeks | cash | ☐ |
| P-210 | pages/CashFlow.tsx:223-243 | طول الفترة: ٧/١٤/٣٠/مخصص (١–٩٢، Enter أو blur يطبّق) | GET /cashflow?period_days | cash | ☐ |
| P-211 | pages/CashFlow.tsx:244 | نقطة شرح cashflowHorizon | — | cash | ☐ |
| P-212 | pages/CashFlow.tsx:245-253 | الأطراف: كلاهما/الموردون فقط/المقاولون فقط | GET /cashflow?parties | cash | ☐ |
| P-213 | pages/CashFlow.tsx:61-67,101-107,629-714 | Carousel بطاقات بثلاث صفحات (الحالي/المتأخر/المتوقع مقابل الفعلي)، أسهم RTL، أسهم لوحة المفاتيح (← التالي، → السابق)، سحب باللمس (٤٠px)، نقاط، محفوظ في localStorage `egco.cashflow.kpiView` | — | cash | ☐ |
| P-214 | pages/CashFlow.tsx:729-772 | صفحة «الحالي»: إجمالي الداخل (متوقّع) · إجمالي المحصّل خلال المدى · إجمالي الخارج — كلها قابلة للنقر للتفكيك؛ صافي الفترة (hero+شرح)؛ أدنى رصيد (نقر = قفز للفترة + شرح) + إفصاح الفرق بين المتوقع والمحصّل | GET /cashflow + /cashflow/breakdown | cash | ☐ |
| P-215 | pages/CashFlow.tsx:113-122,349-353 | القفز إلى فترة أدنى رصيد في الجدول مع إطار ذهبي ٢.٢ث | — | cash | ☐ |
| P-216 | pages/CashFlow.tsx:779-825 | صفحة «المتأخر»: إجمالي الخارج المتأخر · الداخل المتأخر · أدنى رصيد لو سُدد المتأخر اليوم · لو حُصِّل اليوم + جدول أعمار التأخر (خارج/داخل مع العدد) + إفصاح | GET /cashflow (overdueView) | cash | ☐ |
| P-217 | pages/CashFlow.tsx:833-851 | صفحة «المتوقع مقابل الفعلي»: المتوقع · المحصّل فعلياً · الفجوة + إفصاح | GET /cashflow (forecastVsActual) | cash | ☐ |
| P-218 | pages/CashFlow.tsx:260-265 | تنبيه «أول عجز متوقع في … بمقدار …» | GET /cashflow | cash | ☐ |
| P-219 | pages/CashFlow.tsx:267-272 | تنبيه «مستحق للمقاولين بلا تواريخ استحقاق: X — غير موزّع» (عند parties≠suppliers) | GET /cashflow (undatedContractorDues) | cash | ☐ |
| P-220 | pages/CashFlow.tsx:277-279 | تنبيه نطاق رصيد المقاولين عند فلتر مشروع (contractorBalanceScopeNote) | GET /cashflow | cash | ☐ |
| P-221 | pages/CashFlow.tsx:282-326 | مخطط «الداخل مقابل الخارج» عمودان لكل فترة (أخضر/ذهبي/أحمر للعجز) + مفتاح الألوان + شريط الرصيد لكل فترة؛ حالة «لا حركة نقدية في هذا الأفق» | GET /cashflow | cash | ☐ |
| P-222 | pages/CashFlow.tsx:328-392 | «جدول الفترات»: الفترة · الداخل (متوقّع) · التحصيل الفعلي · الخارج · صافي الحركة · الرصيد التراكمي · شارة «عجز»؛ أول ٦٠ فترة + ملاحظة القص؛ شرح cashflowColumns | GET /cashflow | cash | ☐ |
| P-223 | pages/CashFlow.tsx:70-77,355-375 | كل مبلغ داخل/محصّل/خارج في الجدول قابل للنقر → تفكيك تلك الفترة | GET /cashflow/breakdown?term&period | cash | ☐ |
| P-224 | pages/CashFlow.tsx:450-544 | سطر مطابقة الخارج: المجدول + متأخر الآن + بعد الأفق + بلا تواريخ − أرصدة دائنة − ضمانات تتجاوز = المديونية المفتوحة؛ شارة «مطابق بالهللة»/«فرق غير مفسَّر» (ε=0.005) + شرح | GET /cashflow (reconciliation) | cash | ☐ |
| P-225 | pages/CashFlow.tsx:511-528 | سطر مطابقة الداخل: المجدول + متأخر + بعد الأفق + بلا تواريخ = المستحق المفتوح + شارة المطابقة | GET /cashflow | cash | ☐ |
| P-226 | pages/CashFlow.tsx:530-536 | إفصاح ما يُستبعد من الرصيد التراكمي (horizonEnd) | — | cash | ☐ |
| P-227 | pages/CashFlow.tsx:553-625 | عند فرق غير مفسَّر: سؤال «ما سبب الفرق؟» (مبلغ متأخر لم يُرفع كشفه / دفعة لم تُسجَّل / أخرى نص حر) يُحفظ ويُعرض لاحقاً + «تغيير التفسير» | POST /cashflow/reconciliation-note | cash | ☐ |
| P-228 | pages/CashFlow.tsx:857-978 | نافذة «من أين جاء هذا الرقم؟»: العنوان، المبلغ، القاعدة بالعربية، صفوف بحسب النوع (مورد: المورد·الفاتورة·التاريخ·الاستحقاق·المبلغ·التأخر / مقاول: المقاول·المشروع·الإفراج·المبلغ / تحصيل: التاريخ·العميل·المشروع·المبلغ) + الإجمالي + «عُرض أول 500 صف» | GET /cashflow/breakdown | cash | ☐ |
| P-229 | pages/CashFlow.tsx:981-1070 | «ماذا لو؟» (AI): اختيار مورد/مقاول (optgroup) + إزاحة الأيام → قبل/بعد + سرد + «الأرقام محسوبة؛ النص فقط من المساعد» | GET /suppliers + GET /contractors + POST /ai/what-if | cash | ☐ |

### 1.13 التحصيلات — pages/Revenues.tsx (`/revenues`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-230 | pages/Revenues.tsx:38-64 | تصفية/ترتيب على الخادم (q, project, status, date_from/to, min/max_amount, sort, dir) debounce + seq | GET /revenues | cash | ☐ |
| P-231 | pages/Revenues.tsx:126-133 | KPIs: المستحق المفتوح (hero) · المحصّل · الإجمالي (مع شروح) | GET /revenues | cash | ☐ |
| P-232 | pages/Revenues.tsx:137-138 | عدّاد «N نتيجة · مفتوح X» + «مسح كل التصفية» | — | cash | ☐ |
| P-233 | pages/Revenues.tsx:158-176 | أعمدة: العميل (نص: العميل أو الوحدة) · المشروع (قائمة) · المبلغ (مدى) · تاريخ الاستحقاق (مدى) · الحالة (مفتوح/محصّل) · المصدر (يدوي/ملف) — كلها قابلة للترتيب | — | cash | ☐ |
| P-234 | pages/Revenues.tsx:185,190-193 | الوحدة تحت العميل؛ «—» ذهبي بتلميح «بلا تاريخ — لا يدخل توقع التدفق» | — | cash | ☐ |
| P-235 | pages/Revenues.tsx:143-152 | حالتا فراغ | — | cash | ☐ |
| P-236 | pages/Revenues.tsx:120,221-226 | «إضافة تحصيل» | POST /revenues | cash | ☐ |
| P-237 | pages/Revenues.tsx:201-206,228-247 | «تحصيل» سريع: يفتح النموذج بحالة محصّل وتاريخ اليوم | PUT /revenues/{id} | cash | ☐ |
| P-238 | pages/Revenues.tsx:207-208 | تعديل ✎ | PUT /revenues/{id} | cash | ☐ |
| P-239 | pages/Revenues.tsx:209-210,360-394 | حذف 🗑 مع تنبيه «صف مستورد — حذفه لا يمنع إعادة رفعه» | DELETE /revenues/{id} | cash | ☐ |
| P-240 | pages/Revenues.tsx:265-358 | نموذج التحصيل: العميل (مطلوب، datalist العملاء) · المشروع (datalist) · الوحدة (datalist وحدات العميل) · المبلغ (≥0.01 مطلوب) · تاريخ الاستحقاق · الحالة · تاريخ التحصيل (مطلوب إن محصّل) · ملاحظات | — | cash | ☐ |

### 1.14 الصفحات المخفية «قيد الإنشاء» — components/ComingSoon.tsx
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-241 | components/ComingSoon.tsx:26-66 | قالب «قيد الإنشاء»: العنوان، الغرض، شارة، «ما ستعرضه»، «ما نحتاجه قبل البناء»، «تجده في…» | — | cash | ☐ |
| P-242 | pages/Loans.tsx:4-22 | `/loans` القروض — نص الخطة والاحتياجات + رابط التدفق النقدي | — | cash | ☐ |
| P-243 | pages/Obligations.tsx:4-23 | `/obligations` الالتزامات الشهرية — الرواتب/الإيجارات/الأقساط + رابط التدفق | — | cash | ☐ |
| P-244 | pages/Expenses.tsx:4-22 | `/expenses` المصاريف التشغيلية — المخطط مقابل الفعلي + رابط الموازنة | — | cash | ☐ |

### 1.15 تغطية الكشوفات — pages/Coverage.tsx (`/coverage`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-245 | pages/Coverage.tsx:50-52 | جلب التغطية بعتبة قِدَم ٩٠ يوماً | GET /coverage?stale_days=90 | data | ☐ |
| P-246 | pages/Coverage.tsx:123-124 | ترويسة «تغطية الموردين — حتى {asOf}» | GET /coverage | data | ☐ |
| P-247 | pages/Coverage.tsx:128-141 | KPIs: موردون بلا كشوفات (أحمر) · كشوفاتهم قديمة (+N يوماً) · نسبة التغطية (hero) | GET /coverage | data | ☐ |
| P-248 | pages/Coverage.tsx:143-145 | إفصاح «أرقام لوحة اليوم مبنية على من رُفعت كشوفاتهم فقط» | — | data | ☐ |
| P-249 | pages/Coverage.tsx:150-151 | عدّاد «N مورد» + «مسح كل التصفية» | — | data | ☐ |
| P-250 | pages/Coverage.tsx:164-193 | تسعة أعمدة بفرز وتصفية محلية: المورد (نص) · الحساب (نص) · المشروع (قائمة) · أول حركة (مدى) · آخر حركة (مدى) · منذ (مدى أيام) · الفواتير (مدى) · المديونية المفتوحة (مدى) · الحالة (بلا كشوفات/قديمة/مكتملة) | — | data | ☐ |
| P-251 | pages/Coverage.tsx:197-212 | تلوين الصف: بلا كشوفات/قديمة؛ رابط المورد | — | data | ☐ |
| P-252 | pages/Coverage.tsx:155-158 | حالة «لا نتائج مطابقة» | — | data | ☐ |

### 1.16 التقويم المالي — pages/Calendar.tsx (`/calendar`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-253 | pages/Calendar.tsx:36,73-77,133-138 | فلتر مشروع في URL `?project=` | GET /projects | today | ☐ |
| P-254 | pages/Calendar.tsx:52-59,89-95 | استحقاقات الموردين على أيام الشهر (من schedule) | GET /dashboard?project= | today | ☐ |
| P-255 | pages/Calendar.tsx:42-50,99-106 | مستخلصات المقاولين المستحقة (المتبقي بعد الدفعات) تُضاف لخلايا الأيام (م-٤٦) | GET /contractors/claims-due?project= | today | ☐ |
| P-256 | pages/Calendar.tsx:126 | «الشهر · إجمالي الاستحقاقات X» | — | today | ☐ |
| P-257 | pages/Calendar.tsx:128-130 | التنقل: الشهر السابق · اليوم · الشهر التالي | — | today | ☐ |
| P-258 | pages/Calendar.tsx:142-180 | شبكة أسبوع تبدأ السبت (RTL)، تمييز اليوم، المبلغ المختصر + عدد الفواتير، حد أحمر للمتأخر، ذهبي للتحديد | — | today | ☐ |
| P-259 | pages/Calendar.tsx:63-71,184-192 | نقر يوم → «تفاصيل يوم …» (أو «لا استحقاقات») | GET /dashboard/day?date&project | today | ☐ |
| P-260 | pages/Calendar.tsx:194-228 | جدول «مستخلصات مقاولين تستحق»: المستخلص (رقم)·المشروع·المتبقي·الحالة (متأخر N يوماً/مستحق)·«فتح كشف المقاول» | — | today | ☐ |
| P-261 | pages/Calendar.tsx:230-261 | جدول «فواتير موردين مستحقة»: المورد·رقم الفاتورة·المبلغ·الحالة·«فتح كشف المورد» | GET /dashboard/day | today | ☐ |
| P-262 | pages/Calendar.tsx:263-291 | جدول «ضمانات مقاولين تستحق الصرف»: المقاول·المشروع·المبلغ·«فتح كشف المقاول» | GET /dashboard/day | today | ☐ |

### 1.17 رفع الملفات — pages/Import.tsx (`/import`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-263 | pages/Import.tsx:565-570 | ترويسة بالصيغ المدعومة؛ «اختيار من جديد» (reset) | — | data | ☐ |
| P-264 | pages/Import.tsx:577-593 | زرا «اختيار ملفات» و«اختيار مجلد كامل» + منطقة إسقاط قابلة للنقر بالصيغ المقبولة (PDF · XLSX/XLSM · CSV · XLS) | IPC dialog:pickFiles / dialog:pickDirectory | data | ☐ |
| P-265 | pages/Import.tsx:448-460 | رسالة «متاح داخل التطبيق فقط» خارج Electron + خطأ فتح النافذة | — | data | ☐ |
| P-266 | pages/Import.tsx:67-75,884 | كشف نوع الملف تلقائياً (pdf_statement/csv_statement/suppliers_excel/debts_report_xls/contractors_balance_xls/budget_deviation/unsupported) بتسمية عربية | IPC dialog:pickFiles (source) | data | ☐ |
| P-267 | pages/Import.tsx:469-481 | ترتيب الطابور: الموردون أولاً ← الكشوفات ← التقارير المجمّعة ← الموازنة ← غير المعروف (م-٢١: لا شيء يُسقط بصمت) | — | data | ☐ |
| P-268 | pages/Import.tsx:484-501 | معاينة تسلسلية للكشوفات والتقارير المجمّعة قبل الحفظ | POST /import/preview | data | ☐ |
| P-269 | pages/Import.tsx:995-1014 | ١٣ حالة لكل ملف (بانتظار/قراءة/جاهز/✓ مطابق/✕ غير مطابق/عُوين/خطأ قراءة/حفظ/تم/تعذّر/حساب جديد/مُستبعد/غير مدعوم) | — | data | ☐ |
| P-270 | pages/Import.tsx:895-915 | معاينة كشف: اسم الشركة (أو من الترويسة + «حساب جديد») · الحساب · فواتير · دفعات · رصيد الكشف · المحسوب · ✓ مطابق / ✕ الفرق | POST /import/preview | data | ☐ |
| P-271 | pages/Import.tsx:1026-1088 | معاينة «تقرير مديونيات مجمّع»: بطاقات مقاول/مورد/ضمان (العدد، جديد أحمر، معروف) + «N حساب يحتاج تصنيفك» مع «تصنيف…» لكل حساب + عدد ملاحظات القراءة | POST /import/preview | data | ☐ |
| P-272 | pages/Import.tsx:504-557,742-749 | «حفظ الملفات المطابقة (N)»: يستبعد غير المطابق/خطأ القراءة، يحفظ الجاهز ← المطابق ← المُعاين؛ معطّل أثناء القراءة | POST /import | data | ☐ |
| P-273 | pages/Import.tsx:533-541 | تمييز «مورد غير معروف» (saved=false, reason=unknown_supplier) عن الخطأ — لا «تم» كاذبة | POST /import | data | ☐ |
| P-274 | pages/Import.tsx:1134-1222 | لوحة «حساب جديد لم نره من قبل»: الأرقام + اسم المورد (من الترويسة) + المشروع (تخمين قبل «-» أو «(») + مدة السداد (إلزامية) → «إنشاء الحساب وحفظ الكشف» أو «تجاهل هذا الملف» | POST /import {create_supplier} | data | ☐ |
| P-275 | pages/Import.tsx:960-970,1097-1111 | بعد حفظ تقرير مجمّع: «N جديد، M محدَّث، K بانتظار تصنيف» + لوحة «فرق بين رصيد الملف ورصيد سجل الحركات» بارزة | POST /import (reconcileWarnings) | data | ☐ |
| P-276 | pages/Import.tsx:972-988 | بعد حفظ كشف: «أُضيف N، تُجوهل M مكرراً» / ملف موردين «N مورداً (جديد/محدَّث)» + تنبيه «أُنشئ حساب … تلقائياً — مدة سداده غير محدّدة» | POST /import | data | ☐ |
| P-277 | pages/Import.tsx:178-209,919-921 | تنبيه «تكرار محتمل» (نفس التاريخ والمبلغ بسند مختلف، داخل الملف أو مقابل المحفوظ) — معلوماتي لا يمنع الحفظ | POST /import/preview · /import (nearDuplicates) | data | ☐ |
| P-278 | pages/Import.tsx:923-928 | رسالة «صيغة غير مدعومة في هذا الإصدار» | — | data | ☐ |
| P-279 | pages/Import.tsx:930-939 | خطأ قراءة + «محاولة القراءة بالذكاء الاصطناعي» (AI) → AiRescueModal | — | data | ☐ |
| P-280 | pages/Import.tsx:125-147,714-729 | لافتة ملخص الدفعة: أخضر فقط إن حُفظ الكل، وإلا قائمة كل ملف لم يُحفظ وسببه + عدد المكرر | — | data | ☐ |
| P-281 | pages/Import.tsx:751-757 | بعد الانتهاء: «عرض الموردين» · «لوحة اليوم» · «رفع ملفات أخرى» | — | data | ☐ |
| P-282 | pages/Import.tsx:303-328,599-624 | «اختيار مجلد كامل»: فحص المجلد → «وُجد N: PDF · CSV · موردين» + المتجاهَلة وأسبابها | IPC dialog:pickDirectory + POST /import/scan | data | ☐ |
| P-283 | pages/Import.tsx:330-343,614-620 | «رفع الكل (N)» دفعة واحدة | POST /import/batch | data | ☐ |
| P-284 | pages/Import.tsx:627-711 | جدول «نتيجة الرفع»: الملف·النوع·المورد·الحالة (تم/مكرر/غير مطابق/مورد غير معروف/بلا رقم حساب/يحتاج تصنيفاً/تعذّرت القراءة)·تفاصيل (أُضيف/تُجوهل) + تحذيرات التكرار المحتمل لكل ملف فوق الجدول | POST /import/batch | data | ☐ |
| P-285 | pages/Import.tsx:681-686 | «محاولة القراءة بالذكاء الاصطناعي» لصفوف read_error/no_account في الدفعة | — | data | ☐ |
| P-286 | pages/Import.tsx:687-696,347-358 | «تصنيف…» لصف needs_classification ثم إعادة استيراد ذلك الملف وحده وتحديث صفه | PUT /import/classify + POST /import/batch | data | ☐ |
| P-287 | pages/Import.tsx:697-703,378-424 | «إنشاء المورد…» لصف unknown_supplier في الدفعة (قراءة الملف وحده ثم نافذة حساب جديد؛ تجاهل يحدّث الرسالة) | POST /import (+create_supplier) | data | ☐ |
| P-288 | pages/Import.tsx:810-868 | نافذة «تصنيف حساب» (بادئة غير 211/212/216): مورد/مقاول/ضمان/تجاهل + اقتراح آلي (AI، «القرار لك») | PUT /import/classify + POST /import/classify/suggest | data | ☐ |
| P-289 | pages/Import.tsx:363-373 | بعد تصنيف حساب من معاينة تقرير مجمّع: إعادة معاينة ذلك الصف فقط | POST /import/preview | data | ☐ |
| P-290 | pages/Import.tsx:18,1276-1279,1375-1393 | قسم «الملفات المرفوعة (N)» قابل للطي، الحالة محفوظة في localStorage `egco.import.historyOpen` (افتراضي مفتوح)؛ لا جلب وهو مطوي | GET /import/history | data | ☐ |
| P-291 | pages/Import.tsx:1295-1332 | تصفية/ترتيب «الملفات المرفوعة» على الخادم (file_name, source, party, min/max_moves, date_from/to, reconciled, sort, dir) debounce+seq | GET /import/history?… | data | ☐ |
| P-292 | pages/Import.tsx:1435-1465 | أعمدة: التاريخ (مدى) · الملف (نص، title=المسار) · النوع (١٠ أنواع) · الطرف (نص؛ رابط حسب بادئة 211/212) · مضاف (مدى) · مطابق مسبقاً · مطابق ✓/✕ (قائمة) | — | data | ☐ |
| P-293 | pages/Import.tsx:1250-1252,1480-1482 | شارة «فشل» (ليس قديماً وأُضيف 0 وتُجوهل 0) | — | data | ☐ |
| P-294 | pages/Import.tsx:1486-1488 | شارة «قديم» للسجلات legacy؛ «— بلا اسم ملف —» | — | data | ☐ |
| P-295 | pages/Import.tsx:1494-1503,1515-1530 | حذف ملف مستورد: يحذف حركاته فقط (اليدوي لا يُمس)؛ معطّل إن canDelete=false «يُدار من شاشته الخاصة» | DELETE /import/history/{id} | data | ☐ |
| P-296 | pages/Import.tsx:1532-1547 | حذف تقريبي للملفات القديمة (حركات الحساب خلال ٣ دقائق من الرفع) بتأكيد ثانٍ | DELETE /import/history/{id}?force=true | data | ☐ |
| P-297 | pages/Import.tsx:1425-1430 | رسالة «حُذف N حركة من … — تحدّثت أرصدة …» | — | data | ☐ |
| P-298 | pages/Import.tsx:1401-1415 | حالتا فراغ (لا ملفات مرفوعة + اختيار ملفات / لا نتائج مطابقة) | — | data | ☐ |
| P-299 | pages/Import.tsx:1564-1643 | قسم «الحركات المكرّرة المحتملة» القائمة (يظهر فقط عند وجودها): العدد والمبلغ، مجموعات (الطرف·الحساب·التاريخ·المبلغ·السند) و«حذف هذا الصف» لكل صف + إفصاح «يمكن الاسترجاع من المحذوفات» | GET /import/duplicates + POST /import/duplicates/delete | data | ☐ |

### 1.18 التقرير التحليلي — pages/Report.tsx (`/report`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-300 | pages/Report.tsx:34-37 | تبويبان: «تقرير الفترة» / «التحليل الدوري» | — | reports | ☐ |
| P-301 | pages/Report.tsx:39-50 | تنسيق تقرير الفترة: «تفصيلي» / «ملخّص بالمشروع» | — | reports | ☐ |
| P-302 | pages/Report.tsx:71-95 | النطاق والأطراف في URL: `?account=` / `?contractor=` / `?project=` (واحد فقط) و `?parties=` (contractors/both؛ suppliers افتراضي يُحذف) — تقرير قابل للمشاركة | — | reports | ☐ |
| P-303 | pages/Report.tsx:119-121 | ScopeBar (الشركة/مشروع/مورد/مقاول + الأطراف) + PeriodBar (من/إلى، افتراضي 2026-01-01 → اليوم) | GET /reports/scopes | reports | ☐ |
| P-304 | pages/Report.tsx:100-113 | تحميل تقرير الفترة بالنطاق والفترة والأطراف | GET /reports/analysis?account,date_from,date_to,project,contractor,parties | reports | ☐ |
| P-305 | pages/Report.tsx:482 | شارة النطاق (scope_label) | — | reports | ☐ |
| P-306 | pages/Report.tsx:293-326,516-529 | «الملخص التنفيذي (AI)» بنطاق التقرير ← مسودة «راجعها قبل الاعتماد» + نسخ + إغلاق (لا تُطبع) | POST /ai/summary | reports | ☐ |
| P-307 | pages/Report.tsx:485,475-478 | «وضع العرض» (Present) بشرائح مبنية من نفس البيانات + تصدير العرض PDF أفقي `EGCO-عرض-YYYY-MM-DD.pdf` | IPC export:pdf | reports | ☐ |
| P-308 | pages/Report.tsx:486 | «تصدير Excel» لتقرير الفترة بالنطاق | GET /reports/export.xlsx?date_from,date_to,account,project,contractor,parties | reports | ☐ |
| P-309 | pages/Report.tsx:464-470,487-492 | «طباعة / حفظ PDF» عمودي `EGCO-تقرير-تحليلي-YYYY-MM-DD.pdf` + خطأ التصدير؛ window.print خارج Electron | IPC export:pdf | reports | ☐ |
| P-310 | pages/Report.tsx:494-513 | ورقة A4: الشعار الكامل، الشركة، الإدارة، العنوان، النطاق·الفترة·«بالريال»، رقم الوثيقة، تاريخ الإصدار، أساس الاحتساب، التصنيف | GET /reports/analysis (meta) | reports | ☐ |
| P-311 | pages/Report.tsx:455-457 | ترقيم أقسام ديناميكي (٠١…) بلا فجوات للأقسام المخفية | — | reports | ☐ |
| P-312 | pages/Report.tsx:533-560 | الرصيد الافتتاحي · حركة الفترة (مفوتر − مسدد داخل الفترة) · الختامي (مع شروح) + سطر التفسير — للموردين فقط | GET /reports/analysis | reports | ☐ |
| P-313 | pages/Report.tsx:563-583 | مؤشرات: إجمالي المفوتر · المسدد · المفتوحة · [أرصدة لنا (مقدمة) · الصافي عند وجودها] · المتأخر | GET /reports/analysis | reports | ☐ |
| P-314 | pages/Report.tsx:584-603 | فقرة سردية (lede) محسوبة: العدد، المفتوح، المتأخر، خلال ٧ أيام، الصافي، مستحق المقاولين وإجمالي الالتزام | — | reports | ☐ |
| P-315 | pages/Report.tsx:607-643 | قسم «أعمار الديون»: الفئة·العدد·المبلغ·النسبة + مجموع الفئات + «بانتظار تاريخ استحقاق» + المفتوحة كاملةً | GET /reports/analysis | reports | ☐ |
| P-316 | pages/Report.tsx:645-661,793-811 | قسم «جدول السداد القادم»: التاريخ·الطرف (الاسم أو «و N آخرون» + وسم مورد/مقاول، tooltip بالتفاصيل)·الفواتير·الحالة·المبلغ | GET /reports/analysis | reports | ☐ |
| P-317 | pages/Report.tsx:665-705,752-769 | قسم «المقاولون» (عند parties≠suppliers): المقاول·الرمز·المشاريع·المستخلص·المسدد·الرصيد (له/لنا)·آخر دفعة + الإجماليات | GET /reports/analysis (contractors) | reports | ☐ |
| P-318 | pages/Report.tsx:338-438,707-709 | قسم «أولويات السداد» (على مستوى الشركة): ميزانية اختيارية + «تحديث»؛ AI إن مفعّل وإلا رجوع للترتيب الحتمي + ملاحظة «الشرح الآلي غير متاح» | POST /ai/priorities → fallback GET /reports/priorities?budget | reports | ☐ |
| P-319 | pages/Report.tsx:711-723 | قسم «ملاحظات ومخاطر» | GET /reports/analysis (notes) | reports | ☐ |
| P-320 | pages/Report.tsx:725-733 | تذييل التواقيع (إعداد/مراجعة/اعتماد) + «وثيقة داخلية · رقم» | — | reports | ☐ |
| P-321 | pages/Report.tsx:132-204 | «ملخّص بالمشروع»: اختيار المشروع (من scopes، أول مشروع افتراضياً) + الأطراف (كلاهما افتراضي) | GET /reports/scopes + GET /reports/project-summary?project,parties | reports | ☐ |
| P-322 | pages/Report.tsx:194 | «تصدير Excel» لملخّص المشروع | GET /reports/project-summary/export.xlsx | reports | ☐ |
| P-323 | pages/Report.tsx:170-173,195 | «طباعة / حفظ PDF» أفقي `EGCO-ملخص-مشروع-YYYY-MM-DD.pdf` | IPC export:pdf | reports | ☐ |
| P-324 | pages/Report.tsx:207-290 | ورقة ملخّص المشروع: KPIs بنطاق «في هذا المشروع» (المفوتر/المسدد/المفتوحة/المتأخر موردون فقط) + جدول سطر لكل شركة (الاسم+وسم·الحساب·النوع·المفوتر·المسدد·المفتوحة·المتأخر·أقصى تأخر·آخر دفعة) + «— (لا يُحسب للمقاولين)» + سطر الإجمالي + ملاحظة نطاق المقاول | GET /reports/project-summary | reports | ☐ |
| P-325 | pages/Report.tsx:840-890 | «التحليل الدوري»: التقسيم (ربع/نصف/سنوي) · السنة (2024/2025/2026) · تصدير Excel؛ يحترم `?account=` | GET /reports/periodic + GET /reports/export.xlsx?granularity,year,account | reports | ☐ |
| P-326 | pages/Report.tsx:901-908 | «التغطية المسجلة: من ← إلى» + تحذير «بعض الفترات خارج التغطية» | GET /reports/periodic | reports | ☐ |
| P-327 | pages/Report.tsx:910-948 | جدول «الفترات»: الفترة (+«جزئي»)·الافتتاحي·المفوتر·المسدد·صافي الحركة·الختامي·متوسط عمر السداد | GET /reports/periodic | reports | ☐ |
| P-328 | pages/Report.tsx:950-978 | جدول «المقارنة»: المسدد·الفترة السابقة·التغيّر٪·نفس الفترة العام الماضي·التغيّر٪ (أحمر/أخضر) | GET /reports/periodic | reports | ☐ |
| P-329 | pages/Report.tsx:980-1003 | آخر فترة مكتملة: «التوزيع على المشاريع» (أشرطة) + «أعلى الموردين سداداً» (٥) | GET /reports/periodic | reports | ☐ |
| P-330 | pages/Report.tsx:1036-1265 | شرائح العرض: الغلاف · المؤشرات · أعمار الديون · جدول السداد (١٠) · أعلى الموردين (٨) · المقاولون (KPIs + أعلى ٦) · ملاحظات · «الإجراءات المطلوبة» المشتقة من الأرقام | — | reports | ☐ |

### 1.19 الإعدادات — pages/Settings.tsx (`/settings`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-331 | pages/Settings.tsx:39-40 | ترويسة «البيانات محفوظة على هذا الجهاز فقط» | — | data | ☐ |
| P-332 | pages/Settings.tsx:45-55 | بطاقة «البيانات»: مكان قاعدة البيانات · مجلد التطبيق · نظام التشغيل + «فتح المجلد» | GET /health + IPC app:info + app:revealDataDir | data | ☐ |
| P-333 | pages/Settings.tsx:192-215 | نسخة يومية تلقائية عند فتح الإعدادات (إن مضى يوم) + تحذير المجلد الخارجي إن فشل | POST /backups/daily-if-due | data | ☐ |
| P-334 | pages/Settings.tsx:224-230,265-267 | «نسخة الآن» (اسم + حجم، أو تحذير المجلد الخارجي) | POST /backups | data | ☐ |
| P-335 | pages/Settings.tsx:268-270 | «فتح المجلد» للنسخ الاحتياطية | IPC backups:reveal | data | ☐ |
| P-336 | pages/Settings.tsx:271-275 | «آخر نسخة يومية: قبل N ساعات/أيام» بتعريب صحيح | GET /backups | data | ☐ |
| P-337 | pages/Settings.tsx:278-287 | مجلد خارجي (iCloud/Drive/قرص) اختياري: «اختيار…» / «إزالة» | IPC backups:pickExternalDir + GET/PUT /backups/settings | data | ☐ |
| P-338 | pages/Settings.tsx:297-327 | جدول النسخ: التاريخ (ar-SA) · النوع (يومية/يدوية/قبل التحديث/قبل الاستيراد/قبل الاستعادة/قديمة) · الحجم (ك.ب/م.ب) | GET /backups | data | ☐ |
| P-339 | pages/Settings.tsx:232-237,314-317 | «استعادة» نسخة (تأخذ نسخة قبلها ثم تعيد التشغيل؛ رسالة خطأ إن فشلت) | IPC backups:restore | data | ☐ |
| P-340 | pages/Settings.tsx:239-243,318-320 | «حذف» نسخة بتأكيد | DELETE /backups/{name} | data | ☐ |
| P-341 | pages/Settings.tsx:59-102 | «النقل إلى جهاز آخر»: «تصدير نسخة من البيانات» (نسخة متّسقة، رسالة المسار) · «استيراد ملف بيانات» (نسخة قبل الاستيراد ثم إعادة تشغيل) | IPC data:export / data:import | data | ☐ |
| P-342 | pages/Settings.tsx:104-108 | «الافتراضات» (عرض): مدة السداد عند غياب القيمة = كاش، FIFO، نافذة التنبيه ٧ أيام | — | data | ☐ |
| P-343 | pages/Settings.tsx:26-31,110-112 | تبديل الوضع الليلي/النهاري، محفوظ في localStorage `egco-theme` | — | shell | ☐ |
| P-344 | pages/Settings.tsx:117-129 | «المحذوفات وإدارة المشاريع»: روابط /settings/trash و /settings/projects + شرح | — | data | ☐ |
| P-345 | pages/Settings.tsx:434-539 | «مساعد قراءة الملفات (AI)»: تفعيل · المزود · baseUrl · مفتاح API (مُقنَّع «•••» يبقى إن تُرك فارغاً) · النموذج · maxTokens (≥100) · «حفظ» · «اختبار الاتصال» (يحفظ ثم يختبر) + نص الخصوصية | GET/PUT /ai/settings + POST /ai/test | data | ☐ |
| P-346 | pages/Settings.tsx:544-577 | «أنماط الملفات المتعلَّمة»: الاسم/الحساب/النوع · مرات الاستخدام · الرموز الموفّرة · آخر استخدام | GET /ai/learned-layouts | data | ☐ |
| P-347 | pages/Settings.tsx:585-643 | «تصنيفات الحسابات» المحفوظة (الحساب·الاسم·التصنيف) + حذف | GET /import/classify + DELETE /import/classify/{account} | data | ☐ |
| P-348 | pages/Settings.tsx:656-774 | «تصفير البيانات»: معاينة الأعداد لكل جدول، ما يبقى، كتابة عبارة التأكيد، نسخة احتياطية قبل المحو، رسالة النتيجة واسم النسخة، إعادة تحميل بعد ٢.٥ث؛ «التطبيق فارغ أصلاً» | GET /reset/preview + POST /reset | data | ☐ |
| P-349 | pages/Settings.tsx:137-157 | «عن التطبيق»: إصدار التطبيق · إصدار الخدمة · «لا يوجد اتصال بالشبكة» + «ما الجديد في هذا الإصدار» (آخر جولة) | GET /health + IPC app:info | data | ☐ |
| P-350 | pages/Settings.tsx:341-432 | «التحديثات»: الإصدار الحالي + «تحقق من التحديثات» وحالات: جارٍ الفحص · غير متاح في التطوير · أحدث إصدار · متوفر/جارٍ التنزيل N٪ · تم التنزيل + «إعادة التشغيل والتثبيت الآن» · خطأ بنصه الفعلي | IPC update:check / update:install / update:status | data | ☐ |
| P-351 | pages/Settings.tsx:96-100,328-330,424-428 | رسائل «متاح داخل التطبيق فقط» خارج Electron | — | data | ☐ |

### 1.20 المحذوفات — pages/Trash.tsx (`/settings/trash`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-352 | pages/Trash.tsx:89-96 | تصفية بالنوع: الكل/موردون/مقاولون/فواتير/دفعات/حركات مقاولين/استيرادات/أشهر موازنة | GET /trash?kind | data | ☐ |
| P-353 | pages/Trash.tsx:104-141 | جدول: النوع · الاسم · تاريخ الحذف · التفاصيل (summary) | GET /trash | data | ☐ |
| P-354 | pages/Trash.tsx:54-64,127-130 | «استرجاع» مع التبعيات | POST /trash/{kind}/{id}/restore | data | ☐ |
| P-355 | pages/Trash.tsx:66-77,131-160 | «حذف نهائي» بتأكيد «لا رجعة بعده» | DELETE /trash/{kind}/{id}?confirm=true | data | ☐ |
| P-356 | pages/Trash.tsx:100-102 | «السلّة فارغة» | — | data | ☐ |
| P-357 | pages/Trash.tsx:86 | «رجوع للإعدادات» | — | data | ☐ |

### 1.21 المشاريع والدمج — pages/ProjectAdmin.tsx (`/settings/projects`)
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-358 | pages/ProjectAdmin.tsx:86-104 | «مشاريع تبدو مكرّرة» (تجاهل أل والتشكيل) + أزرار «دمج A في B» لكل اتجاه | GET /project-admin | data/projects | ☐ |
| P-359 | pages/ProjectAdmin.tsx:106-127 | «دمج يدوي»: المصدر (سيختفي) · الهدف (سيبقى) · «معاينة الأثر» (معطّل إن تساويا) | GET /project-admin | data/projects | ☐ |
| P-360 | pages/ProjectAdmin.tsx:42-52,132-139 | معاينة «سيتأثر N صفاً» لكل جدول | GET /project-admin/merge/preview?fromName&intoName | data/projects | ☐ |
| P-361 | pages/ProjectAdmin.tsx:54-69,140-142 | «تنفيذ الدمج» + «تم الدمج — N صفاً تأثّر» | POST /project-admin/merge | data/projects | ☐ |

### 1.22 المكوّنات المشتركة — components/*.tsx
| ID | المكان | القدرة | API | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-362 | components/Modal.tsx:24-136 | نافذة منبثقة RTL: إغلاق بـEsc/النقر خارجاً/✕؛ حارس «تجاهل التغييرات غير المحفوظة؟» عند dirty (عودة للنموذج/تجاهل والإغلاق)؛ تركيز أول حقل (لا زر ✕)؛ فخ Tab/Shift+Tab؛ قفل تمرير الصفحة؛ إعادة التركيز لفاتح النافذة؛ useModalClose للأزرار الداخلية | — | shell (ui) | ☐ |
| P-363 | components/ColumnMenu.tsx:37-184 | قائمة عمود (Th): ترتيب ▲/▼ بتسميات مخصّصة (إعادة النقر تلغي)، تصفية text/select(+hint)/range(+وحدة)/dateRange، نقطة «تصفية نشطة»، Esc/نقر خارجاً يغلق، موضع fixed يتبع الزر عند التمرير (م-٣٩) ويبقى داخل الشاشة | — | shell (DataTable) | ☐ |
| P-364 | components/ExportMenu.tsx:15-114 | منتقي تصدير المقاولين «تصدير Excel ▾» بـ٤ مجموعات (قوائم/بالمشروع/تقارير تدقيق/تقرير شامل)؛ «مشروع واحد…» يطلب اختيار مشروع قبل التنزيل (لا ٤٢٢ من الواجهة)؛ يحمل تصفية الجدول | GET /contractors/export.xlsx?format | parties | ☐ |
| P-365 | components/ExportMenu.tsx:119-129 | زر 📄 «تصدير كشف الحساب (Excel)» لكل صف | GET /contractors/export.xlsx?format=single_statement&code | parties | ☐ |
| P-366 | components/PrintableList.tsx:26-200 | ورقة PDF مشتركة: الشعار، الشركة «الإدارة المالية — الفرع الرئيسي»، العنوان، العدد·تاريخ الإصدار·«بالريال»·النطاق، «تصفية مطبَّقة: …/بلا تصفية — القائمة كاملة»، تنبيه ⚠، ملخص إجماليات أعلى الورقة، جدول + سطر إجماليات، حاشية، «وثيقة داخلية»؛ «رجوع إلى القائمة» | IPC export:pdf | shell (ExportDialog) | ☐ |
| P-367 | components/PrintableList.tsx:17,58-65,85-102 | اختيار اتجاه الورقة «عمودي A4/أفقي A4» محفوظ في localStorage `egco-print-landscape` (مشترك بين الشاشات)، يقود @page و exportPdf معاً | — | shell | ☐ |
| P-368 | components/PrintableList.tsx:70-76 | اسم الملف `EGCO-{fileStamp}-YYYY-MM-DD.pdf`؛ window.print خارج Electron؛ رسالة خطأ التصدير | IPC export:pdf | shell | ☐ |
| P-369 | components/Present.tsx:16-87 | وضع العرض ملء الشاشة: ←/PageDown/Space التالي، →/PageUp السابق (RTL)، Esc إغلاق، عدّاد، أزرار السابق/التالي، «تصدير العرض PDF» يطبع كل الشرائح، تذييل باسم الشركة ورقم الشريحة | IPC export:pdf | reports | ☐ |
| P-370 | components/Explain.tsx:9-55 + lib/explanations.ts | نقطة «؟» بجوار KPI تفتح شرحاً حتمياً (بلا AI): «ماذا يعني» · «كيف حُسب» بالتعويض بالقيم الفعلية = النتيجة · «مصدر البيانات»؛ ٣٢ مقياساً (openingBalance, periodMovement, closingBalance, outstanding, netOutstanding, overdue, dueWithin7, contractorBalance, retentionHeld, cashflowHorizon, budgetDelay, budgetCompletion, revenuesOpen/Collected/Total, contractorsOwed/OwedToUs/Retention, guaranteeStatementsHeld/TrackedHeld/DueSoon, supplierCoverage, projectsTotals, projectDetailOutstanding, ageingByDueDate, cashflowColumns, reportAgeing, guaranteeAccountMatch, budgetDeviation, cashflowMinBalance, cashflowNetPeriod, cashflowReconciliation) | — | shell (KPI) | ☐ |
| P-371 | components/AiRescueModal.tsx:20-229 | «محاولة القراءة بالذكاء الاصطناعي»: استخراج (٣٠–٦٠ث) ← جدول قابل للتعديل (التاريخ·مدين·دائن·الوصف، حذف سطر) + إجماليات ورصيد ← مقاول موجود (قائمة) أو جديد (الكود+الاسم) ← «حفظ N حركة» (لا شيء يُكتب قبل الحفظ) ← رسالة «تظهر في الملفات المرفوعة» | POST /ai/extract + GET /contractors + POST /ai/commit-extract | data | ☐ |
| P-372 | components/RemindModal.tsx:10-74 | «صياغة مطالبة»: مسودة قابلة للتعديل، «إعادة الصياغة»، «نسخ» أساسي، «إغلاق» يمرّ بحارس التعديل (dirty = تعديل يدوي فقط) | POST /ai/remind | parties | ☐ |
| P-373 | components/Ai.tsx:11-34 | AiBlock: حالة انتظار/خطأ/محتوى موحّدة لميزات AI | — | shell | ☐ |
| P-374 | components/Ai.tsx:37-55 | CopyButton: نسخ للحافظة + «نُسخ ✓» ١.٥ث | — | shell | ☐ |
| P-375 | components/Ai.tsx:58-64 | AiDisabledHint «فعّل مساعد الذكاء من الإعدادات» | — | today | ☐ |
| P-376 | lib/useAi.ts:9-23 | إخفاء كل عناصر AI أثناء التحميل وعند التعطيل | GET /ai/settings | shell | ☐ |
| P-377 | components/Carousel.tsx:15-88 | Carousel عام: أسهم RTL، لوحة مفاتيح، سحب لمس ٤٠px، نقاط، loadStoredCarouselView من localStorage | — | shell | ☐ |
| P-378 | components/ScopeBar.tsx:40-147 | نطاق التقرير: كل الموردين/مورد واحد/مشروع واحد/مقاول واحد (يظهر فقط إن نشر الخادم مقاولين)؛ optgroups «لديهم كشوفات/بلا كشوفات — التقرير سيكون فارغاً» و«لديهم حركة/بلا حركة»؛ الأطراف؛ scopeParams مكان واحد للشاشة والتصدير | GET /reports/scopes | reports | ☐ |
| P-379 | components/PeriodBar.tsx:6-27 | من تاريخ / إلى تاريخ + «تطبيق» | — | reports | ☐ |
| P-380 | components/SupplierForm.tsx:31-179 | نموذج المورد: رقم الحساب (مطلوب، مقفل عند التعديل + «لا يُعدَّل») · الاسم (مطلوب) · المشاريع (شرائح، الأول ★ الأساسي، Enter/«إضافة»، datalist) · اقتراح «يوجد مشروع مشابه» بتطبيع عربي · مدة السداد نص حر («٤٥ يوم · كاش · مستخلص») · تتبّع dirty | — | parties | ☐ |
| P-381 | components/ContractorForm.tsx:31-194 | نموذج المقاول: الرمز (مطلوب، مقفل عند التعديل) · الاسم (مطلوب) · الهاتف · المشاريع (★ + اقتراح مشابه) · نسبة الضمان ٠–١٠٠ · مدة الضمان · مدة السداد ٠–٣٦٥ (فارغ = null صريح «امسح المدة») · ملاحظات · dirty | — | parties | ☐ |
| P-382 | components/ManualEntryForm.tsx:14-102 | نموذج فاتورة/دفعة يدوية: المبلغ (>0 مطلوب) · التاريخ (اليوم افتراضياً) · تاريخ الاستحقاق (للفاتورة، «يُحسب من مدة المورد إن تُرك فارغاً») · الوصف · رقم مرجعي · dirty | — | parties | ☐ |
| P-383 | components/WhatsNewModal.tsx:10-63 | جولة «ما الجديد» تجمع إصدارات فائتة، خطوة بخطوة إن زادت عن ٣ (السابق/التالي، N/M)، «تجدها في: …»، «فهمت، أغلق» | — | shell | ☐ |
| P-384 | lib/whatsNew.ts:27-181 | محتوى الجولة لإصدارات 0.10.0 · 0.11.0 · 0.11.1 · 0.12.0 · 0.13.0 + toursSince | — | shell | ☐ |
| P-385 | components/ErrorBoundary.tsx:25-76 | «تعذّر عرض هذه الشاشة — بياناتك سليمة» + «إعادة المحاولة» + «إعادة تحميل التطبيق» + «التفاصيل التقنية»؛ console.error | — | shell | ☐ |
| P-386 | components/ui.tsx:6-16 | Kpi: label + explain + value + unit، tone، alert، hero (30/22/28px) | — | shell | ☐ |
| P-387 | components/ui.tsx:55-64 | ErrorState موحّد «حدث خطأ» + «إعادة المحاولة» | — | shell | ☐ |
| P-388 | components/ui.tsx:74-95 | EmptyState بثلاث حالات لا تُخلط: no-data (⬆ ذهبي، زر أساسي) · no-results (⌕) · all-clear (✓ أخضر بلا إجراء) | — | shell | ☐ |
| P-389 | components/ui.tsx:18-46 | Money · Card (title/sub/actions) · Pill · State | — | shell | ☐ |
| P-390 | components/Icon.tsx:7-169 | مجموعة الأيقونات SVG المسماة (dashboard, payables, suppliers, contractors, guarantee, cashflow, revenue, loans, obligations, expenses, projects, budget, reports, calendar, upload, coverage, settings, expand, collapse) | — | shell | ☐ |
| P-391 | lib/delay.ts:17-40 | شرائح التأخر السبع m1..m6_plus (+none) مطابقة للخادم + bucketOfDays | — | parties | ☐ |
| P-392 | lib/format.ts | تنسيق عربي: ar (أرقام عربية)، arDate، arRange، sar (ر.س بخانتين)، k (مختصر)، pct، dueLabel/dueTone، invoiceCount | — | shell | ☐ |
| P-393 | lib/api.ts:29-60 | ApiError برسائل عربية: «تعذّر الاتصال بالخدمة المحلية…»، body.detail، «استجابة غير سليمة» | — | shell | ☐ |
| P-394 | lib/api.ts:9-27 | initApi يسأل Electron عن عنوان الخادم + setApiBase عند إعادة التشغيل | IPC backend:url | shell | ☐ |
| P-395 | main.tsx:8-11 | تطبيق الوضع المحفوظ `egco-theme` قبل أول رسم (لا وميض) | — | shell | ☐ |

## ٢ · مسارات الخادم (FastAPI) — كلها تحت `/api/v1` عدا `/health`

العمود «المستدعي» من `apps/renderer/src/lib/api.ts` ومن نداءات `fetch(apiBase()+…)` المباشرة في الصفحات ومن `apps/desktop`. **⚠ بلا مستدعٍ** = لا شاشة تستدعيه في v0.13.0 (لا يُحذف — يُعلَّم).

| ID | الطريقة | المسار | المعاملات / الجسم | المستدعي (الشاشة) | الموطن الجديد | الحالة |
|---|---|---|---|---|---|---|
| P-396 | GET | /health | — | App.tsx (إقلاع)، Settings، desktop backend.ts (انتظار/توقف) | shell | ☐ |
| P-397 | GET | /dashboard | date_from, date_to, project | api.dashboard ← Dashboard.tsx (/payables)، Calendar.tsx (schedule) — ⚠ date_from/date_to غير مستعملين | today/cash | ☐ |
| P-398 | GET | /dashboard/day | date (مطلوب), project | api.calendarDay ← Calendar.tsx | cash | ☐ |
| P-399 | GET | /overview | — | api.overview ← CommandCentre، Dashboard، Sidebar (نقاط التنبيه) | today/shell | ☐ |
| P-400 | GET | /suppliers | q, project, status, date_from, date_to, min/max_outstanding, overdue_only, has_data, delay, min/max_delay_days, sort, dir | api.suppliers ← Suppliers.tsx، CashFlow.tsx (ماذا لو) — ⚠ overdue_only/has_data/min_delay_days/max_delay_days غير مستعملة | parties | ☐ |
| P-401 | GET | /suppliers/export.xlsx | نفس معاملات القائمة | رابط مباشر ← Suppliers.tsx | parties | ☐ |
| P-402 | GET | /suppliers/settings/payment-allocation | — | fetch مباشر ← SupplierDetail.tsx | parties/data | ☐ |
| P-403 | PUT | /suppliers/settings/payment-allocation | {enabled} | fetch مباشر ← SupplierDetail.tsx | parties/data | ☐ |
| P-404 | GET | /suppliers/payment-allocation/pending-count | — | **⚠ بلا مستدعٍ** | today (مرشح لنقطة تنبيه) | ☐ |
| P-405 | POST | /suppliers/{account}/payments/{payment_id}/allocate | {lines:[{invoiceId|null, amount}]} | fetch مباشر ← SupplierDetail.tsx (نافذة التخصيص) | parties | ☐ |
| P-406 | DELETE | /suppliers/{account}/payments/{payment_id}/allocate | — | **⚠ بلا مستدعٍ** (لا زر «إلغاء التخصيص») | parties | ☐ |
| P-407 | GET | /suppliers/{account} | date_from, date_to | api.supplier ← SupplierDetail.tsx — ⚠ date_from/date_to غير مستعملين | parties | ☐ |
| P-408 | POST | /suppliers | {account, name, project, term, projects} | api.createSupplier ← Suppliers.tsx | parties | ☐ |
| P-409 | PUT | /suppliers/{account} | {name, project, term, projects} | api.updateSupplier ← Suppliers.tsx | parties | ☐ |
| P-410 | DELETE | /suppliers/{account} | force | api.deleteSupplier ← Suppliers.tsx | parties | ☐ |
| P-411 | POST | /manual/invoices | {account, amount, date, due_date, description, reference} | api.addManualInvoice ← SupplierDetail | parties | ☐ |
| P-412 | PUT | /manual/invoices/{id} | نفس الحقول | api.updateManualInvoice ← SupplierDetail | parties | ☐ |
| P-413 | DELETE | /manual/invoices/{id} | — | api.deleteManualInvoice ← SupplierDetail | parties | ☐ |
| P-414 | POST | /manual/payments | {account, amount, date, description, reference} | api.addManualPayment ← SupplierDetail | parties | ☐ |
| P-415 | DELETE | /manual/payments/{id} | — | api.deleteManualPayment ← SupplierDetail | parties | ☐ |
| P-416 | PUT | /invoices/{id}/due-date | {due_date|null} | api.setDueDate ← SupplierDetail | parties | ☐ |
| P-417 | POST | /import/preview | {path, source} | api.previewImport ← Import.tsx | data | ☐ |
| P-418 | POST | /import | {path, source, allow_unreconciled, create_supplier{name,project,term}} | api.runImport ← Import.tsx | data | ☐ |
| P-419 | POST | /import/scan | {dir} | api.scanDir ← Import.tsx | data | ☐ |
| P-420 | POST | /import/classify | {path} → {source} | desktop main detectSource (.xlsx/.xlsm) | desktop | ☐ |
| P-421 | POST | /import/budget-attachment | {path} → {attachment} | api.budgetUploadAttachment ← Budget.tsx | projects | ☐ |
| P-422 | POST | /import/batch | {paths, allow_unreconciled} | api.batchImport ← Import.tsx | data | ☐ |
| P-423 | GET | /import/classify | — | api.importClassifications ← Settings.tsx | data | ☐ |
| P-424 | PUT | /import/classify | {account, kind, name} | api.setImportClassification ← Import.tsx | data | ☐ |
| P-425 | DELETE | /import/classify/{account} | — | api.deleteImportClassification ← Settings.tsx | data | ☐ |
| P-426 | POST | /import/classify/suggest | {path} → {kind, reason} | api.suggestImportClassification ← Import.tsx (AI) | data | ☐ |
| P-427 | GET | /import/near-duplicates | account (مطلوب) | **⚠ بلا مستدعٍ** (التحذير يصل ضمن preview/import بدلاً منه) | data | ☐ |
| P-428 | GET | /import/duplicates | — | fetch مباشر ← Import.tsx DuplicatesSection | data | ☐ |
| P-429 | POST | /import/duplicates/delete | {kind, id} | fetch مباشر ← Import.tsx | data | ☐ |
| P-430 | GET | /import/history | file_name, source, party, date_from, date_to, min_moves, max_moves, reconciled, sort, dir(desc) | fetch مباشر ← Import.tsx (api.importHistory معرَّف لكن **⚠ غير مستعمل**) | data | ☐ |
| P-431 | DELETE | /import/history/{log_id} | force | api.deleteImport ← Import.tsx | data | ☐ |
| P-432 | GET | /reports/analysis | account, project, contractor, parties, date_from, date_to, period_from (قديم) | api.report ← Report.tsx | reports | ☐ |
| P-433 | GET | /reports/project-summary | project (مطلوب), parties | api.projectSummary ← Report.tsx | reports | ☐ |
| P-434 | GET | /reports/project-summary/export.xlsx | project, parties | رابط ← Report.tsx | reports | ☐ |
| P-435 | GET | /reports/priorities | budget | api.priorities ← Report.tsx (بديل عند تعطّل AI) | reports | ☐ |
| P-436 | GET | /reports/scopes | — | api.reportScopes ← Report.tsx، ScopeBar | reports | ☐ |
| P-437 | GET | /reports/periodic | granularity, year (مطلوب), account | api.periodic ← Report.tsx | reports | ☐ |
| P-438 | GET | /reports/export.xlsx | granularity, year, account, project, contractor, parties, date_from, date_to | api.exportExcelUrl ← Report.tsx (تبويبا الفترة والدوري) | reports | ☐ |
| P-439 | GET | /coverage | stale_days(90), q, project, state | api.coverage ← Coverage.tsx — ⚠ q/project/state غير مستعملة (التصفية محلية) | data | ☐ |
| P-440 | GET | /projects | q, date_from, date_to, min_outstanding | api.projects ← Projects، Dashboard، Calendar — ⚠ المعاملات غير مستعملة | projects | ☐ |
| P-441 | GET | /projects/{project} | — | api.project ← ProjectDetail | projects | ☐ |
| P-442 | GET | /cashflow | weeks(1–104، 26), from, opening_balance, project, parties(suppliers افتراضياً), period_days | api.cashflow ← CashFlow.tsx — ⚠ from غير مستعمل | cash | ☐ |
| P-443 | GET | /cashflow/breakdown | term (scheduled/overdue/undated/beyond/collected/forecast), period, weeks, from, project, parties, period_days | fetch مباشر ← CashFlow.tsx BreakdownModal | cash | ☐ |
| P-444 | POST | /cashflow/reconciliation-note | {parties, project, noteCode, noteText} (جدول cashflow_recon_notes) | fetch مباشر ← CashFlow.tsx | cash | ☐ |
| P-445 | GET | /contractors | q, project, direction, has_guarantees, status (يقبل قائمة + overdue), sort, dir | api.contractorsList ← Contractors.tsx؛ api.contractors ← CashFlow، AiRescueModal — ⚠ has_guarantees غير مستعمل | parties | ☐ |
| P-446 | GET | /contractors/overview | — | fetch مباشر ← Contractors.tsx | parties | ☐ |
| P-447 | GET | /contractors/export.xlsx | نفس معاملات القائمة + format (١٤) + code | contractorsExportUrl ← ExportMenu، StatementExportButton | parties | ☐ |
| P-448 | GET | /contractors/claims-due | date_from, date_to, project | fetch مباشر ← Calendar.tsx — ⚠ date_from/date_to غير مستعملين | cash | ☐ |
| P-449 | GET | /contractors/{code} | — | api.contractor ← ContractorDetail، Contractors (طباعة الكشف) | parties | ☐ |
| P-450 | POST | /contractors | ContractorIn {code, name, phone, notes, status, statusNote, defaultRetentionRate, defaultGuaranteeDays, paymentTermDays, projects} | api.createContractor ← Contractors.tsx — ⚠ status/statusNote لا تُرسل من أي نموذج | parties | ☐ |
| P-451 | PUT | /contractors/{code} | ContractorUpdate (نفسها، paymentTermDays=null يمسح) | api.updateContractor ← Contractors، ContractorDetail | parties | ☐ |
| P-452 | DELETE | /contractors/{code} | force | api.deleteContractor ← Contractors.tsx | parties | ☐ |
| P-453 | POST | /contractors/{code}/entries | {date, debit, credit, description, kind, project} | api.createContractorEntry ← ContractorDetail | parties | ☐ |
| P-454 | PUT | /contractors/{code}/entries/{id} | جزئي (يشمل project فقط لتغيير المشروع) | api.updateContractorEntry ← ContractorDetail | parties | ☐ |
| P-455 | DELETE | /contractors/{code}/entries/{id} | — | api.deleteContractorEntry ← ContractorDetail | parties | ☐ |
| P-456 | POST | /contractors/{code}/claims | ClaimIn | api.createContractorClaim ← ContractorDetail | parties | ☐ |
| P-457 | PUT | /contractors/{code}/claims/{id} | ClaimUpdate | api.updateContractorClaim ← ContractorDetail | parties | ☐ |
| P-458 | DELETE | /contractors/{code}/claims/{id} | — | api.deleteContractorClaim ← ContractorDetail | parties | ☐ |
| P-459 | POST | /contractors/{code}/guarantees | GuaranteeIn | api.createContractorGuarantee ← ContractorDetail | parties | ☐ |
| P-460 | PUT | /contractors/{code}/guarantees/{id} | GuaranteeUpdate | api.updateContractorGuarantee ← ContractorDetail | parties | ☐ |
| P-461 | DELETE | /contractors/{code}/guarantees/{id} | — | api.deleteContractorGuarantee ← ContractorDetail | parties | ☐ |
| P-462 | GET | /guarantees | — | api.guarantees ← Guarantees.tsx | parties | ☐ |
| P-463 | GET | /guarantees/{account} | — | api.guaranteeAccount ← Guarantees.tsx | parties | ☐ |
| P-464 | GET | /budget | project, city, from_month, to_month, status, has_claims | api.budgetList ← Budget.tsx | projects | ☐ |
| P-465 | GET | /budget/overview | — | api.budget ← Budget.tsx (الوثيقة) | projects | ☐ |
| P-466 | GET | /budget/project/{name} | from_month, to_month | api.budgetProject ← Budget.tsx — ⚠ from/to غير مستعملين | projects | ☐ |
| P-467 | POST | /budget/preview | {project, month, actualMonth, plannedMonth} | api.budgetPreview ← Budget.tsx | projects | ☐ |
| P-468 | POST | /budget | BudgetSnapshotIn {project, month, actualMonth, plannedMonth, claims, docNo, issuedOn, notes, forceConflict, attachment} | api.budgetCreate ← Budget.tsx | projects | ☐ |
| P-469 | PUT | /budget/{id} | BudgetSnapshotIn | api.budgetUpdate ← Budget.tsx | projects | ☐ |
| P-470 | DELETE | /budget/{id} | — | api.budgetDelete ← Budget.tsx | projects | ☐ |
| P-471 | POST | /budget/{id}/comments | CommentIn | **⚠ بلا مستدعٍ** | projects | ☐ |
| P-472 | GET | /budget/{id}/comments | — | **⚠ بلا مستدعٍ** | projects | ☐ |
| P-473 | DELETE | /budget/{id}/comments/{comment_id} | — | **⚠ بلا مستدعٍ** | projects | ☐ |
| P-474 | PUT | /budget/project/{name}/city | {city} | api.budgetSetCity معرَّف **⚠ بلا مستدعٍ** (لا واجهة لضبط المدينة) | projects | ☐ |
| P-475 | POST | /budget/import | {path} | api.budgetImport ← Budget.tsx | projects/data | ☐ |
| P-476 | GET | /budget/export.xlsx | نفس معاملات القائمة | رابط ← Budget.tsx | projects | ☐ |
| P-477 | GET | /ai/settings | — | api.aiSettings ← Settings، useAiEnabled (كل الشاشات) | data | ☐ |
| P-478 | PUT | /ai/settings | {enabled, provider, baseUrl, apiKey, model, maxTokens} | api.saveAiSettings ← Settings | data | ☐ |
| P-479 | POST | /ai/test | — | api.aiTest ← Settings | data | ☐ |
| P-480 | POST | /ai/extract | {path} | api.aiExtract ← AiRescueModal | data | ☐ |
| P-481 | GET | /ai/learned-layouts | — | api.aiLearnedLayouts ← Settings | data | ☐ |
| P-482 | POST | /ai/commit-extract | {partyKind, code|newContractor, rows, sourceFile} | api.aiCommitExtract ← AiRescueModal | data | ☐ |
| P-483 | POST | /ai/ask | {question} → {answer, sql, rows} | api.aiAsk ← CommandCentre | today | ☐ |
| P-484 | POST | /ai/remind | {partyKind, key} → {message} | api.aiRemind ← RemindModal | parties | ☐ |
| P-485 | POST | /ai/budget-notes | {project} → {notes} | api.aiBudgetNotes ← Budget.tsx | projects | ☐ |
| P-486 | POST | /ai/summary | {account, project, contractor, parties, date_from, date_to} | api.aiSummary ← Report.tsx | reports | ☐ |
| P-487 | POST | /ai/brief | {days} | api.aiBrief ← CommandCentre | today | ☐ |
| P-488 | POST | /ai/anomalies | {} | api.aiAnomalies ← CommandCentre | today | ☐ |
| P-489 | POST | /ai/parse-text | {text} → {proposal} | api.aiParseText ← ContractorDetail | parties | ☐ |
| P-490 | POST | /ai/what-if | {partyKind, key, shiftDays} | api.aiWhatIf ← CashFlow.tsx | cash | ☐ |
| P-491 | POST | /ai/priorities | {budget} | api.aiPriorities ← Suppliers.tsx، Report.tsx | parties/reports | ☐ |
| P-492 | GET | /revenues | q, project, status, date_from, date_to, date_field(due/collected), min/max_amount, sort, dir | api.revenues ← Revenues.tsx — ⚠ date_field غير مستعمل | cash | ☐ |
| P-493 | POST | /revenues | RevenueIn | api.createRevenue ← Revenues.tsx | cash | ☐ |
| P-494 | PUT | /revenues/{id} | RevenueUpdate | api.updateRevenue ← Revenues.tsx | cash | ☐ |
| P-495 | DELETE | /revenues/{id} | — | api.deleteRevenue ← Revenues.tsx | cash | ☐ |
| P-496 | GET | /trash | kind | api.trash ← Trash.tsx | data | ☐ |
| P-497 | POST | /trash/{kind}/{id}/restore | — | api.restoreTrash ← Trash.tsx | data | ☐ |
| P-498 | DELETE | /trash/{kind}/{id} | confirm=true | api.purgeTrash ← Trash.tsx | data | ☐ |
| P-499 | GET | /project-admin | — | api.projectAdmin ← ProjectAdmin.tsx | data | ☐ |
| P-500 | GET | /project-admin/merge/preview | fromName, intoName | api.projectMergePreview ← ProjectAdmin.tsx | data | ☐ |
| P-501 | POST | /project-admin/merge | {fromName, intoName} | api.projectMerge ← ProjectAdmin.tsx | data | ☐ |
| P-502 | GET | /backups | — | api.backups ← Settings | data | ☐ |
| P-503 | POST | /backups | — (نسخة يدوية متّسقة) | api.createBackup ← Settings؛ desktop data:export | data | ☐ |
| P-504 | POST | /backups/daily-if-due | — | api.backupDailyIfDue ← Settings (عند الفتح فقط) | data | ☐ |
| P-505 | GET | /backups/settings | — | api.backupSettings ← Settings | data | ☐ |
| P-506 | PUT | /backups/settings | {path|null} | api.saveBackupSettings ← Settings | data | ☐ |
| P-507 | DELETE | /backups/{name} | — | api.deleteBackup ← Settings | data | ☐ |
| P-508 | GET | /reset/preview | — → {wipes, keeps, totalRows, isEmpty, confirmPhrase} | api.resetPreview ← Settings | data | ☐ |
| P-509 | POST | /reset | {confirm} | api.resetAll ← Settings | data | ☐ |

## ٣ · سطح المكتب (Electron) — v0.13.0 (`git show v0.13.0:apps/desktop/...`)

> ملاحظة: شجرة العمل تحمل تعديلات غير مودعة من وكيل D (`window:insets`, `window:setTheme`, `window:isFocused`, `window:focus`, `notify:os`, `notify:clicked`, `app:setBadge`, `chrome.ts`, `notify.ts`, `windowState.ts`). هذه **جديدة** وليست من v0.13.0 فلا تُعدّ هنا كبنود تكافؤ.

| ID | المكان | القدرة | القناة / الآلية | الموطن الجديد | الحالة |
|---|---|---|---|---|---|
| P-510 | preload/index.ts | `window.egco` الجسر الوحيد (contextIsolation، sandbox، لا ipcRenderer مكشوف) | contextBridge | desktop | ☐ |
| P-511 | main/index.ts:242 | عنوان الخدمة الحالي | `app:backendUrl` (invoke) | desktop | ☐ |
| P-512 | main/index.ts:244-248 | معلومات التطبيق: version · platform · dataDir | `app:info` (invoke) | desktop | ☐ |
| P-513 | main/index.ts:285-294,361-373 | اختيار ملف واحد بمرشحات (كل المدعوم/PDF/Excel/CSV/كل الملفات) + كشف النوع | `dialog:pickFile` | desktop | ☐ |
| P-514 | main/index.ts:378-389 | اختيار ملفات متعددة + كشف النوع لكل ملف | `dialog:pickFiles` | desktop | ☐ |
| P-515 | main/index.ts:343-359 | كشف النوع: .pdf→pdf_statement، .csv→csv_statement، .xls→ شمّ «كشف المقاولين» UTF-16LE → contractors_balance_xls وإلا debts_report_xls، .xlsx/.xlsm → سؤال الخادم (budget_deviation/suppliers_excel، افتراضي suppliers عند الفشل) | POST /api/v1/import/classify | desktop | ☐ |
| P-516 | main/index.ts:396-399 | اختيار مجلد للرفع الجماعي | `dialog:pickDirectory` | desktop | ☐ |
| P-517 | main/index.ts:430-447 | تصدير البيانات: حوار حفظ `EGCO-data-YYYY-MM-DD.db` ← نسخة يدوية متّسقة من الخادم (VACUUM INTO) ← نسخ؛ «لا توجد قاعدة بيانات بعد» | `data:export` + POST /api/v1/backups | desktop/data | ☐ |
| P-518 | main/index.ts:449-484 | استيراد بيانات: اختيار .db ← تأكيد أصلي «استبدال البيانات الحالية؟» ← نسخة `before-import-*` (آخر ١٠) ← استبدال ← relaunch | `data:import` | desktop/data | ☐ |
| P-519 | main/index.ts:486 | فتح مجلد بيانات التطبيق | `shell:revealDataDir` | desktop | ☐ |
| P-520 | main/index.ts:495-498 | فتح مجلد النسخ (يُنشأ إن غاب) | `backup:revealDir` | desktop | ☐ |
| P-521 | main/index.ts:501-507 | اختيار مجلد خارجي للنسخ (مع إنشاء مجلد) | `backup:pickExternalDir` | desktop | ☐ |
| P-522 | main/index.ts:493,529-568 | استعادة نسخة: تحقق الاسم بنمط صارم (daily/manual/before-update/before-import/before-restore/egco) وداخل المجلد فقط ← تأكيد أصلي ← إيقاف الخدمة وانتظار توقفها ← نسخة `before-restore-*` (آخر ٥) ← حذف -wal/-shm/-journal ← نسخ ← relaunch | `backup:restore` | desktop/data | ☐ |
| P-523 | main/index.ts:578-604 | تصدير PDF: حوار حفظ في «المستندات» ← printToPDF (A4، خلفيات، عمودي/أفقي) ← إظهار الملف في Finder/Explorer | `export:pdf` | desktop | ☐ |
| P-524 | main/index.ts:255-268 | فحص تحديث يدوي يعيد الحالة الحقيقية (unavailable-dev في غير المحزوم، checking، error بنصه) | `update:check` | desktop | ☐ |
| P-525 | main/index.ts:271-275 | تثبيت التحديث المنزَّل (quitAndInstall) | `update:install` | desktop | ☐ |
| P-526 | main/index.ts:28-30,94-103 | بث حالة التحديث: available/up-to-date/downloading%/error/downloaded | `update:status` (send) | desktop | ☐ |
| P-527 | main/index.ts:78-126,136-144 | تحديث تلقائي عند الإقلاع (المحزوم فقط، GitHub)، تنزيل تلقائي، **لا** تثبيت عند الإغلاق، حوار «تحديث الآن وإعادة التشغيل / لاحقاً» | electron-updater | desktop | ☐ |
| P-528 | main/index.ts:44-56,63-70 | نسخة `before-update-{ver}-{stamp}.db` لحظة اكتمال التنزيل (آخر ١٠)، الفشل لا يوقف التحديث | electron-updater | desktop | ☐ |
| P-529 | main/index.ts:215-217 + backend.ts | بث إعادة تشغيل الخدمة {url, recovered, error} | `app:backend-restarted` (send) | desktop | ☐ |
| P-530 | backend.ts | مشرف الخدمة: منفذ loopback حر، انتظار /health حتى ٣٠ث، إعادة تشغيل تلقائية بميزانية ٥ محاولات/٥ دقائق، محاولة نفس المنفذ أولاً، ذيل stderr (آخر ٦ أسطر) في رسائل الخطأ، EGCO_API_PORT/EGCO_DATA_DIR | child_process | desktop | ☐ |
| P-531 | main/index.ts:219-229 | فشل تشغيل الخدمة عند الإقلاع → صندوق خطأ «تعذّر تشغيل الخدمة» + التفاصيل ثم إغلاق | dialog.showErrorBox | desktop | ☐ |
| P-532 | main/index.ts:181-190 | نسخة واحدة فقط من التطبيق (single-instance lock) + استعادة/تركيز النافذة | app.requestSingleInstanceLock | desktop | ☐ |
| P-533 | main/index.ts:200-207 | كل تنزيل (Excel) يمرّ بحوار حفظ أصلي في «التنزيلات» ثم يُظهر الملف | session will-download | desktop | ☐ |
| P-534 | main/index.ts:146-175 | النافذة: 1600×950، حد أدنى 1100×720، خلفية #FBFAF7، hiddenInset على macOS، روابط خارجية تُفتح في المتصفح | BrowserWindow | desktop | ☐ |
| P-535 | main/index.ts:237-238 | إغلاق كل النوافذ يُنهي التطبيق (عدا macOS)؛ إيقاف الخدمة قبل الخروج؛ activate يعيد النافذة | app events | desktop | ☐ |

## ٤ · الإعدادات والتخزين الدائم

| ID | المخزن | المفتاح | القيمة / الافتراضي | يُقرأ/يُكتب في | الموطن الجديد | الحالة |
|---|---|---|---|---|---|---|
| P-536 | localStorage | `egco-theme` | 'light' \| 'dark' — بلا قيمة = data-theme الافتراضي (فاتح) | main.tsx (قبل الرسم)، Settings.tsx (تبديل) | shell | ☐ |
| P-537 | localStorage | `egco.sidebar.collapsed` | '1' \| '0' (افتراضي موسّع) | Sidebar.tsx | shell | ☐ |
| P-538 | localStorage | `egco-last-seen-version` | نص الإصدار؛ غيابه = أول تشغيل يسجّل بصمت | App.tsx (جولة ما الجديد) | shell | ☐ |
| P-539 | localStorage | `egco.cashflow.kpiView` | 0..2 (افتراضي 0 «الحالي») | CashFlow.tsx | cash | ☐ |
| P-540 | localStorage | `egco.contractors.overviewView` | 0..3 (افتراضي 0 «التوزيع على المشاريع») | Contractors.tsx | parties | ☐ |
| P-541 | localStorage | `egco.import.historyOpen` | '1' \| '0' (افتراضي مفتوح) | Import.tsx | data | ☐ |
| P-542 | localStorage | `egco-print-landscape` | '1' \| '0' (افتراضي عمودي) — مشترك لكل PrintableList | PrintableList.tsx | shell | ☐ |
| P-543 | app_settings (SQLite) | `payment_allocation_enabled` | نص منطقي، افتراضي متوقف | services/payables_service.py:36 ← /suppliers/settings/payment-allocation | data | ☐ |
| P-544 | app_settings (SQLite) | `backup_external_dir` | مسار أو فارغ | services/backup_service.py:57 ← /backups/settings | data | ☐ |
| P-545 | ملف `{DATA_DIR}/ai-settings.json` | enabled/provider/baseUrl/apiKey/model/maxTokens | افتراضي: enabled=false، نصوص فارغة، maxTokens=2000؛ apiKey يُعاد مقنّعاً «•••» | services/ai_service.py:25-140 ← /ai/settings | data | ☐ |
| P-546 | جدول `cashflow_recon_notes` | (parties, project) → noteCode/noteText/updatedAt | يُنشأ عند الحاجة (CREATE TABLE IF NOT EXISTS) | cashflow_service.py:598 ← /cashflow/reconciliation-note | cash | ☐ |
| P-547 | جدول `account_classifications` (عبر /import/classify) | account → kind (supplier/contractor/guarantee/ignore), name | يدوي | Import.tsx، Settings.tsx | data | ☐ |
| P-548 | جدول learned layouts (AI) | قواعد استخراج + hit_count + last_used_at + learned_from_chars | تلقائي | ai_service ← /ai/learned-layouts | data | ☐ |
| P-549 | مجلد `{userData}/backups` | سقوف الاحتفاظ: daily 30 · manual 20 · before-update 10 · before-import 10 · before-restore 5 · before-reset 10 | backup_service.KEEP + desktop pruneBackups | data | ☐ |
| P-550 | ملف `{userData}/egco.db` | قاعدة SQLite واحدة | EGCO_DATA_DIR | desktop/backend | ☐ |
| P-551 | ثوابت معروضة | مدة السداد عند غياب القيمة = كاش · FIFO · نافذة التنبيه ٧ أيام · عتبة القِدَم ٩٠ يوماً (التغطية) · أفق التدفق ٢٦ أسبوعاً · طول الفترة ١٤ يوماً · بداية التقرير 2026-01-01 · سنوات التحليل الدوري 2024–2026 | Settings.tsx:104-108، Coverage، CashFlow، Report | data/reports | ☐ |
| P-552 | ثوابت | ترقيم صفحات المقاولين ٥٠ · أقصى فترات معروضة ٦٠ · أقصى صفوف تفكيك ٥٠٠ · debounce ٢٠٠ms (قوائم) / ٣٠٠ms (معاينة الموازنة) | Contractors، CashFlow، Budget | shell | ☐ |

## ٥ · التصديرات

| ID | الصيغة | المصدر | الأعمدة / المحتوى | اسم الملف | الموطن الجديد | الحالة |
|---|---|---|---|---|---|---|
| P-553 | XLSX | GET /suppliers/export.xlsx (Suppliers) | ورقة «الموردون» RTL: رقم الحساب · الاسم · المشروع · الحالة · المديونية المفتوحة · المتأخر · آخر دفعة — التاريخ · آخر دفعة — المبلغ + سطر الإجمالي (المفتوح، المتأخر) — بالتصفية الحالية | Content-Disposition عربي+ASCII | parties | ☐ |
| P-554 | PDF | PrintableList (Suppliers) | المورد · رقم الحساب · المشروع · الحالة · التأخر · المديونية المفتوحة + الإجمالي + «متأخر ضمن التصفية» | `EGCO-قائمة-الموردين-YYYY-MM-DD.pdf` | parties | ☐ |
| P-555 | XLSX `full` | /contractors/export.xlsx (افتراضي) | ورقة «تحليل المقاولين» (التصفية، العدد، الإجماليات بالاتجاه: لهم/لنا/الصافي/التأمينات، بالمشروع، بالحالة، قوائم) + ورقة «المقاولون» الخام: كود·الاسم·المشاريع·المحمّل عليه·المدفوع·خصومات وتحميلات·المستحق له·الرصيد + الإجمالي | `EGCO-المقاولون-full-YYYYMMDD.xlsx` | parties | ☐ |
| P-556 | XLSX `creditors` | ExportMenu «لهم علينا فقط» | اتجاه مفروض owed_to_them؛ أعمدة الصف القياسية (_ROW_HEADERS): الكود·الاسم·المشاريع·له كشف حقيقي؟·عدد حركات الكشف·المستحقات·المدفوع·خصومات·التأمين المحتجز·الرصيد·الحالة·آخر دفعة تاريخ/مبلغ·الهاتف | `EGCO-المقاولون-creditors-…` | parties | ☐ |
| P-557 | XLSX `debtors` | «لنا عليهم فقط» | اتجاه مفروض owed_to_us؛ _ROW_HEADERS | … | parties | ☐ |
| P-558 | XLSX `by_status` | «التوزيع بالحالة» | الحالة·العدد·الرصيد·لهم·لنا + قوائم لكل حالة | … | parties | ☐ |
| P-559 | XLSX `missing_statement` | «بلا كشف مرفوع — قائمة عمل» | من لا كشف له؛ _ROW_HEADERS | … | parties | ☐ |
| P-560 | XLSX `project_totals` | «إجماليات المشاريع — نظرة القرار» | المشروع·عدد الجهات·لهم علينا·لنا عليهم·غير مُسنَد؟ | … | parties | ☐ |
| P-561 | XLSX `by_project_creditors` | «بالمشروع ← الدائنون تحته» | لكل مشروع: الكود·الاسم·له كشف؟·الرصيد في المشروع·الرصيد الكلي·الحالة | … | parties | ☐ |
| P-562 | XLSX `by_project_debtors` | «بالمشروع ← المدينون تحته» | نفس الأعمدة | … | parties | ☐ |
| P-563 | XLSX `single_project` | «مشروع واحد…» (يتطلب project) | الكود·الاسم·له كشف؟·الرصيد في هذا المشروع·الرصيد الكلي·الحالة | … | parties | ☐ |
| P-564 | XLSX `reported_vs_derived` | «المبلَّغ مقابل المشتقّ» | الكود·الاسم·الرصيد المُبلَّغ·المشتقّ من الحركات·الفرق·يستحق المراجعة؟ | … | parties/data | ☐ |
| P-565 | XLSX `balanced_dormant` | «المتساوية والخاملة» | اتجاه مفروض balanced؛ _ROW_HEADERS | … | parties | ☐ |
| P-566 | XLSX `opening_vs_activity` | «الافتتاحي مقابل نشاط الحركة» | الكود·الاسم·له كشف؟·الافتتاحي·نشاط الحركة·الرصيد الكلي·الأغلب | … | parties | ☐ |
| P-567 | XLSX `single_statement` | زر 📄 في الصف (يتطلب code) | كشف حساب: التاريخ·النوع·المشروع·الوصف·رقم المستخلص·مدين·دائن·المصدر | … | parties | ☐ |
| P-568 | XLSX `full_report` | «التقرير الكامل (١١ ورقة)» | القائمة الكاملة + الدائنون + المدينون + إجماليات المشاريع + بالمشروع-الدائنون + بالمشروع-المدينون + بلا كشف + المبلَّغ/المشتقّ + المتساوية + بالحالة + الافتتاحي/النشاط | … | parties | ☐ |
| P-569 | — | ملاحظة | كل صيغ المقاولين: ورقة RTL، كتلة عنوان «التصفية المطبَّقة: …» و«العدد»، تحترم q/project/direction/status/sort/dir | — | parties | ☐ |
| P-570 | PDF | PrintableList (قائمة المقاولين) | المقاول·الرمز·المشروع·الرصيد (له/لنا)·الضمان المحتجز + تذييل له/لنا | `EGCO-قائمة-المقاولين-…pdf` | parties | ☐ |
| P-571 | PDF | PrintableList (إجماليات المشاريع) | المشروع·عدد المقاولين·له·لنا + ملخص ٣ أرقام | `EGCO-إجماليات-المشاريع-…pdf` | parties | ☐ |
| P-572 | PDF | PrintableList (كشف حساب مقاول) | التاريخ·النوع·الوصف·المشروع·مدين·دائن + ملخص (الختامي/مدين/دائن/الضمان) + تحذير «لا كشف مرفوع» | `EGCO-كشف-حساب-{code}-…pdf` | parties | ☐ |
| P-573 | XLSX | GET /budget/export.xlsx | «تحليل الموازنة»: التصفية، العدد، الإجماليات (الفعلي/المخطط/الانحراف/التراكمي/الإنجاز/التأخر المجمَّعة)، تنويه مشاريع بلا بيانات، جدول: المشروع·المدينة·الشهر·الفعلي·المخطط·انحراف الشهر·التراكمي الفعلي/المخطط·الإنجاز·التأخر·تحسّن/تراجع·الحالة·المصدر·رقم الوثيقة·تاريخ الإصدار + ورقة المستخلصات (المشروع·الشهر·الرقم·المبلغ·التاريخ) | … | projects | ☐ |
| P-574 | PDF | PrintableList (الموازنة بالتصفية) | ١١ عموداً (انظر P بند Budget) + ملخص | `EGCO-موازنة-مصفّاة-…pdf` | projects | ☐ |
| P-575 | PDF | BudgetDoc (وثيقة الموازنة الكاملة) | ترويسة، فترة، مؤشرات، قسم لكل مشروع، ملاحظات، تواقيع | `EGCO-موازنة-YYYY-MM-DD.pdf` | projects | ☐ |
| P-576 | XLSX | GET /reports/export.xlsx (تقرير الفترة) | «الملخص» (البند/القيمة) + «الفترات» (إن طُلب: الفترة·من·إلى·الافتتاحي·المفوتر·المسدد·الصافي·الختامي·متوسط أيام السداد) + «الموردون» (رقم الحساب·الاسم·المشروع·المدة·المديونية القائمة·المتأخر) + «المقاولون» (عند الشمول) + «أولويات السداد» (#·الاسم·النوع·المبلغ·السبب — لنطاق الشركة فقط)؛ نطاق مقاول = ورقة المقاولين وحدها | `_disposition(scope)` | reports | ☐ |
| P-577 | XLSX | GET /reports/export.xlsx?granularity&year (التحليل الدوري) | نفس الدفتر مع ورقة الفترات | … | reports | ☐ |
| P-578 | XLSX | GET /reports/project-summary/export.xlsx | اسم الشركة·رقم الحساب·نوع الطرف·إجمالي المفوتر·المسدد·المتبقي·المتأخر·أقصى تأخر·آخر دفعة تاريخ/مبلغ + الإجمالي | … | reports | ☐ |
| P-579 | PDF | تقرير الفترة A4 | انظر بنود Report (ترويسة، ٦ أقسام، تواقيع) | `EGCO-تقرير-تحليلي-YYYY-MM-DD.pdf` (عمودي) | reports | ☐ |
| P-580 | PDF | ملخّص المشروع | انظر بند ProjectSummarySheet | `EGCO-ملخص-مشروع-YYYY-MM-DD.pdf` (أفقي) | reports | ☐ |
| P-581 | PDF | وضع العرض | كل الشرائح مرتّبة للطباعة | `EGCO-عرض-YYYY-MM-DD.pdf` (أفقي) | reports | ☐ |
| P-582 | DB | data:export | نسخة SQLite متّسقة | `EGCO-data-YYYY-MM-DD.db` | data | ☐ |

## ٦ · ثوابت البيانات التي تستحق اختباراً

| ID | الثابت | أين يُحسب / يُعرض | اختبار قائم؟ | الحالة |
|---|---|---|---|---|
| P-583 | مديونية المورد المفتوحة = Σ (مبلغ الفاتورة − المسدد بها) بعد توزيع الدفعات FIFO = إجمالي المفوتر − المسدد (عدا الأرصدة الدائنة) | SupplierDetail KPIs، Suppliers، Dashboard، Coverage، Report | test_payables.py | ☐ |
| P-584 | مجموع «المديونية المفتوحة» في /suppliers totals = Σ صفوف المجموعة المصفّاة (التصفية والترتيب على الخادم — سطر الإجمالي يصف ما يُعرض) | Suppliers/Contractors/Revenues/Budget | test_filters_totals.py | ☐ |
| P-585 | /overview.payables.outstanding = /dashboard.summary.outstanding = Σ /suppliers rows.outstanding = /reports/analysis summary.outstanding (نطاق الشركة) | CommandCentre/Dashboard/Suppliers/Report | test_synergy_screens.py | ☐ |
| P-586 | شرائح التأخر: Σ byBucket = delay.amount؛ حدود m1..m6_plus متطابقة بين lib/delay.ts و domain/payables.py | Suppliers، SupplierDetail، ContractorDetail | test_payables.py / test_contractor_delay.py | ☐ |
| P-587 | أعمار الديون في التقرير: Σ الفئات + «بانتظار تاريخ استحقاق» = المديونية المفتوحة كاملةً | Report.tsx:623-640 | test_report_balance_identity.py | ☐ |
| P-588 | الرصيد الافتتاحي + (المفوتر − المسدد داخل الفترة) = الرصيد الختامي | Report.tsx:533-560 | test_report_balance_identity.py | ☐ |
| P-589 | اصطلاح إشارة الكشف: المطبوع سالباً = نحن ندين لهم، موجباً = يدينون لنا (لا يُعكس) | ingest/import | test_intake / test_debts_report_xls | ☐ |
| P-590 | رصيد المقاول: سالب = «له» (نحن مدينون)، موجب = «لنا»؛ الرصيد = إجمالي المدين − إجمالي الدائن؛ owedToContractors = Σ max(0, −balance) | Contractors/ContractorDetail/Report | test_contractors.py | ☐ |
| P-591 | ⚠ عدم اتساق قائم: ProjectDetail.tsx:78-81 يلوّن السالب أحمر ويسمّيه «لنا عليه» (عكس الاصطلاح)، وReport.tsx:772-776 يلوّن «له» أحمر بينما Contractors.tsx (م-٣٦) محايد — يجب توحيده في النسخة الجديدة | ProjectDetail، Report | لا | ☐ |
| P-592 | جانب المدين = مدفوعات + خصومات + تأمينات + (فواتير محمّلة ورصيد افتتاحي) = debitTotal | ContractorDetail.tsx:269-281 | test_contractors.py | ☐ |
| P-593 | بادئة الحساب تحسم النوع: 211 مورد · 212 مقاول · 216 ضمان؛ غير ذلك ← «يحتاج تصنيفاً» ولا يُحفظ حتى يقرر المستخدم | import، Import.tsx ClassifyModal، partyLink | test_account_lengths / test_migrate_211_contractors / test_branch_prefix_duplicates | ☐ |
| P-594 | مستخلص المقاول: أعمال الفترة = التراكمي − السابق؛ الصافي = أعمال − تأمين − خصومات | ContractorDetail ClaimForm | test_contractors.py | ☐ |
| P-595 | تأخر المقاول يُحسب فقط لمن له payment_term_days (استحقاق = تاريخ المستخلص + المدة، FIFO للدفعات)؛ بلا مدة = null («—») لا صفر | Contractors، ContractorDetail، Calendar | test_contractor_delay.py / test_contractors_overdue_api.py | ☐ |
| P-596 | مطابقة التدفق: المجدول + متأخر الآن + بعد الأفق + بلا تواريخ − أرصدة دائنة − ضمانات تتجاوز = المديونية المفتوحة (فرق < 0.005) ؛ وللداخل = المستحق المفتوح | CashFlow ReconciliationFooter | test_cashflow_credits_not_double_counted.py (حارس ٤٧٤٬١٤٧٫١٠) | ☐ |
| P-597 | تفكيك أي رقم في التدفق: Σ rows = الرقم المعروض (حتى عند القص ٥٠٠) | /cashflow/breakdown | test_cashflow_collections_breakdown.py | ☐ |
| P-598 | «المحصّل» و«الداخل المتوقّع» مجموعتان منفصلتان لا تُجمعان؛ الفجوة = المحصّل − المتوقع | CashFlow | test_cashflow.py | ☐ |
| P-599 | التحصيلات: الإجمالي = المفتوح + المحصّل؛ التحصيل بلا تاريخ استحقاق لا يدخل توقع التدفق | Revenues، CashFlow | test_revenues.py / test_receivables.py | ☐ |
| P-600 | الموازنة: الانحراف = الفعلي − المخطط؛ التراكمي سلسلة تُعاد بناؤها عند إضافة/حذف شهر؛ التعارض ملف/يدوي لا يُكتب صامتاً | Budget | test_budget.py | ☐ |
| P-601 | ضمانات 216: المطابقة = رصيد حساب الضمان مقابل المتتبَّع (الرصيد − الفرق) | Guarantees | test_guarantees_page.py / test_guarantee_import.py | ☐ |
| P-602 | «المُبلَّغ» (تقرير المديونيات المجمّع) و«المشتقّ» (الحركات) لا يُجمعان؛ اختلاف الرصيد يُبلَّغ بحدود الهللة | Contractors overview، Import | test_contractor_overview.py | ☐ |
| P-603 | تخصيص الدفعات: مجموع أسطر التخصيص = مبلغ الدفعة؛ متوقف افتراضياً = FIFO القديم حرفياً | SupplierDetail | test_payment_allocation.py | ☐ |
| P-604 | الحذف منطقي في كل مكان (deleted_at)؛ الاسترجاع يعيد التبعيات؛ حذف استيراد يحذف حركاته فقط لا اليدوي | Trash، Import | test_trash.py / test_import_history.py | ☐ |
| P-605 | التصفير يأخذ نسخة before-reset قبل المحو ويُلغى إن فشلت؛ يُبقي app_settings والنسخ | Settings ResetCard | test_reset.py | ☐ |
| P-606 | دمج المشاريع: المعاينة = عدد الصفوف المتأثرة فعلاً؛ لا إعادة تسمية تلقائية | ProjectAdmin | test_project_admin.py | ☐ |
| P-607 | Decimal والتقريب مرة واحدة عند الحد — لا فرق هللة بين شاشتين لنفس الرقم (الأرقام الذهبية) | كل الشاشات | test_golden_numbers.py (جديد) | ☐ |
