import { useState, type ReactNode } from 'react';

/**
 * كتلة عرض موحّدة لمزايا الذكاء الاصطناعي — عنوان، حالة انتظار، خطأ نصي inline
 * (رسائل ApiError تأتي جاهزة بالعربية من الخادم)، أو المحتوى.
 *
 * سطح داخلي (.ai-block) لا بطاقة: كانت تُصيّر <div class="card"> داخل بطاقة أخرى،
 * فيظهر إطاران متداخلان بحشوين مختلفين في كل شاشة يظهر فيها المساعد.
 * An inner surface, not a card — nesting .card inside .card doubled the border.
 */
export function AiBlock({ title, busy, error, children }: {
  title?: string;
  busy?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="ai-block">
      {title && (
        <div className="ai-head">
          <b>{title}</b>
          {busy && <span className="muted">جارٍ التحميل…</span>}
        </div>
      )}
      {error ? (
        <div className="callout bad" role="alert">{error}</div>
      ) : busy && !children ? (
        <div className="muted" style={{ fontSize: 13 }} aria-live="polite">جارٍ التحميل…</div>
      ) : (
        children
      )}
    </div>
  );
}

/** زر نسخ نص إلى الحافظة — يومض «نُسخ ✓» لثانية ونصف ثم يعود. */
export function CopyButton({ text, primary }: { text: string; primary?: boolean }) {
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
    <button type="button" className={'btn' + (primary ? ' primary' : '')} onClick={copy} disabled={!text}>
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
