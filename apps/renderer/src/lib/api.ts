/**
 * عميل الخدمة المحلية — v0.2.
 *
 * OWNED BY THE INTEGRATOR: agents read this file, they do not edit it.
 * Shapes are defined in docs/API-CONTRACT-v0.2.md.
 */
let base = '';

export async function initApi(): Promise<string> {
  if (window.egco?.backendUrl) base = await window.egco.backendUrl();
  else base = 'http://127.0.0.1:8756';
  return base;
}

/** For building direct download links (Excel export). */
export const apiBase = () => base;

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let msg = `خطأ ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch { /* keep the status message */ }
    throw new ApiError(msg);
  }
  return res.json() as Promise<T>;
}

const post = <T>(p: string, body: unknown) =>
  call<T>(p, { method: 'POST', body: JSON.stringify(body) });
const put = <T>(p: string, body: unknown) =>
  call<T>(p, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(p: string) => call<T>(p, { method: 'DELETE' });

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : '';
};

export interface Period { date_from?: string; date_to?: string }

/** أطراف التقرير — الموردون، المقاولون، أو الاثنان. الافتراضي: الموردون. */
export type PartyScope = 'suppliers' | 'contractors' | 'both';

/** معاملات نطاق التقرير التحليلي (مورد/مشروع/مقاول + الأطراف). */
export interface ReportScopeParams {
  account?: string;
  project?: string;
  contractor?: string;
  parties?: PartyScope;
}

export const api = {
  health: () => call<{ status: string; db: string; version: string }>('/health'),

  dashboard: (p: Period & { project?: string } = {}) => call<any>('/api/v1/dashboard' + qs({ ...p })),
  /** تفاصيل يوم في التقويم — فواتير مستحقة وضمانات تُصرف، مع روابط أصحابها */
  calendarDay: (date: string, p: { project?: string } = {}) =>
    call<any>('/api/v1/dashboard/day' + qs({ date, ...p })),

  suppliers: (p: { q?: string; project?: string; status?: string } = {}) =>
    call<any>('/api/v1/suppliers' + qs(p)),
  supplier: (account: string, p: Period = {}) =>
    call<any>(`/api/v1/suppliers/${account}` + qs({ ...p })),

  /* ---- CRUD الموردين ---- */
  createSupplier: (b: { account: string; name: string; project: string; term: string }) =>
    post<any>('/api/v1/suppliers', b),
  updateSupplier: (account: string, b: { name?: string; project?: string; term?: string }) =>
    put<any>(`/api/v1/suppliers/${account}`, b),
  deleteSupplier: (account: string, force = false) =>
    del<{ deleted: boolean }>(`/api/v1/suppliers/${account}` + (force ? '?force=true' : '')),

  /* ---- المديونية اليدوية ---- */
  addManualInvoice: (b: { account: string; amount: number; date: string;
    due_date?: string; description?: string; reference?: string }) =>
    post<any>('/api/v1/manual/invoices', b),
  updateManualInvoice: (id: string, b: Partial<{ amount: number; date: string;
    due_date: string; description: string; reference: string }>) =>
    put<any>(`/api/v1/manual/invoices/${id}`, b),
  deleteManualInvoice: (id: string) => del<{ deleted: boolean }>(`/api/v1/manual/invoices/${id}`),
  addManualPayment: (b: { account: string; amount: number; date: string;
    description?: string; reference?: string }) =>
    post<any>('/api/v1/manual/payments', b),
  deleteManualPayment: (id: string) => del<{ deleted: boolean }>(`/api/v1/manual/payments/${id}`),

  /* ---- الرفع ---- */
  previewImport: (path: string, source: string) =>
    post<any>('/api/v1/import/preview', { path, source }),
  runImport: (path: string, source: string, allow_unreconciled = false) =>
    post<any>('/api/v1/import', { path, source, allow_unreconciled }),
  /** الملفات المرفوعة — لعرضها وحذف حركاتها */
  importHistory: () => call<ImportHistoryResponse>('/api/v1/import/history'),
  deleteImport: (id: string, force = false) =>
    del<ImportDeleteResult>(`/api/v1/import/history/${id}` + (force ? '?force=true' : '')),

  /* ---- التقارير ---- */
  report: (account?: string, p: Period & Omit<ReportScopeParams, 'account'> = {}) =>
    call<any>('/api/v1/reports/analysis' + qs({ account, ...p })),
  reportScopes: () => call<any>('/api/v1/reports/scopes'),
  periodic: (granularity: 'quarter' | 'half' | 'year', year: number, account?: string) =>
    call<any>('/api/v1/reports/periodic' + qs({ granularity, year, account })),
  exportExcelUrl: (params: Record<string, string | number | undefined>) =>
    base + '/api/v1/reports/export.xlsx' + qs(params),
  /* ---- v0.3: الرفع بالمجلد والتغطية ---- */
  scanDir: (dir: string) => post<any>('/api/v1/import/scan', { dir }),
  batchImport: (paths: string[], allow_unreconciled = false) =>
    post<any>('/api/v1/import/batch', { paths, allow_unreconciled }),
  coverage: (staleDays = 90) => call<any>('/api/v1/coverage' + qs({ stale_days: staleDays })),
  setDueDate: (invoiceId: string, due_date: string | null) =>
    put<any>(`/api/v1/invoices/${invoiceId}/due-date`, { due_date }),

  /* ---- v0.3: المشاريع ---- */
  projects: () => call<any>('/api/v1/projects'),
  project: (name: string) => call<any>(`/api/v1/projects/${encodeURIComponent(name)}`),

  /* ---- v0.5: التحصيلات (الإيراد) يدوياً ---- */
  revenues: (p: { q?: string; project?: string; status?: string } = {}) =>
    call<any>('/api/v1/revenues' + qs(p)),
  createRevenue: (b: { project?: string; unit?: string; client: string; amount: number;
                       dueDate?: string; status?: string; collectedOn?: string; notes?: string }) =>
    post<any>('/api/v1/revenues', b),
  updateRevenue: (id: string, b: Partial<{ project: string; unit: string; client: string;
                       amount: number; dueDate: string | null; status: string;
                       collectedOn: string | null; notes: string }>) =>
    put<any>(`/api/v1/revenues/${id}`, b),
  deleteRevenue: (id: string) => del<{ deleted: boolean }>(`/api/v1/revenues/${id}`),

  /* ---- v0.3: التدفق النقدي ---- */
  cashflow: (p: { weeks?: number; from?: string; opening_balance?: number; project?: string;
    parties?: 'suppliers' | 'contractors' | 'both' } = {}) =>
    call<any>('/api/v1/cashflow' + qs({ ...p })),

  /* ---- v0.3: لوحة القيادة ---- */
  overview: () => call<any>('/api/v1/overview'),

  /* ---- v0.4: المقاولون ---- */
  contractors: () => call<ContractorsResponse>('/api/v1/contractors'),
  contractor: (code: string) =>
    call<ContractorDetailResponse>(`/api/v1/contractors/${encodeURIComponent(code)}`),
  createContractor: (b: ContractorBody) => post<any>('/api/v1/contractors', b),
  updateContractor: (code: string, b: Partial<ContractorBody>) =>
    put<any>(`/api/v1/contractors/${encodeURIComponent(code)}`, b),
  deleteContractor: (code: string, force = false) =>
    del<{ deleted: boolean }>(`/api/v1/contractors/${encodeURIComponent(code)}` + (force ? '?force=true' : '')),

  createContractorEntry: (code: string, b: ContractorEntryBody) =>
    post<any>(`/api/v1/contractors/${encodeURIComponent(code)}/entries`, b),
  updateContractorEntry: (code: string, id: string, b: Partial<ContractorEntryBody>) =>
    put<any>(`/api/v1/contractors/${encodeURIComponent(code)}/entries/${id}`, b),
  deleteContractorEntry: (code: string, id: string) =>
    del<{ deleted: boolean }>(`/api/v1/contractors/${encodeURIComponent(code)}/entries/${id}`),

  createContractorClaim: (code: string, b: ContractorClaimBody) =>
    post<any>(`/api/v1/contractors/${encodeURIComponent(code)}/claims`, b),
  updateContractorClaim: (code: string, id: string, b: Partial<ContractorClaimBody>) =>
    put<any>(`/api/v1/contractors/${encodeURIComponent(code)}/claims/${id}`, b),
  deleteContractorClaim: (code: string, id: string) =>
    del<{ deleted: boolean }>(`/api/v1/contractors/${encodeURIComponent(code)}/claims/${id}`),

  createContractorGuarantee: (code: string, b: ContractorGuaranteeBody) =>
    post<any>(`/api/v1/contractors/${encodeURIComponent(code)}/guarantees`, b),
  updateContractorGuarantee: (code: string, id: string, b: Partial<ContractorGuaranteeBody>) =>
    put<any>(`/api/v1/contractors/${encodeURIComponent(code)}/guarantees/${id}`, b),
  deleteContractorGuarantee: (code: string, id: string) =>
    del<{ deleted: boolean }>(`/api/v1/contractors/${encodeURIComponent(code)}/guarantees/${id}`),

  /* ---- v0.4: الموازنة التقديرية ---- */
  budget: () => call<BudgetResponse>('/api/v1/budget'),
  budgetImport: (path: string) => post<any>('/api/v1/budget/import', { path }),

  /* ---- v0.5: مساعد الذكاء الاصطناعي (Ollama أو أي مزود متوافق مع OpenAI) ---- */
  aiSettings: () => call<AiSettings>('/api/v1/ai/settings'),
  saveAiSettings: (b: Partial<AiSettings>) => put<AiSettings>('/api/v1/ai/settings', b),
  aiTest: () => post<{ ok: boolean; message: string; model?: string }>('/api/v1/ai/test', {}),
  aiExtract: (path: string) => post<any>('/api/v1/ai/extract', { path }),

  /* ---- v0.5: مزايا المساعد — نصوص فقط، الأرقام تأتي دائماً من قاعدة البيانات ---- */
  /** سؤال بالعربية عن البيانات — قراءة فقط */
  aiAsk: (question: string) =>
    post<{ answer: string; sql?: string; rows?: any[] }>('/api/v1/ai/ask', { question }),
  /** صياغة مطالبة/متابعة لمورد أو مقاول */
  aiRemind: (b: { partyKind: 'supplier' | 'contractor'; key: string }) =>
    post<{ message: string }>('/api/v1/ai/remind', b),
  /** مسودة الملاحظات المالية لتقرير موازنة مشروع */
  aiBudgetNotes: (project: string) =>
    post<{ notes: string }>('/api/v1/ai/budget-notes', { project }),
  /** ملخص تنفيذي نصي لحمولة التقرير الحالية */
  aiSummary: (b: { parties?: string; account?: string; project?: string; contractor?: string;
                   date_from?: string; date_to?: string }) =>
    post<{ summary: string }>('/api/v1/ai/summary', b),
  /** موجز التغيرات الأخيرة (أسبوع افتراضاً) */
  aiBrief: (days = 7) => post<{ brief: string }>('/api/v1/ai/brief', { days }),
  /** ملاحظات شذوذ مرشّحة آلياً ومصاغة نصياً — تنبيهات فقط، لا تعديل بيانات */
  aiAnomalies: () =>
    post<{ items: { title: string; detail: string; link?: string }[] }>('/api/v1/ai/anomalies', {}),
  /** ماذا-لو: تأجيل/تقديم دفعة — الحساب حتمي في الخادم، والنموذج يصوغ الأثر نصياً */
  aiWhatIf: (b: { partyKind: 'supplier' | 'contractor'; key: string; shiftDays: number }) =>
    post<{ narrative: string; before: any; after: any }>('/api/v1/ai/what-if', b),
  /** ترتيب أولويات السداد — درجات محسوبة بقواعد حتمية، والنموذج يشرح فقط */
  aiPriorities: (budget?: number) =>
    post<{ items: { partyKind: string; key: string; name: string; amount: number;
                    score: number; reason: string }[]; narrative: string }>(
      '/api/v1/ai/priorities', { budget }),
  /** اقتراح قيد من نص ملصوق (رسالة واتساب/بريد) — يُعرض للمراجعة ولا يُحفظ آلياً */
  aiParseText: (text: string) =>
    post<{ proposal: { partyKind?: string; key?: string; date?: string; debit?: number;
                       credit?: number; description?: string; claimNo?: string } }>(
      '/api/v1/ai/parse-text', { text }),
};

/** إعدادات مزود الذكاء الاصطناعي — قابلة للتعديل بالكامل من شاشة الإعدادات. */
export interface AiSettings {
  enabled: boolean;
  /** اسم وصفي فقط، مثل Ollama أو OpenAI */
  provider: string;
  /** قاعدة متوافقة مع OpenAI، مثل http://127.0.0.1:11434/v1 */
  baseUrl: string;
  /** فارغ لمزود محلي مثل Ollama */
  apiKey: string;
  model: string;
  /** أقصى عدد لرموز الإخراج — يُبقي الاستهلاك خفيفاً */
  maxTokens: number;
}

/* ---------------- أنواع المقاولين والموازنة ---------------- */

export interface ContractorBody {
  code: string; name: string; phone?: string; notes?: string;
  defaultRetentionRate?: number; defaultGuaranteeDays?: number;
}

export interface ContractorEntryBody {
  date: string; debit: number; credit: number; description: string;
  kind?: string; project?: string;
}

export interface ContractorClaimBody {
  project: string; number: string; date: string;
  grossCumulative: number; previousCumulative: number;
  retentionRate?: number; retentionAmount: number;
  otherDeductions: number; netDue: number; description?: string;
}

export interface ContractorGuaranteeBody {
  project: string; amount?: number; retentionRate?: number;
  finishedOn?: string; guaranteeDays?: number; releaseDue?: string;
  releasedOn?: string; notes?: string;
}

export interface ContractorRow {
  code: string; name: string; phone: string | null; projects: string[];
  balance: number; duesTotal: number; paidTotal: number; retentionHeld: number;
  entryCount: number; lastActivity: string | null; releaseAlerts: number;
  lastPayment: { date: string; amount: number } | null;
}

export interface ContractorsResponse {
  count: number;
  rows: ContractorRow[];
  totals: { owedToContractors: number; owedToUs: number; retentionHeld: number };
}

export type GuaranteeDueStatus = 'released' | 'due' | 'upcoming' | 'scheduled';

export interface ContractorEntry {
  id: string; date: string; debit: number; credit: number; doc: string | null;
  description: string; kind: string; claimNo: string | null;
  project: string | null; source: string;
}

export interface ContractorClaim {
  id: string; project: string; number: string; date: string;
  grossCumulative: number; previousCumulative: number;
  retentionRate: number | null; retentionAmount: number;
  otherDeductions: number; netDue: number;
  description: string | null; source: string;
}

export interface ContractorGuarantee {
  id: string; project: string; amount: number | null; retentionRate: number | null;
  finishedOn: string | null; guaranteeDays: number | null; releaseDue: string | null;
  releasedOn: string | null; notes: string | null; dueStatus: GuaranteeDueStatus;
}

export interface ContractorDetailResponse {
  code: string; name: string; phone: string | null; notes: string | null;
  defaultRetentionRate: number | null; defaultGuaranteeDays: number | null;
  balance: number;
  duesTotal: number; paidTotal: number;
  lastPayment: { date: string; amount: number } | null;
  perProject: { project: string; debit: number; credit: number; balance: number; entryCount: number }[];
  entries: ContractorEntry[];
  claims: ContractorClaim[];
  guarantees: ContractorGuarantee[];
}

export interface BudgetMonth {
  /** رقم التقرير كما يصدر من الملف، مثل 'EGCO/1607026'. */
  month: string; serial: string | null; issuedOn: string | null;
  actualMonth: number; plannedMonth: number; deviationMonth: number;
  cumActual: number; cumPlanned: number;
  cumPrevActual: number; cumPrevPlanned: number;
  /** كسور لا نسب مئوية: 0.17 = ٪17 — تُضرب في 100 عند العرض. */
  delayPct: number; completionPct: number;
  claims: { no: string; amount: number; date: string | null }[];
  notes: string | null;
}

export interface BudgetProject {
  project: string;
  months: BudgetMonth[];
  latest: BudgetMonth | null;
  trend: { delayDeltaPp: number } | null;
}

export interface BudgetResponse { projects: BudgetProject[] }

/* ---------------- الملفات المرفوعة ---------------- */

export interface ImportHistoryRow {
  id: string;
  date: string;          // ISO — created_at
  fileName: string;
  path: string;
  source: string;
  detected: string;      // تصنيف عربي
  account: string | null;
  partyName: string | null;
  added: number;
  skipped: number;
  reconciled: boolean;
  linkedRows: number;
  canDelete: boolean;
  legacy: boolean;
}

export interface ImportHistoryResponse { rows: ImportHistoryRow[] }

export interface ImportDeleteResult {
  deleted: { invoices: number; payments: number; entries: number; receivables: number };
  approximate?: boolean;
}
