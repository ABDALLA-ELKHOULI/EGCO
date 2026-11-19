/**
 * «سجل الاستيراد» (P-290..298) + «الحركات المكرّرة القائمة» (P-299).
 *
 * الفرز والتصفية على الخادم على المجموعة كاملةً — القائمة تكبر باستمرار. الطيّ يُتذكَّر
 * (`egco.import.historyOpen`، افتراضي مفتوح) ولا جلب وهو مطوي.
 */
import { useRef, useState } from 'react';
import { Button, Chip, DataTable, Island, Modal, Money, Num, Pill, ago, confirm, dateTxt, setUiPref, toast, uiPref, usePrefs, type Column } from '@/ui';
import { useGo } from '@/app/routes';
import { deleteImportRow, isImportFailed, useDuplicates, useImportHistory } from '../hooks/useImportHistory';
import { errMsg } from '../api';
import { Callout } from './parts';
import type { ImportHistoryRow } from '../types';

const OPEN_KEY = 'egco.import.historyOpen';

const RECONCILED = [{ value: '', label: 'الكل' }, { value: 'yes', label: 'مطابق' }, { value: 'no', label: 'غير مطابق' }];
const RANGE = [{ value: '', label: 'كل الأوقات' }, { value: '7', label: 'آخر ٧ أيام' }, { value: '30', label: 'آخر ٣٠ يوماً' }];

function isoDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function HistorySection({ reloadToken, onPickFiles, onChanged }: {
  reloadToken: number; onPickFiles: () => void; onChanged: () => void;
}) {
  usePrefs();
  const go = useGo();
  const [open, setOpenState] = useState<boolean>(() => uiPref<boolean>(OPEN_KEY, true));
  const setOpen = (v: boolean) => { setOpenState(v); setUiPref(OPEN_KEY, v); };
  const h = useImportHistory(reloadToken, open);
  const [range, setRange] = useState('');
  const [forceRow, setForceRow] = useState<ImportHistoryRow | null>(null);
  // خيارات «النوع» من الخادم نفسه (source ← detected) تتراكم مما رأيناه — لا قائمة أنواع
  // مكتوبة في الواجهة، فقارئ جديد يظهر نوعه هنا تلقائياً.
  const seenTypes = useRef(new Map<string, string>());
  for (const r of h.rows ?? []) if (r.source && !seenTypes.current.has(r.source)) seenTypes.current.set(r.source, r.detected || r.source);

  const partyCell = (r: ImportHistoryRow) => {
    const label = r.partyName ?? r.account ?? '—';
    // بادئة الحساب تحسم النوع: ٢١١ مورد · ٢١٢ مقاول (CLAUDE.md §٢)
    if (r.account?.startsWith('211')) return <button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); go('parties.supplier', { account: r.account }); }}>{label}</button>;
    if (r.account?.startsWith('212')) return <button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); go('parties.contractor', { code: r.account }); }}>{label}</button>;
    return label;
  };

  async function doDelete(row: ImportHistoryRow, force: boolean) {
    try {
      const r = await deleteImportRow(row, force);
      if (r.kind === 'needs-force') { setForceRow(row); return; }
      setForceRow(null);
      toast(`حُذف ${r.n} حركة من «${row.fileName || 'بلا اسم'}» — تحدّثت أرصدة ${row.partyName ?? row.account ?? 'الطرف المرتبط'} فوراً. يمكن استرجاعها من المحذوفات.`, { kind: 'ok' });
      h.refetch(); onChanged();
    } catch (e) { toast(errMsg(e), { kind: 'error' }); }
  }

  async function askDelete(row: ImportHistoryRow) {
    const ok = await confirm({
      title: 'تأكيد حذف ملف مستورد', danger: true, confirmLabel: 'حذف حركاته',
      body: <>سيُحذف <b className="num">{row.linkedRows || row.added}</b> حركة مستوردة من ملف «{row.fileName || 'بلا اسم'}» لحساب {row.partyName ?? row.account ?? '—'} — البيانات اليدوية لا تُمس، والمحذوف يبقى في سلة المحذوفات.</>,
    });
    if (ok) await doDelete(row, false);
  }

  const columns: Column<ImportHistoryRow>[] = [
    { key: 'date', label: 'التاريخ', render: (r) => <span data-testid="import-history-row" data-id={r.id}>{dateTxt(r.date.slice(0, 10))}<div className="cap">{ago(r.date)}</div></span>, required: true },
    { key: 'fileName', label: 'الملف', render: (r) => <span title={r.path}>{r.fileName ? <b>{r.fileName}</b> : <span className="cap">— بلا اسم ملف —</span>}</span> },
    { key: 'detected', label: 'النوع', render: (r) => <>{r.detected}{isImportFailed(r) && <> <Pill tone="danger">فشل</Pill></>}</> },
    { key: 'partyName', label: 'الطرف المرتبط', render: partyCell },
    // عمودان لا واحد (م-٣٧): صفر «مضاف» قد يعني «كلها مطابقة مسبقاً» أو «فشل».
    { key: 'linkedRows', label: 'مضاف', num: true, render: (r) => (r.legacy ? <><Num value={r.added} int /> <Pill tone="warn">قديم</Pill></> : <Num value={r.linkedRows} int />) },
    { key: 'skipped', label: 'مطابق مسبقاً', num: true, sort: false, render: (r) => <Num value={r.skipped} int /> },
    { key: 'reconciled', label: 'مطابق', render: (r) => <Pill tone={r.reconciled ? 'ok' : 'danger'}>{r.reconciled ? 'مطابق' : 'غير مطابق'}</Pill> },
    { key: '_a', label: '', sort: false, required: true, render: (r) => (
      <Button size="sm" disabled={!r.canDelete} title={r.canDelete ? 'حذف حركات هذا الملف' : 'يُدار من شاشته الخاصة'}
        onClick={(e) => { e.stopPropagation(); void askDelete(r); }}>حذف حركاته</Button>
    ) },
  ];

  const f = h.filters;
  return (
    <>
      <Island i={3} title={
        <button type="button" className="collapse-h" aria-expanded={open} onClick={() => setOpen(!open)}>
          سجل الاستيراد{h.rows ? <> (<Num value={h.rows.length} int />)</> : null}
          <span className="cap">{open ? 'اضغط للطيّ' : 'اضغط للعرض'}</span>
        </button>}>
        {open && (
          <div className="hfilters">
            <div className="filters">
              {RANGE.map((o) => <Chip key={o.value} pressed={range === o.value} onClick={() => {
                setRange(o.value); h.setFilter('dateFrom', o.value ? isoDaysAgo(Number(o.value)) : ''); h.setFilter('dateTo', '');
              }}>{o.label}</Chip>)}
              {RECONCILED.map((o) => <Chip key={'r' + o.value} pressed={f.reconciled === o.value} onClick={() => h.setFilter('reconciled', o.value)}>{o.label}</Chip>)}
            </div>
            <div className="fgrid">
              <label className="fld"><span className="cap">الطرف (اسم أو رقم حساب)</span>
                <input value={f.party} onChange={(e) => h.setFilter('party', e.target.value)} /></label>
              <div className="fgrid">
                <label className="fld"><span className="cap">مضاف — من</span>
                  <input type="number" min={0} dir="ltr" value={f.minMoves} onChange={(e) => h.setFilter('minMoves', e.target.value)} /></label>
                <label className="fld"><span className="cap">إلى</span>
                  <input type="number" min={0} dir="ltr" value={f.maxMoves} onChange={(e) => h.setFilter('maxMoves', e.target.value)} /></label>
              </div>
            </div>
            {h.error && <Callout tone="bad">{h.error} <Button size="sm" onClick={h.refetch}>إعادة المحاولة</Button></Callout>}
            {h.rows && (
              <DataTable<ImportHistoryRow>
                id="data.import.history" mode="server" rows={h.rows} rowKey="id" columns={columns}
                sort={{ key: 'date', dir: 'desc' }}
                filters={[{ key: 'source', label: 'النوع', options: [...seenTypes.current].map(([value, label]) => ({ value, label })) }]}
                searchPlaceholder="اسم الملف…"
                onQueryChange={(q) => {
                  h.setFilter('fileName', q.q);
                  h.setSort(q.sort ? { key: q.sort.key, dir: q.sort.dir } : null);
                  h.setFilter('source', q.filters.source ?? '');
                }}
                toolbar={h.filtering ? <Button size="sm" onClick={() => { h.clear(); setRange(''); }}>مسح التصفية</Button> : undefined}
                empty={h.filtering
                  ? { icon: 'search', title: 'لا نتائج مطابقة', body: 'لم تطابق التصفية أي ملف مرفوع.', cta: 'مسح التصفية', onCta: () => { h.clear(); setRange(''); } }
                  : { icon: 'file', title: 'لا ملفات مرفوعة بعد', body: 'ابدأ برفع كشف حساب أو ملف مدد الموردين لتظهر هنا.', cta: 'اختيار ملفات', onCta: onPickFiles }}
              />
            )}
          </div>
        )}
      </Island>

      {forceRow && (
        <Modal open onClose={() => setForceRow(null)} title="ملف قديم — الحذف تقريبي" size="md"
          actions={[{ label: 'إلغاء' }, { label: 'حذف تقريبي — متابعة', kind: 'danger', onClick: async (c) => { await doDelete(forceRow, true); c(true); } }]}>
          <p>
            هذا الملف رُفع قبل توفّر ربط الحركات بملفها، فحركاته غير مربوطة به مباشرة. سيُحذف تقريبياً كل حركة لحساب
            {' '}{forceRow.partyName ?? forceRow.account ?? '—'} أُنشئت خلال ٣ دقائق من وقت رفع «{forceRow.fileName}» —
            قد يشمل ذلك حركات لا علاقة لها بهذا الملف تحديداً.
          </p>
        </Modal>
      )}
    </>
  );
}

/**
 * الحركات المكرّرة القائمة — ما استقر في البيانات قبل إصلاح القارئ. لا حذف تلقائي:
 * ثبت وجود أزواج مشروعة (فاتورتان متتاليتان بنفس المبلغ والسند).
 */
export function DuplicatesSection({ reloadToken, onChanged }: { reloadToken: number; onChanged: () => void }) {
  usePrefs();
  const d = useDuplicates(reloadToken);
  const [open, setOpen] = useState(false);
  if (!d.data || d.data.count === 0) return null;
  return (
    <Island i={4} crit title={
      <button type="button" className="collapse-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Num value={d.data.count} int /> حركة مكرّرة محتملة · <Money value={d.data.totalAmount} />
        <span className="cap">{open ? 'اضغط للإخفاء' : 'اضغط للمراجعة'}</span>
      </button>}>
      {open && (
        <>
          <p className="cap">نفس الطرف والتاريخ والمبلغ والسند. راجع الوصفين واحذف الصف الزائد — لا يُحذف شيء تلقائياً، وبعض الأزواج قد تكون حركتين مشروعتين فعلاً. ما يُحذف يُسترجع من «المحذوفات».</p>
          {d.data.groups.map((g, gi) => (
            <div className="dupg" key={gi}>
              <div className="cap">
                <b>{g.party}</b> (<span className="num ltr">{g.account}</span>) · {dateTxt(g.date)} · <b className="t-danger"><Money value={g.amount} /></b>
                {g.doc && <> · سند {g.doc}</>}
              </div>
              {g.rows.map((r) => (
                <div className="duprow" key={r.id}>
                  <span>{r.number && <span className="cap">رقم {r.number} · </span>}{r.description || '—'}</span>
                  <Button size="sm" disabled={d.busy === r.id} onClick={async () => {
                    try { await d.remove(g.kind, r.id); toast('حُذف الصف — في المحذوفات', { kind: 'ok' }); onChanged(); }
                    catch (e) { toast(errMsg(e), { kind: 'error' }); }
                  }}>{d.busy === r.id ? '…' : 'حذف هذا الصف'}</Button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </Island>
  );
}
