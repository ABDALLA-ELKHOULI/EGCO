import { useMemo, useState } from 'react';

/**
 * تطبيع عربي محلي للمقارنة فقط (لا يُخزَّن ولا يُعرض) — نفس قواعد
 * app/utils/arabic.py على الخادم (الهمزات، التاء المربوطة، الياء الفارسية،
 * التشكيل، التطويل)، منسوخة هنا لأن هذا الملف لا يملك حق استيراد ملف عميل
 * مشترك جديد. الهدف الوحيد: اقتراح مشروع موجود بدل صمت يُنشئ توأماً له.
 */
function normalizeArLocal(s: string): string {
  if (!s) return '';
  return s.normalize('NFKC')
    .replace(/[ؗ-ًؚ-ْٰۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/[يیى]/g, 'ي')
    .replace(/[کﻙﻚ]/g, 'ك')
    .replace(/[ةھه]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SupplierFormValues {
  account: string;
  name: string;
  project: string;
  term: string;
  projects: string[];
}

/** نموذج إضافة/تعديل مورد. */
export function SupplierForm({ initial, knownProjects, onSubmit, busy, error }: {
  initial?: Partial<SupplierFormValues>;
  /** أسماء المشاريع المعروفة — للاختيار السريع بدل كتابة الاسم من جديد في كل مرة. */
  knownProjects?: string[];
  onSubmit: (values: SupplierFormValues) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const isEdit = Boolean(initial?.account);
  const [account, setAccount] = useState(initial?.account ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [term, setTerm] = useState(initial?.term ?? '');
  // لائحة المشاريع — الأول هو «الأساسي» وهو ما تعرضه بقية الشاشات (التقارير،
  // التصدير، شاشة الميزانية) التي لا تزال تقرأ عمود project المفرد.
  const [projects, setProjects] = useState<string[]>(
    initial?.projects && initial.projects.length > 0
      ? initial.projects
      : initial?.project ? [initial.project] : []);
  const [newProject, setNewProject] = useState('');

  const canSubmit = account.trim() && name.trim() && !busy;

  // مشروع قريب موجود بإملاء مختلف (المدينة/المدينه) — يُقترح بدل أن يُضاف
  // الاسم المكتوب توأماً صامتاً لمشروع موجود أصلاً. تطابق حرفي كامل ليس اقتراحاً.
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          account: account.trim(), name: name.trim(), term: term.trim(),
          projects, project: projects[0] ?? '',
        });
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          المشاريع — قد يعمل المورد على أكثر من مشروع، والأول هو الأساسي في بقية الشاشات
        </span>
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
            list="supplier-known-projects"
            style={{ flex: 1 }}
          />
          <datalist id="supplier-known-projects">
            {(knownProjects ?? []).map((p) => <option key={p} value={p} />)}
          </datalist>
          <button type="button" className="btn sm" onClick={() => addProject(newProject)}>إضافة</button>
        </div>
        {projectSuggestion && (
          // يمنع توأماً صامتاً لنفس المشروع بإملاء آخر — «المدينة»/«المدينه» يصبحان
          // مشروعين مختلفين في القائمة إن لم يُنبَّه المستخدم هنا.
          <div className="callout" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>يوجد مشروع مشابه: «{projectSuggestion}» — هل تقصده؟</span>
            <button type="button" className="btn sm" onClick={() => addProject(projectSuggestion)}>
              استخدام «{projectSuggestion}»
            </button>
          </div>
        )}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>مدة السداد</span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="مثال: ٤٥ يوم · كاش · مستخلص"
        />
      </label>

      <div className="modal-foot">
        <button type="submit" className="btn primary" disabled={!canSubmit}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}
