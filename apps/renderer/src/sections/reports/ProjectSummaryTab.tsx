/** «ملخّص بالمشروع» (P-321…P-324، P-578، P-580) — سطر واحد لكل شركة، أرقام الخادم كما هي. */
import { useEffect, useState } from 'react';
import logoFull from '@/assets/logo-full.png';
import { Button, EmptyState, Money, Seg, Skeleton, dateTxt, digits, toast } from './uikit';
import { useProjectSummary, useScopes } from './hooks';
import { download, exportPdf, pdfNames, projectSummaryExportUrl } from './exports';
import { PKpi, PartyPill, lastPaymentText } from './parts';
import type { PartyScope, ProjectSummaryPayload } from './types';

export function ProjectSummaryTab() {
  const scopes = useScopes();
  const [project, setProject] = useState<string | null>(null);
  const [parties, setParties] = useState<PartyScope>('both');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!project && scopes.data?.projects.length) setProject(scopes.data.projects[0]); }, [scopes.data, project]);
  const q = useProjectSummary(project, parties);

  async function pdf() {
    setBusy(true);
    const r = await exportPdf(pdfNames.projectSummary(), true);
    setBusy(false);
    if (r.error) toast('تعذّر إنشاء PDF: ' + r.error, { kind: 'error' });
  }

  return (
    <div className="rp-print-landscape">
      <div className="rp-actbar rp-noprint">
        <label className="rp-inline">المشروع
          <select value={project ?? ''} onChange={(e) => setProject(e.target.value || null)}>
            {!scopes.data?.projects.length && <option value="">لا مشاريع</option>}
            {scopes.data?.projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <Seg label="الأطراف" value={parties} onChange={setParties}
          options={[{ value: 'both', label: 'الموردون والمقاولون' }, { value: 'suppliers', label: 'الموردون فقط' }, { value: 'contractors', label: 'المقاولون فقط' }]} />
        <span className="rp-grow" />
        <Button disabled={!project} onClick={() => project && download(projectSummaryExportUrl(project, parties))}>تصدير Excel</Button>
        <Button kind="primary" disabled={!q.data || busy} onClick={pdf}>{busy ? 'جارٍ إنشاء PDF…' : 'طباعة / حفظ PDF'}</Button>
      </div>
      <div className="rp-paper-wrap">
        {q.error && <EmptyState icon={null} title="تعذّر إعداد الملخّص" body={q.error} cta="إعادة المحاولة" onCta={q.reload} />}
        {!q.error && q.loading && <Skeleton rows={6} />}
        {!q.error && !q.loading && !project && scopes.data && <EmptyState title="لا مشاريع للاختيار منها بعد" />}
        {q.data && !q.loading && <Sheet d={q.data} />}
      </div>
    </div>
  );
}

function Sheet({ d }: { d: ProjectSummaryPayload }) {
  const t = d.totals;
  return (
    <article className="rp-paper rp-wide" aria-label="ملخّص المشروع">
      <header className="rp-head">
        <img src={logoFull} alt="" className="rp-logo-img" />
        <div><b>شركة إعمار الخليج المصرية للمقاولات</b><span>الإدارة المالية — الفرع الرئيسي</span></div>
      </header>
      <h3>ملخّص المشروع</h3>
      <p className="rp-sub">المشروع: {d.project} · حتى {dateTxt(d.today, { year: true })} · جميع الأرقام بالريال السعودي</p>
      {d.contractorScopeNote && <p className="rp-sub">{d.contractorScopeNote}</p>}
      {/* كل مسمّى يحمل نطاقه «في هذا المشروع» — نفس الكلمات في التقرير العام بأرقام أخرى */}
      <div className="rp-kpis rp-k4">
        <PKpi label="المفوتر في هذا المشروع" value={t.totalInvoiced} />
        <PKpi label="المسدد في هذا المشروع" value={t.totalPaid} tone="ok" />
        <PKpi label="المديونية المفتوحة في هذا المشروع" value={t.outstanding} />
        <PKpi label="المتأخر في هذا المشروع (موردون فقط)" value={t.delayedAmount} tone={t.delayedAmount ? 'danger' : undefined} />
      </div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>اسم الشركة</th><th>رقم الحساب</th><th>النوع</th><th className="n">إجمالي المفوتر</th><th className="n">المسدد</th>
          <th className="n">المديونية المفتوحة</th><th className="n">المتأخر</th><th>أقصى تأخر</th><th>آخر دفعة</th></tr></thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.partyKind + '-' + r.account}>
              <td className="rp-nowrap">{r.name}<PartyPill kind={r.partyKind} /></td>
              <td className="num">{r.account}</td><td>{r.partyKind === 'contractor' ? 'مقاول' : 'مورد'}</td>
              <td className="n"><Money value={r.totalInvoiced} /></td><td className="n"><Money value={r.totalPaid} /></td>
              <td className="n"><Money value={r.outstanding} /></td>
              {r.delay ? (
                <>
                  <td className="n"><Money value={r.delay.amount} className={r.delay.amount > 0 ? 't-danger' : undefined} /></td>
                  <td>{r.delay.days > 0 ? `${digits(r.delay.days)} يوم` : '—'}</td>
                </>
              ) : (
                <td colSpan={2} className="rp-muted" title="حسابات المقاولين دفتر جارٍ بلا تواريخ استحقاق، فلا يُحسب لها تأخر">— (لا يُحسب للمقاولين)</td>
              )}
              <td className="rp-nowrap">{lastPaymentText(r.lastPayment)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <td colSpan={3}>الإجمالي ({digits(t.companyCount)} شركة)</td>
          <td className="n"><Money value={t.totalInvoiced} /></td><td className="n"><Money value={t.totalPaid} /></td>
          <td className="n"><Money value={t.outstanding} /></td><td className="n"><Money value={t.delayedAmount} /></td>
          <td>{t.maxDelayDays > 0 ? `${digits(t.maxDelayDays)} يوم` : '—'}</td><td />
        </tr></tfoot>
      </table></div>
      <p className="rp-cap">المتأخر يُحسب للموردين فقط من تاريخ استحقاق كل فاتورة؛ حسابات المقاولين دفتر جارٍ مدين/دائن بلا تاريخ استحقاق، فلا معنى محاسبياً لحساب تأخره.</p>
    </article>
  );
}
