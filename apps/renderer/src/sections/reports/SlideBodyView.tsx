/** يرسم SlideBody — نفس المكوّن للعرض الحيّ ولطباعة كل الشرائح PDF. */
import { Money, digits } from './uikit';
import { AgeingBars, BalanceCell, DecisionList, PartyCell, PartyPill, projectsText } from './parts';
import type { SlideBody } from './slides';

export function SlideBodyView({ b }: { b: SlideBody }) {
  switch (b.kind) {
    case 'cover': return (
      <div className="rp-s-hero"><b>{b.title}</b><span>{b.scope} · {b.period}</span>
        <small>رقم الوثيقة <span className="num">{b.serial}</span> · {b.issuedOn}</small></div>
    );
    case 'kpis': return (
      <div className="rp-s-kpis">
        <div><span>إجمالي المفوتر</span><b><Money value={b.totalInvoiced} /></b></div>
        <div><span>المسدد</span><b><Money value={b.totalPaid} className="t-ok" /></b></div>
        <div><span>المديونية المفتوحة</span><b><Money value={b.outstanding} /></b></div>
        {b.overdue != null && <div className={b.overdue > 0 ? 'crit' : undefined}><span>المتأخر (موردون)</span>
          <b><Money value={b.overdue} className={b.overdue > 0 ? 't-danger' : undefined} /></b><small>{digits(b.overdueCount)} جهة</small></div>}
      </div>
    );
    case 'ageing': return <AgeingBars buckets={b.buckets} undated={b.undated} />;
    case 'schedule': return (
      <div className="tbl-wrap"><table>
        <thead><tr><th>تاريخ الاستحقاق</th><th>الطرف</th><th className="n">الفواتير</th><th>الحالة</th><th className="n">المبلغ</th></tr></thead>
        <tbody>{b.rows.map((x) => (
          <tr key={x.date}><td>{x.date_ar}</td><td><PartyCell row={x} /></td><td className="n">{digits(x.count)}</td>
            <td className={x.overdue ? 't-danger' : undefined}>{x.status}</td>
            <td className="n"><Money value={x.amount} className={x.overdue ? 't-danger' : undefined} /></td></tr>))}</tbody>
      </table></div>
    );
    case 'overdue': return (
      <div className="tbl-wrap"><table>
        <thead><tr><th>الجهة</th><th>المشروع</th><th className="n">المتأخر</th></tr></thead>
        <tbody>{b.rows.map((o) => <tr key={o.key}><td>{o.name}<PartyPill kind={o.kind} /></td><td>{o.project ?? '—'}</td>
          <td className="n"><Money value={o.amount} className="t-danger" /></td></tr>)}</tbody>
      </table></div>
    );
    case 'topSuppliers': return (
      <div className="tbl-wrap"><table>
        <thead><tr><th>المورد</th><th>المشروع</th><th className="n">المديونية المفتوحة</th><th className="n">المتأخر</th></tr></thead>
        <tbody>{b.rows.map((x) => <tr key={x.account}><td>{x.name}<PartyPill kind="supplier" /></td><td className="rp-muted">{x.project ?? '—'}</td>
          <td className="n"><Money value={x.outstanding} /></td>
          <td className="n">{x.overdue > 0 ? <Money value={x.overdue} className="t-danger" /> : '—'}</td></tr>)}</tbody>
      </table></div>
    );
    case 'contractors': return (
      <div className="rp-s-stack">
        <div className="rp-s-kpis rp-s-k3">
          <div><span>إجمالي المستخلصات</span><b><Money value={b.invoiced} /></b></div>
          <div><span>المسدد للمقاولين</span><b><Money value={b.paid} className="t-ok" /></b></div>
          <div><span>مستحق لهم</span><b><Money value={b.owed}  /></b></div>
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>المقاول</th><th>المشاريع</th><th className="n">الرصيد</th></tr></thead>
          <tbody>{b.rows.map((c) => <tr key={c.code}><td>{c.name}</td><td className="rp-muted">{projectsText(c.projects)}</td>
            <td className="n"><BalanceCell balance={c.balance} /></td></tr>)}</tbody>
        </table></div>
      </div>
    );
    case 'notes': return <div className="rp-notes rp-s-notes">{b.notes.map((n) => <div key={n.title}><b>{n.title}</b><p>{n.body}</p></div>)}</div>;
    case 'decisions': return <DecisionList items={b.items} />;
  }
}
