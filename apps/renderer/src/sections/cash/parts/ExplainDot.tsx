/**
 * نقطة «ⓘ» — شرح حتمي بلا ذكاء اصطناعي (P-370): ماذا يعني · كيف حُسب (بالتعويض بالقيم
 * المعروضة فعلاً) · مصدر البيانات. تعريفات lib/explanations.ts القديمة كما هي، وتعريفات
 * النموذج الإضافية هنا (نص فقط، والتعويض يُمرَّر جاهزاً من أرقام الخادم).
 */
import { useState } from 'react';
import { Modal } from '@/ui';
import { EXPLANATIONS } from '@/lib/explanations';

const LOCAL: Record<string, { t: string; m: string; f: string; s: string }> = {
  end: { t: 'الرصيد في نهاية الأفق', m: 'كم سيبقى في البنك في آخر يوم من المدى المختار لو سارت الاستحقاقات والتحصيلات كما هي مسجّلة.', f: 'الرصيد الافتتاحي + الداخل المتوقع − الخارج المجدول', s: 'الرصيد الافتتاحي منك، الخارج من كشوف الموردين ودفاتر المقاولين، الداخل من التحصيلات.' },
  lateOut: { t: 'الخارج المتأخر', m: 'ما فات تاريخ استحقاقه ولم يُدفع بعد للموردين والمقاولين — خارج الرصيد التراكمي.', f: 'مجموع المتبقي من البنود التي تاريخ استحقاقها قبل بداية الأفق', s: 'نفس مصدر «متأخر الآن» في سطر المطابقة.' },
  lateIn: { t: 'الداخل المتأخر', m: 'تحصيلات فات استحقاقها ولم تُحصَّل — لا تدخل المنحنى لأن موعدها مجهول.', f: 'مجموع التحصيلات المفتوحة ذات الاستحقاق قبل اليوم', s: 'شاشة التحصيلات.' },
  gap: { t: 'الفجوة', m: 'هل التحصيل الفعلي يواكب ما تتوقعه؟ سالب = تتوقع أكثر مما حُصِّل.', f: 'المحصّل فعلياً − المتوقع', s: 'البطاقتان المجاورتان.' },
  rIn30: { t: 'خلال ٣٠ يوماً', m: 'ما يُنتظر تحصيله في الشهر القادم.', f: 'مجموع غير المحصّل ذي الاستحقاق من اليوم حتى +٣٠', s: 'جدول التحصيلات.' },
  rMonth: { t: 'محصّل هذا الشهر', m: 'ما دخل فعلاً منذ بداية الشهر الجاري.', f: 'مجموع المحصّل بتاريخ تحصيل في الشهر الجاري', s: 'جدول التحصيلات (تاريخ التحصيل).' },
  rLate: { t: 'متأخر التحصيل', m: 'تحصيلات فات تاريخ استحقاقها.', f: 'مجموع غير المحصّل ذي الاستحقاق قبل اليوم', s: 'جدول التحصيلات.' },
};

export function ExplainDot({ metric, values, subst }: {
  metric: string; values?: Record<string, number | null | undefined>; subst?: string;
}) {
  const [open, setOpen] = useState(false);
  const lib = EXPLANATIONS[metric];
  const loc = LOCAL[metric];
  if (!lib && !loc) return null;
  const r = lib ? lib.compute(values ?? {}) : null;
  const title = lib ? lib.title : loc.t;
  const line = r?.substitution ? r.substitution + (r.result != null ? ` = ${r.result}` : '') : subst;
  return (
    <>
      <button type="button" className="sec-cash-ex" aria-label="اشرح هذا الرقم"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>ⓘ</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="md" actions={[{ label: 'فهمت', kind: 'primary' }]}>
        <div className="sec-cash sec-cash-exb">
          <section><b>ماذا يعني</b><p>{lib ? lib.meaning : loc.m}</p></section>
          <section><b>كيف حُسب</b><p>{lib ? lib.formula : loc.f}</p>
            {line ? <p className="num sec-cash-subst">{line}</p> : <p className="cap">لا قيم كافية للتعويض</p>}
          </section>
          <section><b>مصدر البيانات</b><p>{lib ? lib.source : loc.s}</p></section>
        </div>
      </Modal>
    </>
  );
}
