import { useEffect, useRef, type ReactNode } from 'react';

/** نافذة منبثقة عامة — RTL، تُغلق بالنقر خارجها أو بـ Escape. */
export function Modal({ title, children, onClose, maxWidth = 480 }:
  { title: string; children: ReactNode; onClose: () => void; maxWidth?: number }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // التركيز ينتقل إلى النافذة عند فتحها — وإلا بقي على الزر خلفها فتاه لوحة المفاتيح.
  // Focus moves into the dialog on open; otherwise it stays on the button behind it.
  useEffect(() => {
    const first = boxRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), textarea, select, button');
    first?.focus();
  }, []);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        ref={boxRef}
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn sm" aria-label="إغلاق" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
