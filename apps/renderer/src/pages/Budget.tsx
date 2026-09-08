import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, apiBase, ApiError,
  type BudgetChainImpact, type BudgetClaim, type BudgetConflict,
  type BudgetMonth, type BudgetPreviewResponse, type BudgetProject,
  type BudgetProjectDetail, type BudgetResponse, type BudgetRow,
  type ProjectContractorRow,
} from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Kpi, Money, Pill, State } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { ExplainDot } from '@/components/Explain';
import { useAiEnabled } from '@/lib/useAi';
import { PrintableList, type PrintableColumn } from '@/components/PrintableList';
import type { PickedFile } from '@/types/global';

/** نتيجة رفع دفعة ملفات موازنة — تُجمع من ردود الخادم لكل ملف. */
interface UploadOutcome {
  ok: boolean;
  message: string;
  details?: string[];
}

/* ==================== الألوان بالاتجاه لا بالعتبة (PLAN §٥-١) ====================
 * الشهر والتراكمي يُلوَّن كلٌّ بمعناه منفصلاً — لا لون واحد للصفّ:
 *   deviationMonth  فعلي الشهر مقابل مخطط الشهر    > 0 أخضر · < 0 أحمر
 *   delayPct        cum_actual مقابل cum_planned    < 0 (سالب = متقدّم) أخضر · > 0 أحمر
 * لا عتبة سحرية (كانت delayPct > 0.10) — أي انحرافٍ عن الصفر له لون، مهما صغر،
 * لأن تأخر ٩٪ على ٥٩ مليوناً = ٥.٣ مليون عملٍ غير مُنجَز، ولا يجوز أن يظهر بلا لون.
 */
function monthTone(deviation: number): 'ok' | 'red' | '' {
  if (deviation > 0) return 'ok';
  if (deviation < 0) return 'red';
  return '';
}
function cumTone(delayPct: number | null): 'ok' | 'red' | '' {
  if (delayPct == null) return '';
  if (delayPct < -0.0001) return 'ok';   // تراكمي أعلى من المخطط — متقدّم
  if (delayPct > 0.0001) return 'red';   // تراكمي أقل من المخطط — متأخر
  return '';
}

/** اتجاه التحسّن بين شهرين لنفس المشروع — متأخرٌ يتحسّن قرارٌ مختلف عن متأخرٍ يتفاقم. */
function DeltaArrow({ deltaPp }: { deltaPp: number | null | undefined }) {
  if (deltaPp == null) return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  if (Math.abs(deltaPp) < 0.01) return <span className="muted" style={{ fontSize: 11 }}>= بلا تغيّر</span>;
  const improving = deltaPp < 0; // تناقص نسبة التأخر = تحسّن
  return (
    <span className={improving ? 'ok' : 'red'} style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {improving ? '↓ يتحسّن' : '↑ يتفاقم'} {sar(Math.abs(deltaPp))} ن.م
    </span>
  );
}

/** الموازنة التقديرية — تقرير الانحراف الشهري لكل مشروع. */
export function Budget() {
  const nav = useNavigate();
  const [d, setD] = useState<BudgetResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const [docMode, setDocMode] = useState(false);

  // ---------------- فلاتر الخادم (PLAN §٥-٢) — على المجموعة كاملةً، لا في المتصفح ----------------
  const [project, setProject] = useState('');
  const [city, setCity] = useState('');
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [status, setStatus] = useState('');
  const [hasClaims, setHasClaims] = useState(false);

  const query = useMemo(() => ({
    project: project || undefined,
    city: city || undefined,
    from_month: fromMonth || undefined,
    to_month: toMonth || undefined,
    status: (status || undefined) as any,
    has_claims: hasClaims ? true : undefined,
  }), [project, city, fromMonth, toMonth, status, hasClaims]);

  const [list, setList] = useState<Awaited<ReturnType<typeof api.budgetList>> | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const seq = useRef(0);

  const reloadList = useCallback(() => {
    const my = ++seq.current;
    api.budgetList(query).then((r) => { if (my === seq.current) { setList(r); setListErr(null); } })
      .catch((e) => { if (my === seq.current) setListErr(e.message); });
  }, [query]);

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => {
      api.budgetList(query).then((r) => { if (my === seq.current) { setList(r); setListErr(null); } })
        .catch((e) => { if (my === seq.current) setListErr(e.message); });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(() => {
    setErr(null);
    api.budget().then(setD).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const clearAll = () => {
    setProject(''); setCity(''); setFromMonth(''); setToMonth(''); setStatus(''); setHasClaims(false);
  };

  const STATUS_LABEL: Record<string, string> = { ahead: 'متقدّم', behind: 'متأخر', on_track: 'مطابق' };
  const chips = [
    project && { k: 'p', label: `المشروع: ${project}`, clear: () => setProject('') },
    city && { k: 'c', label: `المدينة: ${city}`, clear: () => setCity('') },
    (fromMonth || toMonth) && { k: 'm', label: `الشهر: ${fromMonth ? arDate(fromMonth) : '—'} ← ${toMonth ? arDate(toMonth) : '—'}`,
      clear: () => { setFromMonth(''); setToMonth(''); } },
    status && { k: 's', label: `الحالة: ${STATUS_LABEL[status] ?? status}`, clear: () => setStatus('') },
    hasClaims && { k: 'h', label: 'لها مستخلصات', clear: () => setHasClaims(false) },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];
  const filtering = chips.length > 0;
  const filterLine = chips.length > 0 ? chips.map((c) => c.label).join(' · ') : null;

  // رابط تصدير Excel — بنفس معايير query بالضبط، فيصدَّر ما تُصفّيه الشاشة الآن
  // فعلاً لا الدفتر كاملاً (نفس فكرة exportUrl في Suppliers.tsx).
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
    const s = params.toString();
    return apiBase() + '/api/v1/budget/export.xlsx' + (s ? `?${s}` : '');
  }, [query]);

  // نسخة PDF بنفس التصفية المعروضة — تُعاد استعمال PrintableList (لا مكتبة PDF
  // ثانية) بدل «تقرير الموازنة» الكامل غير المصفّى أعلاه، حتى لا تناقض الورقة
  // المطبوعة ما تراه الشاشة فعلاً (نفس قاعدة PLAN-BUDGET §٥-٤).
  const [showPrint, setShowPrint] = useState(false);

  async function upload() {
    setOutcome(null);
    if (!window.egco?.pickFiles) {
      setOutcome({
        ok: false,
        message: 'اختيار الملفات متاح داخل التطبيق فقط — افتح «EGCO Dashboard» من مجلد التطبيقات.',
      });
      return;
    }
    let picked: PickedFile[] = [];
    try {
      picked = await window.egco.pickFiles();
    } catch (e: any) {
      setOutcome({ ok: false, message: `تعذّر فتح نافذة اختيار الملفات: ${e?.message ?? e}` });
      return;
    }
    if (!picked.length) return; // المستخدم ألغى

    // تقرير الموازنة ملف Excel حصراً — نستبعد غيره قبل إرسال أي شيء للخادم
    const xlsx = picked.filter((f) => f.name.toLowerCase().endsWith('.xlsx'));
    const rejected = picked.filter((f) => !f.name.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length === 0) {
      setOutcome({
        ok: false,
        message: 'لم يُرفع شيء — تقرير الموازنة يجب أن يكون ملف Excel بامتداد .xlsx. ملف مسحٌ ضوئي (صورة) لا يُقرأ آلياً — استعمل الإدخال اليدوي وأرفقه كمرجع.',
        details: rejected.map((f) => f.name),
      });
      return;
    }

    setUploading(true);
    let imported = 0, updated = 0;
    const projects = new Set<string>();
    const failures: string[] = [];
    for (const f of xlsx) {
      try {
        const res = await api.budgetImport(f.path);
        imported += res?.imported ?? 0;
        updated += res?.updated ?? 0;
        for (const p of res?.projects ?? []) projects.add(p);
      } catch (e: any) {
        failures.push(`${f.name} — ${e?.message ?? e}`);
      }
    }
    setUploading(false);

    const skippedNote = rejected.length
      ? [`تُجوهل ${ar(rejected.length)} ملفاً بامتداد غير مقبول: ${rejected.map((f) => f.name).join('، ')}`]
      : [];
    if (failures.length === 0) {
      setOutcome({
        ok: true,
        message: `تم استيراد ${ar(imported)} لقطة${updated > 0 ? ` وتحديث ${ar(updated)}` : ''} لمشاريع: ${[...projects].join('، ') || '—'}`,
        details: skippedNote,
      });
    } else {
      setOutcome({
        ok: false,
        message: imported + updated > 0
          ? `اكتمل جزئياً — استُورد ${ar(imported + updated)} لقطة، وفشل ${ar(failures.length)}:`
          : 'لم يُستورد شيء:',
        details: [...failures, ...skippedNote],
      });
    }
    load();       // تحديث الوثيقة القابلة للطباعة (overview)
    reloadList();  // تحديث الجدول المفلتر
  }

  // ---------------- إدارة مشروع (نموذج الإدخال اليدوي + المقاولون) ----------------
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [newProjectForm, setNewProjectForm] = useState(false);

  if (err) return <ErrorState message={err} onRetry={load} />;

  if (docMode && d) {
    return <BudgetDoc d={d} onBack={() => setDocMode(false)} />;
  }

  // نسخة PDF بنفس التصفية النشطة — عمود «الشهر» و«التراكمي» كلٌّ بلونه المستقل
  // (monthTone/cumTone أعلاه) حتى لا يخفي تقدّمُ شهرٍ تأخراً تراكمياً (PLAN §٥-١).
  if (showPrint && list) {
    const printColumns: PrintableColumn[] = [
      { key: 'project', label: 'المشروع', render: (r: BudgetRow) => r.project },
      { key: 'city', label: 'المدينة', render: (r: BudgetRow) => r.city || '—' },
      { key: 'month', label: 'الشهر', render: (r: BudgetRow) => arDate(r.month) },
      { key: 'actual', label: 'الفعلي (ر.س)', ltr: true, render: (r: BudgetRow) => sar(r.actualMonth) },
      { key: 'planned', label: 'المخطط (ر.س)', ltr: true, render: (r: BudgetRow) => sar(r.plannedMonth) },
      { key: 'deviation', label: 'انحراف الشهر (ر.س)', ltr: true, render: (r: BudgetRow) =>
        <span className={monthTone(r.deviationMonth)}>{sar(r.deviationMonth)}</span> },
      { key: 'cumActual', label: 'تراكمي فعلي (ر.س)', ltr: true, render: (r: BudgetRow) => sar(r.cumActual) },
      { key: 'cumPlanned', label: 'تراكمي مخطط (ر.س)', ltr: true, render: (r: BudgetRow) => sar(r.cumPlanned) },
      { key: 'delayPct', label: 'نسبة التأخر التراكمية', ltr: true, render: (r: BudgetRow) =>
        <span className={cumTone(r.delayPct)}>{r.delayPct != null ? `${sar(r.delayPct * 100)}٪` : '—'}</span> },
      { key: 'status', label: 'الحالة', render: (r: BudgetRow) => STATUS_LABEL[r.status] ?? r.status },
      { key: 'source', label: 'المصدر', render: (r: BudgetRow) => r.entrySource === 'manual' ? 'يدوي' : 'ملف' },
    ];
    return (
      <PrintableList
        docTitle="تقرير الموازنة — بالتصفية الحالية"
        fileStamp="موازنة-مصفّاة"
        scopeLine="مرتَّبة بالمشروع ثم بالشهر"
        filterLine={filterLine}
        countLabel={`${ar(list.count)} شهر`}
        columns={printColumns}
        rows={list.rows}
        totalsCells={[
          `الإجمالي (${ar(list.count)})`, '', '',
          sar(list.totals.actualMonth), sar(list.totals.plannedMonth), '',
          sar(list.totals.cumActual), sar(list.totals.cumPlanned), '', '', '',
        ]}
        summary={[
          { label: 'الفعلي', value: `${sar(list.totals.actualMonth)} ر.س` },
          { label: 'المخطط', value: `${sar(list.totals.plannedMonth)} ر.س` },
          { label: 'التراكمي الفعلي', value: `${sar(list.totals.cumActual)} ر.س` },
          { label: 'التراكمي المخطط', value: `${sar(list.totals.cumPlanned)} ر.س` },
        ]}
        onBack={() => setShowPrint(false)}
      />
    );
  }

  // تجميع صفوف القائمة المفلترة حسب المشروع — بترتيب الأشهر كما وصل من الخادم
  const groups: { project: string; city: string; rows: BudgetRow[] }[] = [];
  if (list) {
    const byProject = new Map<string, BudgetRow[]>();
    for (const r of list.rows) {
      if (!byProject.has(r.project)) byProject.set(r.project, []);
      byProject.get(r.project)!.push(r);
    }
    for (const [p, rows] of byProject) groups.push({ project: p, city: rows[0]?.city ?? '', rows });
    groups.sort((a, b) => a.project.localeCompare(b.project, 'ar'));
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>الموازنة التقديرية</h1>
          <p>حجم العمل الفعلي مقابل المخطط ونسب التأخر والإنجاز لكل مشروع</p>
        </div>
        {d && d.projects.length > 0 && (
          <button className="btn" onClick={() => setDocMode(true)}>تقرير الموازنة (طباعة/PDF)</button>
        )}
        {/* يُصدِّران بالضبط ما تُصفّيه الشاشة الآن — لا الدفتر كاملاً (PLAN-BUDGET §٥-٤) */}
        <a className="btn sm" href={exportUrl} download>تصدير Excel (بالتصفية)</a>
        <button className="btn sm" disabled={!list || list.count === 0} onClick={() => setShowPrint(true)}>
          طباعة/PDF (بالتصفية)
        </button>
        <button className="btn" onClick={() => setNewProjectForm(true)}>مشروع جديد — إدخال يدوي</button>
        <button className="btn primary" onClick={upload} disabled={uploading}>
          {uploading ? 'جارٍ الاستيراد…' : 'رفع تقرير الموازنة'}
        </button>
      </div>

      {outcome && (
        <div className={'callout ' + (outcome.ok ? 'ok' : 'bad')} style={{ marginBottom: 16 }}>
          {outcome.message}
          {outcome.details && outcome.details.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
              {outcome.details.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* شريط الفلاتر — على الخادم دائماً، نفس نمط الموردين/المقاولين */}
      {list && (list.projects.length > 0 || list.cities.length > 0) && (
        <Card>
          <div className="filters-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <label className="field">
              <span>المشروع</span>
              <select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">الكل</option>
                {list.projects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="field">
              <span>المدينة</span>
              <select value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">الكل</option>
                {list.cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span>من شهر</span>
              <input type="month" value={fromMonth.slice(0, 7)}
                onChange={(e) => setFromMonth(e.target.value ? e.target.value + '-01' : '')} />
            </label>
            <label className="field">
              <span>إلى شهر</span>
              <input type="month" value={toMonth.slice(0, 7)}
                onChange={(e) => setToMonth(e.target.value ? e.target.value + '-01' : '')} />
            </label>
            <label className="field">
              <span>الحالة</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">الكل</option>
                <option value="ahead">متقدّم</option>
                <option value="behind">متأخر</option>
                <option value="on_track">مطابق</option>
              </select>
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={hasClaims} onChange={(e) => setHasClaims(e.target.checked)} />
              <span>لها مستخلصات فقط</span>
            </label>
            {filtering && <button className="btn sm" onClick={clearAll}>مسح الكل</button>}
          </div>
          {filtering && (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              تصفية نشطة: {chips.map((c) => c.label).join(' · ')}
            </p>
          )}
          {list.count > 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {ar(list.count)} شهر · إجمالي الفعلي {sar(list.totals.actualMonth)} ر.س مقابل مخطط {sar(list.totals.plannedMonth)} ر.س
            </p>
          )}
        </Card>
      )}

      {listErr && <ErrorState message={listErr} onRetry={reloadList} />}

      {!list ? <State>جارٍ التحميل…</State>
        : groups.length === 0 ? (
          <Card>
            <EmptyState kind={filtering ? 'no-results' : 'no-data'}
              title={filtering ? 'لا نتائج مطابقة للتصفية' : 'لم تُرفع بيانات الموازنة بعد'}
              body={filtering
                ? 'لا شهور تطابق هذه الفلاتر — جرّب توسيع المدى أو مسح الفلاتر.'
                : 'ارفع ملف تقرير الانحراف الشهري أو أدخل شهراً يدوياً ليظهر هنا.'}
              ctaLabel={filtering ? 'مسح الفلاتر' : 'رفع الملفات'}
              onCta={filtering ? clearAll : () => nav('/import')} />
          </Card>
        ) : (
          <div className="stack">
            {groups.map((g) => (
              <ProjectRowCard key={g.project} group={g}
                onManage={() => setOpenProject(g.project)} />
            ))}
          </div>
        )}

      {openProject && (
        <ProjectPanel project={openProject} onClose={() => setOpenProject(null)}
          onSaved={() => { reloadList(); load(); }} />
      )}

      {newProjectForm && (
        <ManualEntryForm project="" existing={null} projectEditable
          onClose={() => setNewProjectForm(false)}
          onSaved={() => { setNewProjectForm(false); reloadList(); load(); }} />
      )}
    </>
  );
}

/* ==================== بطاقة مشروع في القائمة المفلترة ==================== */

function ProjectRowCard({ group, onManage }: {
  group: { project: string; city: string; rows: BudgetRow[] };
  onManage: () => void;
}) {
  const rows = group.rows;
  const latest = rows[rows.length - 1];
  return (
    <Card
      title={group.project + (group.city ? ` — ${group.city}` : '')}
      sub={`آخر شهر: ${arDate(latest.month, true)}${latest.docNo ? ` · وثيقة ${latest.docNo}` : ''}${latest.entrySource === 'manual' ? ' · إدخال يدوي' : ' · من ملف'}`}
      actions={<button className="btn sm" onClick={onManage}>إدارة الأشهر ومقاولو المشروع</button>}
    >
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 16 }}>
        <div className="kpi-row" style={{ marginBottom: 0 }}>
          <Kpi label="الفعلي للشهر" value={sar(latest.actualMonth)} unit="ر.س" />
          <Kpi label="المخطط للشهر" value={sar(latest.plannedMonth)} unit="ر.س" />
          <Kpi label="انحراف الشهر" value={sar(latest.deviationMonth)} unit="ر.س" tone={monthTone(latest.deviationMonth)} />
          <Kpi label="نسبة الإنجاز التراكمية" value={latest.completionPct != null ? `${sar(latest.completionPct * 100)}٪` : '—'} hero
            tone={cumTone(latest.delayPct)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            التراكمي: الفعلي {sar(latest.cumActual)} مقابل المخطط {sar(latest.cumPlanned)} ر.س ·
            {' '}نسبة التأخر التراكمية{' '}
            <b className={cumTone(latest.delayPct)}>{latest.delayPct != null ? `${sar(latest.delayPct * 100)}٪` : '—'}</b>
          </span>
          <DeltaArrow deltaPp={latest.delayDeltaPp} />
        </div>

        {rows.length > 0 && (
          <div className="table-scroll"><table>
            <thead>
              <tr>
                <th>الشهر</th>
                <th className="ltr">الفعلي (ر.س)</th>
                <th className="ltr">المخطط (ر.س)</th>
                <th className="ltr">انحراف الشهر (ر.س)</th>
                <th className="ltr">نسبة التأخر التراكمية</th>
                <th className="ltr">الاتجاه</th>
                <th>المصدر</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{arDate(m.month)}</td>
                  <td className="ltr"><Money v={m.actualMonth} /></td>
                  <td className="ltr muted"><Money v={m.plannedMonth} /></td>
                  <td className="ltr"><Money v={m.deviationMonth} cls={monthTone(m.deviationMonth)} /></td>
                  <td className={'ltr num ' + cumTone(m.delayPct)}>
                    {m.delayPct != null ? `${sar(m.delayPct * 100)}٪` : '—'}
                  </td>
                  <td className="ltr"><DeltaArrow deltaPp={m.delayDeltaPp} /></td>
                  <td>
                    <Pill kind={m.entrySource === 'manual' ? 'gold' : ''}>
                      {m.entrySource === 'manual' ? 'يدوي' : 'ملف'}
                    </Pill>
                    {m.hasAttachment && <span className="muted" style={{ marginInlineStart: 6, fontSize: 11 }}>📎 مرفق</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </Card>
  );
}

/* ==================== لوحة إدارة مشروع — أشهر + إدخال يدوي + مقاولون ==================== */

function ProjectPanel({ project, onClose, onSaved }: {
  project: string; onClose: () => void; onSaved: () => void;
}) {
  const [detail, setDetail] = useState<BudgetProjectDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<BudgetRow | 'new' | null>(null);

  const reload = useCallback(() => {
    api.budgetProject(project).then((r) => { setDetail(r); setErr(null); }).catch((e) => setErr(e.message));
  }, [project]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <Modal title={`إدارة الموازنة — ${project}`} onClose={onClose} maxWidth={920}>
      {err && <ErrorState message={err} onRetry={reload} />}
      {!detail && !err && <State>جارٍ التحميل…</State>}
      {detail && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {detail.city ? `المدينة: ${detail.city} · ` : ''}
              {ar(detail.months.length)} شهر مسجَّل
            </p>
            <button className="btn primary sm" onClick={() => setEditing('new')}>إضافة شهر</button>
          </div>

          {detail.months.length > 0 && (
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th className="ltr">الفعلي</th>
                  <th className="ltr">المخطط</th>
                  <th className="ltr">انحراف الشهر</th>
                  <th className="ltr">تراكمي فعلي</th>
                  <th className="ltr">تراكمي مخطط</th>
                  <th className="ltr">التأخر التراكمي</th>
                  <th className="ltr">الاتجاه</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {detail.months.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{arDate(m.month)}</td>
                    <td className="ltr"><Money v={m.actualMonth} /></td>
                    <td className="ltr muted"><Money v={m.plannedMonth} /></td>
                    <td className="ltr"><Money v={m.deviationMonth} cls={monthTone(m.deviationMonth)} /></td>
                    <td className="ltr"><Money v={m.cumActual} /></td>
                    <td className="ltr muted"><Money v={m.cumPlanned} /></td>
                    <td className={'ltr num ' + cumTone(m.delayPct)}>
                      {m.delayPct != null ? `${sar(m.delayPct * 100)}٪` : '—'}
                    </td>
                    <td className="ltr"><DeltaArrow deltaPp={m.delayDeltaPp} /></td>
                    <td><button className="btn sm" onClick={() => setEditing(m)}>تعديل</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}

          <ContractorsCard contractors={detail.contractors} project={project} />
        </div>
      )}

      {editing && (
        <ManualEntryForm
          project={project}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); onSaved(); }}
        />
      )}
    </Modal>
  );
}

/* ==================== مقاولو المشروع — قسم منفصل، لا فلترة مدموجة (PLAN §١-ب) ====================
 * الموازنة رقم المشروع لا رقم مقاولٍ فيه — دمجهما يُنتج رقماً مضلِّلاً (نفس عائلة
 * عطب م-٢٨ في المقاولين). لذلك بطاقة مستقلة بعنوان صريح، لا عمود إضافي بجدول الأشهر.
 */
function ContractorsCard({ contractors, project }: { contractors: ProjectContractorRow[]; project: string }) {
  return (
    <Card title="التزامات مقاولي هذا المشروع"
      sub="من وحدة المقاولين — مصدر منفصل تماماً عن رقم موازنة المشروع أعلاه، لا يُجمع معه">
      {contractors.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>لا مقاولون مربوطون بمشروع «{project}» في وحدة المقاولين.</p>
      ) : (
        <div className="table-scroll"><table>
          <thead>
            <tr><th>المقاول</th><th className="ltr">الكود</th><th className="ltr">الرصيد (ر.س)</th></tr>
          </thead>
          <tbody>
            {contractors.map((c, i) => (
              <tr key={String(c.code ?? i)}>
                <td>{String(c.name ?? '—')}</td>
                <td className="ltr">{String(c.code ?? '—')}</td>
                <td className="ltr">{typeof c.balance === 'number' ? sar(c.balance) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

/* ==================== الإدخال اليدوي — مطابق لتخطيط التقرير (PLAN §٥-٤ / §٣) ====================
 * ٦ حقول يُدخلها المستخدم فقط: actualMonth · plannedMonth · claims[] · docNo ·
 * issuedOn · notes. الخمسة الأخرى (deviationMonth·cumActual·cumPlanned·
 * completionPct·delayPct) تُحسب حيّاً بـ/budget/preview — لا تُخترع محلياً.
 */
function ManualEntryForm({ project: initialProject, existing, onClose, onSaved, projectEditable }: {
  project: string;
  existing: BudgetRow | null;
  onClose: () => void;
  onSaved: () => void;
  /** لمشروع جديد ليس له أي شهر مسجَّل بعد — لا مصدر يقترح الاسم غير كتابته يدوياً. */
  projectEditable?: boolean;
}) {
  const [project, setProject] = useState(initialProject);
  const [month, setMonth] = useState(existing ? existing.month.slice(0, 7) : '');
  const [actualMonth, setActualMonth] = useState(String(existing?.actualMonth ?? ''));
  const [plannedMonth, setPlannedMonth] = useState(String(existing?.plannedMonth ?? '0'));
  const [claims, setClaims] = useState<BudgetClaim[]>(existing?.claims ?? []);
  const [docNo, setDocNo] = useState(existing?.docNo ?? '');
  const [issuedOn, setIssuedOn] = useState(existing?.issuedOn ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const [preview, setPreview] = useState<BudgetPreviewResponse | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [confirmConflict, setConfirmConflict] = useState<BudgetConflict | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  const monthIso = month ? `${month}-01` : '';

  // حساب حيّ أثناء الكتابة — الخادم مصدر الحقيقة الوحيد لهذا الحساب، لا يُخترع محلياً
  useEffect(() => {
    if (!monthIso) { setPreview(null); return; }
    const a = Number(actualMonth) || 0;
    const p = Number(plannedMonth) || 0;
    const t = setTimeout(() => {
      api.budgetPreview({ project, month: monthIso, actualMonth: a, plannedMonth: p })
        .then((r) => { setPreview(r); setPreviewErr(null); })
        .catch((e) => setPreviewErr(e instanceof ApiError ? e.message : String(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [project, monthIso, actualMonth, plannedMonth]);

  function addClaim() { setClaims((c) => [...c, { no: '', amount: 0, date: null }]); }
  function updateClaim(i: number, patch: Partial<BudgetClaim>) {
    setClaims((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeClaim(i: number) { setClaims((c) => c.filter((_, idx) => idx !== i)); }

  async function attachFile() {
    if (!window.egco?.pickFile) {
      setSaveErr('إرفاق الملفات متاح داخل التطبيق فقط.');
      return;
    }
    setAttaching(true);
    try {
      const picked = await window.egco.pickFile();
      if (!picked) return;
      const r = await api.budgetUploadAttachment(picked.path);
      setAttachmentName(r.attachment);
    } catch (e: any) {
      setSaveErr(`تعذّر إرفاق الملف: ${e?.message ?? e}`);
    } finally {
      setAttaching(false);
    }
  }

  async function doSave(forceConflict: boolean) {
    if (!monthIso) { setSaveErr('اختر الشهر أولاً'); return; }
    setSaving(true); setSaveErr(null);
    try {
      const body = {
        project, month: monthIso,
        actualMonth: Number(actualMonth) || 0,
        plannedMonth: Number(plannedMonth) || 0,
        claims, docNo, issuedOn: issuedOn || null, notes,
        forceConflict,
        // مسار الملف الذي أعادته /imports/budget-attachment — بلا هذا يُنسخ
        // الملف ويُعرض اسمه ولا يبقى مربوطاً بسجل الشهر (فجوة كشفها التصدير
        // والواجهة مستقلَّين، أُغلقت في الخادم والنموذج معاً).
        attachment: attachmentName ?? undefined,
      };
      const res = existing ? await api.budgetUpdate(existing.id, body) : await api.budgetCreate(body);
      if (!res.saved) {
        // تعارض — لا كتابة صامتة فوق رقم قائم أبداً؛ الحوار يُفتح ويُنتظر قرار صريح
        setConfirmConflict(res.conflict);
        return;
      }
      onSaved();
    } catch (e: any) {
      setSaveErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const c = preview?.computed;
  const conflict = preview?.conflict;

  return (
    <Modal title={existing ? `تعديل شهر — ${arDate(existing.month, true)}` : 'إضافة شهر — إدخال يدوي'}
      onClose={onClose} maxWidth={760}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {saveErr && <div className="callout bad">{saveErr}</div>}

        {/* ترويسة — تطابق ترويسة التقرير الورقي */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {projectEditable && (
            <label className="field">
              <span>المشروع</span>
              <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="اسم المشروع" />
            </label>
          )}
          <label className="field">
            <span>الشهر</span>
            <input type="month" value={month} disabled={!!existing}
              onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label className="field">
            <span>رقم الوثيقة</span>
            <input value={docNo} onChange={(e) => setDocNo(e.target.value)} placeholder="EGCO/…" />
          </label>
          <label className="field">
            <span>تاريخ الإصدار</span>
            <input type="date" value={issuedOn ?? ''} onChange={(e) => setIssuedOn(e.target.value)} />
          </label>
        </div>

        {/* الجدول ١ — كما في التقرير: فعلي الشهر × المبلغ الفعلي/المخطط */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="field">
            <span>الفعلي للشهر (ر.س)</span>
            <input type="number" inputMode="decimal" value={actualMonth}
              onChange={(e) => setActualMonth(e.target.value)} />
          </label>
          <label className="field">
            <span>المخطط للشهر (ر.س)</span>
            <input type="number" inputMode="decimal" value={plannedMonth}
              onChange={(e) => setPlannedMonth(e.target.value)} />
          </label>
        </div>

        {/* الخمسة المحسوبة — حيّة من الخادم، لا تُدخَل يدوياً أبداً */}
        <Card title="المحسوب تلقائياً (من الخادم)">
          {previewErr && <div className="callout bad">{previewErr}</div>}
          {!c ? <p className="muted" style={{ fontSize: 12 }}>اختر الشهر لعرض الحساب الحيّ.</p> : (
            <div className="kpi-row" style={{ marginBottom: 0 }}>
              <Kpi label="انحراف الشهر" value={sar(c.deviationMonth)} unit="ر.س" tone={monthTone(c.deviationMonth)} />
              <Kpi label="تراكمي الفعلي" value={sar(c.cumActual)} unit="ر.س" />
              <Kpi label="تراكمي المخطط" value={sar(c.cumPlanned)} unit="ر.س" />
              <Kpi label="نسبة الإنجاز" value={c.completionPct != null ? `${sar(c.completionPct * 100)}٪` : '—'} hero
                tone={cumTone(c.delayPct)} />
            </div>
          )}
          {preview && preview.chainImpact.length > 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              سيتغيّر {ar(preview.chainImpact.length)} شهراً تالياً بعد الحفظ (إعادة بناء سلسلة التراكمي).
            </p>
          )}
          {conflict && (
            <div className="callout bad" style={{ marginTop: 10 }}>
              <b>تعارض بيانات:</b> القيمة الحالية {sar(conflict.current)} (من {conflict.currentSource === 'file' ? 'ملف' : 'إدخال يدوي'})
              {' '}— القيمة الجديدة {sar(conflict.incoming)} (يدوي). لن يُحفظ شيء حتى تختار أيّهما تعتمد عند الضغط على «حفظ».
            </div>
          )}
        </Card>

        {/* الجدول ٢ — المستخلصات */}
        <Card title="المستخلصات" actions={<button className="btn sm" onClick={addClaim}>إضافة مستخلص</button>}>
          {claims.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>لا مستخلصات لهذا الشهر.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>الرقم</th><th className="ltr">المبلغ (ر.س)</th><th>التاريخ</th><th></th></tr></thead>
              <tbody>
                {claims.map((cl, i) => (
                  <tr key={i}>
                    <td><input value={cl.no} onChange={(e) => updateClaim(i, { no: e.target.value })} style={{ width: 100 }} /></td>
                    <td className="ltr"><input type="number" value={cl.amount}
                      onChange={(e) => updateClaim(i, { amount: Number(e.target.value) || 0 })} style={{ width: 140 }} /></td>
                    <td><input type="date" value={cl.date ?? ''} onChange={(e) => updateClaim(i, { date: e.target.value || null })} /></td>
                    <td><button className="btn sm" onClick={() => removeClaim(i)}>حذف</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>

        {/* الملاحظات */}
        <label className="field">
          <span>الملاحظات</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="نصّ حرّ — نِسَب ومقارنة الشهر السابق…" />
        </label>

        {/* المرفق — الأصل الموقَّع يبقى مربوطاً بالرقم */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn sm" onClick={attachFile} disabled={attaching}>
            {attaching ? 'جارٍ الإرفاق…' : 'إرفاق الملف الأصلي (PDF/Excel)'}
          </button>
          {attachmentName && <span className="muted" style={{ fontSize: 12 }}>نُسخت نسخة مرجعية: {attachmentName}</span>}
          {existing?.hasAttachment && !attachmentName && (
            <span className="muted" style={{ fontSize: 12 }}>📎 يوجد مرفق سابق لهذا الشهر</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={saving || !monthIso || !project.trim()} onClick={() => doSave(false)}>
            {saving ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
        </div>
      </div>

      {confirmConflict && (
        <ConflictModal conflict={confirmConflict}
          onCancel={() => setConfirmConflict(null)}
          onConfirm={() => { setConfirmConflict(null); doSave(true); }} />
      )}
    </Modal>
  );
}

/** حوار التعارض — إلزامي، لا كتابة صامتة فوق رقم قائم أبداً (PLAN §٤/الخطر ٢). */
function ConflictModal({ conflict, onCancel, onConfirm }: {
  conflict: BudgetConflict; onCancel: () => void; onConfirm: () => void;
}) {
  const label = conflict.field === 'cumActual' ? 'التراكمي الفعلي' : 'نسبة التأخر';
  const fmt = (v: number) => conflict.field === 'delayPct' ? `${sar(v * 100)}٪` : `${sar(v)} ر.س`;
  return (
    <Modal title="تعارض بين مصدرين" onClose={onCancel} maxWidth={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p>
          القيمة الحالية لـ«{label}» <b>{fmt(conflict.current)}</b> (من {conflict.currentSource === 'file' ? 'ملف' : 'إدخال يدوي'}) —
          {' '}القيمة الجديدة <b>{fmt(conflict.incoming)}</b> (يدوي). أيّهما تعتمد؟
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel}>إلغاء — الاحتفاظ بالحالية</button>
          <button className="btn primary" onClick={onConfirm}>اعتماد القيمة الجديدة</button>
        </div>
      </div>
    </Modal>
  );
}

/* ==================== الوثيقة القابلة للطباعة ==================== */

/** يجمع مدى الأشهر المغطاة عبر كل المشاريع — لسطر «الفترة» في رأس الوثيقة. */
function coveredRange(d: BudgetResponse): string {
  const months = d.projects.flatMap((p) => p.months.map((m) => m.month)).sort();
  if (months.length === 0) return '—';
  const first = months[0], last = months[months.length - 1];
  return first === last ? arDate(first) : `${arDate(first)} ← ${arDate(last)}`;
}

function BudgetDoc({ d, onBack }: { d: BudgetResponse; onBack: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);

  // داخل التطبيق: حوار حفظ أصلي + printToPDF — وفي المتصفح: window.print كما في التقرير التحليلي
  async function exportPdf() {
    if (!window.egco?.exportPdf) { window.print(); return; }
    setExporting(true); setExportErr(null);
    const r = await window.egco.exportPdf({ filename: `EGCO-موازنة-${stamp}.pdf` });
    setExporting(false);
    if (r.error) setExportErr(r.error);
  }

  return (
    <>
      <div className="page-head no-print">
        <div className="grow">
          <h1>تقرير الموازنة التقديرية</h1>
          <p>جاهز للطباعة أو الحفظ بصيغة PDF</p>
        </div>
        <button className="btn" onClick={onBack}>عودة</button>
        <button className="btn primary" onClick={exportPdf} disabled={exporting}>
          {exporting ? 'جارٍ إنشاء PDF…' : 'طباعة / حفظ PDF'}
        </button>
      </div>
      {exportErr && <div className="no-print"><State>{exportErr}</State></div>}

      <div className="sheet budget-doc">
        <header className="rpt-head">
          <div>
            <b>شركة إعمار الخليج المصرية للمقاولات</b>
            <span>الإدارة المالية</span>
          </div>
        </header>
        <hr className="rule-ink" />

        <h1 className="rpt-title">تقرير الموازنة التقديرية</h1>
        <p className="rpt-sub">
          الفترة المغطاة: {coveredRange(d)} · جميع الأرقام بالريال السعودي
        </p>
        <div className="rpt-meta">
          <div><span>تاريخ الإصدار</span><b>{arDate(stamp)}</b></div>
          <div><span>عدد المشاريع</span><b>{ar(d.projects.length)}</b></div>
          <div><span>أساس الاحتساب</span><b>تقارير الانحراف الشهرية</b></div>
          <div><span>التصنيف</span><b>وثيقة داخلية</b></div>
        </div>
        <hr />

        {d.projects.map((p, i) => (
          <ProjectDocSection key={p.project} p={p} index={i} />
        ))}

        <div className="rpt-foot">
          <hr />
          <div className="signs">
            <div>إعداد — الإدارة المالية</div>
            <div>مراجعة — المدير المالي</div>
            <div>اعتماد — الإدارة التنفيذية</div>
          </div>
          <p className="muted">وثيقة داخلية · تقرير الموازنة التقديرية · {arDate(stamp)}</p>
        </div>
      </div>
    </>
  );
}

function ProjectDocSection({ p, index }: { p: BudgetProject; index: number }) {
  const latest = p.latest ?? p.months[p.months.length - 1] ?? null;
  if (!latest) return null;
  return (
    <section className="budget-doc-project">
      <div className="rpt-section">
        <div>
          <span className="badge">٠{ar(index + 1)}</span>
          <b>مشروع {p.project}</b>
        </div>
        <p>
          آخر تقرير: {arDate(latest.month, true)}
          {latest.serial ? ` · تقرير رقم ${ar(latest.serial)}` : ''}
          {latest.issuedOn ? ` · صدر ${arDate(latest.issuedOn)}` : ''}
        </p>
      </div>

      <div className="rpt-kpis" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <DocKpi label="الفعلي للشهر" value={sar(latest.actualMonth)} />
        <DocKpi label="المخطط للشهر" value={sar(latest.plannedMonth)} />
        <DocKpi label="انحراف الشهر" value={sar(latest.deviationMonth)}
                cls={monthTone(latest.deviationMonth)} />
        <DocKpi label="نسبة التأخر" value={`${sar(latest.delayPct * 100)}٪`}
                cls={cumTone(latest.delayPct)} unit="" />
        <DocKpi label="نسبة الإنجاز" value={`${sar(latest.completionPct * 100)}٪`} unit="" />
      </div>

      <MonthsTable months={p.months} />

      <div style={{ margin: '12px 0' }}>
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          التراكمي: الفعلي {sar(latest.cumActual)} مقابل المخطط {sar(latest.cumPlanned)} ر.س
        </div>
        <DocBar label="الفعلي" value={latest.cumActual} max={Math.max(latest.cumActual, latest.cumPlanned, 1)} gold />
        <DocBar label="المخطط" value={latest.cumPlanned} max={Math.max(latest.cumActual, latest.cumPlanned, 1)} />
      </div>

      {latest.claims.length > 0 && (
        <>
          <b style={{ fontSize: 12, display: 'block', margin: '10px 0 6px' }}>مستخلصات الشهر الأخير</b>
          <table className="rpt-table">
            <thead>
              <tr><th>المستخلص</th><th className="ltr">المبلغ (ر.س)</th><th>التاريخ</th></tr>
            </thead>
            <tbody>
              {latest.claims.map((c, i) => {
                const pending = !c.amount || !c.date;
                return (
                  <tr key={c.no + i}>
                    <td className="num">{ar(c.no)}</td>
                    <td className="ltr num">{pending ? 'لم يصدر بعد' : sar(c.amount)}</td>
                    <td>{c.date ? arDate(c.date) : 'لم يصدر بعد'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <BudgetNotesSection project={p.project} initial={latest.notes} />
    </section>
  );
}

/**
 * ملاحظات مالية — نص المستخدم يفوز دائماً؛ مسودة الذكاء تكتب فوق الحقل فقط
 * لحظة الضغط الصريح على الزر، ولا تُحفظ تلقائياً في أي مكان.
 */
function BudgetNotesSection({ project, initial }: { project: string; initial: string | null }) {
  const [notes, setNotes] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { enabled: aiEnabled, loading: aiLoading } = useAiEnabled();

  async function draft() {
    setBusy(true); setError(null);
    try {
      const r = await api.aiBudgetNotes(project);
      setNotes(r.notes);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rpt-notes no-print-controls" style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <b style={{ flex: 1 }}>ملاحظات مالية</b>
        {!aiLoading && aiEnabled && (
          <button type="button" className="btn no-print" onClick={draft} disabled={busy}>
            {busy ? 'جارٍ الصياغة…' : 'مسودة بالذكاء الاصطناعي'}
          </button>
        )}
      </div>
      {error && <div className="callout bad no-print" style={{ marginBottom: 6 }}>{error}</div>}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="ملاحظات مالية عن هذا المشروع…"
        rows={4}
        style={{ fontSize: 12 }}
      />
    </div>
  );
}

function MonthsTable({ months }: { months: BudgetMonth[] }) {
  if (months.length === 0) return null;
  return (
    <table className="rpt-table">
      <thead>
        <tr>
          <th>الشهر</th>
          <th className="ltr">الفعلي (ر.س)</th>
          <th className="ltr">المخطط (ر.س)</th>
          <th className="ltr">الانحراف (ر.س)</th>
          <th className="ltr">نسبة التأخر</th>
          <th className="ltr">نسبة الإنجاز</th>
          <th className="ltr">الاتجاه</th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => (
          <tr key={m.month}>
            <td className="nowrap">{arDate(m.month)}</td>
            <td className="ltr num">{sar(m.actualMonth)}</td>
            <td className="ltr num">{sar(m.plannedMonth)}</td>
            <td className={'ltr num ' + monthTone(m.deviationMonth)}>
              {sar(m.deviationMonth)}
            </td>
            <td className={'ltr num ' + cumTone(m.delayPct)}>{sar(m.delayPct * 100)}٪</td>
            <td className="ltr num">{sar(m.completionPct * 100)}٪</td>
            <td className="ltr num"><DeltaArrow deltaPp={m.delayDeltaPp} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const DocKpi = ({ label, value, cls, unit = 'ر.س' }:
  { label: string; value: string; cls?: string; unit?: string }) => (
  <div className="rpt-kpi">
    <span>{label}</span>
    <b className={'num ' + (cls || '')}>{value}</b>
    {unit && <i>{unit}</i>}
  </div>
);

function DocBar({ label, value, max, gold }:
  { label: string; value: number; max: number; gold?: boolean }) {
  return (
    <div className="budget-doc-bar">
      <span>{label}</span>
      <div className="track">
        <div className={'fill' + (gold ? ' gold' : '')}
             style={{ width: `${Math.max((value / max) * 100, 0)}%` }} />
      </div>
      <span className="num amount">{sar(value)} ر.س</span>
    </div>
  );
}
