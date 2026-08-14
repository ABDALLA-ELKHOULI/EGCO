import { useEffect, type ReactNode } from 'react';

/** نافذة منبثقة عامة — RTL، تُغلق بالنقر خارجها أو بـ Escape. */
export function Modal({ title, children, onClose, maxWidth = 480 }:
  { title: string; children: ReactNode; onClose: () => void; maxWidth?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)', borderRadius: 10, padding: 24,
          width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, margin: 0, flex: 1 }}>{title}</h2>
          <button className="btn" style={{ padding: '4px 10px' }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
