import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { CopyButton } from '@/components/Ai';

/**
 * نافذة «صياغة مطالبة» — تُستخدم في كشف المورد وكشف المقاول.
 * النص مسودة قابلة للتعديل دائماً، ولا يُحفظ تلقائياً في أي مكان.
 */
export function RemindModal({ partyKind, partyKey, onClose }: {
  partyKind: 'supplier' | 'contractor';
  partyKey: string;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try {
      const r = await api.aiRemind({ partyKind, key: partyKey });
      setText(r.message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="صياغة مطالبة" onClose={onClose} maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error && <div className="callout bad">{error}</div>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={busy ? 'جارٍ الصياغة…' : ''}
          disabled={busy}
          rows={8}
          style={{ width: '100%', resize: 'vertical', font: 'inherit', fontSize: 13, padding: 10,
                   border: '1px solid var(--hair)', borderRadius: 'var(--r-control)',
                   background: 'var(--card)', color: 'var(--ink)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button className="btn" onClick={load} disabled={busy}>
            {busy ? 'جارٍ إعادة الصياغة…' : 'إعادة الصياغة'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <CopyButton text={text} />
            <button className="btn" onClick={onClose}>إغلاق</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
