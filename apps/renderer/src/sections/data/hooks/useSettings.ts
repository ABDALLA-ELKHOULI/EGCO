/**
 * الإعدادات: معلومات التطبيق، الذكاء + الأنماط المتعلَّمة، تصنيفات الحسابات،
 * النقل لجهاز آخر، التحديثات، وتصفير البيانات.
 */
import { useCallback, useEffect, useState } from 'react';
import { dataApi, errMsg } from '../api';
import { useAction, useAsync } from './useAsync';
import type { AiSettings, AppInfo, Note, ResetPreview, ResetResult, UpdateStatus } from '../types';

export function useAppInfo() {
  const health = useAsync(() => dataApi.health(), []);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => { window.egco?.info().then(setInfo).catch(() => undefined); }, []);
  return { health: health.data, healthError: health.error, info, revealDataDir: () => window.egco?.revealDataDir() };
}

export function useAiSettings() {
  const q = useAsync(() => dataApi.aiSettings(), []);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  useEffect(() => { if (q.data) setDraft(q.data); }, [q.data]);
  const act = useAction();
  const set = (p: Partial<AiSettings>) => setDraft((d) => (d ? { ...d, ...p } : d));
  /** «•••» = مفتاح محفوظ لم يُعرض؛ إرساله كما هو يُبقيه على الخادم. */
  const keyMasked = q.data?.apiKey === '•••';
  const save = () => act.run('save', async () => {
    if (!draft) return;
    setDraft(await dataApi.saveAiSettings(draft));
    return { ok: true, text: 'تم حفظ الإعدادات' };
  });
  // يختبر ما يراه المستخدم على الشاشة: حفظ ثم اختبار.
  const test = () => act.run('test', async () => {
    if (!draft) return;
    await dataApi.saveAiSettings(draft);
    const r = await dataApi.aiTest();
    return { ok: r.ok, text: r.message };
  });
  const layouts = useAsync(() => dataApi.aiLearnedLayouts().then((r) => r.items).catch(() => []), []);
  return { draft, set, keyMasked, loadError: q.error, busy: act.busy, note: act.note, save, test, layouts: layouts.data ?? [] };
}

/** هل المساعد مفعّل — لإظهار «محاولة القراءة بالذكاء الاصطناعي» في الرفع. */
export function useAiEnabled() {
  const q = useAsync(() => dataApi.aiSettings(), []);
  return !!q.data?.enabled;
}

export function useClassifications() {
  const q = useAsync(() => dataApi.classifications(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const remove = useCallback(async (account: string) => {
    setBusy(account); setErr(null);
    try { await dataApi.unclassify(account); q.refetch(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  }, [q]);
  /** تغيير النوع مباشرة (من النموذج) — PUT يستبدل القرار. */
  const change = useCallback(async (account: string, kind: 'supplier' | 'contractor' | 'guarantee' | 'ignore', name?: string) => {
    setBusy(account); setErr(null);
    try { await dataApi.classify(account, kind, name); q.refetch(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  }, [q]);
  return { rows: q.data?.rows, error: err ?? q.error, isLoading: q.isLoading, refetch: q.refetch, busy, remove, change };
}

/** تخصيص الدفعات — مفتاح عام يملكه الخادم؛ يظهر هنا وفي صفحة المورد. */
export function usePaymentAllocation() {
  const q = useAsync(() => dataApi.paymentAllocation(), []);
  const act = useAction();
  const toggle = () => act.run('alloc', async () => {
    await dataApi.setPaymentAllocation(!q.data?.enabled); q.refetch();
  });
  return { enabled: q.data?.enabled, error: q.error ?? null, busy: act.busy === 'alloc', note: act.note, toggle };
}

export function useDataTransfer() {
  const act = useAction();
  const exportData = () => act.run('export', async () => {
    if (!window.egco) return;
    const r = await window.egco.exportData();
    if (r.canceled) return;
    return r.ok ? { ok: true, text: `تم التصدير إلى: ${r.path}` } : { ok: false, text: r.error ?? 'تعذّر التصدير' };
  });
  // النجاح يعيد تشغيل التطبيق، فلا رسالة نجاح تُرى.
  const importData = () => act.run('import', async () => {
    if (!window.egco) return;
    const r = await window.egco.importData();
    if (!r.canceled && !r.ok) return { ok: false, text: r.error ?? 'تعذّر الاستيراد' };
  });
  return { busy: act.busy, note: act.note, exportData, importData };
}

/**
 * فحص تحديث يدوي — كل نتيجة تظهر كما هي، بما فيها نص الخطأ الفعلي.
 * يستمع لأحداث لاحقة (تنزيل جارٍ/اكتمل) حتى بعد انتهاء الفحص.
 */
export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (typeof window.egco?.onUpdateStatus !== 'function') return undefined;
    return window.egco.onUpdateStatus((s) => { setStatus(s); setBusy(false); });
  }, []);
  const check = useCallback(async () => {
    if (!window.egco) return;
    setBusy(true); setStatus(null);
    try {
      const s = await window.egco.checkForUpdates();
      if (s.state !== 'checking') { setStatus(s); setBusy(false); }
    } catch (e) { setStatus({ state: 'error', message: errMsg(e) }); setBusy(false); }
  }, []);
  return { status, busy, check, install: () => window.egco?.installUpdate() };
}

/**
 * تصفير البيانات — ثلاثة حواجز: أعداد حقيقية لما سيُحذف، كتابة العبارة (من الخادم)
 * بدل نقرة، وقائمة صريحة بما يبقى. الخادم يأخذ نسخة قبل المحو ويُلغي إن فشلت.
 */
export function useWipe() {
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<ResetResult | null>(null);

  const open = useCallback(async () => {
    setErr(null); setDone(null); setPhrase('');
    try { setPreview(await dataApi.resetPreview()); } catch (e) { setErr(errMsg(e)); }
  }, []);
  const close = useCallback(() => { if (!busy) { setPreview(null); setPhrase(''); } }, [busy]);
  const ready = preview !== null && !preview.isEmpty && phrase.trim() === preview.confirmPhrase;
  const run = useCallback(async () => {
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      const r = await dataApi.resetAll(phrase.trim());
      setDone(r); setPreview(null);
      // كل الشاشات تقرأ عند التحميل — إعادة التحميل أبسط وأصدق من إبطال كل ذاكرة مؤقتة.
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }, [ready, phrase]);
  return { preview, phrase, setPhrase, ready, busy, err, done, open, close, run };
}

export type { Note };
