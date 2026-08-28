# عيّنات لازمة لتشغيل سويّة `services/api/tests` كاملة

هذا الملف يوثّق ما يلزم يدوياً على جهاز جديد كي تعمل كل الاختبارات، بدل أن
يكون القرار (تتبُّعها في git أم لا) ضمنياً يتخذه كل جهاز بصمته الخاصة.

**لا شيء هنا مُتتبَّع في git عمداً** — بعضها بيانات مالية حقيقية لشركة إعمار
الخليج (قرار خصوصية يخص المستخدم وحده)، وبعضها ملفات على جهاز المستخدم فقط.
غيابها **لا يكسر شيئاً محلياً**: الاختبارات المرتبطة بها تُتخطّى (`SKIPPED`)
بأمان. لكن في CI (`CI=true`) نفس الغياب يصبح **فشلاً صريحاً** يسمّي الملف
الناقص — راجع `services/api/tests/conftest.py::sample_missing/require_sample`
لآلية ذلك، ومسوَّغه في `docs/feedback/BACKLOG.md` بند م-١٤.

## الفئة ١ — `design/samples/` (كشوف حقيقية مُعمّاة الاسم فقط)

يُفترض وجودها في `design/samples/` بجذر المستودع (خارج `services/api`).
هذا المجلد **للقراءة فقط ولا يُنقل ولا يُحذف أبداً** — ملفات المستخدم الحقيقية.

ملفات مطلوبة (أهمها):
- `guarantee-alquds.pdf`, `contractor-diyar-alwadi.pdf`, `contractor-harmony.pdf`,
  `contractor-maysan.pdf`, `contractor-zawaya.pdf`, `contractor-holol-afaq.pdf`
- `suppliers-terms.xlsx`, `budget-deviation-2026-07.xlsx`
- `statement-qanbar.pdf`, `statement-injaz-alsuddan.pdf`
- `statement-glued-kahrabaiya.pdf`, `statement-glued-sami-muhandiya.pdf`,
  `statement-glued-lamsa.pdf`
- مجلد `statements-batch/` (دفتر كشوف كامل — أكبر وأخصّ من البقية)

## الفئة ٢ — مسارات مطلقة خارج المستودع (على جهاز المطوّر فقط)

هذه **لن توجد على أي جهاز CI إطلاقاً**، ولا حتى إن نُقل `design/samples`:

- `~/Downloads/شركة تداين للخرسانة اليرموك.pdf` — `test_unknown_supplier_flow.py`
- `~/Downloads/تقرير مديونيات المقاولين والموردين للمشاريع حتى 07-13.xls` —
  `test_debts_report_xls.py`, `test_packaged_imports.py`
- `~/Downloads/كشف المقاولين 25-8.xls` — `test_contractors_balance_xls.py`
- `/Users/abdallaalkhouli/Desktop/Anchor/EGCO/report4.html` — `test_receivables.py`

## القرار المتخذ (م-١٤)

لا توليد عيّنات مُعمّاة الآن — حُكم عليه بأنه عمل يوم–يومين لكل تخطيط PDF
وينتج حراسة أضعف مما توحي به الخضرة (يتحقق من اتساقه الذاتي لا من مطابقة
مطبوع خارجي). ولا تتبُّع الملفات الحقيقية في git — قرار خصوصية يخص المستخدم.

بدلاً من ذلك: **الغياب يبقى تخطّياً محلياً، ويصبح فشلاً صريحاً في CI فقط**
(عبر `CI=true`)، فلا يعلن البناء نجاحاً لسويّة لم يُشغّلها فعلاً. من أراد
تشغيل السويّة كاملة على جهاز جديد يضع الملفات أعلاه يدوياً في مكانها.
