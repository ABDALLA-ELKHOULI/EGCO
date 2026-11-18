/* عميل قسم «الأطراف» — غلاف مُنمَّط فوق lib/api.ts (لا يُعدَّل ذلك الملف)، ويضيف المسارات
 * التي كانت الصفحات القديمة تناديها مباشرة (تخصيص الدفعات، نظرة المقاولين، تصدير الموردين)
 * ومسارات م-٥٠ الجديدة. */
import { api, apiBase, contractorsExportUrl, type ContractorExportFormat } from '@/lib/api';
import { request } from '@/data';
import type {
  AllocationLine, ContractorBodyX, ContractorClaimBody, ContractorDetail, ContractorEntryBody,
  ContractorGuaranteeBody, ContractorListResponse, ContractorQuery, ContractorsOverview,
  GuaranteeAccountDetail, GuaranteesResponse, ManualInvoiceBody, ManualPaymentBody,
  ParseTextProposal, PartyProjectBody, PartyProjectsResponse, PartyType, PaymentAllocationSetting,
  PriorityItem, SupplierBody, SupplierDetailResponse, SupplierListResponse, SupplierQuery,
} from './types';

/* المسارات بلا دالة في lib/api.ts تمرّ عبر request من @/data (نفس رسائل الخطأ العربية، حقل status). */
const req = <T>(path: string, init: { method?: string; body?: string } = {}) => request<T>(path, init);

const enc = encodeURIComponent;

/** سلسلة استعلام بلا قيم فارغة — نفس قاعدة qs() في lib/api.ts. */
export function queryString(p: Record<string, string | number | boolean | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}

const partyBase = (t: PartyType, id: string) =>
  `/api/v1/${t === 'supplier' ? 'suppliers' : 'contractors'}/${enc(id)}`;

export const partiesApi = {
  /* ── الموردون ── */
  suppliers: (q: SupplierQuery = {}) => api.suppliers(q) as Promise<SupplierListResponse>,
  supplier: (account: string) => api.supplier(account) as Promise<SupplierDetailResponse>,
  createSupplier: (b: SupplierBody) => api.createSupplier(b),
  updateSupplier: (account: string, b: Partial<Omit<SupplierBody, 'account'>>) => api.updateSupplier(account, b),
  /** force=false أولاً؛ ٤٠٩ يعني «له حركات» → تأكيد بكتابة الحساب ثم force=true. */
  deleteSupplier: (account: string, force = false) => api.deleteSupplier(account, force),
  /** رابط Excel بنفس معايير القائمة بالضبط — ما تراه الشاشة هو ما يُصدَّر. */
  suppliersExportUrl: (q: SupplierQuery) => apiBase() + '/api/v1/suppliers/export.xlsx' + queryString(q),

  addManualInvoice: (account: string, b: ManualInvoiceBody) => api.addManualInvoice({ account, ...b }),
  updateManualInvoice: (id: string, b: Partial<ManualInvoiceBody>) => api.updateManualInvoice(id, b),
  deleteManualInvoice: (id: string) => api.deleteManualInvoice(id),
  addManualPayment: (account: string, b: ManualPaymentBody) => api.addManualPayment({ account, ...b }),
  deleteManualPayment: (id: string) => api.deleteManualPayment(id),
  setDueDate: (invoiceId: string, due: string | null) => api.setDueDate(invoiceId, due),

  /* تخصيص الدفعات (إعداد عام، افتراضياً متوقف) */
  allocationSetting: () => req<PaymentAllocationSetting>('/api/v1/suppliers/settings/payment-allocation'),
  setAllocationSetting: (enabled: boolean) =>
    req<PaymentAllocationSetting>('/api/v1/suppliers/settings/payment-allocation',
      { method: 'PUT', body: JSON.stringify({ enabled }) }),
  allocationPendingCount: () => req<{ count: number }>('/api/v1/suppliers/payment-allocation/pending-count'),
  allocatePayment: (account: string, paymentId: string, lines: AllocationLine[]) =>
    req<unknown>(`/api/v1/suppliers/${enc(account)}/payments/${enc(paymentId)}/allocate`,
      { method: 'POST', body: JSON.stringify({ lines }) }),
  /** موجود في الخادم ولم تكن الواجهة القديمة تناديه — «إلغاء التخصيص» يعيد الدفعة معلَّقة. */
  clearAllocation: (account: string, paymentId: string) =>
    req<unknown>(`/api/v1/suppliers/${enc(account)}/payments/${enc(paymentId)}/allocate`, { method: 'DELETE' }),

  /* ── المقاولون ── */
  contractors: (q: ContractorQuery = {}) => api.contractorsList(q) as Promise<ContractorListResponse>,
  contractorsOverview: () => req<ContractorsOverview>('/api/v1/contractors/overview'),
  contractor: (code: string) => api.contractor(code) as Promise<ContractorDetail>,
  createContractor: (b: ContractorBodyX) => api.createContractor(b as Parameters<typeof api.createContractor>[0]),
  updateContractor: (code: string, b: Partial<ContractorBodyX>) =>
    api.updateContractor(code, b as Parameters<typeof api.updateContractor>[1]),
  deleteContractor: (code: string, force = false) => api.deleteContractor(code, force),
  createEntry: (code: string, b: ContractorEntryBody) => api.createContractorEntry(code, b),
  updateEntry: (code: string, id: string, b: Partial<ContractorEntryBody>) => api.updateContractorEntry(code, id, b),
  deleteEntry: (code: string, id: string) => api.deleteContractorEntry(code, id),
  createClaim: (code: string, b: ContractorClaimBody) => api.createContractorClaim(code, b),
  updateClaim: (code: string, id: string, b: Partial<ContractorClaimBody>) => api.updateContractorClaim(code, id, b),
  deleteClaim: (code: string, id: string) => api.deleteContractorClaim(code, id),
  createGuarantee: (code: string, b: ContractorGuaranteeBody) => api.createContractorGuarantee(code, b),
  updateGuarantee: (code: string, id: string, b: Partial<ContractorGuaranteeBody>) =>
    api.updateContractorGuarantee(code, id, b),
  deleteGuarantee: (code: string, id: string) => api.deleteContractorGuarantee(code, id),
  /** ١٤ صيغة Excel — نفس رابط lib/api.ts بمعاملات التصفية الحالية. */
  contractorsExportUrl: (format: ContractorExportFormat, params: Record<string, string | number | undefined>,
    extra?: { project?: string; code?: string }) => contractorsExportUrl(format, params, extra),

  /* ── الضمانات ── */
  guarantees: () => api.guarantees() as Promise<GuaranteesResponse>,
  guaranteeAccount: (account: string) => api.guaranteeAccount(account) as Promise<GuaranteeAccountDetail>,

  /* ── م-٥٠ ── */
  partyProjects: (t: PartyType, id: string) => req<PartyProjectsResponse>(`${partyBase(t, id)}/projects`),
  putPartyProject: (t: PartyType, id: string, project: string, b: PartyProjectBody) =>
    req<unknown>(`/api/v1/projects/${enc(project)}/parties/${t}/${enc(id)}`,
      { method: 'PUT', body: JSON.stringify(b) }),
  removePartyProject: (t: PartyType, id: string, project: string) =>
    req<unknown>(`/api/v1/projects/${enc(project)}/parties/${t}/${enc(id)}`, { method: 'DELETE' }),

  /* ── المساعد (نص فقط؛ الأرقام من القاعدة) ── */
  aiRemind: (partyKind: PartyType, key: string) => api.aiRemind({ partyKind, key }),
  aiPriorities: (budget?: number) =>
    api.aiPriorities(budget) as Promise<{ items: PriorityItem[]; narrative: string }>,
  /** أولويات حتمية بلا ذكاء اصطناعي — تعمل حين يكون المساعد معطّلاً. */
  priorities: (budget?: number) => api.priorities(budget) as Promise<{ items: PriorityItem[] }>,
  aiParseText: (text: string) => api.aiParseText(text) as Promise<{ proposal: ParseTextProposal }>,
};
