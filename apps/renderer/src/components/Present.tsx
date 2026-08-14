import { useEffect, useState, type ReactNode } from 'react';

export interface Slide {
  title: string;
  subtitle?: string;
  body: ReactNode;
}

/**
 * وضع العرض — ملء الشاشة لعرض النتائج على الإدارة.
 *
 * Deliberately not a generic slideshow library: the slides are the app's own live
 * data, so what is presented can never drift from what the screens show. Arrow keys
 * and Escape work because a presenter should not hunt for buttons mid-meeting.
 */
export function Present({ slides, onClose, onExport }:
  { slides: Slide[]; onClose: () => void; onExport?: () => void }) {
  const [i, setI] = useState(0);
  const last = slides.length - 1;

  useEffect(() => {
    // في RTL: السهم الأيسر يتقدّم، الأيمن يرجع — يطابق اتجاه القراءة
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault(); setI((n) => Math.min(last, n + 1));
      } else if (e.key === 'ArrowRight' || e.key === 'PageUp') {
        e.preventDefault(); setI((n) => Math.max(0, n - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    document.documentElement.classList.add('presenting');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('presenting');
    };
  }, [last, onClose]);

  const s = slides[i];
  if (!s) return null;

  return (
    <div className="present">
      <div className="present-bar no-print">
        <button className="btn" onClick={onClose}>إغلاق (Esc)</button>
        {onExport && <button className="btn" onClick={onExport}>تصدير العرض PDF</button>}
        <div className="grow" />
        <span className="present-count">
          {i + 1} / {slides.length}
        </span>
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>السابق</button>
        <button className="btn" disabled={i === last} onClick={() => setI(i + 1)}>التالي</button>
      </div>

      <div className="present-stage">
        <div className="present-slide">
          <header>
            <h1>{s.title}</h1>
            {s.subtitle && <p>{s.subtitle}</p>}
          </header>
          <div className="present-body">{s.body}</div>
          <footer>
            <span>شركة إعمار الخليج المصرية للمقاولات</span>
            <span>{i + 1} / {slides.length}</span>
          </footer>
        </div>
      </div>

      {/* كل الشرائح مرتبة للطباعة — التصدير يخرج العرض كاملاً لا الشريحة الظاهرة */}
      <div className="present-print-only">
        {slides.map((sl, n) => (
          <div className="present-slide print-slide" key={n}>
            <header>
              <h1>{sl.title}</h1>
              {sl.subtitle && <p>{sl.subtitle}</p>}
            </header>
            <div className="present-body">{sl.body}</div>
            <footer>
              <span>شركة إعمار الخليج المصرية للمقاولات</span>
              <span>{n + 1} / {slides.length}</span>
            </footer>
          </div>
        ))}
      </div>
    </div>
  );
}
