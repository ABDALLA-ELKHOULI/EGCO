import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { ar, sar } from '@/lib/format';
import { Card, Pill, State } from '@/components/ui';
import type { PickedFile } from '@/types/global';

const LABEL: Record<string, string> = {
  pdf_statement: 'كشف حساب مورد (PDF)',
  csv_statement: 'كشف حساب مورد (CSV)',
  suppliers_excel: 'ملف مدد الموردين (Excel)',
};

type QueueStatus =
  | 'pending'       // بانتظار المعالجة
  | 'reading'       // جارٍ القراءة
  | 'ready'         // جاهز للحفظ (ملفات الموردين)
  | 'reconciled'    // ✓ مطابق
  | 'unreconciled'  // ✕ غير مطابق
  | 'read_error'    // خطأ قراءة
  | 'saving'
  | 'saved'
  | 'save_error'
  | 'excluded';     // مُستبعد

interface QueueItem {
  file: PickedFile;
  status: QueueStatus;
  preview?: any;
  saveResult?: any;
  error?: string;
}

const isStatementSource = (s: string) => s === 'pdf_statement' || s === 'csv_statement';

const isSavedStatus = (s: string) =>
  s === 'saved' || s === 'contractor_saved' || s === 'duplicate';

/**
 * ملخص بارز لنتيجة الدفعة — كان المستخدم يقرأ «تم» بينما لم يُحفظ أي صف
 * لأن حالة كل ملف كانت مدفونة في الجدول. الأخضر فقط عندما حُفظ الجميع؛
 * وإلا نُعدّد كل ملف لم يُحفظ مع سببه بالعربية.
 */
function BatchSummaryBanner({ total, saved, duplicates = 0, failures }: {
  total: number; saved: number; duplicates?: number;
  failures: { name: string; reason: string }[];
}) {
  const dupNote = duplicates > 0 ? ` و${ar(duplicates)} مكرر (مرفوع سابقاً)` : '';
  if (total > 0 && failures.length === 0) {
    return (
      <div className="callout ok">
        حُفظ {ar(saved)} من {ar(total)} ملفات{dupNote} — اكتمل الرفع بنجاح.
      </div>
    );
  }
  return (
    <div className="callout bad">
      <b>حُفظ {ar(saved)} من {ar(total)} ملفات{dupNote} — {ar(failures.length)} لم يُحفظ:</b>
      <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
        {failures.map((f, i) => (
          <li key={f.name + i}>{f.name} — {f.reason}</li>
        ))}
      </ul>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  pdf_statement: 'كشف PDF',
  csv_statement: 'كشف CSV',
  suppliers_excel: 'ملف موردين',
};

const BATCH_STATUS: Record<string, { text: string; kind: string }> = {
  saved: { text: 'تم الحفظ', kind: 'ok' },
  duplicate: { text: 'مكرر — سبق رفعه', kind: 'warn' },
  contractor_saved: { text: 'تم الحفظ', kind: 'ok' },
  not_reconciled: { text: 'غير مطابق', kind: 'red' },
  unknown_supplier: { text: 'مورد غير معروف', kind: 'warn' },
  no_account: { text: 'بلا رقم حساب', kind: 'warn' },
  read_error: { text: 'تعذّرت القراءة', kind: 'red' },
};

interface ScanResult {
  dir: string;
  files: { path: string; name: string; source: string; sizeKb: number }[];
  skipped: { name: string; reason: string }[];
}

interface BatchResult {
  total: number;
  saved: number;
  duplicates?: number;
  failed: number;
  results: {
    path: string; name: string; source: string; status: string;
    detected?: string;
    account?: string; supplierName?: string; added?: number; skipped?: number;
    computedBalance?: number; statementBalance?: number; message?: string;
  }[];
}

/**
 * الرفع — صف من الملفات، الموردون أولاً ثم الكشوفات (يتطابق مع متطلبات العقد).
 *
 * Multiple files can be picked at once. Suppliers files are reordered first because
 * statements can only reconcile against suppliers that already exist. Each file gets
 * its own status chip; nothing is saved until the user presses the single save button,
 * and only suppliers files plus reconciled statements are actually sent.
 */
export function ImportPage() {
  const nav = useNavigate();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // ---- وضع اختيار مجلد كامل ----
  const [folderErr, setFolderErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  function reset() {
    setQueue([]); setErr(null); setDone(false);
    setFolderErr(null); setScanning(false); setScanResult(null);
    setBatchBusy(false); setBatchResult(null);
  }

  async function pickFolder() {
    setFolderErr(null); setScanResult(null); setBatchResult(null);
    const egco = window.egco;
    if (!egco?.pickDirectory) {
      setFolderErr('اختيار مجلد متاح داخل التطبيق فقط — افتح «EGCO Dashboard» من مجلد التطبيقات.');
      return;
    }
    let dir: string | null = null;
    try {
      dir = await egco.pickDirectory();
    } catch (e: any) {
      setFolderErr(`تعذّر فتح نافذة اختيار المجلد: ${e?.message ?? e}`);
      return;
    }
    if (!dir) return; // المستخدم ألغى

    setScanning(true);
    try {
      const res = await api.scanDir(dir);
      setScanResult(res);
    } catch (e: any) {
      setFolderErr(e?.message ?? String(e));
    } finally {
      setScanning(false);
    }
  }

  async function uploadAll() {
    if (!scanResult) return;
    setBatchBusy(true); setFolderErr(null);
    try {
      const paths = scanResult.files.map((f) => f.path);
      const res = await api.batchImport(paths);
      setBatchResult(res);
    } catch (e: any) {
      setFolderErr(e?.message ?? String(e));
    } finally {
      setBatchBusy(false);
    }
  }

  function patch(idx: number, upd: Partial<QueueItem>) {
    setQueue((q) => q.map((it, i) => (i === idx ? { ...it, ...upd } : it)));
  }

  async function pick() {
    setErr(null); setDone(false);
    if (!window.egco?.pickFiles) {
      setErr('اختيار الملفات متاح داخل التطبيق فقط — افتح «EGCO Dashboard» من مجلد التطبيقات.');
      return;
    }
    let picked: PickedFile[] = [];
    try {
      picked = await window.egco.pickFiles();
    } catch (e: any) {
      setErr(`تعذّر فتح نافذة اختيار الملفات: ${e?.message ?? e}`);
      return;
    }
    if (!picked.length) return;              // المستخدم ألغى

    // الموردون أولاً، ثم الكشوفات
    const ordered = [
      ...picked.filter((p) => p.source === 'suppliers_excel'),
      ...picked.filter((p) => isStatementSource(p.source)),
    ];
    const items: QueueItem[] = ordered.map((file) => ({
      file,
      status: isStatementSource(file.source) ? 'pending' : 'ready',
    }));
    setQueue(items);

    // معاينة تسلسلية للكشوفات فقط
    for (let i = 0; i < items.length; i++) {
      if (!isStatementSource(items[i].file.source)) continue;
      patch(i, { status: 'reading' });
      try {
        const preview = await api.previewImport(items[i].file.path, items[i].file.source);
        patch(i, { status: preview?.reconciled ? 'reconciled' : 'unreconciled', preview });
      } catch (e: any) {
        patch(i, { status: 'read_error', error: e?.message ?? String(e) });
      }
    }
  }

  async function saveAll() {
    setBusy(true); setErr(null);
    try {
      setQueue((q) => {
        const next = q.map((it) => {
          if (it.status === 'unreconciled' || it.status === 'read_error') {
            return { ...it, status: 'excluded' as QueueStatus };
          }
          return it;
        });
        return next;
      });

      // نعيد قراءة الصف الحالي بعد التحديث أعلاه عبر إغلاق متزامن
      const current = queue;
      const order = [
        ...current.map((it, i) => ({ it, i })).filter(({ it }) => it.status === 'ready'),
        ...current.map((it, i) => ({ it, i })).filter(({ it }) => it.status === 'reconciled'),
      ];

      for (const { i } of order) {
        const item = current[i];
        patch(i, { status: 'saving' as QueueStatus });
        try {
          const res = await api.runImport(item.file.path, item.file.source);
          patch(i, { status: 'saved' as QueueStatus, saveResult: res });
        } catch (e: any) {
          patch(i, { status: 'save_error' as QueueStatus, error: e?.message ?? String(e) });
        }
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  const savable = queue.filter((it) => it.status === 'ready' || it.status === 'reconciled');
  const stillReading = queue.some((it) => it.status === 'pending' || it.status === 'reading');
  const canSave = queue.length > 0 && !busy && !stillReading && savable.length > 0 && !done;

  const nothingPickedYet = queue.length === 0 && !scanResult && !batchResult;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>رفع ملفات</h1>
          <p>كشف حساب مورد (PDF/CSV) أو ملف مدد الموردين (Excel) — ملفات منفردة أو مجلد كامل دفعة واحدة</p>
        </div>
        {(queue.length > 0 || scanResult || batchResult) && (
          <button className="btn" onClick={reset}>اختيار من جديد</button>
        )}
      </div>

      <div className="stack">
        {nothingPickedYet && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" onClick={pick}>اختيار ملفات</button>
            <button className="btn" onClick={pickFolder} disabled={scanning}>
              {scanning ? 'جارٍ فحص المجلد…' : 'اختيار مجلد كامل'}
            </button>
          </div>
        )}

        {nothingPickedYet && (
          <div className="dropzone" onClick={pick}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>اضغط لاختيار الملفات (يمكن تحديد أكثر من ملف)</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              الصيغ المقبولة: PDF · Excel (XLSX/XLSM) · CSV
            </div>
          </div>
        )}

        {folderErr && <div className="callout bad">{folderErr}</div>}
        {err && <div className="callout bad">{err}</div>}

        {/* ---- نتيجة فحص المجلد ---- */}
        {scanResult && !batchResult && (
          <Card title="نتيجة فحص المجلد" sub={scanResult.dir}>
            <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                وُجد {ar(scanResult.files.length)} ملفاً: {ar(scanResult.files.filter((f) => f.source === 'pdf_statement').length)} كشف PDF
                {' '}· {ar(scanResult.files.filter((f) => f.source === 'csv_statement').length)} كشف CSV
                {' '}· {ar(scanResult.files.filter((f) => f.source === 'suppliers_excel').length)} ملف موردين
              </div>
              {scanResult.skipped.length > 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  تُجوهل {ar(scanResult.skipped.length)} ملفاً:{' '}
                  {scanResult.skipped.map((s) => `${s.name} (${s.reason})`).join(' · ')}
                </div>
              )}
              <div>
                <button
                  className="btn primary"
                  onClick={uploadAll}
                  disabled={batchBusy || scanResult.files.length === 0}
                >
                  {batchBusy ? 'جارٍ الرفع…' : `رفع الكل (${ar(scanResult.files.length)})`}
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* ---- نتيجة الرفع الجماعي ---- */}
        {batchResult && (
          <Card title="نتيجة الرفع">
            <div style={{ padding: '14px 20px' }}>
              <div style={{ marginBottom: 10 }}>
                <BatchSummaryBanner
                  total={batchResult.total}
                  saved={batchResult.saved}
                  duplicates={batchResult.duplicates
                    ?? batchResult.results.filter((r) => r.status === 'duplicate').length}
                  failures={batchResult.results
                    .filter((r) => !isSavedStatus(r.status))
                    .map((r) => ({
                      name: r.name,
                      reason: r.message
                        ?? BATCH_STATUS[r.status]?.text
                        ?? r.status,
                    }))}
                />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>الملف</th><th>النوع</th><th>المورد</th><th>الحالة</th><th>تفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {batchResult.results.map((r, i) => {
                    const chip = BATCH_STATUS[r.status] ?? { text: r.status, kind: '' };
                    return (
                      <tr key={r.path + i}>
                        <td>{r.name}</td>
                        <td className="muted">{r.detected ?? SOURCE_LABEL[r.source] ?? r.source}</td>
                        <td>{r.supplierName ?? r.account ?? '—'}</td>
                        <td><Pill kind={chip.kind}>{chip.text}</Pill></td>
                        <td className="muted">
                          {r.status === 'saved'
                            ? `أُضيف ${ar(r.added ?? 0)}، تُجوهل ${ar(r.skipped ?? 0)}`
                            : (r.message ?? '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {done && (
          <BatchSummaryBanner
            total={queue.length}
            saved={queue.filter((it) => it.status === 'saved').length}
            failures={queue
              .filter((it) => it.status !== 'saved')
              .map((it) => ({
                name: it.file.name,
                reason: it.status === 'excluded'
                  ? (it.error ?? 'مُستبعد — لم يتطابق مع رصيد الكشف أو حدث خطأ قراءة')
                  : it.status === 'save_error'
                    ? (it.error ?? 'تعذّر الحفظ')
                    : (it.error ?? CHIP[it.status]?.text ?? it.status),
              }))}
          />
        )}

        {queue.map((item, i) => (
          <QueueCard key={item.file.path + i} item={item} />
        ))}

        {queue.length > 0 && !done && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" onClick={saveAll} disabled={!canSave}>
              {stillReading ? 'جارٍ القراءة…' : `حفظ الملفات المطابقة (${ar(savable.length)})`}
            </button>
            <button className="btn" onClick={reset}>إلغاء</button>
          </div>
        )}

        {(done || batchResult) && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" onClick={() => nav('/suppliers')}>عرض الموردين</button>
            <button className="btn" onClick={() => nav('/')}>لوحة اليوم</button>
            <button className="btn" onClick={reset}>رفع ملفات أخرى</button>
          </div>
        )}
      </div>
    </>
  );
}

function QueueCard({ item }: { item: QueueItem }) {
  const { file, status, preview, saveResult, error } = item;
  return (
    <Card>
      <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{file.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{LABEL[file.source] ?? file.source}</div>
          </div>
          <StatusChip status={status} />
        </div>

        {status === 'reading' && <State>جارٍ القراءة…</State>}

        {(status === 'reconciled' || status === 'unreconciled') && preview && (
          <div className="muted" style={{ fontSize: 12 }}>
            رقم الحساب: {preview.account ?? '—'} · فواتير: {ar(preview.invoiceCount)} · دفعات: {ar(preview.paymentCount)}
            {' '}· رصيد الكشف: {sar(preview.statementBalance ?? 0)} · المحسوب: {sar(preview.computedBalance)}
            {status === 'reconciled'
              ? ' — ✓ مطابق'
              : ` — ✕ غير مطابق (الفرق ${sar(preview.difference ?? 0)} ر.س)`}
          </div>
        )}

        {status === 'read_error' && (
          <div className="callout bad" style={{ margin: 0 }}>خطأ قراءة: {error}</div>
        )}

        {status === 'save_error' && (
          <div className="callout bad" style={{ margin: 0 }}>تعذّر الحفظ: {error}</div>
        )}

        {status === 'excluded' && (
          <div className="muted" style={{ fontSize: 12 }}>مُستبعد من الحفظ (لم يتطابق أو حدث خطأ قراءة)</div>
        )}

        {status === 'saved' && saveResult && (
          <div className="muted" style={{ fontSize: 12 }}>
            {isStatementSource(file.source)
              ? `تم الحفظ — أُضيف ${ar(saveResult.added ?? 0)}، تُجوهل ${ar(saveResult.skipped ?? 0)} مكرراً`
              : `تم الحفظ — ${ar(saveResult.imported ?? 0)} مورداً (${ar(saveResult.created ?? 0)} جديد، ${ar(saveResult.updated ?? 0)} محدَّث)`}
          </div>
        )}
      </div>
    </Card>
  );
}

const CHIP: Record<QueueStatus, { text: string; kind: string }> = {
  pending: { text: 'بانتظار المعالجة', kind: '' },
  reading: { text: 'جارٍ القراءة', kind: 'warn' },
  ready: { text: 'جاهز للحفظ', kind: '' },
  reconciled: { text: '✓ مطابق', kind: 'ok' },
  unreconciled: { text: '✕ غير مطابق', kind: 'red' },
  read_error: { text: 'خطأ قراءة', kind: 'red' },
  saving: { text: 'جارٍ الحفظ', kind: 'warn' },
  saved: { text: 'تم الحفظ', kind: 'ok' },
  save_error: { text: 'تعذّر الحفظ', kind: 'red' },
  excluded: { text: 'مُستبعد', kind: '' },
};

function StatusChip({ status }: { status: QueueStatus }) {
  const c = CHIP[status];
  return <Pill kind={c.kind}>{c.text}</Pill>;
}
