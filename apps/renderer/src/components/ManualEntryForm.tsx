import { useState } from 'react';

export interface ManualEntryValues {
  amount: number;
  date: string;
  due_date?: string;
  description?: string;
  reference?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** نموذج إدخال يدوي — فاتورة أو دفعة. */
export function ManualEntryForm({ mode, initial, onSubmit, busy, error }: {
  mode: 'invoice' | 'payment';
  initial?: Partial<ManualEntryValues>;
  onSubmit: (values: ManualEntryValues) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [date, setDate] = useState(initial?.date ?? today());
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [reference, setReference] = useState(initial?.reference ?? '');

  const amountNum = Number(amount);
  const canSubmit = amount.trim() && amountNum > 0 && date && !busy;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          amount: amountNum,
          date,
          due_date: mode === 'invoice' && dueDate ? dueDate : undefined,
          description: description.trim() || undefined,
          reference: reference.trim() || undefined,
        });
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {error && <div className="callout bad">{error}</div>}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>المبلغ</span>
        <input
          type="number" min="0" step="0.01"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>التاريخ</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>

      {mode === 'invoice' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>تاريخ الاستحقاق</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            يُحسب من مدة المورد إن تُرك فارغاً
          </span>
        </label>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>الوصف</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>رقم مرجعي</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button type="submit" className="btn primary" disabled={!canSubmit}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}
