/**
 * النماذج — useForm + <Field> + <FormGrid>. منقولة من prototype/ui.js («النماذج»):
 * نفس الحقول، نفس رسائل التحقق، اهتزاز الحقل الخاطئ (m-shake) وتركيز أول خطأ.
 */
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { digits, parseNum } from './format';
import { replayClass } from './motion';

export type FieldType = 'text' | 'number' | 'money' | 'date' | 'month' | 'select' | 'multiselect' | 'checkbox' | 'textarea' | 'tel' | 'email';
type Values = Record<string, unknown>;
export interface Rule {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  message?: string;
  custom?: (v: unknown, all: Values) => string | null | undefined | true;
}
export type Rules<T> = Partial<Record<keyof T & string, Rule | ((v: unknown, all: T) => string | null | undefined | true)>>;

export interface FormApi<T extends Values> {
  values: T;
  errors: Partial<Record<keyof T & string, string>>;
  dirty: boolean;
  set: (name: keyof T & string, v: unknown) => void;
  setValues: (patch: Partial<T>) => void;
  setError: (name: keyof T & string, msg: string | null) => void;
  validate: () => boolean;
  reset: (v?: T) => void;
  /** داخلي: تسجيل عناصر الحقول للاهتزاز والتركيز ومعرفة القيود المعلنة على <Field>. */
  _reg: (name: string, el: HTMLElement | null, meta?: Rule & { kind?: FieldType }) => void;
}

const fmtPlain = (n: number) => digits(Number(n).toLocaleString('en-US'));

export function useForm<T extends Values>(initial: T, rules: Rules<T> = {}): FormApi<T> {
  const [values, setVals] = useState<T>(initial);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [dirty, setDirty] = useState(false);
  const els = useRef(new Map<string, { el: HTMLElement | null; meta?: Rule & { kind?: FieldType } }>());
  const valsRef = useRef(values); valsRef.current = values;
  const rulesRef = useRef(rules); rulesRef.current = rules;

  const set = useCallback((name: string, v: unknown) => {
    setVals((o) => ({ ...o, [name]: v }));
    setDirty(true);
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }, []);
  const setValues = useCallback((patch: Partial<T>) => { setVals((o) => ({ ...o, ...patch })); setDirty(true); }, []);
  const setError = useCallback((name: string, msg: string | null) => {
    setErrors((e) => ({ ...e, [name]: msg || undefined }));
    if (msg) replayClass(els.current.get(name)?.el ?? null, 'm-shake');
  }, []);
  const validate = useCallback(() => {
    const all = valsRef.current as Values;
    const names = new Set<string>([...Object.keys(rulesRef.current), ...els.current.keys()]);
    const next: Record<string, string | undefined> = {};
    let firstBad: string | null = null;
    for (const name of names) {
      const raw = (rulesRef.current as Record<string, Rule | ((v: unknown, a: Values) => string | null | undefined | true)>)[name];
      const r: Rule = typeof raw === 'function' ? { custom: raw } : { ...(raw || {}) };
      const meta = els.current.get(name)?.meta || {};
      const required = r.required ?? meta.required;
      const min = r.min ?? meta.min, max = r.max ?? meta.max;
      const v = all[name];
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length) || v === false && meta.kind === 'checkbox' && required;
      let msg: string | null = null;
      if (required && empty) msg = 'هذا الحقل مطلوب';
      else if (!empty && typeof v === 'number' && isNaN(v)) msg = 'أدخل رقماً صحيحاً';
      else if (!empty && typeof v === 'number' && min != null && v < min) msg = 'الحد الأدنى ' + fmtPlain(min);
      else if (!empty && typeof v === 'number' && max != null && v > max) msg = 'الحد الأعلى ' + fmtPlain(max);
      else if (!empty && r.pattern && !r.pattern.test(String(v))) msg = r.message || 'صيغة غير صحيحة';
      if (!msg && r.custom) { const m = r.custom(v, all); if (m && m !== true) msg = m; }
      next[name] = msg || undefined;
      if (msg) { replayClass(els.current.get(name)?.el ?? null, 'm-shake'); if (!firstBad) firstBad = name; }
    }
    setErrors(next);
    if (firstBad) {
      const el = els.current.get(firstBad)?.el;
      (el?.querySelector<HTMLElement>('input,select,textarea') ?? el)?.focus();
    }
    return !firstBad;
  }, []);
  const reset = useCallback((v?: T) => { setVals(v ?? initial); setErrors({}); setDirty(false); }, [initial]);
  const _reg = useCallback((name: string, el: HTMLElement | null, meta?: Rule & { kind?: FieldType }) => {
    if (el) els.current.set(name, { el, meta }); else els.current.delete(name);
  }, []);
  return useMemo(() => ({ values, errors, dirty, set, setValues, setError, validate, reset, _reg }) as FormApi<T>,
    [values, errors, dirty, set, setValues, setError, validate, reset, _reg]);
}

export function FormGrid({ children }: { children: ReactNode }) { return <div className="f-grid">{children}</div>; }

export type OptionLike = string | number | { value: string | number; label: ReactNode };
const opts = (o?: OptionLike[]) => (o || []).map((x) => (typeof x === 'object' ? x : { value: x, label: String(x) }));

export interface FieldProps<T extends Values> {
  form: FormApi<T>;
  name: keyof T & string;
  label: ReactNode;
  type?: FieldType;
  required?: boolean;
  help?: ReactNode;
  placeholder?: string;
  options?: OptionLike[];
  full?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  dir?: 'ltr' | 'rtl';
  min?: number;
  max?: number;
  step?: number | string;
  checkLabel?: ReactNode;
  rows?: number;
}

export function Field<T extends Values>(f: FieldProps<T>) {
  const id = useId();
  const type = f.type || 'text';
  const v = f.form.values[f.name];
  const err = f.form.errors[f.name];
  // نص الحقل الرقمي محلي: يبقى ما كتبه المستخدم («١٬٢٠٠٫٥») ويُقرأ رقماً عند كل تغيير
  const [txt, setTxt] = useState<string | null>(null);
  const reg = useCallback((el: HTMLElement | null) => f.form._reg(f.name, el, { required: f.required, min: f.min, max: f.max, kind: type }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f.form._reg, f.name, f.required, f.min, f.max, type]);
  const common = { id, name: f.name, placeholder: f.placeholder, readOnly: f.readOnly, disabled: f.disabled, 'aria-invalid': !!err || undefined, 'aria-required': f.required || undefined };
  const set = (x: unknown) => f.form.set(f.name, x);
  let ctl: ReactNode;
  switch (type) {
    case 'select':
      ctl = (
        <select {...common} value={v == null ? '' : String(v)} onChange={(e) => set(e.target.value)}>
          {(f.placeholder || !f.required) && <option value="">{f.placeholder || '—'}</option>}
          {opts(f.options).map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      );
      break;
    case 'textarea':
      ctl = <textarea {...common} rows={f.rows || 3} value={v == null ? '' : String(v)} onChange={(e) => set(e.target.value)} />;
      break;
    case 'money':
    case 'number': {
      const shown = txt ?? (v == null || (typeof v === 'number' && isNaN(v)) ? '' : String(v));
      const input = (
        <input {...common} type="text" inputMode="decimal" dir="ltr" autoComplete="off" value={shown}
          onChange={(e) => { setTxt(e.target.value); set(parseNum(e.target.value)); }}
          onBlur={() => setTxt(null)} />
      );
      ctl = type === 'money' ? <span className="f-money">{input}<span className="cur">ر.س</span></span> : input;
      break;
    }
    case 'date':
    case 'month':
      ctl = <input {...common} type={type} dir="ltr" value={v == null ? '' : String(v)} onChange={(e) => set(e.target.value)} />;
      break;
    case 'checkbox':
      ctl = (
        <label className="f-check">
          <input {...common} type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />
          <span>{f.checkLabel}</span>
        </label>
      );
      break;
    case 'multiselect': {
      const vals = (Array.isArray(v) ? v : []).map(String);
      const o = opts(f.options);
      ctl = (
        <div className="f-multi" role="group" id={id} aria-label={typeof f.label === 'string' ? f.label : undefined}>
          {o.length ? o.map((x) => (
            <label key={String(x.value)} className="f-opt">
              <input type="checkbox" value={String(x.value)} checked={vals.includes(String(x.value))} disabled={f.disabled}
                onChange={(e) => set(e.target.checked ? [...vals, String(x.value)] : vals.filter((y) => y !== String(x.value)))} />
              <span>{x.label}</span>
            </label>
          )) : <span className="cap">لا خيارات</span>}
        </div>
      );
      break;
    }
    default:
      ctl = <input {...common} type={type === 'tel' || type === 'email' ? type : 'text'} dir={f.dir} autoComplete="off"
        value={v == null ? '' : String(v)} onChange={(e) => set(e.target.value)} />;
  }
  const full = f.full || type === 'textarea' || type === 'multiselect';
  const cls = 'fld' + (full ? ' full' : '') + (err ? ' invalid' : '');
  const inner = (
    <>
      <span className="fl">{f.label}{f.required && <> <i className="req" aria-hidden="true">*</i></>}</span>
      {ctl}
      {f.help != null && <small className="fh">{f.help}</small>}
      <small className="fe" aria-live="polite">{err || ''}</small>
    </>
  );
  return type === 'multiselect' || type === 'checkbox'
    ? <div className={cls} data-field={f.name} ref={reg}>{inner}</div>
    : <label className={cls} data-field={f.name} htmlFor={id} ref={reg}>{inner}</label>;
}
