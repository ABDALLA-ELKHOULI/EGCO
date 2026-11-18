/**
 * Toast — من prototype/ui.js: تكدّس (الأحدث أمام، الأقدم −8px وscale −.04، أقصى ٣ مرئية)،
 * «تراجع»، مؤقت يتوقف عند التمرير، دخول spring وخروج 200ms.
 *
 * الاستعمال من أي مكان (حتى خارج React):
 *   toast('حُفظ المورد');
 *   toast('نُقل إلى سلة المحذوفات', { undo: () => restore(id) });
 *   toast('تعذّر الحفظ: …', { kind: 'error' });
 * <ToastHost/> يُركَّب مرة واحدة في الهيكل.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { digits } from './format';
import { usePrefs } from './prefs';
import { reduced } from './motion';

export type ToastKind = 'ok' | 'info' | 'error';
export interface ToastOptions {
  kind?: ToastKind;
  /** إن وُجد يظهر زر «تراجع» ويُمدَّد المؤقت إلى 6 ثوانٍ. */
  undo?: () => void;
  undoLabel?: string;
  /** بالملّي ثانية — الافتراضي 4000 (6000 مع undo). */
  duration?: number;
}
interface ToastItem extends ToastOptions { id: number; text: string; out: boolean; ms: number }

let items: ToastItem[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => { items = [...items]; subs.forEach((f) => f()); };

function kill(id: number) {
  const t = items.find((x) => x.id === id);
  if (!t || t.out) return;
  t.out = true; emit();
  setTimeout(() => { items = items.filter((x) => x.id !== id); emit(); }, reduced() ? 0 : 200);
}

/** يعرض toast ويعيد { close }. */
export function toast(text: string, opts: ToastOptions = {}): { close: () => void } {
  const id = ++seq;
  const ms = opts.duration || (opts.undo ? 6000 : 4000);
  items = [{ ...opts, id, text, out: false, ms }, ...items].slice(0, 6);
  emit();
  return { close: () => kill(id) };
}

function ToastView({ t, index }: { t: ToastItem; index: number }) {
  const left = useRef(t.ms);
  const t0 = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    timer.current = setTimeout(() => kill(t.id), t.ms);
    return () => clearTimeout(timer.current);
  }, [t.id, t.ms]);
  const pause = () => { clearTimeout(timer.current); left.current -= Date.now() - t0.current; };
  const resume = () => { t0.current = Date.now(); timer.current = setTimeout(() => kill(t.id), Math.max(800, left.current)); };
  const style = t.out ? undefined : {
    transform: index ? `translateY(${-8 * index}px) scale(${1 - 0.04 * index})` : undefined,
    opacity: index > 2 ? 0 : index ? (index === 1 ? 0.9 : 0.75) : 1,
    zIndex: 10 - index,
    pointerEvents: index ? ('none' as const) : undefined,
  };
  return (
    <div className={'toast' + (t.kind === 'info' ? ' info' : t.kind === 'error' ? ' error' : '') + (t.out ? ' out' : '')}
      lang="ar" role={t.kind === 'error' ? 'alert' : 'status'} style={style}
      onMouseEnter={pause} onMouseLeave={resume}>
      <span className="tx">{digits(t.text)}</span>
      {t.undo && (
        <button type="button" className="undo" onClick={() => { try { t.undo?.(); } finally { kill(t.id); } }}>
          {t.undoLabel || 'تراجع'}
        </button>
      )}
      <span className="timer" style={{ animationDuration: t.ms + 'ms' }} />
    </div>
  );
}

export function ToastHost() {
  usePrefs();
  const list = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => items, () => items);
  let i = 0;
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => <ToastView key={t.id} t={t} index={t.out ? 0 : i++} />)}
    </div>
  );
}
