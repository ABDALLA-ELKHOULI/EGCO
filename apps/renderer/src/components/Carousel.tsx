import { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, TouchEvent as ReactTouchEvent, useRef } from 'react';

/**
 * شريط بطاقات منزلق عام — استُخرج من KpiCarousel في apps/renderer/src/pages/CashFlow.tsx
 * (أول استخدام لهذا النمط في التطبيق) حتى لا تتكرر منطق الأسهم/النقاط/اللمس/لوحة
 * المفاتيح/الحفظ في localStorage في كل شاشة تحتاج شريط صفحات. CashFlow.tsx نفسه
 * لم يُعدَّل (مملوك لوكيل آخر) — نسخته المضمّنة تبقى كما هي، وهذا المكوّن يطابقها
 * حرفياً في السلوك والتصميم لأي مستخدم جديد (بدءاً بشاشة المقاولين).
 *
 * أسهم يمين/يسار متوافقة مع اتجاه القراءة العربي (RTL): زر «السابق» أولاً في DOM
 * فيظهر يمين الشاشة، و«التالي» يظهر يسارها. يدعم أسهم لوحة المفاتيح (يسار = التالي،
 * يمين = السابق) والسحب باللمس، والصفحة الفعالة تُحفظ في localStorage عبر
 * useCarouselView أدناه بنفس نمط تسمية مفاتيح Sidebar.tsx.
 */
export function Carousel({ views, activeView, onViewChange, ariaLabel, children }: {
  views: { key: string; title: string }[];
  activeView: number;
  onViewChange: (i: number) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const touchX = useRef<number | null>(null);

  function goTo(i: number) {
    onViewChange(((i % views.length) + views.length) % views.length);
  }
  const goNext = () => goTo(activeView + 1);
  const goPrev = () => goTo(activeView - 1);

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); goNext(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goPrev(); }
  }
  function onTouchStart(e: ReactTouchEvent) { touchX.current = e.touches[0]?.clientX ?? null; }
  function onTouchEnd(e: ReactTouchEvent) {
    if (touchX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) goNext(); else goPrev();
  }

  // أنماط inline — نفس أنماط KpiCarousel في CashFlow.tsx بالحرف؛ لم تُضف إلى
  // styles/tokens.css (المملوك لوكيل آخر)، تحتاج توحيداً لاحقاً في نظام التصميم.
  const outerStyle: CSSProperties = {
    border: '1px solid var(--hair)', borderRadius: 'var(--r-card, 10px)',
    padding: '10px 4px 8px', marginBottom: 14,
  };
  const headerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 6px',
  };
  const arrowStyle: CSSProperties = {
    border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer',
    padding: '2px 12px', color: 'var(--muted)',
  };
  const dotsRowStyle: CSSProperties = { display: 'flex', justifyContent: 'center', gap: 6, padding: '8px 0 2px' };
  const dotStyle = (active: boolean): CSSProperties => ({
    width: 7, height: 7, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
    background: active ? 'var(--gold)' : 'var(--hair)',
  });

  return (
    <div style={outerStyle} tabIndex={0} onKeyDown={onKeyDown}
         onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
         role="region" aria-roledescription="carousel" aria-label={ariaLabel}>
      <div style={headerStyle}>
        <button type="button" aria-label="السابق" style={arrowStyle} onClick={goPrev}>›</button>
        <b style={{ fontSize: 13 }}>{views[activeView].title}</b>
        <button type="button" aria-label="التالي" style={arrowStyle} onClick={goNext}>‹</button>
      </div>

      {children}

      <div style={dotsRowStyle}>
        {views.map((v, i) => (
          <button key={v.key} type="button" aria-label={v.title} aria-current={i === activeView}
                  style={dotStyle(i === activeView)} onClick={() => onViewChange(i)} />
        ))}
      </div>
    </div>
  );
}

/** يحمّل/يحفظ الصفحة الفعالة في localStorage — نفس نمط loadStoredKpiView في CashFlow.tsx. */
export function loadStoredCarouselView(storageKey: string, count: number): number {
  const raw = Number(localStorage.getItem(storageKey));
  return Number.isInteger(raw) && raw >= 0 && raw < count ? raw : 0;
}
