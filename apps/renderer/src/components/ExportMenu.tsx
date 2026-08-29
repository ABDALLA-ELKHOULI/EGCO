import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CONTRACTOR_EXPORT_GROUPS, contractorsExportUrl,
  type ContractorExportFormat, type ContractorExportOption,
} from '@/lib/api';

/**
 * منتقي صيغة تصدير المقاولين — ١٤ صيغة مجمّعة بما يخدم القرار (قوائم/بالمشروع/
 * تدقيق/شامل/مفرد)، بدل قائمة مسطّحة يصعب مسحها بالعين. نفس نمط موضعة
 * ColumnMenu.tsx (position: fixed محسوب من الزر، لأن .card تقصّ الفائض).
 *
 * الصيغتان المشروطتان (مشروع واحد / كشف حساب) تطلبان مُدخلاً هنا قبل التنزيل —
 * لا زر يُنتج ٤٢٢ من الواجهة أبداً.
 */
export function ExportMenu({ params, projects }: {
  /** تصفية الجدول الحالية بالضبط (q/project/direction/status/sort/dir). */
  params: Record<string, string | number | undefined>;
  /** أسماء المشاريع المعروفة — لقائمة اختيار «مشروع واحد». */
  projects: string[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ContractorExportOption | null>(null);
  const [pickProject, setPickProject] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  useLayoutEffect(() => {
    const el = panel.current;
    const btn = wrap.current;
    if (!open || !el || !btn) return;
    const b = btn.getBoundingClientRect();
    el.style.top = `${b.bottom + 6}px`;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(8, b.right - w), window.innerWidth - w - 8);
    el.style.left = `${left}px`;
  }, [open]);

  const pick = (opt: ContractorExportOption) => {
    if (opt.requires === 'project') {
      setPickProject(projects[0] ?? '');
      setPending(opt);
      return;
    }
    // 'code' (كشف حساب مفرد) لا يظهر هنا أصلاً — له زر مباشر في صفّه، لا حاجة
    // لطلبه من قائمة عامة بلا مقاول محدَّد.
    if (opt.requires === 'code') return;
    window.location.href = contractorsExportUrl(opt.format, params);
    setOpen(false);
  };

  const confirmProject = () => {
    if (!pending || !pickProject) return;
    window.location.href = contractorsExportUrl(pending.format, params, { project: pickProject });
    setPending(null);
    setOpen(false);
  };

  return (
    <div className="col-menu-wrap" ref={wrap} style={{ position: 'relative' }}>
      <button type="button" className="btn sm" aria-haspopup="menu" aria-expanded={open}
              onClick={() => setOpen((v) => !v)}>
        تصدير Excel ▾
      </button>

      {open && (
        <div className="col-menu" ref={panel} role="menu" style={{ minWidth: 260 }}>
          {CONTRACTOR_EXPORT_GROUPS.map((g) => (
            <div key={g.group} style={{ marginBottom: 6 }}>
              <div className="muted" style={{ fontSize: 11, padding: '4px 8px' }}>{g.group}</div>
              <div className="col-menu-sort">
                {g.options.filter((o) => o.requires !== 'code').map((o) => (
                  <button key={o.format} type="button" onClick={() => pick(o)}>
                    {o.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <div className="col-menu" style={{ position: 'fixed', top: '50%', left: '50%',
                                            transform: 'translate(-50%, -50%)', minWidth: 280, zIndex: 80 }}
             role="dialog" aria-label="اختيار المشروع">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>اختر المشروع للتصدير</div>
          <select autoFocus value={pickProject} onChange={(e) => setPickProject(e.target.value)}
                  style={{ width: '100%' }}>
            {projects.length === 0 && <option value="">لا مشاريع متاحة</option>}
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
            <button className="btn sm" onClick={() => setPending(null)}>إلغاء</button>
            <button className="btn sm primary" disabled={!pickProject} onClick={confirmProject}>تصدير</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** زر «كشف حساب» في صفّ مقاول — يُصدّر single_statement&code=… مباشرةً، أكثر
 * صيغة تُطلب يومياً: تُرسَل للمقاول نفسه للمطابقة. لا حوار هنا: الرمز معروف
 * من الصفّ فلا معامل مفقود يستدعي ٤٢٢. */
export function StatementExportButton({ code, params }: {
  code: string;
  params: Record<string, string | number | undefined>;
}) {
  const href = contractorsExportUrl('single_statement' as ContractorExportFormat, params, { code });
  return (
    <a className="btn sm" href={href} download aria-label="تصدير كشف الحساب" title="تصدير كشف الحساب (Excel)">
      📄
    </a>
  );
}
