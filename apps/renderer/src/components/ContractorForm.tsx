import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ContractorBody } from '@/lib/api';

/** تطبيع عربي محلي للمقارنة فقط — نسخة مطابقة لِـ SupplierForm.tsx، انظر تعليقها
 * هناك لسبب عدم استيراد ملف مشترك. */
function normalizeArLocal(s: string): string {
  if (!s) return '';
  return s.normalize('NFKC')
    .replace(/[ؗ-ًؚ-ْٰۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/[يیى]/g, 'ي')
    .replace(/[کﻙﻚ]/g, 'ك')
    .replace(/[ةھه]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** م-٤٦: paymentTermDays خارج ContractorBody (lib/api.ts مملوك لوكيل آخر) —
 * null صريح = «امسح المدة» (الخادم يميّزه عن الغياب)، فيعود المقاول «غير محدّد». */
export type ContractorFormValues = ContractorBody & { paymentTermDays?: number | null };

interface Initial {
  code?: string; name?: string; phone?: string; notes?: string;
  defaultRetentionRate?: number | null; defaultGuaranteeDays?: number | null;
  paymentTermDays?: number | null;
  projects?: string[];
}

/** نموذج مقاول — إضافة وتعديل (الرمز يُقفل عند التعديل). */
export function ContractorForm({ initial, codeLocked = false, knownProjects, onSubmit, busy, error,
                                  onDirtyChange }: {
  initial?: Initial;
  codeLocked?: boolean;
  /** أسماء المشاريع المعروفة — نفس فكرة SupplierForm، للاختيار السريع. */
  knownProjects?: string[];
  onSubmit: (v: ContractorFormValues) => void;
  busy: boolean;
  error: string | null;
  /** م-٣٤: انظر تعليقها في SupplierForm.tsx — نفس الفكرة بالحرف. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const initialRetention = initial?.defaultRetentionRate != null ? String(initial.defaultRetentionRate) : '';
  const [retention, setRetention] = useState(initialRetention);
  const initialDays = initial?.defaultGuaranteeDays != null ? String(initial.defaultGuaranteeDays) : '';
  const [days, setDays] = useState(initialDays);
  const initialTerm = initial?.paymentTermDays != null ? String(initial.paymentTermDays) : '';
  const [term, setTerm] = useState(initialTerm);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  // لائحة المشاريع — نفس منطق SupplierForm بالحرف: الأول «الأساسي»، شرائح قابلة
  // للإزالة، وحقل حر + قائمة معروفة للإضافة. المقاول لا يملك عمود مشروع مفرد
  // (خلافاً للمورد)، فكل مشاريعه تعيش هنا فقط.
  const initialProjects = initial?.projects ?? [];
  const [projects, setProjects] = useState<string[]>(initialProjects);
  const [newProject, setNewProject] = useState('');

  useEffect(() => {
    const dirty = code.trim() !== (initial?.code ?? '')
      || name.trim() !== (initial?.name ?? '')
      || phone.trim() !== (initial?.phone ?? '')
      || retention !== initialRetention
      || days !== initialDays
      || term !== initialTerm
      || notes.trim() !== (initial?.notes ?? '')
      || projects.length !== initialProjects.length
      || projects.some((p, i) => p !== initialProjects[i])
      || newProject.trim() !== '';
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, name, phone, retention, days, term, notes, projects, newProject]);

  // نفس اقتراح SupplierForm.tsx — مشروع قريب بإملاء مختلف بدل توأم صامت.
  const projectSuggestion = useMemo(() => {
    const v = newProject.trim();
    if (!v) return null;
    const key = normalizeArLocal(v);
    return (knownProjects ?? []).find((p) => p !== v && normalizeArLocal(p) === key) ?? null;
  }, [newProject, knownProjects]);

  function addProject(p: string) {
    const v = p.trim();
    if (!v || projects.includes(v)) return;
    setProjects([...projects, v]);
    setNewProject('');
  }

  function removeProject(p: string) {
    setProjects(projects.filter((x) => x !== p));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const v: ContractorFormValues = { code: code.trim(), name: name.trim(), projects };
    if (phone.trim()) v.phone = phone.trim();
    if (notes.trim()) v.notes = notes.trim();
    if (retention !== '') v.defaultRetentionRate = Number(retention);
    if (days !== '') v.defaultGuaranteeDays = Number(days);
    // فارغ = null صريح لا حذف المفتاح: عند التعديل يجب أن يصل «امسح المدة» للخادم،
    // وإلا بقيت مدة قديمة تُنتج تأخراً لا يثق به المستخدم.
    v.paymentTermDays = term !== '' ? Number(term) : null;
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
      <div style={field}>
        <span>المشاريع — قد يعمل المقاول على أكثر من مشروع، والأول هو الأساسي</span>
        {projects.length > 0 && (
          <div className="chip-row">
            {projects.map((p, i) => (
              <span key={p} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i === 0 && <b style={{ fontWeight: 700 }}>★</b>}
                {p}
                <button type="button" onClick={() => removeProject(p)} aria-label={`إزالة ${p}`}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 13, lineHeight: 1 }}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addProject(newProject); }
            }}
            placeholder="اكتب اسم مشروع أو اختر من القائمة…"
            list="contractor-known-projects"
            style={{ flex: 1 }}
          />
          <datalist id="contractor-known-projects">
            {(knownProjects ?? []).map((p) => <option key={p} value={p} />)}
          </datalist>
          <button type="button" className="btn sm" onClick={() => addProject(newProject)}>إضافة</button>
        </div>
        {projectSuggestion && (
          <div className="callout" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>يوجد مشروع مشابه: «{projectSuggestion}» — هل تقصده؟</span>
            <button type="button" className="btn sm" onClick={() => addProject(projectSuggestion)}>
              استخدام «{projectSuggestion}»
            </button>
          </div>
        )}
      </div>
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
        مدة السداد (يوماً)
        <input type="number" min="0" max="365" value={term}
               onChange={(e) => setTerm(e.target.value)} dir="ltr" />
        <span className="muted">اتركه فارغاً إن لم تُتفق مدة — لن يُحسب تأخر</span>
      </label>
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
