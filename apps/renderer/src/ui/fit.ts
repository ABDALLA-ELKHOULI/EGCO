/**
 * تحسينات DOM عامة يشغّلها الهيكل مرة واحدة (تشمل الأقسام والصفحات القديمة دون تعديلها):
 *
 * ١) fitNumbers: رقم KPI/hero لا يُقصّ أبداً — إن تجاوز عرض حاويته يُصغَّر خطه خطوةً خطوة حتى
 *    يتسع (حدّ أدنى 14px). لا ellipsis ولا overflow على مبلغ مالي: رقم مقطوع رقمٌ كاذب.
 * ٢) حقول التاريخ/الشهر الأصلية الفارغة تعرض «يوم/شهر/سنة» بالعربية بدل «mm/dd/yyyy»: تُعرض
 *    نصاً بعنصر نائب عربي حتى التركيز، ثم تعود date/month مع فتح المنتقي.
 */
const FIT_SEL = '.kpi, .hero, [data-fit], .legacy-page .kpi .value';
const MIN_PX = 14;

function fit(el: HTMLElement) {
  if (el.classList.contains('kpi') && el.closest('.legacy-page')) return; // في القديم .kpi بطاقة، الرقم في .value
  el.style.fontSize = '';
  if (el.clientWidth === 0) return;
  let size = parseFloat(getComputedStyle(el).fontSize);
  let guard = 0;
  while (el.scrollWidth > el.clientWidth + 1 && size > MIN_PX && guard++ < 40) {
    size = Math.max(MIN_PX, size - 1);
    el.style.fontSize = size + 'px';
  }
}

const DATE_PH: Record<string, string> = { date: 'يوم/شهر/سنة', month: 'شهر/سنة' };

function enhanceDate(inp: HTMLInputElement) {
  if (inp.dataset.arDate) return;
  const kind = inp.type;
  inp.dataset.arDate = kind;
  const toText = () => {
    if (inp.value || document.activeElement === inp) return;
    inp.type = 'text';
    if (!inp.placeholder || /yyyy|YYYY/.test(inp.placeholder)) { inp.dataset.ph = inp.placeholder; inp.placeholder = DATE_PH[kind]; }
  };
  inp.addEventListener('focus', () => {
    if (inp.type !== kind) {
      inp.type = kind;
      if (inp.dataset.ph != null) { inp.placeholder = inp.dataset.ph; }
      try { (inp as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* يتطلب إيماءة */ }
    }
  });
  inp.addEventListener('blur', toText);
  toText();
}

let started = false;
export function startDomEnhancers() {
  if (started || typeof ResizeObserver === 'undefined') return;
  started = true;
  const ro = new ResizeObserver((entries) => { for (const e of entries) fit(e.target as HTMLElement); });
  const watched = new WeakSet<Element>();
  const scan = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>(FIT_SEL).forEach((el) => {
      if (!watched.has(el)) { watched.add(el); ro.observe(el); }
      fit(el);
    });
    root.querySelectorAll<HTMLInputElement>('input[type=date],input[type=month]').forEach(enhanceDate);
  };
  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; scan(document); });
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  scan(document);
}
