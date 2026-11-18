/**
 * التصدير الحقيقي — PDF عبر Electron وملفات XLSX يبنيها الخادم.
 *
 * النموذج كان «نسخ فقط» لأن الصفحة المنشورة تحجب التنزيل والطباعة؛ التطبيق
 * الحقيقي يملك window.egco.exportPdf (حوار حفظ أصلي + printToPDF) ومسارات
 * export.xlsx على الخادم — كلاهما يبقى. CSV/نص من النموذج تُضاف فوقهما لا بدلهما.
 */
import { api, apiBase, CONTRACTOR_EXPORT_GROUPS, contractorsExportUrl, type ContractorExportFormat } from '@/lib/api';
import type { AnalysisParams, Granularity, PartyScope } from './types';

/* ───────── PDF ───────── */

export interface PdfResult { ok: boolean; canceled?: boolean; path?: string; error?: string }

/** نفس آلية Report.tsx:464-470 و PrintableList.tsx:70-76 — في المتصفح: window.print. */
export async function exportPdf(filename: string, landscape: boolean): Promise<PdfResult> {
  if (!window.egco?.exportPdf) { window.print(); return { ok: true }; }
  try {
    const r = await window.egco.exportPdf({ filename, landscape });
    if (r.error) return { ok: false, error: r.error };
    return { ok: !r.canceled, canceled: r.canceled, path: r.path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const stamp = (d = new Date()) => d.toISOString().slice(0, 10);

export const pdfNames = {
  report: () => `EGCO-تقرير-تحليلي-${stamp()}.pdf`,
  slides: () => `EGCO-عرض-${stamp()}.pdf`,
  projectSummary: () => `EGCO-ملخص-مشروع-${stamp()}.pdf`,
  list: (fileStamp: string) => `EGCO-${fileStamp}-${stamp()}.pdf`,
};

/* ───────── XLSX من الخادم ───────── */

/** معاملات التصدير: الأطراف الافتراضية (suppliers) لا تُرسل — كما Report.tsx:115. */
export function analysisExportUrl(p: AnalysisParams & { granularity?: Granularity; year?: number }): string {
  const { parties, ...rest } = p;
  return api.exportExcelUrl({ ...rest, parties: parties === 'suppliers' ? undefined : parties });
}
export const periodicExportUrl = (g: Granularity, year: number, account?: string) =>
  api.exportExcelUrl({ granularity: g, year, account });
export const projectSummaryExportUrl = (project: string, parties: PartyScope) =>
  api.projectSummaryExportUrl(project, parties);

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const o = s.toString();
  return o ? `?${o}` : '';
}
export const suppliersExportUrl = (p: Record<string, string | number | boolean | undefined> = {}) =>
  apiBase() + '/api/v1/suppliers/export.xlsx' + qs(p);
export const budgetExportUrl = (p: Record<string, string | number | boolean | undefined> = {}) =>
  apiBase() + '/api/v1/budget/export.xlsx' + qs(p);

export { CONTRACTOR_EXPORT_GROUPS, contractorsExportUrl };
export type { ContractorExportFormat };

/* ───────── كتالوج شاشة «التصدير» ───────── */

export type CatalogKey =
  | 'analysis' | 'periodic' | 'projectSummary' | 'contractors' | 'suppliers' | 'budget' | 'gm';

export interface CatalogItem {
  key: CatalogKey;
  title: string;
  desc: string;
  formats: ('XLSX' | 'PDF' | 'CSV' | 'نص')[];
}

/** كل عنصر هنا مسار خادم حقيقي موجود اليوم — لا بطاقة بلا تصدير خلفها. */
export const CATALOG: readonly CatalogItem[] = [
  { key: 'gm', title: 'تقرير المدير العام', desc: 'صفحة A4 بالأقسام المختارة', formats: ['PDF', 'XLSX', 'نص'] },
  { key: 'analysis', title: 'التحليل الكامل', desc: 'الملخص والأعمار والجدول والمقاولون والأولويات — بالنطاق', formats: ['XLSX'] },
  { key: 'periodic', title: 'التحليل الدوري', desc: 'ربع/نصف/سنوي مع المقارنة', formats: ['XLSX'] },
  { key: 'projectSummary', title: 'ملخّص بالمشروع', desc: 'سطر واحد لكل شركة في المشروع', formats: ['XLSX', 'PDF'] },
  { key: 'contractors', title: 'المقاولون', desc: '١٣ صيغة: قوائم · بالمشروع · تدقيق · شامل', formats: ['XLSX'] },
  { key: 'suppliers', title: 'قائمة الموردين', desc: 'بنفس تصفية شاشة الموردين', formats: ['XLSX'] },
  { key: 'budget', title: 'الموازنة', desc: 'بنفس فلاتر شاشة الموازنة', formats: ['XLSX'] },
];

/** تنزيل رابط XLSX — رابط مباشر كما كان (`<a download>` / location.href). */
export function download(url: string): void {
  const a = document.createElement('a');
  a.href = url; a.download = '';
  document.body.appendChild(a); a.click(); a.remove();
}

/** نسخ نص إلى الحافظة مع رجوع execCommand (النموذج copyText). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* رجوع */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}
