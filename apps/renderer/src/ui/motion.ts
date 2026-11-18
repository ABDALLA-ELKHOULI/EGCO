/**
 * أدوات الحركة — العدّاد (count-up) وتقليل الحركة. منقولة من prototype/ui.js («حركة»).
 * قاعدة المنتج: الأرقام المالية لا ترتد (ease-out تكعيبي، بلا spring)، والعدّاد يحدث مرة
 * واحدة لكل رقم في الجلسة (عند أول ظهور)، ثم من القيمة القديمة إلى الجديدة عند التغيّر فقط.
 */
import { useEffect, useRef, useState } from 'react';

export const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** مفاتيح العدّادات التي عُرضت في هذه الجلسة — العودة لصفحة = ظهور فوري بلا عدّ. */
const seen = new Set<string>();

/**
 * يعيد القيمة المعروضة لحظياً أثناء العدّ. `key` اختياري: إن وُجد ورُئي سابقاً في الجلسة
 * لا يُعدّ من الصفر. null يبقى null.
 */
export function useCountUp(value: number | null | undefined, key?: string, dur = 700): number | null {
  const target = value == null || !Number.isFinite(value) ? null : value;
  const first = useRef(true);
  const prev = useRef<number | null>(null);
  const [shown, setShown] = useState<number | null>(() => {
    if (target == null) return null;
    if (reduced() || (key && seen.has(key))) return target;
    return 0;
  });
  useEffect(() => {
    if (target == null) { setShown(null); prev.current = null; return; }
    const from = first.current ? (key && seen.has(key) ? target : 0) : (prev.current ?? target);
    first.current = false;
    prev.current = target;
    if (key) seen.add(key);
    if (reduced() || from === target) { setShown(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      setShown(from + (target - from) * ease(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, key, dur]);
  return shown;
}

/** يعيد تشغيل حركة CSS على عنصر (مثل m-shake) — إزالة الفئة ثم إعادتها بعد reflow. */
export function replayClass(el: Element | null, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}
