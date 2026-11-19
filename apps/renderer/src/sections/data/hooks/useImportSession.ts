/**
 * جلسة الرفع — ملفات منفردة (معاينة ثم حفظ واحد) أو مجلد كامل (فحص ثم رفع دفعة).
 *
 * عام عمداً: لا قائمة أنواع ملفات هنا. نوع الملف يأتي من نافذة الاختيار (`source`)
 * ويمرّ للخادم كما هو؛ ما يقرّر الحالة هو ما يعيده الخادم:
 *   - المعاينة 400  → «جاهز» يُحفظ مباشرة
 *   - فيها reconciled + أرصدة → بوابة مطابقة
 *   - غير ذلك → «عُوين»
 *   - `source: 'unsupported'` من نافذة الاختيار → يظهر صراحة ولا يختفي (م-٢١)
 * لا شيء يُحفظ قبل ضغط زر الحفظ الواحد؛ غير المطابق وخطأ القراءة يُستبعدان.
 */
import { useCallback, useRef, useState } from 'react';
import { dataApi, errMsg } from '../api';
import { SAVABLE, saveOrder, statusAfterCommit, statusAfterPreview } from '../lib/preview';
import type {
  BatchResult, BatchRow, ImportPayload, NewPartyForm, PickedFile, QueueItem, ScanResult,
} from '../types';

/** ترتيب الطابور: ما لا معاينة له يأتي أولاً عند الحفظ (saveOrder)، هنا نحفظ ترتيب الاختيار. */
export function useImportSession(onChanged: () => void) {
  const [queue, setQueueState] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const [pickErr, setPickErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  // ref + state معاً: حلقة الحفظ تقرأ أحدث حالة، لا لقطة الإغلاق (خلل v0.13: saveAll
  // كان يقرأ `queue` القديم بعد setQueue فيحاول حفظ ما استُبعد للتو).
  const setQueue = useCallback((f: (q: QueueItem[]) => QueueItem[]) => {
    queueRef.current = f(queueRef.current);
    setQueueState(queueRef.current);
  }, []);
  const patch = useCallback((i: number, upd: Partial<QueueItem>) =>
    setQueue((q) => q.map((it, j) => (j === i ? { ...it, ...upd } : it))), [setQueue]);

  const reset = useCallback(() => {
    setQueue(() => []); setPickErr(null); setDone(false);
    setScan(null); setScanning(false); setBatch(null); setBatchBusy(false);
  }, [setQueue]);

  /* ── ملفات منفردة ── */
  const previewOne = useCallback(async (i: number) => {
    const it = queueRef.current[i];
    if (!it || it.file.source === 'unsupported') return;
    patch(i, { status: 'reading', error: undefined });
    const r = await dataApi.preview(it.file.path, it.file.source);
    if (r.kind === 'no-preview') patch(i, { status: 'ready' });
    else if (r.kind === 'error') patch(i, { status: 'read_error', error: r.message });
    else patch(i, { status: statusAfterPreview(r.data), preview: r.data });
  }, [patch]);

  const addFiles = useCallback(async (picked: PickedFile[]) => {
    if (!picked.length) return;
    setDone(false);
    const start = queueRef.current.length;
    setQueue((q) => [...q, ...picked.map((file): QueueItem => ({
      file, status: file.source === 'unsupported' ? 'unsupported' : 'pending',
    }))]);
    // تسلسلياً: المعاينة تقرأ القاعدة (تكرار محتمل، تصنيفات) ولا داعي لإغراق الخادم.
    for (let i = start; i < start + picked.length; i++) await previewOne(i);
  }, [previewOne, setQueue]);

  const pickFiles = useCallback(async () => {
    setPickErr(null);
    if (!window.egco?.pickFiles) {
      setPickErr('اختيار الملفات متاح داخل التطبيق فقط — افتح «EGCO Dashboard» من مجلد التطبيقات.');
      return;
    }
    try { await addFiles(await window.egco.pickFiles()); } catch (e) {
      setPickErr(`تعذّر فتح نافذة اختيار الملفات: ${errMsg(e)}`);
    }
  }, [addFiles]);

  const dropFile = useCallback((i: number) => setQueue((q) => q.filter((_, j) => j !== i)), [setQueue]);

  const saveAll = useCallback(async () => {
    setSaving(true);
    setQueue((q) => q.map((it) => (it.status === 'unreconciled' || it.status === 'read_error'
      ? { ...it, status: 'excluded' } : it)));
    try {
      for (const i of saveOrder(queueRef.current)) {
        const it = queueRef.current[i];
        patch(i, { status: 'saving' });
        try {
          const res = await dataApi.commit(it.file.path, it.file.source);
          const s = statusAfterCommit(res);
          patch(i, { status: s.status, error: s.error, saveResult: res });
        } catch (e) {
          patch(i, { status: 'save_error', error: errMsg(e) });
        }
      }
      setDone(true);
      onChanged();
    } finally {
      setSaving(false);
    }
  }, [onChanged, patch, setQueue]);

  /** إنشاء الطرف الجديد ثم حفظ الكشف — يرمي إن بقي مرفوضاً، فلا نكذب بأنه حُفظ. */
  const confirmNewParty = useCallback(async (i: number, form: NewPartyForm) => {
    const it = queueRef.current[i];
    const res = await dataApi.commit(it.file.path, it.file.source, form);
    if (res.saved === false) throw new Error(res.message || res.reason || 'تعذّر الحفظ');
    patch(i, { status: 'saved', saveResult: res });
    onChanged();
  }, [onChanged, patch]);

  /** موازنة تقديرية: إنشاء المشروع بتأكيد صريح ثم حفظ الخطة. */
  const confirmProject = useCallback(async (i: number) => {
    const it = queueRef.current[i];
    const res = await dataApi.commitWith(it.file.path, it.file.source, { confirmProject: true });
    if (res.saved === false) throw new Error(res.message || res.reason || 'تعذّر الحفظ');
    patch(i, { status: 'saved', saveResult: res });
    onChanged();
  }, [onChanged, patch]);

  /**
   * «احفظ رغم الفرق» — حسابات كشف مجمّع رآها المستخدم بأسمائها وفروقها. لا يُعاد
   * حفظ الملف كله؛ الخادم يحفظ هذه الحسابات وحدها. النتيجة تُدمج في نتيجة الحفظ.
   */
  const forceAccounts = useCallback(async (i: number, accounts: string[]) => {
    const it = queueRef.current[i];
    const res = await dataApi.commitWith(it.file.path, it.file.source, { allowAccounts: accounts });
    const savedNow = new Set((res.rows as { account: string; status: string }[] | undefined ?? [])
      .filter((r) => r.status === 'saved').map((r) => r.account));
    if (savedNow.size === 0) throw new Error(res.message || 'لم يُحفظ أي حساب');
    const prev = it.saveResult ?? {};
    const prevProblems = (prev.problems ?? []).filter((p) => !savedNow.has(p.account));
    const counts = { ...(prev.counts ?? {}) };
    counts.saved = (counts.saved ?? 0) + savedNow.size;
    counts.not_reconciled = Math.max(0, (counts.not_reconciled ?? 0) - savedNow.size);
    if (!counts.not_reconciled) delete counts.not_reconciled;
    patch(i, {
      status: 'saved',
      saveResult: {
        ...prev, counts, problems: prevProblems,
        saved: (typeof prev.saved === 'number' ? prev.saved : 0) + savedNow.size,
        forcedAccounts: [...((prev.forcedAccounts as string[] | undefined) ?? []), ...savedNow],
      },
    });
    onChanged();
  }, [onChanged, patch]);

  const declineNewParty = useCallback((i: number) =>
    patch(i, { status: 'excluded', error: 'لم يُحفظ شيء — لم يُنشأ الحساب' }), [patch]);

  /* ── مجلد كامل ── */
  const pickFolder = useCallback(async () => {
    setPickErr(null); setScan(null); setBatch(null);
    if (!window.egco?.pickDirectory) {
      setPickErr('اختيار مجلد متاح داخل التطبيق فقط — افتح «EGCO Dashboard» من مجلد التطبيقات.');
      return;
    }
    let dir: string | null = null;
    try { dir = await window.egco.pickDirectory(); } catch (e) {
      setPickErr(`تعذّر فتح نافذة اختيار المجلد: ${errMsg(e)}`); return;
    }
    if (!dir) return;
    setScanning(true);
    try { setScan(await dataApi.scanDir(dir)); } catch (e) { setPickErr(errMsg(e)); } finally { setScanning(false); }
  }, []);

  const uploadBatch = useCallback(async () => {
    if (!scan) return;
    setBatchBusy(true); setPickErr(null);
    try { setBatch(await dataApi.batch(scan.files.map((f) => f.path))); onChanged(); }
    catch (e) { setPickErr(errMsg(e)); }
    finally { setBatchBusy(false); }
  }, [scan, onChanged]);

  const patchBatchRow = useCallback((path: string, upd: Partial<BatchRow>, savedDelta = 0) =>
    setBatch((b) => b && ({
      ...b, saved: b.saved + savedDelta,
      results: b.results.map((r) => (r.path === path ? { ...r, ...upd } : r)),
    })), []);

  /** إعادة استيراد ملف واحد من الدفعة بعد تصنيف حسابه. */
  const reimportBatchRow = useCallback(async (path: string) => {
    const res = await dataApi.batch([path]);
    const row = res.results?.[0];
    if (row) patchBatchRow(path, row, row.status === 'saved' ? 1 : 0);
    onChanged();
  }, [onChanged, patchBatchRow]);

  /** «إنشاء المورد…» لصف دفعة: نقرأ الملف منفرداً (الدفعة لا تدعم create_supplier). */
  const loadBatchNewParty = useCallback((row: BatchRow): Promise<ImportPayload> =>
    dataApi.commit(row.path, row.source), []);

  const confirmBatchNewParty = useCallback(async (row: BatchRow, form: NewPartyForm) => {
    const res = await dataApi.commit(row.path, row.source, form);
    if (res.saved === false) throw new Error(res.message || res.reason || 'تعذّر الحفظ');
    patchBatchRow(row.path, {
      status: 'saved', message: 'تم الحفظ بنجاح — أُنشئ حساب المورد',
      supplierName: res.supplier?.name ?? row.supplierName,
      added: res.added ?? row.added, skipped: res.skipped ?? row.skipped,
    }, 1);
    onChanged();
  }, [onChanged, patchBatchRow]);

  const declineBatchNewParty = useCallback((row: BatchRow) =>
    patchBatchRow(row.path, { message: 'لم يُحفظ شيء — لم يُنشأ الحساب (تجاهله المستخدم)' }), [patchBatchRow]);

  const savable = queue.filter((it) => SAVABLE.includes(it.status));
  const stillReading = queue.some((it) => it.status === 'pending' || it.status === 'reading');
  const blockedByClass = queue.filter((it) => (it.preview?.needsClassification ?? []).length > 0).length;

  return {
    // ملفات منفردة
    queue, pickErr, saving, done, savable, stillReading, blockedByClass,
    canSave: queue.length > 0 && !saving && !stillReading && savable.length > 0 && !done,
    pickFiles, addFiles, previewOne, dropFile, saveAll, confirmNewParty, declineNewParty, reset,
    confirmProject, forceAccounts,
    // مجلد
    scan, scanning, batch, batchBusy, pickFolder, uploadBatch,
    reimportBatchRow, loadBatchNewParty, confirmBatchNewParty, declineBatchNewParty,
    idle: queue.length === 0 && !scan && !batch,
  };
}
export type ImportSession = ReturnType<typeof useImportSession>;
