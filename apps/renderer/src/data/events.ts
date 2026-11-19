/**
 * عميل أحداث الخادم — SSE على GET /api/v1/events/stream (عقد الوكيل B):
 *   event: notification  → حدث كامل (AppEvent) → مخزن الإشعارات (+ الجزيرة/إشعار النظام عبر المستمعين)
 *   event: invalidate    → {keys:[…]} → invalidate(keys)
 *   event: progress      → {kind:'import'|'backup', pct, file} → الجزيرة S2/S3
 * يتدهور بهدوء: يكتشف النقاط من /openapi.json (لا طلب 404 يلوّث الكونسول)؛ بلا تيار → استطلاع
 * /api/v1/events كل 30ث؛ بلا أي نقطة → يعيد الاكتشاف كل 60ث (الخادم قد يُحدَّث أثناء الجلسة).
 */
import { apiBase } from '@/lib/api';
import { forgetServerPaths, request, serverPaths } from './client';
import { invalidate } from './queryClient';
import { notifications, type AppEvent } from './notifications';

export interface ProgressMsg { kind: 'import' | 'backup'; pct: number; file?: string | null }
type Listener<T> = (d: T) => void;
const progressSubs = new Set<Listener<ProgressMsg>>();
export const onProgress = (f: Listener<ProgressMsg>) => { progressSubs.add(f); return () => { progressSubs.delete(f); }; };

let es: EventSource | null = null;
let pollT: ReturnType<typeof setInterval> | null = null;
let detectT: ReturnType<typeof setTimeout> | null = null;
let running = false;
let caps = { list: false, stream: false };
let synced = false;

const POLL_MS = 30_000;
const REDETECT_MS = 60_000;

function normalize(e: Partial<AppEvent>): AppEvent | null {
  if (!e || e.id == null || !e.title) return null;
  return {
    id: String(e.id), at: e.at || new Date().toISOString(), kind: e.kind || 'info',
    severity: (['danger', 'warn', 'ok', 'info'] as const).includes(e.severity as never) ? e.severity! : 'info',
    title: String(e.title), detail: e.detail ?? null, link: e.link ?? null, read: !!e.read, archived: !!e.archived,
  };
}

async function loadList() {
  if (!caps.list) return;
  try {
    const raw = await request<AppEvent[] | { items?: AppEvent[]; events?: AppEvent[] }>('/api/v1/events?status=all');
    const arr = Array.isArray(raw) ? raw : raw.items || raw.events || [];
    const known = new Set(notifications.snapshot().items.map((x) => x.id));
    const list = arr.map(normalize).filter((x): x is AppEvent => !!x);
    // ما وصل بالاستطلاع ولم نره قبلاً = جديد (للجزيرة وإشعار النظام) — عدا المزامنة الأولى
    const fresh = synced ? list.filter((x) => !known.has(x.id) && !x.read) : [];
    const freshIds = new Set(fresh.map((x) => x.id));
    notifications.replace(list.filter((x) => !freshIds.has(x.id)));
    fresh.forEach((x) => notifications.upsert(x));
    synced = true;
  } catch { /* الخدمة مشغولة/متوقفة — المحاولة التالية */ }
}

function startPolling() {
  if (pollT || !caps.list) return;
  pollT = setInterval(loadList, POLL_MS);
}
function stopPolling() { if (pollT) { clearInterval(pollT); pollT = null; } }

function parse<T>(m: MessageEvent): T | null { try { return JSON.parse(m.data) as T; } catch { return null; } }

function openStream() {
  if (es || !caps.stream || typeof EventSource === 'undefined') return;
  es = new EventSource(apiBase() + '/api/v1/events/stream');
  es.addEventListener('open', () => { stopPolling(); void loadList(); });
  es.addEventListener('notification', (m) => {
    const e = normalize(parse<AppEvent>(m as MessageEvent) || {});
    if (e) notifications.upsert(e);
  });
  es.addEventListener('invalidate', (m) => {
    const d = parse<{ keys?: string[] }>(m as MessageEvent);
    if (d?.keys?.length) void invalidate(d.keys);
  });
  es.addEventListener('progress', (m) => {
    const d = parse<ProgressMsg>(m as MessageEvent);
    if (d && (d.kind === 'import' || d.kind === 'backup')) progressSubs.forEach((f) => f(d));
  });
  es.addEventListener('error', () => {
    // EventSource يعيد الاتصال بنفسه (CONNECTING)؛ حتى يعود: استطلاع. إن أُغلق نهائياً نعيد الاكتشاف.
    startPolling();
    if (es && es.readyState === EventSource.CLOSED) { es.close(); es = null; scheduleDetect(5_000); }
  });
}

function scheduleDetect(ms: number) {
  if (detectT) clearTimeout(detectT);
  detectT = setTimeout(() => { void detect(); }, ms);
}

async function detect() {
  if (!running) return;
  forgetServerPaths();
  const paths = await serverPaths(0);
  // openapi غير متاح (null) → نفترض النقاط موجودة؛ فشل الجلب يُعامَل بهدوء ويُعاد الاكتشاف
  caps = paths ? { list: paths.has('/api/v1/events'), stream: paths.has('/api/v1/events/stream') } : { list: true, stream: true };
  if (caps.list) await loadList();
  if (caps.stream) openStream();
  else if (caps.list) startPolling();
  if (!caps.stream) scheduleDetect(REDETECT_MS);
}

/** يبدأ القناة (مرة واحدة بعد جاهزية الخدمة). */
export function startEvents() {
  if (running) return;
  running = true;
  void detect();
}
/** بعد إعادة تشغيل الخدمة على منفذ جديد. */
export function restartEvents() {
  stopEvents();
  startEvents();
}
export function stopEvents() {
  running = false;
  if (es) { es.close(); es = null; }
  stopPolling();
  if (detectT) { clearTimeout(detectT); detectT = null; }
}
