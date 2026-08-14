import { useState } from 'react';

export interface SupplierFormValues {
  account: string;
  name: string;
  project: string;
  term: string;
}

/** نموذج إضافة/تعديل مورد. */
export function SupplierForm({ initial, onSubmit, busy, error }: {
  initial?: Partial<SupplierFormValues>;
  onSubmit: (values: SupplierFormValues) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const isEdit = Boolean(initial?.account);
  const [account, setAccount] = useState(initial?.account ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [project, setProject] = useState(initial?.project ?? '');
  const [term, setTerm] = useState(initial?.term ?? '');

  const canSubmit = account.trim() && name.trim() && !busy;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ account: account.trim(), name: name.trim(), project: project.trim(), term: term.trim() });
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {error && <div className="callout bad">{error}</div>}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>رقم الحساب</span>
        <input
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          disabled={isEdit}
          required
        />
        {isEdit && <span style={{ fontSize: 11, color: 'var(--muted)' }}>رقم الحساب لا يُعدَّل</span>}
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>اسم المورد</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>المشروع</span>
        <input value={project} onChange={(e) => setProject(e.target.value)} />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>مدة السداد</span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="مثال: ٤٥ يوم · كاش · مستخلص"
        />
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button type="submit" className="btn primary" disabled={!canSubmit}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}
