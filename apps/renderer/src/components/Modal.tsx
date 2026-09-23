import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

let modalIdSeq = 0;

// يتيح لزرّ «إلغاء»/«إغلاق» داخل محتوى النافذة (مثل RemindModal) المرور بنفس
// مسار التأكيد بدل مناداة onClose مباشرة — بلا هذا، مسار الإغلاق الوحيد
// المحمي هو Esc/النقر خارجاً/الزر ✕ التي يملكها Modal نفسه.
const ModalCloseContext = createContext<(() => void) | null>(null);

/** يُستعمل داخل أطفال Modal بدل onClose المُمرَّر من الصفحة — يمرّ بتأكيد
 * «تجاهل التغييرات» إن كانت النافذة dirty. خارج Modal يُرجع undefined بأمان. */
export function useModalClose(): (() => void) | undefined {
  return useContext(ModalCloseContext) ?? undefined;
}

/**
 * نافذة منبثقة عامة — RTL، تُغلق بالنقر خارجها أو بـ Escape.
 *
 * م-٣٤: كانت الثلاثة (Esc / نقرة خارجاً / زرّ الإغلاق) تُغلق نموذجاً بعشرات
 * الحقول فوراً بلا سؤال — لا فخّ تركيز يمنع Tab من الهروب خلف النافذة، ولا قفل
 * تمرير يمنع الصفحة خلفها من التحرك معها. الأربعة مُعالَجة هنا مركزياً بدل كل
 * نافذة على حدة، فيصير كل مستهلك للمكوّن مصححاً تلقائياً.
 */
export function Modal({ title, children, onClose, maxWidth = 480, dirty = false }:
  { title: string; children: ReactNode; onClose: () => void; maxWidth?: number;
    /** صادقة حين يختلف حقل واحد على الأقل عن قيمته الأولية — تفعّل تأكيد الإغلاق. */
    dirty?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // العنصر الذي فتح النافذة — التركيز يعود إليه عند الإغلاق، وإلا ضاع موضع
  // لوحة المفاتيح في الصفحة خلف النافذة المغلَقة.
  const openerRef = useRef<Element | null>(null);
  const titleId = useRef(`modal-title-${++modalIdSeq}`).current;

  function requestClose() {
    if (dirty) { setConfirmingClose(true); return; }
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // التركيز ينتقل إلى النافذة عند فتحها — وإلا بقي على الزر خلفها فتاه لوحة المفاتيح.
  // Focus moves into the dialog on open; onClose ownership is the caller's, so the
  // opener is captured once here rather than re-read on every render.
  useEffect(() => {
    openerRef.current = document.activeElement;
    // الحقول أولاً ثم الأزرار احتياطاً — محدِّدٌ واحد يجمعها يعيد أول عنصر في ترتيب
    // المستند، وزرّ ✕ في الترويسة يسبق الحقول دائماً، فكان المستخدم يفتح «إضافة
    // مورد» ويبدأ الكتابة فتذهب إلى زرّ الإغلاق لا إلى اسم المورد (مُشاهَد).
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select')
      ?? box?.querySelector<HTMLElement>('button');
    first?.focus();

    // قفل تمرير الصفحة خلف النافذة — يُعاد حتى عند استثناء غير متوقع أثناء عمر
    // النافذة (تنظيف useEffect يُنفَّذ دائماً، بخلاف كود بعد سطر قد يرمي).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  // فخّ تركيز — Tab/Shift+Tab يدوران داخل النافذة فقط، وإلا هرب التركيز إلى
  // عناصر خلفها لا تُرى (النافذة تحجبها بصرياً لكنها تبقى في شجرة DOM).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !boxRef.current) return;
      const focusables = boxRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !boxRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !boxRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="modal-scrim" onClick={requestClose}>
      <div
        ref={boxRef}
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth, position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="btn sm" aria-label="إغلاق" onClick={requestClose}>✕</button>
        </div>
        <ModalCloseContext.Provider value={requestClose}>
          {children}
        </ModalCloseContext.Provider>

        {confirmingClose && (
          // تأكيد داخل النافذة نفسها لا نافذة منفصلة — يبقي فخّ التركيز والسياق
          // كما هما، ولا يفتح مكوّناً جديداً لموقف بهذه البساطة.
          <div className="modal-scrim" onClick={() => setConfirmingClose(false)} style={{ position: 'absolute', inset: 0, borderRadius: 'inherit' }}>
            <div className="modal-box" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}
                 role="alertdialog" aria-modal="true" aria-label="تأكيد تجاهل التغييرات">
              <div className="modal-head"><h2>تجاهل التغييرات غير المحفوظة؟</h2></div>
              <p className="muted" style={{ margin: 0 }}>
                ما كتبته في هذا النموذج لن يُحفظ إن تابعت الإغلاق.
              </p>
              <div className="modal-foot">
                <button className="btn" onClick={() => setConfirmingClose(false)}>عودة للنموذج</button>
                <button className="btn danger" onClick={onClose}>تجاهل والإغلاق</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
