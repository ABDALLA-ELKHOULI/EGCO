/**
 * سيناريو «ماذا لو؟» — مؤقت ولا يكتب بياناتك. ثلاث أدوات: تأجيل بند مجدول، سداد متأخر بتاريخ،
 * تحصيل افتراضي. «أضف للتحصيلات» وحده يكتب (ينشئ تحصيلاً حقيقياً بعد نقر صريح).
 */
import { useState, type FormEvent } from 'react';
import { Button, Money, dateTxt, digits, fmt, parseNum, toast, usePrefs } from '@/ui';
import { useCreateRevenue } from '../hooks';
import { todayIso } from '../logic/money';
import type { CashItem, Tweak } from '../logic/scenario';
import { WhatIfServer } from './WhatIfServer';

const itemLabel = (it: CashItem) => `${it.date ? dateTxt(it.date) : 'بلا تاريخ'} · ${it.party}${it.doc ? ' · ' + it.doc : ''} · ${fmt(it.amount)}`;
const nid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function ScenarioPanel({ tweaks, onChange, saved, onSave, scheduled, overdue, loading, error, truncated, skipped, project }: {
  tweaks: Tweak[]; onChange: (t: Tweak[]) => void; saved: boolean; onSave: () => void;
  scheduled: CashItem[]; overdue: CashItem[]; loading: boolean; error: string | null; truncated: boolean;
  skipped: Tweak[]; project: string;
}) {
  usePrefs();
  const [dKey, setDKey] = useState(''); const [dDays, setDDays] = useState('14');
  const [oKey, setOKey] = useState(''); const [oDate, setODate] = useState(todayIso());
  const [iLabel, setILabel] = useState(''); const [iAmt, setIAmt] = useState(''); const [iDate, setIDate] = useState('');
  const [bad, setBad] = useState<string | null>(null);
  const create = useCreateRevenue();

  const add = (t: Tweak) => { onChange([...tweaks, t]); setBad(null); };
  const onDelay = (e: FormEvent) => {
    e.preventDefault();
    const it = scheduled.find((x) => x.key === dKey); const days = parseInt(dDays, 10);
    if (!it) return setBad('delay-key'); if (!(days > 0 && days <= 365)) return setBad('delay-days');
    add({ id: nid(), kind: 'delay', key: it.key, days, label: `${it.party}${it.doc ? ' — ' + it.doc : ''}` });
  };
  const onSettle = (e: FormEvent) => {
    e.preventDefault();
    const it = overdue.find((x) => x.key === oKey);
    if (!it) return setBad('settle-key'); if (!oDate) return setBad('settle-date');
    add({ id: nid(), kind: 'settleOverdue', key: it.key, date: oDate, label: `${it.party}${it.doc ? ' — ' + it.doc : ''}` });
  };
  const onInflow = (e: FormEvent) => {
    e.preventDefault();
    const a = parseNum(iAmt);
    if (a == null || !(a > 0)) return setBad('in-amt'); if (!iDate) return setBad('in-date');
    add({ id: nid(), kind: 'inflow', amount: a, date: iDate, label: iLabel.trim() || 'تحصيل افتراضي' });
  };
  const remove = (id: string) => {
    const prev = tweaks;
    onChange(tweaks.filter((t) => t.id !== id));
    toast('أُزيل التعديل', { kind: 'info', undo: () => onChange(prev) });
  };
  const clear = () => { const prev = tweaks; onChange([]); toast('أُلغي السيناريو', { kind: 'info', undo: () => onChange(prev) }); };
  const commit = async (t: Extract<Tweak, { kind: 'inflow' }>) => {
    await create.mutateAsync({ project, unit: '', client: t.label, amount: t.amount, dueDate: t.date, status: 'open', collectedOn: null, notes: 'من سيناريو التدفق النقدي' });
    onChange(tweaks.filter((x) => x.id !== t.id));
    toast('أُضيف إلى التحصيلات — يدخل التدفق النقدي فعلاً', { kind: 'ok' });
  };
  const inv = (k: string) => (bad === k ? { 'aria-invalid': true, className: 'sec-cash-in sec-cash-shake' } : { className: 'sec-cash-in' });

  return (
    <section className="isl c12 sec-cash-scn">
      <div className="ih"><h2>سيناريو «ماذا لو؟»</h2><span className="cap">مؤقت — لا يغيّر بياناتك. الأرقام الأصلية من الخادم تبقى ظاهرة بجانبه.</span></div>
      {loading && <p className="cap">جارٍ جلب البنود…</p>}
      {error && <div className="sec-cash-call w"><span>تعذّر جلب البنود: {error}</span></div>}
      {truncated && <div className="sec-cash-call w"><span>أكثر من ٥٠٠ بند في هذا الأفق — القائمة أدناه مقصوصة؛ قصّر الأفق أو صفِّ بمشروع لترى كل البنود.</span></div>}
      <div className="sec-cash-scngrid">
        <form className="sec-cash-scnf" onSubmit={onDelay}><b>أجِّل دفعة أو تحصيلاً مجدولاً</b>
          <label><span className="cap">البند</span>
            <select {...inv('delay-key')} value={dKey} onChange={(e) => setDKey(e.target.value)}>
              <option value="">اختر…</option>
              <optgroup label="الخارج">{scheduled.filter((x) => x.dir === 'out').map((x) => <option key={x.key} value={x.key}>{itemLabel(x)}</option>)}</optgroup>
              <optgroup label="الداخل">{scheduled.filter((x) => x.dir === 'in').map((x) => <option key={x.key} value={x.key}>{itemLabel(x)}</option>)}</optgroup>
            </select></label>
          <label><span className="cap">بعدد أيام</span><input {...inv('delay-days')} type="number" min={1} max={365} dir="ltr" value={dDays} onChange={(e) => setDDays(e.target.value)} /></label>
          <Button type="submit">طبِّق</Button>
        </form>
        <form className="sec-cash-scnf" onSubmit={onSettle}><b>سدِّد متأخراً في تاريخ</b>
          <label><span className="cap">البند المتأخر</span>
            <select {...inv('settle-key')} value={oKey} onChange={(e) => setOKey(e.target.value)}>
              <option value="">{overdue.length ? 'اختر…' : 'لا متأخر'}</option>
              {overdue.map((x) => <option key={x.key} value={x.key}>{itemLabel(x)}</option>)}
            </select></label>
          <label><span className="cap">تاريخ السداد</span><input {...inv('settle-date')} type="date" dir="ltr" value={oDate} onChange={(e) => setODate(e.target.value)} /></label>
          <Button type="submit">طبِّق</Button>
        </form>
        <form className="sec-cash-scnf" onSubmit={onInflow}><b>أضف تحصيلاً متوقعاً</b>
          <label><span className="cap">الوصف</span><input className="sec-cash-in" value={iLabel} onChange={(e) => setILabel(e.target.value)} placeholder="دفعة مقدّمة…" /></label>
          <label><span className="cap">المبلغ</span><input {...inv('in-amt')} inputMode="decimal" dir="ltr" value={iAmt} onChange={(e) => setIAmt(e.target.value)} /></label>
          <label><span className="cap">التاريخ</span><input {...inv('in-date')} type="date" dir="ltr" value={iDate} onChange={(e) => setIDate(e.target.value)} /></label>
          <Button type="submit">أضف</Button>
        </form>
        <WhatIfServer />
      </div>
      {skipped.length > 0 && (
        <div className="sec-cash-call w"><span>{digits(skipped.length)} تعديلاً لم يُطبَّق — بنده خارج الأفق أو الفلتر الحالي أو سُدِّد. لم يدخل الأرقام.</span></div>
      )}
      {tweaks.length > 0 && (
        <>
          <ul className="sec-cash-tweaks">{tweaks.map((t) => (
            <li key={t.id}>
              <span>
                {t.kind === 'delay' && <>تأجيل <b>{t.label}</b> {digits(t.days)} يوماً</>}
                {t.kind === 'settleOverdue' && <>سداد متأخر <b>{t.label}</b> في {dateTxt(t.date)}</>}
                {t.kind === 'inflow' && <>تحصيل <b>{t.label}</b> <Money value={t.amount} className="t-ok" /> في {dateTxt(t.date)}</>}
                {skipped.includes(t) && <span className="pill w"> غير مطبَّق</span>}
              </span>
              <span>
                {t.kind === 'inflow' && <Button size="sm" disabled={create.isPending} onClick={() => { void commit(t); }}>أضف للتحصيلات</Button>}
                <Button size="sm" kind="ghost" aria-label="احذف التعديل" onClick={() => remove(t.id)}>×</Button>
              </span>
            </li>))}
          </ul>
          <div className="sec-cash-askrow">
            <Button size="sm" kind={saved ? 'ghost' : 'primary'} disabled={saved} onClick={onSave}>{saved ? 'محفوظ' : 'احفظ السيناريو'}</Button>
            <Button size="sm" kind="danger" onClick={clear}>ألغِ السيناريو</Button>
          </div>
        </>
      )}
    </section>
  );
}
