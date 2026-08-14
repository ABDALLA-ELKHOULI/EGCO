import { useState, type ReactNode } from 'react';

/**
 * كتلة عرض موحّدة لمزايا الذكاء الاصطناعي — عنوان، حالة انتظار، خطأ نصي inline
 * (رسائل ApiError تأتي جاهزة بالعربية من الخادم)، أو المحتوى.
 */
export function AiBlock({ title, busy, error, children }: {
  title?: string;
  busy?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <b style={{ fontSize: 13 }}>{title}</b>
          {busy && <span className="muted" style={{ fontSize: 12 }}>جارٍ التحميل…</span>}
        </div>
      )}
      {error ? (
        <div className="callout bad">{error}</div>
      ) : busy && !children ? (
        <div className="muted" style={{ fontSize: 13 }}>جارٍ التحميل…</div>
      ) : (
        children
      )}
    </div>
  );
}

/** زر نسخ نص إلى الحافظة — يومض «نُسخ ✓» لثانية ونصف ثم يعود. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // تجاهل — بعض البيئات تمنع الوصول للحافظة
    }
  }

  return (
    <button type="button" className="btn" onClick={copy} disabled={!text}>
      {copied ? 'نُسخ ✓' : 'نسخ'}
    </button>
  );
}

/** تلميح ظهور عند إيقاف مساعد الذكاء — يوجّه المستخدم للإعدادات. */
export function AiDisabledHint() {
  return (
    <p className="muted" style={{ fontSize: 12 }}>
      فعّل مساعد الذكاء من <a href="#/settings">الإعدادات</a>
    </p>
  );
}
