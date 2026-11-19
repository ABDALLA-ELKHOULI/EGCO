/**
 * جلب بسيط بحالة {data, error, loading, reload} — بديل مؤقت حتى ينشر وكيل الأساس
 * TanStack Query وعقد FRONTEND-CONTRACT.md. واجهته مطابقة عمداً لشكل useQuery
 * ({data, error, isLoading, refetch}) كي يكون الاستبدال سطراً في كل hook لا إعادة كتابة.
 *
 * الاستجابة المتأخرة لطلب سابق تُهمل (seq) — وإلا تكتب تصفيةٌ قديمة فوق أحدث.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from '../api';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  isLoading: boolean;
  refetch: () => void;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
  opts: { enabled?: boolean; debounceMs?: number } = {},
): AsyncState<T> {
  const { enabled = true, debounceMs = 0 } = opts;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      fnRef.current().then(
        (d) => { if (my === seq.current) { setData(d); setError(null); } },
        (e: unknown) => { if (my === seq.current) setError(errMsg(e)); },
      ).finally(() => { if (my === seq.current) setLoading(false); });
    }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, ...deps]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, isLoading, refetch };
}

/** فعلٌ واحد بحالة «جارٍ» ورسالة نتيجة — للأزرار. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<void | { ok: boolean; text: string }>) => {
    setBusy(key); setNote(null);
    try {
      const r = await fn();
      if (r) setNote(r);
    } catch (e) {
      setNote({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, note, setNote, run };
}

export const inApp = () => typeof window !== 'undefined' && !!window.egco;
