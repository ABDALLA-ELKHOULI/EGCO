import { useState } from 'react';
import { Modal } from './Modal';
import { EXPLANATIONS, type ExplainMetric } from '@/lib/explanations';

/**
 * نقطة «؟» صغيرة بجوار أي رقم KPI — تفتح شرحاً حتمياً (بلا ذكاء اصطناعي)
 * لمعنى الرقم وكيفية حسابه من القيم الحقيقية المعروضة فعلاً.
 */
export function ExplainDot({ metric, values }:
  { metric: ExplainMetric | string; values?: Record<string, number | undefined | null> }) {
  const [open, setOpen] = useState(false);
  const def = EXPLANATIONS[metric as ExplainMetric];
  if (!def) return null;

  const { substitution, result } = def.compute(values ?? {});

  return (
    <>
      <button
        type="button"
        className="explain-dot"
        aria-label="اشرح هذا الرقم"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        ؟
      </button>
      {open && (
        <Modal title={def.title} onClose={() => setOpen(false)} maxWidth={440}>
          <div className="explain-body" style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section>
              <b style={{ fontSize: 12, color: 'var(--muted)' }}>ماذا يعني</b>
              <p style={{ margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>{def.meaning}</p>
            </section>
            <section>
              <b style={{ fontSize: 12, color: 'var(--muted)' }}>كيف حُسب</b>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>{def.formula}</p>
              {substitution ? (
                <p className="num" dir="ltr" style={{ unicodeBidi: 'isolate', margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  {substitution}
                  {result != null && ` = ${result}`}
                </p>
              ) : (
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>افتح التقرير لرؤية القيم</p>
              )}
            </section>
            <section>
              <b style={{ fontSize: 12, color: 'var(--muted)' }}>مصدر البيانات</b>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>{def.source}</p>
            </section>
          </div>
        </Modal>
      )}
    </>
  );
}
