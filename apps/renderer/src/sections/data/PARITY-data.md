# PARITY-data — قسم «البيانات» (S6)

كل بند في `docs/next/PARITY.md` موطنه `data` (أو مشترك يخصّنا) ← مكانه الجديد.
الحالة: ☐ لم يُبنَ · 🔨 بُني (المرحلة B، `tsc --strict` نظيف) ولم يُتحقَّق منه على بيانات حقيقية/متصفح بعد · ✅ تحقّق · ⛔ محجوب بخادم/جسر.
المكوّنات المذكورة تُبنى في المرحلة B بعد `FRONTEND-CONTRACT.md`؛ الهوكات موجودة الآن وتمرّ بـ `tsc --strict`.

## المسارات (٥ تبويبات)
| الموطن الجديد | يستبدل | ملاحظات |
|---|---|---|
| `/data/import` ← `import/ImportView` | `pages/Import.tsx` | `/import` تحويل |
| `/data/coverage` ← `coverage/CoverageView` | `pages/Coverage.tsx` | `/coverage` تحويل |
| `/data/backups` ← `backups/BackupsView` | بطاقة BackupCard في Settings.tsx | تبويب مستقل (النموذج) |
| `/data/trash` ← `trash/TrashView` | `pages/Trash.tsx` | `/settings/trash` تحويل |
| `/data/settings` ← `settings/SettingsView` | `pages/Settings.tsx` | `/settings` تحويل |
تعريفها في `index.ts › DATA_ROUTES` (P-016، P-017). التسجيل في الهيكل = وكيل F.

## مبدأ الرفع العام (طلب المنسّق)
لا قائمة أنواع ملفات في الواجهة. `lib/preview.ts › summarize()` يعرض أي حقل موجود في الاستجابة
(`detected`، الطرف، `reconciled`+أرصدة، الأعداد، `rowCounts/newVsKnown`، `needsClassification`،
`nearDuplicates`، `parseIssues`، `reconcileWarnings`). الحالة تُشتق من الاستجابة:
معاينة 400 = «جاهز، يُحفظ مباشرة» · بوابة رصيد إن وُجدت · وإلا «عُوين». `source:'unsupported'` يظهر صراحة.
→ أي قارئ جديد يعيد نفس الحقول يعمل بلا تعديل في الواجهة.

## الرفع — `import/*` + `hooks/useImportSession.ts`، `hooks/useImportHistory.ts`
| P | v0.13 | الموطن الجديد | حالة |
|---|---|---|---|
| P-263 | Import.tsx:565-570 ترويسة + «اختيار من جديد» | ImportView ترويسة · `session.reset` | 🔨 |
| P-264 | :577-593 ملفات/مجلد/منطقة إسقاط | DropZone · `pickFiles`/`pickFolder` | 🔨 |
| P-265 | :448-460 «داخل التطبيق فقط» + خطأ النافذة | `session.pickErr` | 🔨 |
| P-266 | :67-75 كشف النوع بتسمية عربية | من `PickedFile.source` + `detected` من الخادم (بلا جدول LABEL ثابت) | 🔨 |
| P-267 | :469-481 ترتيب الطابور، لا إسقاط صامت (م-٢١) | `addFiles` يُبقي الكل · `saveOrder()` بلا-معاينة أولاً | 🔨 |
| P-268 | :484-501 معاينة تسلسلية | `previewOne` تسلسلياً | 🔨 |
| P-269 | :995-1014 ١٣ حالة | `QueueStatus` + `QUEUE_CHIP` | 🔨 |
| P-270 | :895-915 معاينة كشف (اسم، «حساب جديد»، أرصدة، الفرق) | FileCard ← `summarize().balance/partyName/isNewParty` | 🔨 |
| P-271 | :1026-1088 تقرير مجمّع: بطاقات/جديد/معروف + تصنيف + ملاحظات | FileCard ← `byKind` · UnknownAccountsPanel · `parseIssues` | 🔨 |
| P-272 | :504-557 حفظ واحد، استبعاد غير المطابق | `saveAll` (أُصلح: يقرأ ref لا لقطة قديمة) | 🔨 |
| **P-273** | :533-541 «مورد غير معروف» ≠ «تم» | `statusAfterCommit` | 🔨 |
| **P-274** | :1134-1222 لوحة «حساب جديد» (اسم/مشروع مخمَّن/مدة إلزامية) | NewPartyPanel · `confirmNewParty`/`declineNewParty` · `guessProjectFromHeader` | 🔨 |
| P-275 | :960-970,1097-1111 بعد التقرير المجمّع + فرق الرصيد البارز | FileCard · BalanceMismatchPanel ← `reconcileWarnings` | 🔨 |
| P-276 | :972-988 بعد الكشف/الموردين + «أُنشئ تلقائياً — مدة غير محدّدة» | FileCard ← `counts`, `autoCreatedParty`, `needsTerm` | 🔨 |
| P-277 | :178-209 تكرار محتمل (معلوماتي) | NearDuplicateNotice ← `nearDuplicates` + `ND_SCOPE/ND_LEDGER` | 🔨 |
| P-278 | :923-928 صيغة غير مدعومة | FileCard حالة `unsupported` | 🔨 |
| P-279 | :930-939 خطأ قراءة + إنقاذ AI | FileCard → AiRescueModal (`useAiEnabled`) | 🔨 |
| P-280 | :125-147 لافتة الدفعة (أخضر فقط إن حُفظ الكل) | BatchSummaryBanner · `isBatchSaved` | 🔨 |
| P-281 | :751-757 عرض الموردين / لوحة اليوم / رفع أخرى | ConfirmBar بعد الحفظ + «ماذا تغيّر» (النموذج) | 🔨 |
| P-282 | :303-328 فحص المجلد + المتجاهَل | BatchScanCard · `scan` | 🔨 |
| P-283 | :330-343 «رفع الكل (N)» | `uploadBatch` | 🔨 |
| P-284 | :627-711 جدول نتيجة الدفعة + تكرار فوقه | BatchResultTable · `BATCH_CHIP` | 🔨 |
| P-285 | :681-686 AI لصفوف read_error/no_account | BatchResultTable → AiRescueModal | 🔨 |
| P-286 | :687-696 تصنيف ثم إعادة استيراد الملف وحده | ClassifyModal → `reimportBatchRow` | 🔨 |
| P-287 | :697-703 «إنشاء المورد…» لصف دفعة | `loadBatchNewParty` → NewPartyPanel → `confirmBatchNewParty` | 🔨 |
| **P-288** | :810-868 تصنيف إجباري لغير ٢١١/٢١٢/٢١٦ + اقتراح AI «القرار لك» | ClassifyModal · `useClassify` · `CLASS_ORDER` | 🔨 |
| P-289 | :363-373 إعادة معاينة الصف بعد التصنيف | `previewOne(i)` | 🔨 |
| P-290 | :1276-1393 سجل قابل للطي، `egco.import.historyOpen` (P-541) | HistoryTable · `useImportHistory(_, enabled=open)` · uiPref | 🔨 |
| P-291 | :1295-1332 تصفية/ترتيب على الخادم debounce+seq | `useImportHistory` (useAsync debounce 200 + seq) | 🔨 |
| P-292 | :1435-1465 الأعمدة + رابط الطرف حسب ٢١١/٢١٢ | HistoryTable | 🔨 |
| P-293 | :1250 شارة «فشل» | `isImportFailed` | 🔨 |
| P-294 | :1486 «قديم» / «بلا اسم ملف» | HistoryTable | 🔨 |
| P-295 | :1494-1530 حذف حركات الملف، معطّل إن canDelete=false | `deleteImportRow(row,false)` + Modal | 🔨 |
| **P-296** | :1532-1547 حذف تقريبي للقديم بتأكيد ثانٍ | `deleteImportRow` → `needs-force` → Modal ثانٍ | 🔨 |
| P-297 | :1425-1430 «حُذف N حركة … تحدّثت أرصدة» | toast بعد الحذف | 🔨 |
| P-298 | :1401-1415 حالتا فراغ | HistoryTable EmptyState | 🔨 |
| **P-299** | :1564-1643 التكرارات القائمة + حذف صف + «يُسترجع من المحذوفات» | DuplicatesCard · `useDuplicates` | 🔨 |
| P-371 | AiRescueModal.tsx:20-229 استخراج ← تعديل ← مقاول موجود/جديد ← حفظ | `import/AiRescueModal` · `dataApi.aiExtract/aiCommitExtract/contractors` | 🔨 |
| P-417/418/419/422 | /import/preview · /import · /scan · /batch | `dataApi.preview/commit/scanDir/batch` | 🔨 |
| P-423..426 | /import/classify GET/PUT/DELETE + suggest | `dataApi.classifications/classify/unclassify/suggestClass` | 🔨 |
| P-427 | /import/near-duplicates — بلا مستدعٍ | يبقى بلا مستدعٍ (التحذير يصل في preview/import) | — |
| P-428/429 | /import/duplicates · /delete | `dataApi.duplicates/deleteDuplicate` | 🔨 |
| P-430/431 | /import/history (بمعاملات) · DELETE | `dataApi.history/deleteImport` | 🔨 |
| P-480/482 | /ai/extract · /ai/commit-extract | `dataApi.aiExtract/aiCommitExtract` | 🔨 |

### v0.13.1 — الكشف المجمّع (ملف واحد بمئات الحسابات)
| المصدر | القدرة | الموطن الجديد | حالة |
|---|---|---|---|
| Import.tsx (v0.13.1):496-502 | «جاهز» متى طابق حساب واحد على الأقل (counts.reconciled>0) — لا يُقصى الملف كله | `statusAfterPreview` (عام: أي استجابة فيها `accounts`+`counts`) | 🔨 |
| :539-546 | `saved` عددٌ لا منطقي؛ صفر = «لم يُحفظ أي حساب» لا «تم» | `statusAfterCommit` | 🔨 |
| :1045-1108 BundleSummary | الحسابات/الصفحات · شارات الحالات · «الحسابات التي لن تُحفظ (N)»: الحساب·الاسم·السبب·الفرق | `import/parts › BundleSummary` (+ توزيع `kinds`، + زر «تصنيف…» لـneeds_classification — جديد) | 🔨 |
| import_service batch (bundle row) | صف دفعة «كشف مجمّع (N حساباً)» + مشاكله | `Batch.tsx` — ملخص المشاكل خارج الجدول | 🔨 |
| whatsNew 0.13.1 | الجولة | يظهر تلقائياً؛ مرتّب بالإصدار | 🔨 |

## التغطية — `coverage/*` + `hooks/useCoverage.ts`
| P | v0.13 | الموطن الجديد | حالة |
|---|---|---|---|
| P-245 | Coverage.tsx:50 stale_days=90 | `useCoverage(90)` | 🔨 |
| P-246 | :123 «حتى {asOf}» | ترويسة CoverageView | 🔨 |
| P-247 | :128-141 ثلاثة KPIs | CoverageKpis ← `totals` | 🔨 |
| P-248 | :143 إفصاح «اللوحة مبنية على من رُفعت كشوفاتهم فقط» | callout | 🔨 |
| P-249 | :150 عدّاد + مسح التصفية | `rows.length` · `clear` | 🔨 |
| P-250 | :164-193 ٩ أعمدة بفرز وتصفية | `useCoverage` filters/sort (محلي على القائمة الكاملة — لا صفحات) | 🔨 |
| P-251 | :197-212 تلوين الصف + رابط المورد | CoverageTable | 🔨 |
| P-252 | :155 لا نتائج | EmptyState | 🔨 |
| P-439 | /coverage (q/project/state غير مستعملة) | `dataApi.coverage` | 🔨 |
| جديد (نموذج) | «اطلب كشفاً» نص قابل للنسخ | AskStatementModal (نص فقط، لا إرسال) | 🔨 |
| جديد (نموذج) | تضمين المقاولين في التغطية | **⛔ يحتاج الخادم** — /coverage يعيد موردين فقط؛ لن نخترع صفوفاً | ⛔ |

## النسخ الاحتياطي — `backups/*` + `hooks/useBackups.ts`
| P | v0.13 | الموطن الجديد | حالة |
|---|---|---|---|
| P-333 | Settings.tsx:192-215 يومية عند الفتح + تحذير المجلد الخارجي | `useBackups` (daily-if-due ثم القائمة) — **انتبه:** كانت تُطلب عند فتح الإعدادات؛ الآن عند فتح تبويب النسخ. يُقترح أن يستدعيها الهيكل عند الإقلاع (قرار F) | 🔨 |
| P-334 | :224-230 «نسخة الآن» | `backupNow` | 🔨 |
| P-335 | :268 فتح المجلد | `revealDir` | 🔨 |
| P-336 | :271-275 «آخر نسخة يومية: قبل…» | `lastDaily` + `ago()` من ui/format | 🔨 |
| P-337 | :278-287 مجلد خارجي اختيار/إزالة | `pickExternal`/`clearExternal` | 🔨 |
| P-338 | :297-327 الجدول (تاريخ/نوع/حجم) | BackupsTable · `backupKindLabel` (**+ before-reset «قبل التصفير»** — خلل v0.13) · `fmtSize` | 🔨 |
| P-339 | :232-237 استعادة عبر IPC | `restore` + RestoreConfirm | 🔨 |
| P-340 | :239-243 حذف بتأكيد | `remove` + DeleteConfirm (Modal بدل window.confirm) | 🔨 |
| P-502..507 | /backups* | `dataApi.backups…` | 🔨 |
| P-517/522/528 | تصدير متّسق · استعادة آمنة · before-update | desktop (D) — الواجهة تستدعي الجسر فقط | — |
| P-544/549 | backup_external_dir · سقوف الاحتفاظ | خادم؛ نعرض النتيجة | — |

## المحذوفات — `trash/*` + `hooks/useTrash.ts`
| P | v0.13 | الموطن الجديد | حالة |
|---|---|---|---|
| P-352 | Trash.tsx:89-96 تصفية بالنوع | TrashTabs (مع عدّاد لكل نوع — النموذج) · `kind/counts` | 🔨 |
| P-353 | :104-141 الجدول + summary | TrashTable · `trashSummary` · `TRASH_KIND` | 🔨 |
| P-354 | :54-64 استرجاع مع التبعيات | `restore` | 🔨 |
| P-355 | :66-77 حذف نهائي بتأكيد | `purge` + PurgeConfirm | 🔨 |
| P-356 | :100 «السلّة فارغة» | EmptyState | 🔨 |
| P-357 | :86 «رجوع للإعدادات» | يُستغنى عنه: المحذوفات تبويب شقيق في نفس القسم | — |
| P-496..498 | /trash* | `dataApi.trash…` | 🔨 |
| جديد (نموذج) | بحث نصي | `search` (normAr) | 🔨 |
| جديد (نموذج) | «إفراغ السلّة» | **⛔ لا مسار خادم** — مؤجَّل | ⛔ |

## الإعدادات — `settings/*` + `hooks/useSettings.ts`
| P | v0.13 | الموطن الجديد | حالة |
|---|---|---|---|
| P-331 | Settings.tsx:39 «محلية فقط» | ترويسة | 🔨 |
| P-332 | :45-55 مكان القاعدة/المجلد/النظام + فتح | DataLocationCard · `useAppInfo` | 🔨 |
| P-341 | :59-102 تصدير/استيراد ملف بيانات | TransferCard · `useDataTransfer` | 🔨 |
| P-342 | :104-108 الافتراضات (عرض) | DefaultsCard (قراءة فقط — النموذج يحرّر مدة السداد/رصيد البنك: **⛔ لا مسار خادم**، يُعرض كما هو) | 🔨 (التحرير ⛔) |
| P-343 | تبديل الوضع | shell (F) — AppearanceCard يستدعي `ui/prefs` فقط | — |
| P-344 | :117-129 روابط المحذوفات/دمج المشاريع | AboutCard روابط: تبويب المحذوفات · `/projects/merge` (ملك قسم المشاريع — انظر المعلّقات) | 🔨 |
| P-345 | :434-539 المساعد الذكي (مفتاح مقنّع «•••»، حفظ، اختبار=حفظ+اختبار، maxTokens≥100) | AiCard · `useAiSettings` | 🔨 |
| P-346 | :544-577 الأنماط المتعلَّمة | AiCard › LearnedLayouts · `layouts` | 🔨 |
| P-347 | :585-643 تصنيفات الحسابات + حذف | ClassificationsCard · `useClassifications` (+تغيير مباشر — النموذج) | 🔨 |
| **P-348** | :656-774 تصفير البيانات (أعداد، ما يبقى، العبارة من الخادم، نسخة قبل، اسمها، إعادة تحميل ٢.٥ث، «فارغ أصلاً») | DangerZone › WipeModal · `useWipe` | 🔨 |
| P-349 | :137-157 عن التطبيق + «ما الجديد في هذا الإصدار» | AboutCard · `latestTour(version)` (**مرتّب بالإصدار** — خلل v0.13 يعرض 0.11.1) | 🔨 |
| P-350 | :341-432 التحديثات وكل الحالات + تثبيت | UpdatesCard · `useUpdates` | 🔨 |
| P-351 | رسائل «داخل التطبيق فقط» | `NOT_IN_APP` · `inApp()` | 🔨 |
| P-081/P-543 | تخصيص الدفعات — **ref → parties** (المالك قسم الأطراف، A-006) | مرآة في DefaultsCard عبر `usePaymentAllocation` تستدعي نفس المسار GET/PUT `/suppliers/settings/payment-allocation` — لا إعداد ثانٍ | ref → parties |
| P-481 | GET /ai/learned-layouts | `dataApi.aiLearnedLayouts` ← `useAiSettings().layouts` ← AiCard › «أنماط الملفات المتعلَّمة» | 🔨 |
| P-582 | تصدير DB `EGCO-data-YYYY-MM-DD.db` (data:export، نسخة متّسقة) | TransferBlock «تصدير نسخة من البيانات» ← `useDataTransfer().exportData` ← `window.egco.exportData()` (الحوار والنسخة المتّسقة في desktop، P-517) | 🔨 |
| P-477..479/481 | /ai/settings · test · learned-layouts | `dataApi.ai*` | 🔨 |
| P-508/509 | /reset/preview · /reset | `dataApi.resetPreview/resetAll` | 🔨 |
| P-545/547/548 | ai-settings.json · account_classifications · layouts | عبر المسارات أعلاه | — |
| P-605 | التصفير يأخذ before-reset ويُلغى إن فشل | خادم — نعرض `done.backup` | 🔨 |
| جديد (نموذج) | الأرقام ١٢٣/١٢٣، إشعارات النظام، جزيرة الحالة | AppearanceCard/AlertsCard ← `ui/prefs` (F) | 🔨 |

## «ما الجديد» — `whatsnew/WhatsNewTour.tsx` + `lib/tours.ts`
| P | v0.13 | الموطن الجديد | حالة |
|---|---|---|---|
| P-383 | WhatsNewModal.tsx خطوة بخطوة >٣، N/M، «تجدها في»، «فهمت» | WhatsNewTour (يُصدَّر للهيكل) | 🔨 |
| P-384 | lib/whatsNew.ts المحتوى + toursSince | المحتوى يبقى في lib (F)؛ الترتيب في `toursBetween/latestTour` **بالإصدار** | 🔨 |
| P-005/P-538 | العرض التلقائي بعد التحديث (shell) | الهيكل يستدعي `toursBetween(lastSeen, version)` بدل `toursSince` | — |

## بنود مشتركة لا نملكها (للتنسيق)
- P-358..361، P-499..501 «المشاريع والدمج» (data/projects): النموذج يضعها في view `merge`. **أقترح أن يملكها قسم المشاريع**؛ نحن نربط إليها فقط.
- P-133، P-564 اختلافات الرصيد (parties/data) — قسم الأطراف.
- P-192، P-475 رفع الموازنة (projects/data) — قسم المشاريع (يمرّ بـ /budget/import لا بشاشتنا).
