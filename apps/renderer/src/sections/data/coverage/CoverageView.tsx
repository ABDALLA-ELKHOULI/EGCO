/**
 * تغطية الكشوفات (P-245..252) — من رُفعت له كشوفات ومن لا. الحالات والعتبة (٩٠ يوماً)
 * من الخادم كما هي؛ لا نعيد تقسيمها في الواجهة (النموذج يقترح ٣٠/٦٠ — يحتاج الخادم).
 * «اطلب كشفاً» من النموذج: نص جاهز للنسخ، لا إرسال.
 */
import { useState } from 'react';
import { Button, DataTable, Grid, Island, Kpi, Modal, Num, PageHeader, Pill, dateTxt, toast, usePrefs, type Column } from '@/ui';
import { useGo } from '@/app/routes';
import { useCoverage } from '../hooks/useCoverage';
import { COVERAGE_CHIP } from '../lib/labels';
import { Callout, toneToPill } from '../import/parts';
import type { CoverageRow } from '../types';
import '../data.css';

function askText(r: CoverageRow) {
  const today = new Date().toISOString().slice(0, 10);
  return `السادة / ${r.name}\nالسلام عليكم ورحمة الله وبركاته،\n\nنرجو تزويدنا بكشف حساب محدّث لحسابكم رقم ${r.account} لدينا حتى تاريخ ${today}، `
    + (r.daysSinceLast == null ? 'إذ لا يوجد لدينا كشف مرفوع لكم حتى الآن' : `إذ إن آخر حركة لدينا عمرها ${r.daysSinceLast} يوماً`)
    + '، وذلك لمطابقة الأرصدة.\n\nويفضَّل أن يكون الكشف بصيغة PDF أو Excel.\n\nمع الشكر،\nالإدارة المالية — EGCO';
}

export default function CoverageView() {
  usePrefs();
  const go = useGo();
  const c = useCoverage(90);
  const [adv, setAdv] = useState(false);
  const [ask, setAsk] = useState<CoverageRow | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const d = c.data;
  const f = c.filters;

  const columns: Column<CoverageRow>[] = [
    { key: 'name', label: 'المورد', required: true, searchValue: (r) => r.name + ' ' + r.account,
      render: (r) => <><button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); go('parties.supplier', { account: r.account }); }}>{r.name}</button><div className="cap num ltr">{r.account}</div></> },
    { key: 'project', label: 'المشروع', render: (r) => r.project || <span className="dash">—</span> },
    { key: 'firstActivity', label: 'أول حركة', date: true, hidden: true, value: (r) => r.firstActivity },
    { key: 'lastActivity', label: 'آخر حركة', date: true, value: (r) => r.lastActivity },
    { key: 'daysSinceLast', label: 'منذ', num: true, sortValue: (r) => r.daysSinceLast ?? -1,
      render: (r) => (r.daysSinceLast == null ? <span className="dash">—</span> : <><Num value={r.daysSinceLast} int /> يوماً</>) },
    { key: 'invoiceCount', label: 'الفواتير', num: true, render: (r) => <Num value={r.invoiceCount} int /> },
    // م-١٨: نفس الاسم في كل الشاشات لهذا الرقم.
    { key: 'outstanding', label: 'المديونية المفتوحة', money: true },
    { key: 'state', label: 'الحالة', render: (r) => { const p = COVERAGE_CHIP[r.state]; return <Pill tone={toneToPill(p.tone)}>{p.text}</Pill>; } },
    { key: '_a', label: '', sort: false, render: (r) => (r.state === 'ok' ? null
      : <Button size="sm" onClick={(e) => { e.stopPropagation(); setAsk(r); setAskDraft(askText(r)); }}>اطلب كشفاً</Button>) },
  ];

  const range = (label: string, a: keyof typeof f, b: keyof typeof f, type: 'date' | 'number') => (
    <div className="fgrid">
      <label className="fld"><span className="cap">{label} — من</span><input type={type} dir="ltr" value={f[a]} onChange={(e) => c.setFilter(a, e.target.value)} /></label>
      <label className="fld"><span className="cap">إلى</span><input type={type} dir="ltr" value={f[b]} onChange={(e) => c.setFilter(b, e.target.value)} /></label>
    </div>
  );

  return (
    <div className="sec-data">
      <PageHeader title="تغطية الكشوفات" sub={d ? <>حالة الكشوفات المرفوعة لكل مورد — حتى {dateTxt(d.asOf)}</> : 'حالة الكشوفات المرفوعة لكل مورد'} />
      <Grid>
        {c.error && <Island><Callout tone="bad">{c.error} <Button size="sm" onClick={c.refetch}>إعادة المحاولة</Button></Callout></Island>}
        {d && (
          <>
            <Kpi i={0} span={4} label="نسبة التغطية" value={d.totals?.coveredPct ?? null} money={false} size="hero" hint="٪ من الموردين بكشوفات محدَّثة" />
            <Kpi i={1} span={4} label={<>كشوفاتهم قديمة (+<Num value={d.staleDays} int /> يوماً)</>} value={d.totals?.stale ?? 0} money={false} tone="warn" />
            <Kpi i={2} span={4} label="موردون بلا كشوفات" value={d.totals?.withoutData ?? 0} money={false}
              tone={(d.totals?.withoutData ?? 0) > 0 ? 'danger' : undefined} crit={(d.totals?.withoutData ?? 0) > 0} />
            <Island i={3}>
              <Callout>أرقام «اليوم» مبنية على الموردين الذين رُفعت كشوفاتهم فقط — الموردون بلا كشوفات أدناه غير محسوبين فيها.</Callout>
              <div className="rowacts">
                <Button size="sm" onClick={() => setAdv(!adv)} aria-expanded={adv}>{adv ? 'إخفاء التصفية المتقدمة' : 'تصفية متقدمة'}</Button>
                {c.filtering && <Button size="sm" onClick={c.clear}>مسح كل التصفية</Button>}
              </div>
              {adv && (
                <div className="fgrid">
                  {range('أول حركة', 'firstFrom', 'firstTo', 'date')}
                  {range('آخر حركة', 'lastFrom', 'lastTo', 'date')}
                  {range('منذ (يوماً)', 'sinceMin', 'sinceMax', 'number')}
                  {range('الفواتير', 'invMin', 'invMax', 'number')}
                  {range('المديونية المفتوحة (ر.س)', 'outMin', 'outMax', 'number')}
                </div>
              )}
              <DataTable<CoverageRow>
                id="data.coverage" rows={c.rows} rowKey="account" columns={columns}
                sort={{ key: 'daysSinceLast', dir: 'desc' }}
                searchPlaceholder="اسم المورد أو رقم الحساب…"
                filters={[
                  { key: 'state', label: 'الحالة', options: (['none', 'stale', 'ok'] as const).map((s) => ({ value: s, label: COVERAGE_CHIP[s].text, test: (r: CoverageRow) => r.state === s })) },
                  { key: 'project', label: 'المشروع', options: c.projects.map((p) => ({ value: p, label: p, test: (r: CoverageRow) => r.project === p })) },
                ]}
                rowClass={(r) => (r.state === 'none' ? 'row-overdue' : r.state === 'stale' ? 'row-due-soon' : undefined)}
                total={{ keys: ['outstanding'], label: 'الإجمالي' }}
                onRowClick={(r) => go('parties.supplier', { account: r.account })}
                empty={{ icon: 'search', title: 'لا نتائج مطابقة', body: 'لم يطابق البحث أو التصفية أي مورد.', cta: c.filtering ? 'مسح التصفية' : undefined, onCta: c.filtering ? c.clear : undefined }}
              />
            </Island>
          </>
        )}
      </Grid>

      {ask && (
        <Modal open onClose={() => setAsk(null)} title={`طلب كشف حساب — ${ask.name}`} size="md"
          actions={[
            { label: 'نسخ النص', kind: 'primary', onClick: async () => {
              try { await navigator.clipboard.writeText(askDraft); toast('نُسخ النص', { kind: 'ok' }); }
              catch { toast('حدِّد النص وانسخه يدوياً', { kind: 'error' }); }
            } },
            { label: 'إغلاق' },
          ]}>
          <div className="sec-data">
            <p className="cap">انسخ النص وأرسله بالبريد أو واتساب — التطبيق لا يرسل رسائل.</p>
            <textarea className="ta" rows={11} aria-label="نص الطلب" value={askDraft} onChange={(e) => setAskDraft(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
