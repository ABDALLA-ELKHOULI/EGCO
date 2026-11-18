/** أجزاء مشتركة بين الورقة والشرائح والملخّص. عرض فقط — لا حساب. */
import type { ReactNode } from 'react';
import { Money, Pill, digits, dateTxt, fmt } from './uikit';
import { balanceView, type Decision } from './model';
import type { AgeingBucket, LastPayment, ScheduleRow } from './types';

export function Sec({ no, title, sub, explain }: { no: number; title: string; sub?: string; explain?: ReactNode }) {
  return (
    <div className="rp-sec">
      <span className="rp-no">{digits(no)}</span><b>{title}</b>{explain}
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function PKpi({ label, value, tone, hint, explain }: {
  label: string; value: number | null; tone?: 'danger' | 'ok' | 'warn'; hint?: ReactNode; explain?: ReactNode;
}) {
  return (
    <div>
      <span>{label}{explain}</span>
      <b><Money value={value} className={tone ? 't-' + tone : undefined} /></b>
      {hint != null && <em>{hint}</em>}
    </div>
  );
}

export function PartyPill({ kind }: { kind: 'supplier' | 'contractor' }) {
  return <Pill tone="neutral" className="rp-party">{kind === 'contractor' ? 'مقاول' : 'مورد'}</Pill>;
}

/** اسم الطرف من items[] (Report.tsx:793-811): واحد ← اسمه؛ عدة ← أولهم + «و N آخرون» + تلميح. */
export function PartyCell({ row }: { row: ScheduleRow }) {
  const items = row.items ?? [];
  const first = items[0];
  const kind = first?.partyKind ?? 'supplier';
  const extra = items.length > 1 ? items.length - 1 : 0;
  const mixed = extra > 0 && items.some((i) => i.partyKind !== kind);
  return (
    <span className="rp-nowrap" title={extra ? items.map((i) => `${i.name} — ${fmt(i.amount)}`).join('\n') : undefined}>
      {first?.name ?? <span className="rp-muted">{kind === 'contractor' ? 'مقاولون' : 'موردون'}</span>}
      {extra > 0 && <span className="rp-muted"> و{digits(extra)} آخرون</span>}
      {!mixed && <PartyPill kind={kind} />}
    </span>
  );
}

/** رصيد مقاول: القيمة المطلقة + الكلمة. لا أحمر — الأحمر للتأخر الزمني وحده. */
export function BalanceCell({ balance }: { balance: number }) {
  const v = balanceView(balance);
  return (
    <span>
      <Money value={Math.abs(balance)} /> <small>{v.label}</small>
    </span>
  );
}

export function lastPaymentText(lp: LastPayment | string | null | undefined): string {
  if (!lp) return '—';
  if (typeof lp === 'string') return dateTxt(lp, { year: true });
  return `${dateTxt(lp.date, { year: true })} · ${fmt(lp.amount)}`;
}

export const projectsText = (p: string[] | string | null | undefined) =>
  Array.isArray(p) ? (p.length ? p.join('، ') : '—') : p || '—';

/** أشرطة الأعمار — العرض النسبي للرسم فقط (ليس رقماً يُعرض). */
export function AgeingBars({ buckets, undated }: { buckets: AgeingBucket[]; undated: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.amount));
  return (
    <div className="rp-bars">
      {buckets.map((b, i) => (
        <div className="rp-bar" key={b.label}>
          <span>{b.label}</span>
          <div className="rp-track"><i className={i > 0 ? 'late' : undefined}
            style={{ '--w': (b.amount / max).toFixed(4), '--i': i } as React.CSSProperties} /></div>
          <Money value={b.amount} className={i > 0 && b.amount ? 't-danger' : undefined} />
        </div>
      ))}
      {undated > 0 && (
        <div className="rp-bar"><span>بانتظار تاريخ استحقاق</span><div className="rp-track" /><Money value={undated} /></div>
      )}
    </div>
  );
}

const SEV: Record<Decision['sev'], string> = { d: 'd', w: 'w', i: 'n', ok: 'o' };
export function DecisionList({ items }: { items: Decision[] }) {
  return (
    <ol className="rp-s-dec">
      {items.map((x, i) => (
        <li key={i}><i className={'sev ' + SEV[x.sev]} aria-hidden="true" />
          <div><b>{x.title}</b>{x.body && <span>{x.body}</span>}</div></li>
      ))}
    </ol>
  );
}
