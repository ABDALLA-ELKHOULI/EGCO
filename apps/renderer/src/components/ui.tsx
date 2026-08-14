import type { ReactNode } from 'react';
import { sar } from '@/lib/format';

export function Kpi({ label, value, unit, tone, alert, explain }:
  { label: string; value: string; unit?: string; tone?: string; alert?: boolean; explain?: ReactNode }) {
  return (
    <div className={'kpi' + (alert ? ' alert' : '')}>
      <div className="label">{label}{explain}</div>
      <div className={'value num ' + (tone || '')}>{value}</div>
      {unit && <div className="unit">{unit}</div>}
    </div>
  );
}

export function Money({ v, cls }: { v: number; cls?: string }) {
  return <span className={'num ' + (cls || '')}>{sar(v)}</span>;
}

export function Card({ title, sub, children, actions }:
  { title?: string; sub?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="cap" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Pill({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={'pill ' + kind}>{children}</span>;
}

export function State({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

/**
 * حالة خطأ قابلة للتعافي — رسالة الخطأ مع زر «إعادة المحاولة» يعيد الجلب.
 * يمنع خطأً عابراً (انقطاع اتصال مؤقت مثلاً) من تجميد الشاشة لبقية الجلسة.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state" role="alert">
      <div style={{ marginBottom: 12 }}>{message}</div>
      <button className="btn primary" onClick={onRetry}>إعادة المحاولة</button>
    </div>
  );
}

/**
 * حالة فراغ — ثلاث حالات لا تُخلط (تطابق Empty/State في Figma):
 *   no-data    لم تُرفع بيانات أصلاً        → إجراء: رفع
 *   no-results الفلتر لم يطابق شيئاً        → إجراء: مسح التصفية
 *   all-clear  النتيجة صفر فعلاً وهذا جيد    → لا إجراء، علامة خضراء
 *
 * خلط الثلاث يوهم المستخدم أن النظام معطّل بينما المطلوب رفع ملف أو تعديل بحث.
 */
export function EmptyState({ kind, title, body, ctaLabel, onCta }: {
  kind: 'no-data' | 'no-results' | 'all-clear';
  title: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  const ICON = { 'no-data': '⬆', 'no-results': '⌕', 'all-clear': '✓' }[kind];
  const COLOR = { 'no-data': 'gold', 'no-results': 'muted', 'all-clear': 'ok' }[kind];
  return (
    <div className="empty-state">
      <div className={'empty-icon ' + COLOR}>{ICON}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-body">{body}</div>
      {ctaLabel && onCta && (
        <button className={'btn' + (kind === 'no-data' ? ' primary' : '')} onClick={onCta}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
