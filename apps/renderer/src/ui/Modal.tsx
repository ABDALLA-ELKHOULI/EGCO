/**
 * Modal — من prototype/ui.js: حارس التغييرات غير المحفوظة («تجاهل التغييرات غير المحفوظة؟»)،
 * فخ تركيز، Esc، قفل التمرير، دخول spring، إعادة التركيز لمن فتح النافذة.
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="مورد جديد"
 *          actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', onClick: save }]}>
 *     …حقول…
 *   </Modal>
 *
 * الاتساخ (dirty): أي input/change داخل النافذة يعلّمها متسخة تلقائياً (عدا ما يحمل
 * data-no-dirty). `dirty` prop يتجاوز ذلك صراحةً. onClick في الإجراء يستلم close(force?)؛
 * إن رمى خطأ يظهر toast خطأ وتبقى النافذة.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { toast } from './Toast';
import { FOCUSABLE, lockScroll, popLayer, pushLayer, trapTab, type Layer } from './overlay';
import { reduced } from './motion';

export interface ModalAction {
  label: ReactNode;
  kind?: 'primary' | 'danger' | 'ghost';
  /** بلا onClick = إغلاق (مع الحارس). close(true) يتجاوز الحارس. */
  onClick?: (close: (force?: boolean) => void) => unknown | Promise<unknown>;
  disabled?: boolean;
  testId?: string;
}
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
  actions?: ModalAction[];
  /** true = متسخة صراحةً. التتبع التلقائي (أي input/change داخل النافذة) يبقى فعّالاً معه. */
  dirty?: boolean;
  /** false = تعطيل التتبع التلقائي (نوافذ بلا إدخال حقيقي). الافتراضي true. */
  autoDirty?: boolean;
  /** يُبلَّغ حين يتغير الاتساخ التلقائي. */
  onDirtyChange?: (d: boolean) => void;
  className?: string;
  testId?: string;
}

export function Modal(p: ModalProps) {
  // الإبقاء على العنصر مركّباً أثناء حركة الخروج
  const [mounted, setMounted] = useState(p.open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (p.open) { setMounted(true); setLeaving(false); return; }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => { setMounted(false); setLeaving(false); }, reduced() ? 0 : 200);
    return () => clearTimeout(t);
  }, [p.open, mounted]);
  if (!mounted) return null;
  return createPortal(<ModalInner {...p} leaving={leaving} />, document.body);
}

function ModalInner(p: ModalProps & { leaving: boolean }) {
  const tid = useId();
  const dlg = useRef<HTMLDivElement>(null);
  const guardRef = useRef<HTMLDivElement>(null);
  const [autoDirty, setAutoDirty] = useState(false);
  const [guard, setGuard] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const dirty = !!p.dirty || (p.autoDirty !== false && autoDirty);
  const st = useRef({ dirty, guard, onClose: p.onClose });
  st.current = { dirty, guard, onClose: p.onClose };

  const close = useCallback((force?: boolean) => {
    if (force !== true && st.current.dirty) { setGuard(true); return false; }
    st.current.onClose();
    return true;
  }, []);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const layer: Layer = {
      kind: 'modal',
      key: (e) => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          if (st.current.guard) setGuard(false); else close();
          return;
        }
        if (e.key === 'Tab') { const scope = guardRef.current || dlg.current; if (scope) trapTab(e, scope); }
      },
    };
    pushLayer(layer); lockScroll(true);
    const t = setTimeout(() => {
      const d = dlg.current; if (!d) return;
      const f = d.querySelector<HTMLElement>('.m-body input:not([type=hidden]):not([type=checkbox]),.m-body select,.m-body textarea')
        || d.querySelector<HTMLElement>('.m-foot .btn.primary') || d.querySelector<HTMLElement>(FOCUSABLE);
      f?.focus({ preventScroll: true });
    }, 30);
    return () => {
      clearTimeout(t); popLayer(layer); lockScroll(false);
      if (prevFocus && document.body.contains(prevFocus)) prevFocus.focus();
    };
  }, [close]);

  useEffect(() => { if (guard) guardRef.current?.querySelector<HTMLElement>('[data-g="stay"]')?.focus(); }, [guard]);

  const markDirty = (e: React.SyntheticEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest?.('[data-no-dirty]')) return;
    if (p.autoDirty === false) return;
    if (!autoDirty) { setAutoDirty(true); p.onDirtyChange?.(true); }
  };

  const run = async (a: ModalAction, i: number) => {
    if (!a.onClick) { close(); return; }
    try { setBusy(i); await a.onClick(close); }
    catch (err) { console.error(err); toast(String((err as Error)?.message || err), { kind: 'error' }); }
    finally { setBusy(null); }
  };

  return (
    <div className={'m-scrim' + (p.leaving ? ' out' : '')} lang="ar" dir="rtl"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={dlg} className={`m-dlg m-${p.size || 'md'}${p.leaving ? ' out' : ''}${p.className ? ' ' + p.className : ''}`}
        role="dialog" aria-modal="true" aria-labelledby={tid} data-testid={p.testId} onInput={markDirty} onChange={markDirty}>
        <div className="m-head">
          <h2 id={tid}>{p.title}</h2>
          <button className="m-x" type="button" aria-label="إغلاق" onClick={() => close()}><Icon name="close" size={18} stroke={2} /></button>
        </div>
        <div className="m-body">{p.children}</div>
        {!!p.actions?.length && (
          <div className="m-foot">
            {p.actions.map((a, i) => (
              <button key={i} type="button" data-testid={a.testId} disabled={a.disabled || busy === i}
                className={'btn' + (a.kind ? ' ' + a.kind : '')} onClick={() => run(a, i)}>{a.label}</button>
            ))}
          </div>
        )}
        {guard && (
          <div className="m-guard" data-testid="unsaved-guard" role="alertdialog" aria-label="تغييرات غير محفوظة" ref={guardRef}>
            <div className="m-guard-card">
              <b>تجاهل التغييرات غير المحفوظة؟</b>
              <p>ستُفقد التعديلات التي أدخلتها في هذه النافذة.</p>
              <div className="m-guard-acts">
                <button type="button" className="btn" data-g="stay" data-testid="unsaved-back" onClick={() => setGuard(false)}>عودة للنموذج</button>
                <button type="button" className="btn danger" data-testid="unsaved-discard" onClick={() => { setGuard(false); close(true); }}>تجاهل والإغلاق</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ confirm() — وعد بنعم/لا، يُستدعى من أي مكان ═══ */
export interface ConfirmOptions {
  title?: string;
  body?: ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}
interface Pending extends ConfirmOptions { id: number; resolve: (v: boolean) => void }
let pending: Pending[] = [];
let cseq = 0;
const csubs = new Set<() => void>();
const cemit = () => { pending = [...pending]; csubs.forEach((f) => f()); };

/** `if (await confirm({ title: 'حذف المورد؟', body: '…', danger: true, confirmLabel: 'حذف' })) …` */
export function confirm(o: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => { pending.push({ ...o, id: ++cseq, resolve }); cemit(); });
}

export function ConfirmHost() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); csubs.add(f); return () => { csubs.delete(f); }; }, []);
  const top = pending[0];
  const finish = (v: boolean) => {
    if (!top) return;
    top.resolve(v);
    pending = pending.filter((x) => x !== top); cemit();
  };
  return (
    <Modal open={!!top} onClose={() => finish(false)} title={top?.title || 'تأكيد'} size="sm" autoDirty={false} testId="confirm-dialog"
      actions={[
        { label: top?.cancelLabel || 'إلغاء', onClick: () => finish(false) },
        { label: top?.confirmLabel || 'تأكيد', kind: top?.danger ? 'danger' : 'primary', testId: 'confirm-ok', onClick: () => finish(true) },
      ]}>
      <p className="m-text">{top?.body}</p>
    </Modal>
  );
}
