/**
 * المطابقة (P-224/P-225/P-226) + سؤال تفسير الفرق (P-227). كل مصطلح من الخادم كما هو؛
 * الشارة من `difference` وحده (ε=0.005). لا جمع ولا طرح هنا.
 */
import { useState } from 'react';
import { Button, Money, Pill, dateTxt, fmt, usePrefs } from '@/ui';
import { useSaveReconNote } from '../hooks';
import { hasDrift, inflowTerms, outflowTerms, partiesLabel, RECON_DIFF_REASONS, type ReconTermView } from '../logic/recon';
import type { Parties, ReconNote, Reconciliation } from '../types';
import type { BreakdownRequest } from './BreakdownModal';
import { ExplainDot } from './ExplainDot';

function Terms({ terms, onOpen }: { terms: ReconTermView[]; onOpen: (r: BreakdownRequest) => void }) {
  return (
    <div className="sec-cash-terms">
      {terms.map((t) => (
        <span key={t.label + t.sign} className={'sec-cash-term' + (t.muted ? ' sec-cash-muted' : '')}>
          {t.sign && <b className="sec-cash-op">{t.sign}</b>}
          <span className="cap">{t.label}</span>
          {t.term ? (
            <button className="sec-cash-lnk" title="اضغط لرؤية الصفوف التي كوّنت هذا الرقم"
              onClick={() => onOpen({ term: t.term!, title: t.label, amount: t.value, rule: t.rule ?? '' })}>
              <Money value={t.value} />
            </button>
          ) : <Money value={t.value} />}
        </span>
      ))}
    </div>
  );
}

export function ReconFooter({ recon, note, parties, project, onOpen, scenarioActive }: {
  recon: Reconciliation; note: ReconNote | null; parties: Parties; project: string;
  onOpen: (r: BreakdownRequest) => void; scenarioActive: boolean;
}) {
  usePrefs();
  const o = recon.outflow, i = recon.inflow;
  if (!o) return null;
  const outDrift = hasDrift(o.difference), inDrift = i ? hasDrift(i.difference) : false;
  return (
    <>
      <div className="ih"><h2>مطابقة الخارج مع مديونية {partiesLabel(parties)}{' '}
        <ExplainDot metric="cashflowReconciliation" values={{
          scheduled: o.scheduled, overdueNow: o.overdueNow, beyondHorizon: o.beyondHorizon,
          undated: o.undated, credits: o.credits, openDebt: o.openDebt,
        }} /></h2>
        <Pill tone={outDrift ? 'danger' : 'ok'}>{outDrift ? `فرق غير مفسَّر ${fmt(o.difference)}` : 'مطابق بالهللة'}</Pill>
      </div>
      <Terms terms={outflowTerms(o)} onOpen={onOpen} />
      {i && (
        <>
          <div className="ih sec-cash-ih2"><h2>مطابقة الداخل مع المستحق المفتوح</h2>
            <Pill tone={inDrift ? 'danger' : 'ok'}>{inDrift ? `فرق غير مفسَّر ${fmt(i.difference)}` : 'مطابق بالهللة'}</Pill>
          </div>
          <Terms terms={inflowTerms(i)} onOpen={onOpen} />
        </>
      )}
      <p className="disclose">
        «المديونية المفتوحة» و«المستحق المفتوح» هما رقما شاشتَي الأطراف والتحصيلات نفسهما. المنحنى والجداول تعرض
        المجدول فقط — «متأخر الآن» مضى استحقاقه فلا فترة له، و«بعد نهاية الأفق» يستحق بعد {dateTxt(recon.horizonEnd)}،
        و«بلا تواريخ» لا يمكن وضعه في فترة بأمانة. لا شيء من هذه الثلاثة داخل الرصيد التراكمي.
        {scenarioActive && ' المطابقة تصف بياناتك الفعلية — السيناريو لا يغيّرها.'}
      </p>
      {outDrift && <DiffAsk difference={o.difference} parties={parties} project={project} note={note} />}
    </>
  );
}

function DiffAsk({ difference, parties, project, note }: { difference: number; parties: Parties; project: string; note: ReconNote | null }) {
  const [editing, setEditing] = useState(false);
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const save = useSaveReconNote();
  const submit = async (noteCode: string, noteText: string | null) => {
    await save.mutateAsync({ parties, project: project || null, noteCode, noteText });
    setEditing(false); setOther(false); setText('');
  };
  if (note && !editing) {
    const lbl = RECON_DIFF_REASONS.find((r) => r.code === note.noteCode)?.label;
    return (
      <div className="sec-cash-call i">
        <span>تفسير هذا الفرق: <b>{lbl || note.noteText || 'أخرى'}</b>{note.noteCode === 'other' && note.noteText && lbl == null ? '' : ''}</span>
        <Button size="sm" onClick={() => setEditing(true)}>تغيير التفسير</Button>
      </div>
    );
  }
  return (
    <div className="sec-cash-call w sec-cash-ask">
      <b>ما سبب الفرق غير المفسَّر (<span className="num">{fmt(Math.abs(difference))}</span> ر.س)؟</b>
      <div className="sec-cash-askrow">
        {RECON_DIFF_REASONS.map((r) => (
          <Button key={r.code} size="sm" disabled={save.isPending} onClick={() => { void submit(r.code, null); }}>{r.label}</Button>
        ))}
        <Button size="sm" disabled={save.isPending} onClick={() => setOther(true)}>أخرى — اكتب السبب</Button>
        {editing && note && <Button size="sm" kind="ghost" onClick={() => setEditing(false)}>إلغاء</Button>}
      </div>
      {other && (
        <form className="sec-cash-askrow" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void submit('other', text.trim()); }}>
          <input className="sec-cash-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب السبب…" aria-label="سبب الفرق" />
          <Button size="sm" kind="primary" type="submit" disabled={save.isPending || !text.trim()}>حفظ</Button>
        </form>
      )}
    </div>
  );
}
