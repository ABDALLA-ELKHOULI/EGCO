import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiBase, ApiError } from '@/lib/api';
import type { ImportHistoryRow, ImportHistoryResponse } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Money, Pill, State } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { AiRescueModal } from '@/components/AiRescueModal';
import { useAiEnabled } from '@/lib/useAi';
import type { PickedFile } from '@/types/global';
import { Th, type SortState } from '@/components/ColumnMenu';

/**
 * الملفات المرفوعة تُطوى/تُفتح ويُتذكَّر ذلك — نفس نمط الشريط الجانبي
 * (Sidebar.tsx STORAGE_KEY): طيّ يُخفي المعلومة أسوأ من ألا يوجد طيّ أصلاً،
 * لذا الافتراضي هنا مفتوح؛ فقط تفضيل المستخدم الصريح يطويه لاحقاً.
 */
const HISTORY_OPEN_KEY = 'egco.import.historyOpen';

/**
 * جلب «الملفات المرفوعة» بمعاملات الفرز/التصفية — api.ts (ملَك فريق آخر) لا
 * يحمل هذه المعاملات على importHistory()، فهذا استدعاء مباشر يماثل منطق
 * call() الداخلي في api.ts (نفس معالجة الأخطاء) دون تعديل ذلك الملف.
 */
export interface ImportHistoryQuery {
  file_name?: string;
  source?: string;
  party?: string;
  date_from?: string;
  date_to?: string;
  min_moves?: number;
  max_moves?: number;
  reconciled?: string;
  sort?: string;
  dir?: string;
}

async function fetchImportHistory(q: ImportHistoryQuery): Promise<ImportHistoryResponse> {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') s.set(k, String(v));
  }
  const qsStr = s.toString();
  let res: Response;
  try {
    res = await fetch(apiBase() + '/api/v1/import/history' + (qsStr ? `?${qsStr}` : ''), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    throw new ApiError('تعذّر الاتصال بالخدمة المحلية — تأكد أنها تعمل ثم أعد المحاولة');
  }
  if (!res.ok) {
    let msg = `خطأ ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch { /* keep the status message */ }
    throw new ApiError(msg);
  }
  try {
    return (await res.json()) as ImportHistoryResponse;
  } catch {
    throw new ApiError('استجابة غير سليمة من الخدمة المحلية — أعد المحاولة');
  }
}

const LABEL: Record<string, string> = {
  pdf_statement: 'كشف حساب مورد (PDF)',
  csv_statement: 'كشف حساب مورد (CSV)',
  suppliers_excel: 'ملف مدد الموردين (Excel)',
  debts_report_xls: 'تقرير مديونيات مجمّع (Excel قديم .xls)',
};

type QueueStatus =
  | 'pending'       // بانتظار المعالجة
  | 'reading'       // جارٍ القراءة
  | 'ready'         // جاهز للحفظ (ملفات الموردين)
  | 'reconciled'    // ✓ مطابق
  | 'unreconciled'  // ✕ غير مطابق
  | 'debts_previewed' // تقرير مديونيات مجمّع — عُوين، لا بوابة مطابقة تمنع الحفظ
  | 'read_error'    // خطأ قراءة
  | 'saving'
  | 'saved'
  | 'save_error'
  | 'unknown_supplier' // الحساب مطابق لكنه غير موجود في ملف مدد الموردين — يحتاج قراراً
  | 'excluded';     // مُستبعد

interface QueueItem {
  file: PickedFile;
  status: QueueStatus;
  preview?: any;
  saveResult?: any;
  error?: string;
}

const isStatementSource = (s: string) => s === 'pdf_statement' || s === 'csv_statement';
const isDebtsReportSource = (s: string) => s === 'debts_report_xls';

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

/** طرف واحد من زوج «تكرار محتمل» كما ترسله الخدمة */
interface NearDupSide { number?: string | null; doc: string; description: string }

interface NearDuplicate {
  kind: string;                 // 'near_duplicate' | 'near_duplicate_more'
  scope?: 'file' | 'db';
  ledger?: string;              // invoice | payment | entry
  date?: string;
  amount?: number;
  message: string;
  a?: NearDupSide;
  b?: NearDupSide;
}

const ND_SCOPE: Record<string, string> = {
  file: 'داخل هذا الملف',
  db: 'مقابل حركة محفوظة سابقاً',
};

const ND_LEDGER: Record<string, string> = {
  invoice: 'فاتورة', payment: 'دفعة', entry: 'حركة',
};

/**
 * تحذير «تكرار محتمل» — معلوماتي بحت: لا يمنع الحفظ ولا يحذف صفاً ولا يدمج شيئاً،
 * وكل ما يفعله أنه يضع الحركتين جنباً إلى جنب ليحكم المستخدم بعينه. سبب وجوده أن
 * القيد الفريد يمنع الصف المطابق حرفياً فقط؛ حركة أُعيد إصدار سندها برقم آخر تمرّ
 * منه وتُضاعف المبلغ بصمت.
 */
function NearDuplicateNotice({ items, title }: { items: NearDuplicate[]; title?: string }) {
  const pairs = items.filter((n) => n.kind === 'near_duplicate');
  const more = items.find((n) => n.kind === 'near_duplicate_more');
  if (pairs.length === 0 && !more) return null;
  return (
    <div className="callout warn" style={{ margin: 0 }}>
      <b>{title ?? 'تكرار محتمل'} — {ar(pairs.length)} حالة تحتاج نظرك</b>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        حركتان بنفس التاريخ والمبلغ ويختلف سندهما — تأكّد أنهما ليستا حركة واحدة.
        لم يُحذف ولم يُدمج شيء: الحركتان محفوظتان كما وردتا.
      </div>
      <ul style={{ margin: '8px 0 0', paddingInlineStart: 18, display: 'grid', gap: 8 }}>
        {pairs.map((n, i) => (
          <li key={i}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {arDate(n.date ?? '')} · {sar(Math.abs(n.amount ?? 0))} ر.س
              {' · '}{ND_LEDGER[n.ledger ?? ''] ?? 'حركة'}
              {n.scope ? ` · ${ND_SCOPE[n.scope] ?? ''}` : ''}
            </div>
            <div style={{ fontSize: 12, marginTop: 2 }}>
              سند {n.a?.doc || '—'} — «{n.a?.description || '—'}»
            </div>
            <div style={{ fontSize: 12 }}>
              سند {n.b?.doc || '—'} — «{n.b?.description || '—'}»
            </div>
          </li>
        ))}
      </ul>
      {more && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{more.message}</div>}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  pdf_statement: 'كشف PDF',
  csv_statement: 'كشف CSV',
  suppliers_excel: 'ملف موردين',
  debts_report_xls: 'تقرير مديونيات مجمّع (xls)',
};

const BATCH_STATUS: Record<string, { text: string; kind: string }> = {
  saved: { text: 'تم الحفظ', kind: 'ok' },
  duplicate: { text: 'مكرر — سبق رفعه', kind: 'warn' },
  contractor_saved: { text: 'تم الحفظ', kind: 'ok' },
  not_reconciled: { text: 'غير مطابق', kind: 'red' },
  unknown_supplier: { text: 'مورد غير معروف', kind: 'warn' },
  no_account: { text: 'بلا رقم حساب', kind: 'warn' },
  needs_classification: { text: 'يحتاج تصنيفاً', kind: 'warn' },
  read_error: { text: 'تعذّرت القراءة', kind: 'red' },
};

const KIND_LABEL: Record<string, string> = {
  supplier: 'مورد', contractor: 'مقاول', guarantee: 'ضمان', ignore: 'تجاهل',
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
    nearDuplicates?: NearDuplicate[];
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
  const { enabled: aiEnabled } = useAiEnabled();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [rescueTarget, setRescueTarget] = useState<{ path: string; name: string } | null>(null);
  const [classifyTarget, setClassifyTarget] =
    useState<{
      path: string; fileName: string; account: string; parsedName: string; source: string;
      /** موجود فقط حين يأتي التصنيف من صفّ في قائمة الرفع المفرد (لا جدول الدفعة) —
       * بعد الحفظ نعيد معاينة هذا الصف بعينه بدل إعادة استيراد ملف دفعة. */
      queueIdx?: number;
    } | null>(null);

  // ---- وضع اختيار مجلد كامل ----
  const [folderErr, setFolderErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  // ---- حساب جديد داخل الرفع الجماعي — يُحل كل ملف على حدة دون إيقاف بقية الدفعة ----
  const [resolveTarget, setResolveTarget] =
    useState<{ path: string; source: string; fileName: string; data: any } | null>(null);
  const [resolveLoadingPath, setResolveLoadingPath] = useState<string | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  // ---- الملفات المرفوعة — القسم يجلب ويصفّي بنفسه؛ هنا فقط عدّاد يطلب إعادة
  // التحميل بعد أي فعل يغيّر السجل (رفع، حذف، تصنيف…) دون رفع الفرز/التصفية
  // إلى هذا المستوى. ----
  const [historyReload, setHistoryReload] = useState(0);
  const loadHistory = () => setHistoryReload((n) => n + 1);

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
      loadHistory();
    } catch (e: any) {
      setFolderErr(e?.message ?? String(e));
    } finally {
      setBatchBusy(false);
    }
  }

  /** بعد حفظ تصنيف حساب من نافذة «تصنيف…» — يُعاد استيراد هذا الملف وحده فوراً
   * وتُحدَّث نتيجته في جدول الرفع الجماعي، ثم تُحدَّث الملفات المرفوعة. */
  async function reimportAfterClassification(target: { path: string; source: string }) {
    const res = await api.batchImport([target.path]);
    const row = res.results?.[0];
    if (row) {
      setBatchResult((prev) => prev && ({
        ...prev,
        results: prev.results.map((r) => (r.path === target.path ? row : r)),
        saved: prev.saved + (row.status === 'saved' ? 1 : 0),
      }));
    }
    loadHistory();
  }

  /** بعد تصنيف حساب ظهر داخل معاينة «تقرير مديونيات مجمّع» في قائمة الرفع المفرد
   * (لا جدول الدفعة) — نعيد معاينة هذا الصف وحده فقط (ما زال لم يُحفظ بعد، فلا
   * حاجة لإعادة استيراد كامل). فشل إعادة المعاينة يُعرض كخطأ قراءة بدل الصمت. */
  async function reimportPreviewAfterClassification(idx: number) {
    const item = queue[idx];
    if (!item) return;
    patch(idx, { status: 'reading' as QueueStatus });
    try {
      const preview = await api.previewImport(item.file.path, item.file.source);
      patch(idx, { status: 'debts_previewed' as QueueStatus, preview });
    } catch (e: any) {
      patch(idx, { status: 'read_error' as QueueStatus, error: e?.message ?? String(e) });
    }
  }

  /** «إنشاء مورد…» على صف مورد غير معروف في الرفع الجماعي — يعيد قراءة الملف
   * وحده (خارج مسار الدفعة، الذي لا يدعم create_supplier) لجلب الاسم المقترح
   * وأرقام الكشف قبل عرض النافذة، دون إيقاف بقية الملفات في الدفعة. */
  async function openResolveUnknownSupplier(r: { path: string; source: string; name: string }) {
    setResolveErr(null); setResolveLoadingPath(r.path);
    try {
      const res = await api.runImport(r.path, r.source);
      setResolveTarget({ path: r.path, source: r.source, fileName: r.name, data: res });
    } catch (e: any) {
      setResolveErr(e?.message ?? String(e));
    } finally {
      setResolveLoadingPath(null);
    }
  }

  /** تأكيد إنشاء المورد لصف من الدفعة — يُحدّث صف هذا الملف فقط في batchResult،
   * تماماً كإعادة الاستيراد بعد التصنيف، دون لمس بقية نتائج الدفعة. */
  async function confirmNewSupplierForBatchRow(
    target: { path: string; source: string; fileName: string },
    form: { name: string; project: string; term: string },
  ) {
    const res = await api.runImport(target.path, target.source, false, form);
    if (res && res.saved === false) {
      throw new Error(res.message || res.reason || 'تعذّر الحفظ');
    }
    setBatchResult((prev) => prev && ({
      ...prev,
      results: prev.results.map((r) => (r.path === target.path ? {
        ...r,
        status: 'saved',
        message: 'تم الحفظ بنجاح — أُنشئ حساب المورد',
        supplierName: res?.supplier?.name ?? r.supplierName,
        added: res?.added ?? r.added,
        skipped: res?.skipped ?? r.skipped,
      } : r)),
      saved: prev.saved + 1,
    }));
    setResolveTarget(null);
    loadHistory();
  }

  function declineResolveUnknownSupplier(target: { path: string }) {
    setBatchResult((prev) => prev && ({
      ...prev,
      results: prev.results.map((r) => (r.path === target.path ? {
        ...r, message: 'لم يُحفظ شيء — لم يُنشأ الحساب (تجاهله المستخدم)',
      } : r)),
    }));
    setResolveTarget(null);
  }

  function patch(idx: number, upd: Partial<QueueItem>) {
    setQueue((q) => q.map((it, i) => (i === idx ? { ...it, ...upd } : it)));
  }

  /** تأكيد إنشاء المورد من نافذة «حساب جديد» — يعيد تشغيل الاستيراد بنفس الملف
   * مع create_supplier، ثم يحدّث حالة الصف وسجل الملفات المرفوعة. */
  async function confirmNewSupplierForQueueItem(idx: number,
    form: { name: string; project: string; term: string }) {
    const item = queue[idx];
    const res = await api.runImport(item.file.path, item.file.source, false, form);
    if (res && res.saved === false) {
      // ما زال مرفوضاً (مثلاً لم يعد مطابقاً) — لا نكذب بأنه حُفظ
      throw new Error(res.message || res.reason || 'تعذّر الحفظ');
    }
    patch(idx, { status: 'saved' as QueueStatus, saveResult: res });
    loadHistory();
  }

  function declineNewSupplierForQueueItem(idx: number) {
    patch(idx, { status: 'excluded' as QueueStatus, error: 'لم يُحفظ شيء — لم يُنشأ الحساب' });
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
      status: (isStatementSource(file.source) || isDebtsReportSource(file.source)) ? 'pending' : 'ready',
    }));
    setQueue(items);

    // معاينة تسلسلية للكشوفات وتقرير المديونيات المجمّع (الموردون وحدهم بلا معاينة)
    for (let i = 0; i < items.length; i++) {
      const src = items[i].file.source;
      if (!isStatementSource(src) && !isDebtsReportSource(src)) continue;
      patch(i, { status: 'reading' });
      try {
        const preview = await api.previewImport(items[i].file.path, src);
        if (isDebtsReportSource(src)) {
          // لا بوابة مطابقة على هذا الملف (reconciled دائماً true من الخادم — انظر
          // preview_debts_report) فحالة واحدة فقط تعني «عُوين، جاهز للحفظ».
          patch(i, { status: 'debts_previewed', preview });
        } else {
          patch(i, { status: preview?.reconciled ? 'reconciled' : 'unreconciled', preview });
        }
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
        ...current.map((it, i) => ({ it, i })).filter(({ it }) => it.status === 'debts_previewed'),
      ];

      for (const { i } of order) {
        const item = current[i];
        patch(i, { status: 'saving' as QueueStatus });
        try {
          const res = await api.runImport(item.file.path, item.file.source);
          // كشف مطابق تماماً لحساب لم نره من قبل — هذا هو الخلل الأصلي: كانت الشاشة
          // تكتب «تم» بينما res.saved كان false ولم يتغيّر رقم واحد. الآن نميّزها
          // بحالة خاصة تعرض للمستخدم قراراً حقيقياً بدل الصمت.
          if (res && res.saved === false && res.reason === 'unknown_supplier') {
            patch(i, { status: 'unknown_supplier' as QueueStatus, saveResult: res });
          } else if (res && res.saved === false) {
            patch(i, {
              status: 'save_error' as QueueStatus,
              error: res.message || res.reason || 'تعذّر الحفظ',
            });
          } else {
            patch(i, { status: 'saved' as QueueStatus, saveResult: res });
          }
        } catch (e: any) {
          patch(i, { status: 'save_error' as QueueStatus, error: e?.message ?? String(e) });
        }
      }
      setDone(true);
      loadHistory();
    } finally {
      setBusy(false);
    }
  }

  const savable = queue.filter((it) =>
    it.status === 'ready' || it.status === 'reconciled' || it.status === 'debts_previewed');
  const stillReading = queue.some((it) => it.status === 'pending' || it.status === 'reading');
  const canSave = queue.length > 0 && !busy && !stillReading && savable.length > 0 && !done;

  const nothingPickedYet = queue.length === 0 && !scanResult && !batchResult;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>رفع ملفات</h1>
          <p>
            كشف حساب مورد (PDF/CSV)، ملف مدد الموردين (Excel)، أو تقرير مديونيات مجمّع (xls) —
            ملفات منفردة أو مجلد كامل دفعة واحدة
          </p>
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
              الصيغ المقبولة: PDF · Excel (XLSX/XLSM) · CSV · XLS (تقرير مديونيات مجمّع)
            </div>
          </div>
        )}

        {folderErr && <div className="callout bad">{folderErr}</div>}
        {err && <div className="callout bad">{err}</div>}

        {/* ---- نتيجة فحص المجلد ---- */}
        {scanResult && !batchResult && (
          <Card title="نتيجة فحص المجلد" sub={scanResult.dir}>
            <div className="card-body top flow">
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
            <div className="card-body top">
              {resolveErr && <div className="callout bad" style={{ marginBottom: 10 }}>{resolveErr}</div>}
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
              {/* التحذير خارج الجدول: يخصّ أرقاماً لا حالة ملف، وطيّه داخل خلية
                  «تفاصيل» يخفيه عن العين تماماً — وهو أهم ما في هذه الشاشة. */}
              {batchResult.results.some((r) => (r.nearDuplicates ?? []).length > 0) && (
                <div style={{ marginBottom: 10, display: 'grid', gap: 8 }}>
                  {batchResult.results
                    .filter((r) => (r.nearDuplicates ?? []).length > 0)
                    .map((r) => (
                      <NearDuplicateNotice
                        key={r.path}
                        items={r.nearDuplicates ?? []}
                        title={`تكرار محتمل — ${r.supplierName ?? r.account ?? r.name}`}
                      />
                    ))}
                </div>
              )}
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
                          {aiEnabled && (r.status === 'read_error' || r.status === 'no_account') && (
                            <button className="btn sm" style={{ marginInlineStart: 8 }}
                              onClick={() => setRescueTarget({ path: r.path, name: r.name })}>
                              محاولة القراءة بالذكاء الاصطناعي
                            </button>
                          )}
                          {r.status === 'needs_classification' && (
                            <button className="btn sm" style={{ marginInlineStart: 8 }}
                              onClick={() => setClassifyTarget({
                                path: r.path, fileName: r.name,
                                account: r.account ?? '', parsedName: r.supplierName ?? '',
                                source: r.source,
                              })}>
                              تصنيف…
                            </button>
                          )}
                          {r.status === 'unknown_supplier' && (
                            <button className="btn sm" style={{ marginInlineStart: 8 }}
                              disabled={resolveLoadingPath === r.path}
                              onClick={() => openResolveUnknownSupplier(r)}>
                              {resolveLoadingPath === r.path ? 'جارٍ التحميل…' : 'إنشاء المورد…'}
                            </button>
                          )}
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
          <QueueCard key={item.file.path + i} item={item} aiEnabled={aiEnabled}
            onRescue={() => setRescueTarget({ path: item.file.path, name: item.file.name })}
            onConfirmNewSupplier={(form) => confirmNewSupplierForQueueItem(i, form)}
            onDeclineNewSupplier={() => declineNewSupplierForQueueItem(i)}
            onClassifyAccount={(account, name) => setClassifyTarget({
              path: item.file.path, fileName: item.file.name, account, parsedName: name,
              source: item.file.source, queueIdx: i,
            })} />
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

        {/* «الملفات المرفوعة» بعد منطقة الرفع دائماً — هذا هو إصلاح الطلب: كانت
            هذه القائمة (تكبر باستمرار) تسبق زر الرفع فيبتعد الإجراء الأساسي عن
            أول ما يراه المستخدم. تبقى على نفس الشاشة (لا صفحة منفصلة) لأنها
            الوسيلة الوحيدة للتحقق أن الرفع نجح، وتُطوى/تُفتح مع تذكّر الحالة. */}
        <UploadedFilesSection reloadToken={historyReload} onPickFiles={pick} />
      </div>

      {rescueTarget && (
        <AiRescueModal
          path={rescueTarget.path}
          fileName={rescueTarget.name}
          onClose={() => setRescueTarget(null)}
          onSaved={loadHistory}
        />
      )}

      {classifyTarget && (
        <ClassifyModal
          target={classifyTarget}
          aiEnabled={aiEnabled}
          onClose={() => setClassifyTarget(null)}
          onSaved={() => {
            const t = classifyTarget;
            setClassifyTarget(null);
            if (t.queueIdx !== undefined) reimportPreviewAfterClassification(t.queueIdx);
            else reimportAfterClassification(t);
          }}
        />
      )}

      {resolveTarget && (
        <Modal title="حساب جديد لم نره من قبل" onClose={() => setResolveTarget(null)}>
          <NewSupplierPanel
            fileName={resolveTarget.fileName}
            data={resolveTarget.data}
            onConfirm={(form) => confirmNewSupplierForBatchRow(resolveTarget, form)}
            onDecline={() => declineResolveUnknownSupplier(resolveTarget)}
          />
        </Modal>
      )}
    </>
  );
}

/**
 * «اسأل، لا تخمّن» — حساب برقم بادئة غير 211/212/216 لا يُحفظ إطلاقاً حتى يقرر
 * المستخدم تصنيفه هنا. اقتراح الذكاء الاصطناعي (إن كان مفعّلاً) اختياري بحت —
 * يظهر كتنبيه هادئ ولا يقرر شيئاً بنفسه.
 */
function ClassifyModal({ target, aiEnabled, onClose, onSaved }: {
  target: { path: string; fileName: string; account: string; parsedName: string; source: string };
  aiEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [suggestion, setSuggestion] = useState<{ kind?: string; reason?: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!aiEnabled) return;
    let cancelled = false;
    api.suggestImportClassification(target.path)
      .then((s) => { if (!cancelled && s?.kind) setSuggestion(s); })
      .catch(() => { /* اقتراح أفضل-جهد فقط — تجاهل الفشل */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.path, aiEnabled]);

  async function choose(kind: 'supplier' | 'contractor' | 'guarantee' | 'ignore') {
    setSaving(kind); setError(null);
    try {
      await api.setImportClassification({ account: target.account, kind, name: target.parsedName });
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setSaving(null);
    }
  }

  return (
    <Modal title="تصنيف حساب" onClose={onClose}>
      <p>
        رقم الحساب <b>{target.account || '—'}</b>
        {target.parsedName && <> — «{target.parsedName}»</>} في ملف «{target.fileName}»
        {' '}ليس مورداً (211) ولا مقاولاً (212) ولا ضماناً (216). اختر تصنيفه ليُحفظ.
      </p>

      {aiEnabled && suggestion?.kind && (
        <div className="callout" style={{ margin: '10px 0' }}>
          اقتراح آلي — القرار لك: {KIND_LABEL[suggestion.kind] ?? suggestion.kind}
          {suggestion.reason && <> — {suggestion.reason}</>}
        </div>
      )}

      {error && <div className="callout bad">{error}</div>}

      <div className="modal-foot" style={{ flexWrap: 'wrap', gap: 8 }}>
        {(['supplier', 'contractor', 'guarantee', 'ignore'] as const).map((k) => (
          <button key={k} className="btn primary" disabled={!!saving} onClick={() => choose(k)}>
            {saving === k ? 'جارٍ الحفظ…' : KIND_LABEL[k]}
          </button>
        ))}
        <button className="btn" onClick={onClose} disabled={!!saving}>إلغاء</button>
      </div>
    </Modal>
  );
}

function QueueCard({ item, aiEnabled, onRescue, onConfirmNewSupplier, onDeclineNewSupplier, onClassifyAccount }: {
  item: QueueItem; aiEnabled: boolean; onRescue: () => void;
  onConfirmNewSupplier: (form: { name: string; project: string; term: string }) => Promise<void>;
  onDeclineNewSupplier: () => void;
  onClassifyAccount: (account: string, name: string) => void;
}) {
  const { file, status, preview, saveResult, error } = item;
  const isDebts = isDebtsReportSource(file.source);
  return (
    <Card>
      <div className="card-body top flow">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{file.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{LABEL[file.source] ?? file.source}</div>
          </div>
          <StatusChip status={status} />
        </div>

        {status === 'reading' && <State>جارٍ القراءة…</State>}

        {status === 'debts_previewed' && preview && (
          <DebtsReportPreview preview={preview} onClassify={onClassifyAccount} />
        )}

        {!isDebts && (status === 'reconciled' || status === 'unreconciled') && preview && (
          <div className="muted" style={{ fontSize: 12 }}>
            رقم الحساب: {preview.account ?? '—'} · فواتير: {ar(preview.invoiceCount)} · دفعات: {ar(preview.paymentCount)}
            {' '}· رصيد الكشف: {sar(preview.statementBalance ?? 0)} ر.س · المحسوب: {sar(preview.computedBalance)} ر.س
            {status === 'reconciled'
              ? ' — ✓ مطابق'
              : ` — ✕ غير مطابق (الفرق ${sar(preview.difference ?? 0)} ر.س)`}
          </div>
        )}

        {/* تحذير التكرار المحتمل يظهر عند المعاينة (قبل الحفظ) ويبقى بعد الحفظ —
            لا يغيّر الحالة ولا يمنع الزر، فالقرار للمستخدم بعد أن يرى الحركتين. */}
        <NearDuplicateNotice
          items={(saveResult?.nearDuplicates ?? preview?.nearDuplicates ?? []) as NearDuplicate[]}
        />

        {status === 'read_error' && (
          <div className="callout bad" style={{ margin: 0 }}>
            خطأ قراءة: {error}
            {aiEnabled && (
              <div style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={onRescue}>محاولة القراءة بالذكاء الاصطناعي</button>
              </div>
            )}
          </div>
        )}

        {status === 'save_error' && (
          <div className="callout bad" style={{ margin: 0 }}>تعذّر الحفظ: {error}</div>
        )}

        {status === 'unknown_supplier' && saveResult && (
          <NewSupplierPanel
            fileName={file.name}
            data={saveResult}
            onConfirm={onConfirmNewSupplier}
            onDecline={onDeclineNewSupplier}
          />
        )}

        {status === 'excluded' && (
          <div className="muted" style={{ fontSize: 12 }}>
            {error ?? 'مُستبعد من الحفظ (لم يتطابق أو حدث خطأ قراءة)'}
          </div>
        )}

        {status === 'saved' && saveResult && isDebts && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              تم الحفظ — {ar(saveResult.created ?? 0)} حساب جديد، {ar(saveResult.updated ?? 0)} محدَّث
              {saveResult.skipped ? `، ${ar(saveResult.skipped)} بانتظار تصنيف` : ''}
            </div>
            {/* أهم مخرجات هذا الملف: فرق بين رصيد الملف ودفتر الحركات — يظهر بارزاً
                منفصلاً، لا مطوياً داخل ملاحظات عامة (طلب صريح — انظر رأس الملف). */}
            <BalanceMismatchPanel warnings={saveResult.reconcileWarnings ?? []} />
          </div>
        )}

        {status === 'saved' && saveResult && !isDebts && (
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
  debts_previewed: { text: 'عُوين — جاهز للحفظ', kind: 'ok' },
  read_error: { text: 'خطأ قراءة', kind: 'red' },
  saving: { text: 'جارٍ الحفظ', kind: 'warn' },
  saved: { text: 'تم الحفظ', kind: 'ok' },
  save_error: { text: 'تعذّر الحفظ', kind: 'red' },
  unknown_supplier: { text: 'حساب جديد — بانتظار قرار', kind: 'warn' },
  excluded: { text: 'مُستبعد', kind: '' },
};

function StatusChip({ status }: { status: QueueStatus }) {
  const c = CHIP[status];
  return <Pill kind={c.kind}>{c.text}</Pill>;
}

const DEBTS_KIND_ORDER: Array<'contractor' | 'supplier' | 'guarantee'> = ['contractor', 'supplier', 'guarantee'];

/**
 * معاينة «تقرير مديونيات مجمّع» قبل الحفظ. الهدف الأساسي هنا حجم التغيير: كم
 * مقاولاً/مورداً/ضماناً في الملف، وكم منهم *جديد* لم تره القاعدة من قبل (قد يكون
 * بالمئات، انظر مثال ٣٢٠ مقاولاً جديداً من أصل ٣٢١) مقابل معروف مسبقاً — فرق
 * جوهري يجب أن يراه المستخدم قبل أن يضغط حفظ، لا أن يكتشفه بعدها. حسابات
 * بادئتها ليست ٢١١/٢١٢/٢١٦ (مثل ٢١٧) لا تُخمَّن أبداً — تُعرض هنا صراحة وتحتاج
 * قراره عبر نفس نافذة «تصنيف…» المستخدمة في جدول الرفع الجماعي (لا آلية موازية).
 */
function DebtsReportPreview({ preview, onClassify }: {
  preview: {
    rowCounts?: Record<string, number>;
    newVsKnown?: Record<string, { total: number; new: number; known: number }>;
    needsClassification?: { account: string; name: string; project?: string; sheet?: string; prefix?: string }[];
    parseIssues?: { severity?: string; message: string; sheet?: string }[];
  };
  onClassify: (account: string, name: string) => void;
}) {
  const nc = preview.needsClassification ?? [];
  const issues = preview.parseIssues ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {DEBTS_KIND_ORDER.map((k) => {
          const nvk = preview.newVsKnown?.[k];
          const total = preview.rowCounts?.[k] ?? nvk?.total ?? 0;
          if (total === 0) return null;
          return (
            <div key={k} style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', minWidth: 160,
            }}>
              <div className="muted" style={{ fontSize: 12 }}>{KIND_LABEL[k]}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{ar(total)}</div>
              {nvk && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {nvk.new > 0 && <span style={{ color: 'var(--red, #b91c1c)', fontWeight: 700 }}>{ar(nvk.new)} جديد</span>}
                  {nvk.new > 0 && nvk.known > 0 && ' · '}
                  {nvk.known > 0 && <span className="muted">{ar(nvk.known)} معروف مسبقاً</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {nc.length > 0 && (
        <div className="callout warn" style={{ margin: 0 }}>
          <b>{ar(nc.length)} حساب يحتاج تصنيفك قبل أن يُحفظ</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            رقم الحساب لا يبدأ بـ٢١١ (مورد) ولا ٢١٢ (مقاول) ولا ٢١٦ (ضمان) — لن يُحفظ حتى
            تختار تصنيفه؛ بقية الملف يُحفظ بلا انتظاره.
          </div>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 18, display: 'grid', gap: 6 }}>
            {nc.map((n, i) => (
              <li key={n.account + i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{n.account} — «{n.name}»{n.project ? ` (${n.project})` : ''}</span>
                <button className="btn sm" onClick={() => onClassify(n.account, n.name)}>تصنيف…</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {issues.length > 0 && (
        <div className="muted" style={{ fontSize: 12 }}>
          {ar(issues.length)} ملاحظة قراءة (صفوف بلا رقم حساب أو أوراق غير متعرَّف عليها) —
          لن تمنع الحفظ.
        </div>
      )}
    </div>
  );
}

/**
 * تحذير «فرق بين رصيد الملف ورصيد سجل الحركات» — أهم مخرجات هذا الملف: التقرير
 * الخارجي يذكر رصيداً لطرف تحمل قاعدة البيانات حركاته فعلاً، وحين يختلف الرقمان
 * فهذا تعارض محاسبي حقيقي يستحق مراجعة، لا ملاحظة عابرة. يظهر بارزاً منفصلاً بعد
 * الحفظ مباشرة، لا مطوياً داخل قائمة ملاحظات عامة — رسالة الخادم (message) تحمل
 * بالفعل اسم الطرف ورقم حسابه ورصيد الملف والرصيد المحسوب معاً فتُعرض كما وردت.
 */
function BalanceMismatchPanel({ warnings }: {
  warnings: { account?: string; name?: string; message: string }[];
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="callout bad" style={{ margin: 0 }}>
      <b>{ar(warnings.length)} فرق بين رصيد الملف ورصيد سجل الحركات — يستحق مراجعتك</b>
      <ul style={{ margin: '8px 0 0', paddingInlineStart: 18, display: 'grid', gap: 6 }}>
        {warnings.map((w, i) => (
          <li key={(w.account ?? '') + i} style={{ fontSize: 13 }}>{w.message}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * تخمين بحت لاسم المشروع من ترويسة الكشف — النصوص تأتي بصيغ مثل
 * «الیرموك- ( شركة تداین للخرسانة) تاتكو» حيث اسم المشروع قبل أول «-» أو «(».
 * دائماً قابل للتعديل في الحقل، ولا يُستخدم إن لم نجد فاصلاً واضحاً.
 */
function guessProjectFromHeader(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const dash = s.indexOf('-');
  const paren = s.indexOf('(');
  const cut = [dash, paren].filter((n) => n > 0).sort((a, b) => a - b)[0];
  return cut !== undefined ? s.slice(0, cut).trim() : '';
}

/**
 * «حساب جديد لم نره من قبل» — هذا هو إصلاح الخلل الذي أبلغ عنه المستخدم: كشف
 * يقرأ ويطابق رصيده تماماً لكن حسابه غير موجود في ملف مدد الموردين، فكان يُرفض
 * صمتاً والشاشة تقول «تم». هنا نعرض بوضوح: ما الحساب، ما الأرقام في الملف،
 * ونطلب من المستخدم اسم المورد/المشروع/مدة السداد قبل إنشائه — مدة السداد
 * إلزامية لأنها تحدّد تواريخ الاستحقاق ومنها كل حساب التأخر لاحقاً.
 */
function NewSupplierPanel({ fileName, data, onConfirm, onDecline }: {
  fileName: string;
  data: {
    account?: string; suggestedName?: string;
    invoiceCount?: number; paymentCount?: number;
    computedBalance?: number; statementBalance?: number;
  };
  onConfirm: (form: { name: string; project: string; term: string }) => Promise<void>;
  onDecline: () => void;
}) {
  const suggested = data.suggestedName ?? '';
  const [name, setName] = useState(suggested);
  const [project, setProject] = useState(guessProjectFromHeader(suggested));
  const [term, setTerm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  async function confirm() {
    if (!name.trim() || !term.trim()) {
      setError('اسم المورد ومدة السداد إلزاميان');
      return;
    }
    setSaving(true); setError(null);
    try {
      await onConfirm({ name: name.trim(), project: project.trim(), term: term.trim() });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setSaving(false);
    }
  }

  if (declined) {
    return (
      <div className="muted" style={{ fontSize: 12 }}>لم يُحفظ شيء — لم يُنشأ الحساب</div>
    );
  }

  return (
    <div className="callout warn" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <b>حساب جديد لم نره من قبل: {data.account || '—'}</b>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          كشف «{fileName}» مطابق تماماً لرصيده لكن رقم الحساب غير موجود في ملف مدد الموردين —
          لن يُحفظ شيء حتى تقرر إنشاء الحساب أو تجاهل الملف.
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12 }}>
        فواتير: {ar(data.invoiceCount ?? 0)} · دفعات: {ar(data.paymentCount ?? 0)}
        {' '}· رصيد الكشف: <Money v={data.statementBalance ?? 0} /> ر.س
        {' '}· المحسوب: <Money v={data.computedBalance ?? 0} /> ر.س
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          اسم المورد (من ترويسة الكشف — عدّله إن احتاج تنظيفاً)
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          المشروع (تخمين من الترويسة — تحقق منه وعدّله إن احتاج)
        </span>
        <input value={project} onChange={(e) => setProject(e.target.value)} />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          مدة السداد — إلزامي: تحدّد تواريخ الاستحقاق، وتواريخ الاستحقاق تحدّد التأخر
        </span>
        <input value={term} onChange={(e) => setTerm(e.target.value)}
          placeholder="مثال: ٤٥ يوم · كاش · مستخلص" />
      </label>

      {error && <div className="callout bad" style={{ margin: 0 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={saving} onClick={confirm}>
          {saving ? 'جارٍ الحفظ…' : 'إنشاء الحساب وحفظ الكشف'}
        </button>
        <button className="btn" disabled={saving} onClick={() => { setDeclined(true); onDecline(); }}>
          تجاهل هذا الملف
        </button>
      </div>
    </div>
  );
}

/** خيارات عمود «النوع» — تصفية على قيمة source الخام، بتسميتها العربية
 * كما تظهر في عمود «النوع» نفسه (import_service.DETECTED_LABELS). */
const SOURCE_FILTER_OPTIONS = [
  { value: 'suppliers_excel', label: 'ملف مدد الموردين' },
  { value: 'pdf_statement', label: 'كشف حساب (PDF)' },
  { value: 'csv_statement', label: 'كشف حساب (CSV)' },
  { value: 'supplier', label: 'كشف حساب مورد' },
  { value: 'contractor', label: 'كشف حساب مقاول/متعامل' },
  { value: 'guarantee', label: 'كشف حساب ضمان (216)' },
  { value: 'budget_deviation', label: 'تقرير انحراف الموازنة' },
  { value: 'ai_extract', label: 'استخراج بالذكاء الاصطناعي' },
  { value: 'debts_report_xls', label: 'تقرير مديونيات مجمّع (xls)' },
];

const RECONCILED_FILTER_OPTIONS = [
  { value: 'yes', label: 'مطابق' },
  { value: 'no', label: 'غير مطابق' },
];

/**
 * «الملفات المرفوعة» — كل استيراد سابق مع ما أضافه، وحذف واحد منها يحذف حركاته فقط
 * (البيانات اليدوية لا تُمس). السجلات القديمة (قبل هذه الميزة) لا تحمل ربطاً مباشراً
 * بحركاتها فتُحذف تقريبياً بموافقة إضافية.
 *
 * تُطوى/تُفتح مع تذكّر الحالة (مثل الشريط الجانبي)، والفرز/التصفية لكل عمود
 * يُطبَّقان على الخادم على المجموعة كاملةً لا الصفحة المعروضة فقط — القائمة
 * تكبر باستمرار، والتصفية على المتصفح كانت ستُظهر «٢١ ملفاً» بينما المعروض أقل.
 */
function UploadedFilesSection({ reloadToken, onPickFiles }: {
  reloadToken: number;
  onPickFiles: () => void;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem(HISTORY_OPEN_KEY) !== '0');
  useEffect(() => {
    localStorage.setItem(HISTORY_OPEN_KEY, open ? '1' : '0');
  }, [open]);

  const [rows, setRows] = useState<ImportHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState('');
  const [party, setParty] = useState('');
  const [minMoves, setMinMoves] = useState('');
  const [maxMoves, setMaxMoves] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reconciled, setReconciled] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  const query = useMemo<ImportHistoryQuery>(() => ({
    file_name: fileName || undefined,
    source: source || undefined,
    party: party || undefined,
    min_moves: minMoves ? Number(minMoves) : undefined,
    max_moves: maxMoves ? Number(maxMoves) : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    reconciled: reconciled || undefined,
    sort: sort?.key,
    dir: sort?.dir,
  }), [fileName, source, party, minMoves, maxMoves, dateFrom, dateTo, reconciled, sort]);

  const filtering = Boolean(fileName || source || party || minMoves || maxMoves
    || dateFrom || dateTo || reconciled);
  const clearAll = () => {
    setFileName(''); setSource(''); setParty(''); setMinMoves(''); setMaxMoves('');
    setDateFrom(''); setDateTo(''); setReconciled('');
  };

  // لا حاجة للجلب أصلاً إن كان القسم مطوياً — يفتح ويجلب أول مرة فقط.
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      fetchImportHistory(query).then((res) => {
        if (my !== seq.current) return; // استجابة متأخرة لطلب سابق — تُهمل
        setRows(res.rows); setError(null);
      }).catch((e: any) => {
        if (my === seq.current) setError(e?.message ?? String(e));
      }).finally(() => {
        if (my === seq.current) setLoading(false);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [open, query, reloadToken]);

  const [target, setTarget] = useState<ImportHistoryRow | null>(null);
  const [forceStep, setForceStep] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [lastDeleted, setLastDeleted] = useState<{ row: ImportHistoryRow; n: number } | null>(null);

  function openConfirm(row: ImportHistoryRow) {
    setDeleteErr(null); setForceStep(false); setTarget(row);
  }

  async function doDelete(force: boolean) {
    if (!target) return;
    setBusyId(target.id); setDeleteErr(null);
    try {
      const res = await api.deleteImport(target.id, force);
      const n = res.deleted.invoices + res.deleted.payments
        + res.deleted.entries + res.deleted.receivables;
      setLastDeleted({ row: target, n });
      setTarget(null); setForceStep(false);
      seq.current += 1; // يفرض إعادة جلب فورية بدل انتظار reloadToken
      setLoading(true);
      fetchImportHistory(query).then((r) => { setRows(r.rows); setError(null); })
        .catch((e: any) => setError(e?.message ?? String(e)))
        .finally(() => setLoading(false));
    } catch (e: any) {
      // سجل قديم بلا ربط مباشر — الخادم يرفض بـ409 ويطلب تأكيداً إضافياً بالحذف التقريبي
      if (target.legacy && !force) {
        setForceStep(true);
      } else {
        setDeleteErr(e?.message ?? String(e));
      }
    } finally {
      setBusyId(null);
    }
  }

  const count = rows?.length ?? null;

  return (
    <>
      <Card>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start',
            padding: '16px 20px', font: 'inherit',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            الملفات المرفوعة{count !== null ? ` (${ar(count)})` : ''}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            {open ? 'اضغط للطيّ' : 'اضغط للعرض'}
          </span>
          <span className="grow" />
          <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <>
            {loading && rows === null && <State>جارٍ التحميل…</State>}

            {error && <ErrorState message={error} onRetry={() => { seq.current += 1; setError(null); }} />}

            {!error && !loading && rows !== null && rows.length === 0 && !filtering && (
              <EmptyState
                kind="no-data"
                title="لا ملفات مرفوعة بعد"
                body="ابدأ برفع كشف حساب أو ملف مدد الموردين لتظهر هنا."
                ctaLabel="اختيار ملفات"
                onCta={onPickFiles}
              />
            )}

            {!error && !loading && rows !== null && rows.length === 0 && filtering && (
              <EmptyState kind="no-results" title="لا نتائج مطابقة"
                body="لم تطابق التصفية أي ملف مرفوع."
                ctaLabel="مسح التصفية" onCta={clearAll} />
            )}

            {rows !== null && rows.length > 0 && (
              <>
                {filtering && (
                  <div className="filter-bar">
                    <b>تصفية نشطة</b>
                    <button className="btn sm" onClick={clearAll}>مسح الكل</button>
                  </div>
                )}
                {lastDeleted && (
                  <div className="callout ok" style={{ margin: '14px 20px 0' }}>
                    حُذف {ar(lastDeleted.n)} حركة من «{lastDeleted.row.fileName}» —
                    تحدّثت أرصدة {lastDeleted.row.partyName ?? lastDeleted.row.account ?? 'الطرف المرتبط'} فوراً.
                  </div>
                )}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <Th label="التاريخ" sortKey="date" sort={sort} onSort={setSort}
                            ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً"
                            active={Boolean(dateFrom || dateTo)}
                            filter={{ kind: 'dateRange', from: dateFrom, to: dateTo,
                                      onFrom: setDateFrom, onTo: setDateTo }} />
                        <Th label="الملف" sortKey="fileName" sort={sort} onSort={setSort}
                            active={Boolean(fileName)}
                            filter={{ kind: 'text', value: fileName, onChange: setFileName,
                                      placeholder: 'اسم الملف…' }} />
                        <Th label="النوع" sortKey="detected" sort={sort} onSort={setSort}
                            active={Boolean(source)}
                            filter={{ kind: 'select', value: source, onChange: setSource,
                                      allLabel: 'كل الأنواع', options: SOURCE_FILTER_OPTIONS }} />
                        <Th label="الطرف" sortKey="partyName" sort={sort} onSort={setSort}
                            active={Boolean(party)}
                            filter={{ kind: 'text', value: party, onChange: setParty,
                                      placeholder: 'اسم الطرف أو رقم الحساب…' }} />
                        <Th label="الحركات" className="ltr" sortKey="linkedRows" sort={sort} onSort={setSort}
                            ascLabel="الأقل أولاً" descLabel="الأكثر أولاً"
                            active={Boolean(minMoves || maxMoves)}
                            filter={{ kind: 'range', min: minMoves, max: maxMoves,
                                      onMin: setMinMoves, onMax: setMaxMoves }} />
                        <Th label="مطابق" sortKey="reconciled" sort={sort} onSort={setSort}
                            active={Boolean(reconciled)}
                            filter={{ kind: 'select', value: reconciled, onChange: setReconciled,
                                      allLabel: 'الكل', options: RECONCILED_FILTER_OPTIONS }} />
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} title={r.path}>
                          <td className="muted">{arDate(r.date.slice(0, 10))}</td>
                          {/* سجلّات قديمة (وهجرات داخلية) لا تحمل اسم ملف — خليّة فارغة
                              تُقرأ كعطب في العرض، لا كسجلٍّ بلا اسم أصلاً. */}
                          <td title={r.path} className="truncate">
                            {r.fileName || <span className="muted">— بلا اسم ملف —</span>}
                          </td>
                          <td className="muted">{r.detected}</td>
                          <td>{r.partyName ?? r.account ?? '—'}</td>
                          <td className="ltr num">
                            {r.legacy
                              ? <>{ar(r.added)} <Pill kind="warn">قديم</Pill></>
                              : ar(r.linkedRows)}
                          </td>
                          <td>
                            <Pill kind={r.reconciled ? 'ok' : 'red'}>{r.reconciled ? '✓' : '✕'}</Pill>
                          </td>
                          <td>
                            <button
                              className="btn sm"
                              disabled={!r.canDelete || busyId === r.id}
                              title={r.canDelete ? 'حذف حركات هذا الملف' : 'يُدار من شاشته الخاصة'}
                              onClick={() => openConfirm(r)}
                            >
                              {busyId === r.id ? '…' : 'حذف'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </Card>

      {target && !forceStep && (
        <Modal title="تأكيد حذف ملف مستورد" onClose={() => setTarget(null)}>
          <p>
            سيُحذف {ar(target.linkedRows || target.added)} حركة مستوردة من ملف
            «{target.fileName}» لحساب {target.partyName ?? target.account ?? '—'}
            {' '}— البيانات اليدوية لا تُمس.
          </p>
          {deleteErr && <div className="callout bad">{deleteErr}</div>}
          <div className="modal-foot">
            <button className="btn" onClick={() => setTarget(null)}>إلغاء</button>
            <button className="btn danger" onClick={() => doDelete(false)} disabled={busyId === target.id}>
              {busyId === target.id ? 'جارٍ الحذف…' : 'حذف'}
            </button>
          </div>
        </Modal>
      )}

      {target && forceStep && (
        <Modal title="ملف قديم — الحذف تقريبي" onClose={() => { setTarget(null); setForceStep(false); }}>
          <p>
            هذا الملف رُفع قبل توفر هذه الميزة، فحركاته غير مربوطة به مباشرة.
            سيُحذف تقريبياً كل حركة لحساب {target.partyName ?? target.account ?? '—'}
            {' '}أُنشئت خلال ٣ دقائق من وقت رفع «{target.fileName}» — قد يشمل ذلك حركات لا علاقة لها بهذا الملف تحديداً.
          </p>
          {deleteErr && <div className="callout bad">{deleteErr}</div>}
          <div className="modal-foot">
            <button className="btn" onClick={() => { setTarget(null); setForceStep(false); }}>إلغاء</button>
            <button className="btn danger" onClick={() => doDelete(true)} disabled={busyId === target.id}>
              {busyId === target.id ? 'جارٍ الحذف…' : 'حذف تقريبي — متابعة'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
