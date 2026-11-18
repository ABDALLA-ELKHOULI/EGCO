/**
 * تفضيلات عرض التدفق — تُحفظ محلياً (راحة للمستخدم، ليست بيانات). الفلاتر القابلة
 * للمشاركة (project/parties/period_days) تبقى في الرابط كما في CashFlow.tsx القديم،
 * وهذه القيم افتراضاتها.
 */
import { setUiPref, uiPref } from '@/ui/prefs';
import type { Parties } from '../types';

export const PERIOD_DAYS_MIN = 1;
export const PERIOD_DAYS_MAX = 92;
export const PERIOD_DAYS_DEFAULT = 14;
export const PERIOD_PRESETS: readonly { days: number; label: string }[] = [
  { days: 7, label: 'أسبوع' }, { days: 14, label: 'أسبوعان' }, { days: 30, label: 'شهر' },
];
/** الأفق بالأسابيع — الخادم يقبل ١..١٠٤. أبقينا الخيارات الأربعة القديمة + شهر النموذج. */
export const HORIZONS: readonly { weeks: number; label: string }[] = [
  { weeks: 5, label: '٣٠ يوماً' }, { weeks: 13, label: '٣ أشهر' }, { weeks: 26, label: '٦ أشهر' },
  { weeks: 52, label: '١٢ شهراً' }, { weeks: 104, label: 'سنتان' },
];
export const HORIZON_DEFAULT = 26;
export const MAX_RENDERED_PERIOD_ROWS = 60;

export const clampPeriodDays = (n: number): number =>
  Math.min(PERIOD_DAYS_MAX, Math.max(PERIOD_DAYS_MIN, Math.round(n) || PERIOD_DAYS_DEFAULT));

export function parseParties(v: string | null): Parties {
  return v === 'suppliers' || v === 'contractors' || v === 'both' ? v : 'both';
}

/**
 * الرصيد الافتتاحي **ليس** هنا: العقد §٦ يمنع حالة مالية في التخزين المحلي، والخادم
 * لا يحفظ رصيداً بنكياً بعد (ثغرة موثّقة في PARITY-cash.md). حتى يضيفه B يبقى حقلاً
 * في الصفحة يُرسل كـ opening_balance كما في CashFlow.tsx القديم، بلا حفظ.
 */
export interface CashPrefs { weeks: number; kpiView: number }
const KEY = 'cash.prefs';
// مفتاح القديم — يُقرأ مرة واحدة كي لا يفقد المستخدم صفحة الشريط المختارة
const LEGACY_KPI_KEY = 'egco.cashflow.kpiView';

export function loadPrefs(): CashPrefs {
  const v = uiPref<Partial<CashPrefs>>(KEY, {});
  let legacy = NaN;
  try { legacy = Number(localStorage.getItem(LEGACY_KPI_KEY)); } catch { /* لا تخزين */ }
  const okView = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 3;
  return {
    weeks: HORIZONS.some((h) => h.weeks === v.weeks) ? (v.weeks as number) : HORIZON_DEFAULT,
    kpiView: okView(v.kpiView) ? v.kpiView : okView(legacy) ? legacy : 0,
  };
}
export function savePrefs(p: CashPrefs): void { setUiPref(KEY, p); }

export const periodDaysLabel = (n: number, ar: (v: number) => string): string =>
  n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : `${ar(n)} أيام`;

export const ageBucketLabel = (fromDays: number, toDays: number | null, ar: (v: number) => string): string =>
  toDays == null ? `أكثر من ${ar(fromDays - 1)} يوماً` : `${ar(fromDays)}–${ar(toDays)} يوماً`;
