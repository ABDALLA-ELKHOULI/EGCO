import { useState, useEffect } from 'react';

/**
 * شريط اختيار الفترة — من تاريخ / إلى تاريخ + زر تطبيق. RTL، بدون توجيه.
 */
export function PeriodBar({ from, to, onChange }:
  { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  useEffect(() => { setF(from); }, [from]);
  useEffect(() => { setT(to); }, [to]);

  return (
    <div className="toolbar no-print" style={{ marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
        من تاريخ
        <input type="date" value={f} onChange={(e) => setF(e.target.value)} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
        إلى تاريخ
        <input type="date" value={t} onChange={(e) => setT(e.target.value)} />
      </label>
      <button className="btn primary" onClick={() => onChange(f, t)}>تطبيق</button>
    </div>
  );
}
