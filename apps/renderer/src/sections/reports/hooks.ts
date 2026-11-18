/**
 * جلب بيانات قسم «التقارير» — دوال جلب نقية مُنمَّطة + خطافات رفيعة فوقها.
 *
 * المرحلة A: الخطافات مبنية على useLoad محلي (حارس تسلسل كما في Report.tsx:98-113
 * يمنع ردّاً قديماً من الكتابة فوق نطاق أحدث). المرحلة B: تُستبدل بـ TanStack Query
 * من أساس الواجهة (وكيل F) بنفس مفاتيح `reportKeys` — الدوال النقية لا تتغيّر.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type {
  AnalysisParams, AnalysisPayload, Granularity, PeriodicPayload, PrioritiesPayload,
  ProjectSummaryPayload, PartyScope, ScopesPayload,
} from './types';

/* ───────── مفاتيح الاستعلام (ثابتة بين المرحلتين) ───────── */
export const reportKeys = {
  analysis: (p: AnalysisParams) => ['reports', 'analysis', p] as const,
  scopes: () => ['reports', 'scopes'] as const,
  projectSummary: (project: string, parties: PartyScope) =>
    ['reports', 'project-summary', project, parties] as const,
  priorities: (budget: number | null, ai: boolean) => ['reports', 'priorities', budget, ai] as const,
  periodic: (g: Granularity, year: number, account?: string) =>
    ['reports', 'periodic', g, year, account ?? null] as const,
};

/* ───────── دوال الجلب ───────── */
export function fetchAnalysis(p: AnalysisParams): Promise<AnalysisPayload> {
  const { account, ...rest } = p;
  return api.report(account, rest) as Promise<AnalysisPayload>;
}
export const fetchScopes = (): Promise<ScopesPayload> => api.reportScopes() as Promise<ScopesPayload>;
export const fetchProjectSummary = (project: string, parties: PartyScope): Promise<ProjectSummaryPayload> =>
  api.projectSummary(project, parties) as Promise<ProjectSummaryPayload>;
export const fetchPeriodic = (g: Granularity, year: number, account?: string): Promise<PeriodicPayload> =>
  api.periodic(g, year, account) as Promise<PeriodicPayload>;

/**
 * أولويات السداد: مسار الذكاء أولاً إن كان مفعّلاً (يضيف narrative)، ثم رجوع إلى
 * الترتيب الحتمي — نفس سلوك Report.tsx:348-370. القسم لا يفرغ أبداً لغياب الذكاء.
 * `note` يُعاد حين حدث الرجوع، لتقول الواجهة لماذا لا شرح.
 */
export async function fetchPriorities(budget: number | null, aiEnabled: boolean):
  Promise<PrioritiesPayload & { note?: string }> {
  const b = budget ?? undefined;
  if (aiEnabled) {
    try {
      return (await api.aiPriorities(b)) as unknown as PrioritiesPayload;
    } catch { /* رجوع أدناه */ }
  }
  const r = (await api.priorities(b)) as PrioritiesPayload;
  return {
    ...r,
    note: aiEnabled
      ? 'الشرح الآلي لهذه القائمة غير متاح حالياً — الترتيب والأرقام أدناه محسوبة كودياً وكاملة رغم ذلك.'
      : undefined,
  };
}

/* ───────── useLoad (مؤقت حتى TanStack Query) ───────── */
export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function useLoad<T>(key: string, fn: (() => Promise<T>) | null): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    const f = fnRef.current;
    const my = ++seq.current;
    if (!f) { setData(null); setError(null); setLoading(false); return; }
    setLoading(true); setError(null);
    f().then(
      (r) => { if (my === seq.current) { setData(r); setLoading(false); } },
      (e: unknown) => {
        if (my !== seq.current) return;
        setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
  }, []);

  useEffect(run, [key, run]);
  return { data, error, loading, reload: run };
}

/* ───────── الخطافات ───────── */
export const useAnalysis = (p: AnalysisParams) =>
  useLoad(JSON.stringify(reportKeys.analysis(p)), () => fetchAnalysis(p));

export const useScopes = () => useLoad(JSON.stringify(reportKeys.scopes()), fetchScopes);

export const useProjectSummary = (project: string | null, parties: PartyScope) =>
  useLoad(JSON.stringify(reportKeys.projectSummary(project ?? '', parties)),
    project ? () => fetchProjectSummary(project, parties) : null);

export const usePeriodic = (g: Granularity, year: number, account?: string) =>
  useLoad(JSON.stringify(reportKeys.periodic(g, year, account)), () => fetchPeriodic(g, year, account));

/** `aiReady=false` أثناء تحميل حالة الذكاء — لا طلب قبل معرفتها (Report.tsx:372-375). */
export const usePriorities = (budget: number | null, aiEnabled: boolean, aiReady: boolean) =>
  useLoad(JSON.stringify(reportKeys.priorities(budget, aiEnabled)),
    aiReady ? () => fetchPriorities(budget, aiEnabled) : null);

/** الملخص التنفيذي (AI) — فعل عند الطلب لا جلب تلقائي. */
export async function requestAiSummary(p: AnalysisParams): Promise<string> {
  const r = await api.aiSummary({
    account: p.account, project: p.project, contractor: p.contractor,
    parties: p.parties, date_from: p.date_from, date_to: p.date_to,
  });
  return r.summary;
}
