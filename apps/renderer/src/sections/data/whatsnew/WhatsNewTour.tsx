/**
 * جولة «ما الجديد» (P-383) — تجمع إصدارات فائتة، خطوة بخطوة إن زادت العناصر عن ٣
 * (السابق/التالي، N/M)، «تجدها في: …». الترتيب بالإصدار (lib/tours.ts) لا بموضع المدخل.
 * يُصدَّر للهيكل كي يعرضه تلقائياً بعد التحديث (toursBetween)، ويُفتح من الإعدادات.
 */
import { useMemo, useState } from 'react';
import { Modal, Pill, usePrefs } from '@/ui';
import type { TourItem, VersionTour } from '@/lib/whatsNew';
import { cmpVersion } from '../lib/tours';
import '../data.css';

export function WhatsNewTour({ tours, onClose }: { tours: VersionTour[]; onClose: () => void }) {
  usePrefs();
  const ordered = useMemo(() => [...tours].sort((a, b) => cmpVersion(a.version, b.version)), [tours]);
  const items = useMemo(() => ordered.flatMap((t) => t.items.map((it) => ({ ...it, version: t.version }))), [ordered]);
  const [step, setStep] = useState(0);
  if (!items.length) return null;
  const stepped = items.length > 3;
  const latest = ordered[ordered.length - 1].version;
  const visible: (TourItem & { version: string })[] = stepped ? [items[step]] : items;
  const isLast = !stepped || step === items.length - 1;

  return (
    <Modal open onClose={onClose} title={`ما الجديد في الإصدار ${latest}`} size="md"
      actions={[
        ...(stepped && step > 0 ? [{ label: 'السابق', onClick: () => setStep((s) => s - 1) }] : []),
        isLast ? { label: 'فهمت، أغلق', kind: 'primary' as const, onClick: (c: (f?: boolean) => void) => c(true) }
          : { label: 'التالي', kind: 'primary' as const, onClick: () => setStep((s) => s + 1) },
      ]}>
      <div className="sec-data">
        {stepped && <p className="cap" aria-live="polite"><span className="num">{step + 1}</span> / <span className="num">{items.length}</span></p>}
        {visible.map((it, i) => (
          <div key={i} className="tour-item">
            <b>{it.title}</b>{ordered.length > 1 && <> <Pill>الإصدار {it.version}</Pill></>}
            <p>{it.description}</p>
            {it.where && <Pill tone="neutral">تجدها في: {it.where}</Pill>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
