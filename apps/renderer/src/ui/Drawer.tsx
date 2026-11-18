/**
 * Drawer — درج من اليسار (الشريط الجانبي يمين) بنمط درج الإشعارات في النموذج:
 * غطاء ضبابي، دخول 320 وخروج 240، Esc، فخ تركيز، قفل تمرير.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { lockScroll, popLayer, pushLayer, trapTab, type Layer } from './overlay';
import { reduced } from './motion';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  actions?: ReactNode;
  /** شريط ثابت بين الرأس والقائمة (تبويبات، تصفية). */
  sub?: ReactNode;
  width?: number;
  children?: ReactNode;
  className?: string;
}

export function Drawer(p: DrawerProps) {
  const [mounted, setMounted] = useState(p.open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (p.open) { setMounted(true); setLeaving(false); return; }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => { setMounted(false); setLeaving(false); }, reduced() ? 0 : 240);
    return () => clearTimeout(t);
  }, [p.open, mounted]);
  if (!mounted) return null;
  return createPortal(<DrawerInner {...p} leaving={leaving} />, document.body);
}

function DrawerInner(p: DrawerProps & { leaving: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const tid = useId();
  const onClose = useRef(p.onClose); onClose.current = p.onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const layer: Layer = {
      kind: 'drawer',
      key: (e) => {
        if (e.key === 'Escape') { e.preventDefault(); onClose.current(); }
        else if (e.key === 'Tab' && ref.current) trapTab(e, ref.current);
      },
    };
    pushLayer(layer); lockScroll(true);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button,[tabindex="0"]')?.focus());
    return () => { popLayer(layer); lockScroll(false); if (prev && document.body.contains(prev)) prev.focus(); };
  }, []);
  return (
    <>
      <div className={'scrim' + (p.leaving ? ' out' : '')} onClick={() => p.onClose()} />
      <aside ref={ref} className={'drawer' + (p.leaving ? ' out' : '') + (p.className ? ' ' + p.className : '')}
        role="dialog" aria-modal="true" aria-labelledby={tid} lang="ar" dir="rtl"
        style={p.width ? { width: `min(${p.width}px, calc(100vw - 16px))` } : undefined}>
        <div className="dh">
          <h2 id={tid}>{p.title}</h2>
          <div className="dh-acts">
            {p.actions}
            <button type="button" className="m-x" aria-label="إغلاق" onClick={() => p.onClose()}><Icon name="close" size={18} stroke={2} /></button>
          </div>
        </div>
        {p.sub}
        <div className="dlist d-body">{p.children}</div>
      </aside>
    </>
  );
}
