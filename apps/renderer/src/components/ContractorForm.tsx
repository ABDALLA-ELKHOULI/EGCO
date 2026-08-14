import { useState, type FormEvent } from 'react';
import type { ContractorBody } from '@/lib/api';

export type ContractorFormValues = ContractorBody;

interface Initial {
  code?: string; name?: string; phone?: string; notes?: string;
  defaultRetentionRate?: number | null; defaultGuaranteeDays?: number | null;
}

/** نموذج مقاول — إضافة وتعديل (الرمز يُقفل عند التعديل). */
export function ContractorForm({ initial, codeLocked = false, onSubmit, busy, error }: {
  initial?: Initial;
  codeLocked?: boolean;
  onSubmit: (v: ContractorFormValues) => void;
  busy: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [retention, setRetention] = useState(
    initial?.defaultRetentionRate != null ? String(initial.defaultRetentionRate) : '');
  const [days, setDays] = useState(
    initial?.defaultGuaranteeDays != null ? String(initial.defaultGuaranteeDays) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    const v: ContractorFormValues = { code: code.trim(), name: name.trim() };
    if (phone.trim()) v.phone = phone.trim();
    if (notes.trim()) v.notes = notes.trim();
    if (retention !== '') v.defaultRetentionRate = Number(retention);
    if (days !== '') v.defaultGuaranteeDays = Number(days);
    onSubmit(v);
  }

  const field = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 13 };

  return (
    <form onSubmit={submit} className="form-stack">
      <label style={field}>
        الرمز
        <input value={code} onChange={(e) => setCode(e.target.value)} required disabled={codeLocked} />
      </label>
      <label style={field}>
        الاسم
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label style={field}>
        الهاتف
        <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
      </label>
      <div className="field-grid">
        <label style={field}>
          نسبة الضمان الافتراضية ٪
          <input type="number" step="0.1" min="0" max="100" value={retention}
                 onChange={(e) => setRetention(e.target.value)} dir="ltr" />
        </label>
        <label style={field}>
          مدة الضمان الافتراضية (يوم)
          <input type="number" min="0" value={days}
                 onChange={(e) => setDays(e.target.value)} dir="ltr" />
        </label>
      </div>
      <label style={field}>
        ملاحظات
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <div className="callout bad">{error}</div>}
      <div className="modal-foot">
        <button className="btn primary" type="submit" disabled={busy || !code.trim() || !name.trim()}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}
