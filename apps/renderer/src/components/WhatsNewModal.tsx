import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import type { TourItem, VersionTour } from '@/lib/whatsNew';

/**
 * جولة «ما الجديد» — تُبنى من واحدة أو أكثر من VersionTour (قد تكون إصدارات
 * مُجمَّعة إن فاتت المستخدم عدة تحديثات). تُعرض خطوة بخطوة إن كانت الميزات أكثر
 * من ٣-٤، بدل كتلة نصّ طويلة واحدة يصعب استيعابها.
 */
export function WhatsNewModal({ tours, onClose }: { tours: VersionTour[]; onClose: () => void }) {
  const items = useMemo(
    () => tours.flatMap((t) => t.items.map((it) => ({ ...it, _version: t.version }))),
    [tours],
  );
  const [step, setStep] = useState(0);
  const stepped = items.length > 3;
  const latestVersion = tours[tours.length - 1]?.version ?? '';

  if (items.length === 0) return null; // احتياط — لا يُستدعى هذا المكوّن أصلاً بلا عناصر

  const visible: (TourItem & { _version: string })[] = stepped ? [items[step]] : items;
  const isLast = !stepped || step === items.length - 1;
  const isFirst = step === 0;

  return (
    <Modal title={`ما الجديد في الإصدار ${latestVersion}`} onClose={onClose} maxWidth={560}>
      <div className="stack">
        {visible.map((item, i) => (
          <div key={i} className="callout note" style={{ display: 'grid', gap: 6 }}>
            <b style={{ fontSize: 15 }}>{item.title}</b>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
              {item.description}
            </p>
            {item.where && (
              <span className="pill" style={{ justifySelf: 'start' }}>
                تجدها في: {item.where}
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
        {stepped && (
          <span className="muted" style={{ fontSize: 12 }}>
            {step + 1} / {items.length}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, marginInlineStart: 'auto' }}>
          {stepped && !isFirst && (
            <button className="btn" onClick={() => setStep((s) => s - 1)}>السابق</button>
          )}
          {stepped && !isLast && (
            <button className="btn primary" onClick={() => setStep((s) => s + 1)}>التالي</button>
          )}
          {isLast && (
            <button className="btn primary" onClick={onClose}>فهمت، أغلق</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
