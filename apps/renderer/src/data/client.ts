/**
 * عميل خفيف لنقاط الطبقة الجديدة (الأحداث، /today) — lib/api.ts ملك المُدمِج ولا يقبل signal،
 * فهذا يعيد استعمال عنوانه (apiBase) ويضيف الإلغاء وقراءة الأخطاء بنفس الرسائل العربية.
 */
import { apiBase, ApiError } from '@/lib/api';

export async function request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError('تعذّر الاتصال بالخدمة المحلية — تأكد أنها تعمل ثم أعد المحاولة');
  }
  if (!res.ok) {
    let msg = `خطأ ${res.status}`;
    try { const b = await res.json(); if (b?.detail) msg = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail); } catch { /* رسالة الحالة */ }
    const err = new ApiError(msg) as ApiError & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  try { return (await res.json()) as T; } catch { throw new ApiError('استجابة غير سليمة من الخدمة المحلية — أعد المحاولة'); }
}

/** مسارات الخادم المتاحة (من /openapi.json) — لاكتشاف النقاط الجديدة دون طلب 404 يلوّث الكونسول. */
// BUG-008: كان فشل جلب /openapi.json (وكيل e2e لا يوكّله فيعود index.html) يُخزَّن «لا مسارات» فيُخفي
// /today ويُظهر «رصيد البنك غير مُدخل» كذباً. الآن الفشل = «غير معروف» (null) ولا يُخزَّن، والمستدعي يطلب مباشرة.
let pathsCache: { at: number; paths: Set<string> } | null = null;
export async function serverPaths(maxAgeMs = 60_000): Promise<Set<string> | null> {
  if (pathsCache && Date.now() - pathsCache.at < maxAgeMs) return pathsCache.paths;
  try {
    const spec = await request<{ paths?: Record<string, unknown> }>('/openapi.json');
    if (!spec || typeof spec.paths !== 'object') return null;
    pathsCache = { at: Date.now(), paths: new Set(Object.keys(spec.paths)) };
    return pathsCache.paths;
  } catch {
    return null;
  }
}
/** المسار موجود؟ null = غير معروف (لا وصول لـopenapi) → جرّبه مباشرة. */
export async function hasPath(p: string): Promise<boolean | null> {
  const s = await serverPaths();
  if (s && !s.has(p)) { const fresh = await serverPaths(0); return fresh ? fresh.has(p) : null; }
  return s ? true : null;
}
export const forgetServerPaths = () => { pathsCache = null; };
