/* مكوّنات مشتركة داخل قسم «الأطراف». النوافذ تُرسم في portal خارج .sec-parties — لذلك
 * PModal يلفّ المحتوى بنفس الفئة كي يصله CSS القسم. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Chip, Modal, Pill, toast, usePrefs, type ModalAction, type PillTone } from '@/ui';
import { ApiError } from '@/lib/api';
import { useAiEnabled } from '@/lib/useAi';
import { CopyButton } from '@/components/Ai';
import { partiesApi } from '../api';
import { balanceView } from '../logic/contractors';
import { addProject, removeProject, similarProject } from '../logic/arabic';
import type { Chip as ChipT } from '../logic/table';
import type { PartyType } from '../types';

export function PModal(p: {
  open: boolean; onClose: () => void; title: ReactNode; size?: 'sm' | 'md' | 'lg';
  actions?: ModalAction[]; dirty?: boolean; children?: ReactNode;
}) {
  // BUG-002: لا نعتمد على dirty النموذج وحده — أي كتابة داخل النافذة (input/change، عدا data-no-dirty) تُعلّمها
  // متسخة هنا أيضاً، فيعمل حارس «تجاهل التغييرات؟» حتى لو فات useForm تغييرٌ ما. dirty={false} صريحاً = بلا حارس.
  const [local, setLocal] = useState(false);
  useEffect(() => { if (!p.open) setLocal(false); }, [p.open]);
  const mark = (e: React.SyntheticEvent) => {
    if ((e.target as HTMLElement).closest?.('[data-no-dirty]')) return;
    if (!local) setLocal(true);
  };
  const dirty = p.dirty === false ? false : Boolean(p.dirty) || local;
  return (
    <Modal open={p.open} onClose={p.onClose} title={p.title} size={p.size ?? 'md'} actions={p.actions} dirty={dirty}
      /* dirty={false} صريحاً = نافذة اختيار/تأكيد بلا حارس — نوقف التتبّع الآلي في Modal أيضاً */
      autoDirty={p.dirty !== false}>
      <div className="sec-parties" onInput={mark} onChange={mark}>{p.children}</div>
    </Modal>
  );
}

export const ErrBox = ({ msg }: { msg: string | null | undefined }) =>
  msg ? <div className="pt-err" role="alert">{msg}</div> : null;

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** نغمة شارة من نغمة النظام القديم (red/gold/warn/ok/muted). */
export function toneOf(cls: string | undefined | null): PillTone {
  switch (cls) {
    case 'red': return 'danger';
    case 'gold': case 'warn': return 'warn';
    case 'ok': return 'ok';
    default: return 'neutral';
  }
}

/** «نحن ندين لهم / يدينون لنا / متوازن» — اصطلاح الإشارة (CLAUDE.md §٢). */
export function BalanceWord({ balance }: { balance: number }) {
  const v = balanceView(balance);
  return <span className="pill n dirn">{v.words}</span>;
}

/** شريط شرائح «N تصفية نشطة» + مسح الكل + نص إضافي يساراً. */
export function ChipsBar({ chips, onClearAll, extra }: { chips: ChipT[]; onClearAll: () => void; extra?: ReactNode }) {
  usePrefs();
  if (!chips.length) return null;
  return (
    <div className="pt-chips" role="group" aria-label="التصفية النشطة">
      <b>{chips.length.toLocaleString('ar-EG')} تصفية نشطة</b>
      {chips.map((c) => (
        <span key={c.k} className="chip">{c.label}
          <button type="button" onClick={c.clear} aria-label={`إزالة ${c.label}`}>×</button>
        </span>
      ))}
      <Button size="sm" onClick={onClearAll}>مسح الكل</Button>
      {extra && <span className="pt-grow cap">{extra}</span>}
    </div>
  );
}

/* ── عناصر شريط التصفية (.pt-xfil) — بديل قوائم الأعمدة القديمة (ColumnMenu) ── */
export function FText({ label, value, onChange, placeholder, wide }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean;
}) {
  return (
    <label><span>{label}</span>
      <input type="search" value={value} placeholder={placeholder} data-no-dirty onChange={(e) => onChange(e.target.value)}
        style={wide ? { minWidth: 260 } : undefined} />
    </label>
  );
}
export function FSelect({ label, value, onChange, options, allLabel = 'الكل' }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[]; allLabel?: string;
}) {
  return (
    <label><span>{label}</span>
      <select value={value} data-no-dirty onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.hint ? ` — ${o.hint}` : ''}</option>)}
      </select>
    </label>
  );
}
export function FRange({ label, min, max, onMin, onMax, unit = 'ر.س' }: {
  label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; unit?: string;
}) {
  return (
    <label><span>{label}{unit ? ` (${unit})` : ''}</span>
      <span className="pt-pair">
        <input inputMode="decimal" placeholder="من" value={min} data-no-dirty onChange={(e) => onMin(e.target.value)} aria-label={`${label} من`} />
        <input inputMode="decimal" placeholder="إلى" value={max} data-no-dirty onChange={(e) => onMax(e.target.value)} aria-label={`${label} إلى`} />
      </span>
    </label>
  );
}
export function FDates({ label, from, to, onFrom, onTo }: {
  label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  return (
    <label><span>{label}</span>
      <span className="pt-pair">
        <input type="date" dir="ltr" value={from} data-no-dirty onChange={(e) => onFrom(e.target.value)} aria-label={`${label} من`} />
        <input type="date" dir="ltr" value={to} data-no-dirty onChange={(e) => onTo(e.target.value)} aria-label={`${label} إلى`} />
      </span>
    </label>
  );
}

/** «الأول +ن» مع العنوان الكامل عند التحويم. */
export function ProjectsCell({ projects, fallback }: { projects?: string[] | null; fallback?: string | null }) {
  const ps = projects && projects.length ? projects : fallback ? [fallback] : [];
  if (!ps.length) return <span className="dash">—</span>;
  if (ps.length === 1) return <>{ps[0]}</>;
  return <span title={ps.join('، ')}>{ps[0]} <span className="chip">+{(ps.length - 1).toLocaleString('ar-EG')}</span></span>;
}

/**
 * حذف مورد/مقاول بخطوتين (Suppliers.tsx:551-608، Contractors.tsx:982-1040): تأكيد عادي؛ إن رفض الخادم
 * لوجود حركات ← اكتب الرقم حرفياً ← force. الحذف منطقي في الخادم ويمكن الاسترجاع من «المحذوفات».
 */
export function DeletePartyModal({ open, kind, name, keyValue, onClose, onDeleted }: {
  open: boolean; kind: PartyType; name: string; keyValue: string; onClose: () => void; onDeleted: () => void;
}) {
  const [needForce, setNeedForce] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setNeedForce(false); setTyped(''); setError(null); } }, [open]);
  const isSup = kind === 'supplier';
  const del = (force: boolean) => (isSup ? partiesApi.deleteSupplier(keyValue, force) : partiesApi.deleteContractor(keyValue, force));
  const run = async (close: (f?: boolean) => void, force: boolean) => {
    setError(null);
    try {
      await del(force);
      close(true); onDeleted();
      toast(`حُذف ${isSup ? 'المورد' : 'المقاول'} «${name}» — يمكن استرجاعه من المحذوفات`, { kind: 'info' });
    } catch (e) {
      if (e instanceof ApiError && !force) setNeedForce(true);
      else setError(errMsg(e));
    }
  };
  const label = isSup ? 'رقم الحساب' : 'الرمز';
  return (
    <PModal open={open} onClose={onClose} title={isSup ? 'حذف مورد' : 'حذف مقاول'} size="sm" dirty={false}
      actions={[
        { label: 'إلغاء' },
        needForce
          ? { label: 'حذف نهائي', kind: 'danger', disabled: typed !== keyValue, onClick: (c) => run(c, true) }
          : { label: 'حذف', kind: 'danger', onClick: (c) => run(c, false) },
      ]}>
      <p>هل تريد حذف {isSup ? 'المورد' : 'المقاول'} «{name}» ({label} <span className="num">{keyValue}</span>)؟</p>
      <ErrBox msg={error} />
      {needForce && (
        <>
          <div className="pt-err">
            {isSup ? 'لهذا المورد فواتير أو دفعات مرتبطة.' : 'لهذا المقاول حركات مسجّلة.'} للمتابعة، اكتب {label} «{keyValue}» أدناه لتأكيد الحذف النهائي.
          </div>
          <div className="pt-xfil">
            <label><span>{label}</span><input value={typed} placeholder={keyValue} dir="ltr" data-no-dirty onChange={(e) => setTyped(e.target.value)} /></label>
          </div>
        </>
      )}
    </PModal>
  );
}

/** «صياغة مطالبة» (P-372): مسودة من المساعد قابلة للتعديل، «إعادة الصياغة»، «نسخ» أساسي. dirty = تحرير يدوي فقط. */
export function RemindModal({ open, kind, partyKey, onClose }: { open: boolean; kind: PartyType; partyKey: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef('');
  const load = async () => {
    setBusy(true); setError(null);
    try { const r = await partiesApi.aiRemind(kind, partyKey); setText(r.message); loaded.current = r.message; }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) void load(); }, [open, partyKey]);
  return (
    <PModal open={open} onClose={onClose} title="صياغة مطالبة" dirty={text !== loaded.current}
      actions={[
        { label: busy ? 'جارٍ الصياغة…' : 'إعادة الصياغة', disabled: busy, onClick: () => { void load(); } },
        { label: 'إغلاق' },
      ]}>
      <p className="cap">مسودة قابلة للتعديل — لا تُحفظ ولا تُرسل من هنا.</p>
      <ErrBox msg={error} />
      <textarea className="pt-remind" value={text} disabled={busy} placeholder={busy ? 'جارٍ الصياغة…' : ''}
        onChange={(e) => setText(e.target.value)} rows={8} />
      <div className="pt-xfil"><CopyButton text={text} primary /></div>
    </PModal>
  );
}

/** يُظهر عناصر المساعد فقط بعد التحميل وحين يكون مفعّلاً (P-376). */
export function useAi() { const { enabled, loading } = useAiEnabled(); return !loading && enabled; }

/**
 * لائحة مشاريع متعددة (SupplierForm/ContractorForm): شرائح قابلة للإزالة، الأول ★ «الأساسي»، إضافة بـEnter أو
 * «إضافة»، datalist بالمعروفة، واقتراح «يوجد مشروع مشابه» بالتطبيع العربي بدل توأم صامت.
 */
export function ProjectChips({ value, onChange, known, label }: {
  value: string[]; onChange: (v: string[]) => void; known: string[]; label: string;
}) {
  const [typed, setTyped] = useState('');
  const sug = useMemo(() => similarProject(typed, known), [typed, known]);
  const add = (p: string) => { onChange(addProject(value, p)); setTyped(''); };
  const listId = useMemo(() => 'pt-known-' + Math.random().toString(36).slice(2), []);
  return (
    <div className="fld full">
      <span className="fl">{label}</span>
      {value.length > 0 && (
        <div className="pt-projchips">
          {value.map((p, i) => (
            <span key={p} className="chip">{i === 0 && <b aria-label="الأساسي">★ </b>}{p}
              <button type="button" className="pt-link" onClick={() => onChange(removeProject(value, p))} aria-label={`إزالة ${p}`}> ×</button>
            </span>
          ))}
        </div>
      )}
      <div className="pt-projadd">
        <input value={typed} list={listId} placeholder="اكتب اسم مشروع أو اختر من القائمة…"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(typed); } }} />
        <datalist id={listId}>{known.map((p) => <option key={p} value={p} />)}</datalist>
        <Button size="sm" onClick={() => add(typed)}>إضافة</Button>
      </div>
      {sug && (
        <div className="pt-psug">يوجد مشروع مشابه: «{sug}» — هل تقصده؟{' '}
          <Button size="sm" onClick={() => add(sug)}>استخدام «{sug}»</Button>
        </div>
      )}
    </div>
  );
}

/** حقل مشروع واحد: قائمة المعروفة + «مشروع جديد…» يحوّل لإدخال حر (ContractorDetail.tsx:838-861). */
export function ProjectField({ value, onChange, projects, label = 'المشروع' }: {
  value: string; onChange: (v: string) => void; projects: string[]; label?: string;
}) {
  const [free, setFree] = useState(!(value === '' || projects.includes(value)));
  return (
    <label className="fld"><span className="fl">{label}</span>
      {!free ? (
        <select value={value} onChange={(e) => { if (e.target.value === '__free__') { setFree(true); onChange(''); } else onChange(e.target.value); }}>
          <option value="">—</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="__free__">مشروع جديد…</option>
        </select>
      ) : <input value={value} placeholder="اسم المشروع" autoFocus onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

export const tonePill = (cls: string, text: ReactNode) => <Pill tone={toneOf(cls)}>{text}</Pill>;
export { Chip };
