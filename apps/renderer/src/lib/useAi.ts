import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * حالة تفعيل مساعد الذكاء الاصطناعي — تُقرأ مرة واحدة عند التحميل.
 * كل عنصر واجهة متعلق بالذكاء الاصطناعي يجب أن يختفي أثناء loading،
 * وأن يُخفى أو يستبدل بتلميح عند enabled=false (راجع مكوّن AiDisabledHint).
 */
export function useAiEnabled(): { enabled: boolean; loading: boolean } {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.aiSettings()
      .then((s) => { if (!cancelled) setEnabled(Boolean(s?.enabled)); })
      .catch(() => { if (!cancelled) setEnabled(false); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { enabled, loading };
}
