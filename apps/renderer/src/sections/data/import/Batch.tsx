/**
 * رفع مجلد كامل (P-282..287): فحص ← «رفع الكل» ← جدول النتيجة مع إجراء لكل صف
 * (تصنيف، إنشاء مورد، إنقاذ AI). الحالة تُعرض كما أرسلها الخادم؛ غير المعروف بنصّه.
 */
import { useState } from 'react';
import { Button, DataTable, Island, Modal, Num, Pill, usePrefs, type Column } from '@/ui';
import { BATCH_CHIP, isBatchSaved } from '../lib/labels';
import { errMsg } from '../api';
import { BatchSummaryBanner, BundleSummary, Callout, NearDuplicateNotice, NewPartyPanel, toneToPill } from './parts';
import type { ImportSession } from '../hooks/useImportSession';
import type { BatchRow, ImportPayload } from '../types';

export function BatchScanCard({ s }: { s: ImportSession }) {
  usePrefs();
  if (!s.scan || s.batch) return null;
  // التوزيع حسب ما صنّفه الخادم (source) — بلا قائمة أنواع ثابتة.
  const bySource = new Map<string, number>();
  for (const f of s.scan.files) bySource.set(f.source, (bySource.get(f.source) ?? 0) + 1);
  return (
    <Island i={1} title="نتيجة فحص المجلد" actions={<span className="cap ltr">{s.scan.dir}</span>}>
      <p>وُجد <Num value={s.scan.files.length} int /> ملفاً{bySource.size > 0 && ': '}
        {[...bySource].map(([src, n], i) => <span key={src}>{i > 0 && ' · '}<Num value={n} int /> <span className="cap ltr">{src}</span></span>)}
      </p>
      {s.scan.skipped.length > 0 && (
        <details className="errs"><summary>تُجوهل <Num value={s.scan.skipped.length} int /> ملفاً</summary>
          <ul>{s.scan.skipped.map((k, i) => <li key={k.name + i}>{k.name} — {k.reason}</li>)}</ul>
        </details>
      )}
      <div className="rowacts">
        <Button kind="primary" disabled={s.batchBusy || s.scan.files.length === 0} onClick={() => void s.uploadBatch()}>
          {s.batchBusy ? 'جارٍ الرفع…' : <>رفع الكل (<Num value={s.scan.files.length} int />)</>}
        </Button>
        <Button onClick={s.reset} disabled={s.batchBusy}>إلغاء</Button>
      </div>
    </Island>
  );
}

export function BatchResultCard({ s, aiEnabled, onClassify, onRescue }: {
  s: ImportSession; aiEnabled: boolean;
  onClassify: (r: BatchRow) => void; onRescue: (r: BatchRow) => void;
}) {
  usePrefs();
  const [resolve, setResolve] = useState<{ row: BatchRow; data: ImportPayload } | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const b = s.batch;
  if (!b) return null;

  async function openResolve(row: BatchRow) {
    setErr(null); setLoadingPath(row.path);
    try { setResolve({ row, data: await s.loadBatchNewParty(row) }); } catch (e) { setErr(errMsg(e)); } finally { setLoadingPath(null); }
  }

  const columns: Column<BatchRow>[] = [
    { key: 'name', label: 'الملف', render: (r) => <b>{r.name}</b> },
    { key: 'detected', label: 'النوع', render: (r) => r.detected ?? <span className="cap ltr">{r.source}</span> },
    { key: 'party', label: 'الطرف', value: (r) => r.supplierName ?? r.account ?? '', render: (r) => r.supplierName ?? r.account ?? <span className="dash">—</span> },
    { key: 'status', label: 'الحالة', render: (r) => { const c = BATCH_CHIP[r.status] ?? { text: r.status, tone: 'neutral' as const }; return <Pill tone={toneToPill(c.tone)}>{c.text}</Pill>; } },
    { key: 'details', label: 'تفاصيل', sort: false, render: (r) => (
      <span className="rowacts tight">
        <span className="cap">{r.status === 'saved' ? <>أُضيف <Num value={r.added ?? 0} int />، تُجوهل <Num value={r.skipped ?? 0} int /></> : (r.message ?? '—')}</span>
        {aiEnabled && (r.status === 'read_error' || r.status === 'no_account') && <Button size="sm" onClick={() => onRescue(r)}>محاولة القراءة بالذكاء الاصطناعي</Button>}
        {r.status === 'needs_classification' && <Button size="sm" onClick={() => onClassify(r)}>تصنيف…</Button>}
        {r.status === 'unknown_supplier' && <Button size="sm" disabled={loadingPath === r.path} onClick={() => void openResolve(r)}>{loadingPath === r.path ? 'جارٍ التحميل…' : 'إنشاء المورد…'}</Button>}
      </span>
    ) },
  ];

  return (
    <Island i={1} title="نتيجة الرفع">
      <div className="stack">
        {err && <Callout tone="bad">{err}</Callout>}
        <BatchSummaryBanner total={b.total} saved={b.saved}
          duplicates={b.duplicates ?? b.results.filter((r) => r.status === 'duplicate').length}
          failures={b.results.filter((r) => !isBatchSaved(r.status)).map((r) => ({ name: r.name, reason: r.message ?? BATCH_CHIP[r.status]?.text ?? r.status }))} />
        {/* ملفات بحسابات متعددة: ما لم يُحفظ منها يُعرض خارج الجدول — لا يختفي في خلية. */}
        {b.results.filter((r) => r.bundle && (r.problems ?? []).length > 0).map((r) => (
          <Callout key={'b' + r.path} tone="warn"><b>{r.name}</b><BundleSummary data={r} saved /></Callout>
        ))}
        {/* التحذير خارج الجدول: يخصّ أرقاماً لا حالة ملف — وهو أهم ما في الشاشة. */}
        {b.results.filter((r) => (r.nearDuplicates ?? []).length > 0).map((r) => (
          <NearDuplicateNotice key={r.path} items={r.nearDuplicates ?? []} title={`تكرار محتمل — ${r.supplierName ?? r.account ?? r.name}`} />
        ))}
        <DataTable<BatchRow> id="data.import.batch" rows={b.results} rowKey="path" columns={columns} search={false} />
      </div>
      {resolve && (
        <Modal open onClose={() => setResolve(null)} title="حساب جديد لم نره من قبل" size="md">
          <div className="sec-data">
            <NewPartyPanel fileName={resolve.row.name} data={resolve.data}
              onConfirm={async (f) => { await s.confirmBatchNewParty(resolve.row, f); setResolve(null); }}
              onDecline={() => { s.declineBatchNewParty(resolve.row); setResolve(null); }} />
          </div>
        </Modal>
      )}
    </Island>
  );
}
