/**
 * «من أين جاء هذا الرقم؟» (P-228). الإجمالي من الخادم (`total`) لا مجموع الصفوف المعروضة —
 * القص عند ٥٠٠ صف لا يغيّر الإجمالي (P-597). جدول مستقل لكل نوع صف: مع parties=both تختلط
 * صفوف المورد والمقاول في نفس المصطلح، والقديم كان يفترض نوع الصف الأول لكل الجدول.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExportDialog, Modal, Money, Skeleton, dateTxt, digits, fmt, usePrefs } from '@/ui';
import { useBreakdown } from '../hooks';
import { isContractorRow, isReceivableRow, isSupplierRow } from '../types';
import type { BreakdownRow, BreakdownTerm, CashflowQuery, ContractorBdRow, ReceivableBdRow, SupplierBdRow } from '../types';

export interface BreakdownRequest {
  term: BreakdownTerm;
  title: string;
  amount: number;
  rule: string;
  period?: string; // periods[i].from — يقصر المصطلح على فترة واحدة
}

const d = (s: string | null) => (s ? dateTxt(s) : '—');

export function BreakdownModal({ req, query, onClose }: { req: BreakdownRequest | null; query: CashflowQuery; onClose: () => void }) {
  usePrefs();
  const nav = useNavigate();
  const [exp, setExp] = useState(false);
  const bd = useBreakdown(query, req?.term ?? null, req?.period);
  const rows: BreakdownRow[] = bd.data?.rows ?? [];
  const sup = rows.filter(isSupplierRow), con = rows.filter(isContractorRow), rcv = rows.filter(isReceivableRow);
  const go = (path: string) => { onClose(); nav(path); };

  return (
    <Modal open={req != null} onClose={onClose} size="lg"
      title={req ? `من أين جاء هذا الرقم؟ — ${req.title}` : ''}
      actions={[
        ...(rows.length ? [{ label: 'تصدير', onClick: () => { setExp(true); } }] : []),
        { label: 'إغلاق', kind: 'primary' as const },
      ]}>
      {req && (
        <div className="sec-cash">
          <div className="hero num"><Money value={req.amount} /></div>
          <p className="sec-cash-rule">{req.rule}</p>
          {bd.isLoading && <Skeleton rows={5} />}
          {bd.error && (
            <div className="sec-cash-call w"><span>تعذّر جلب تفاصيل هذا الرقم: {bd.error.message}</span>
              <button className="btn sm" onClick={() => bd.refetch()}>أعد المحاولة</button></div>
          )}
          {bd.data && rows.length === 0 && (
            <div className="sec-cash-empty">لا صفوف تكوّن هذا الرقم — قيمته صفر فعلاً لا لغياب البيانات.</div>
          )}
          {sup.length > 0 && <SupTable rows={sup} onOpen={(a) => go(`/parties/suppliers/${encodeURIComponent(a)}`)} />}
          {con.length > 0 && <ConTable rows={con} onOpen={(c) => go(`/parties/contractors/${encodeURIComponent(c)}`)} />}
          {rcv.length > 0 && <RcvTable rows={rcv} />}
          {bd.data && rows.length > 0 && (
            <p className="disclose">
              الإجمالي <b className="num">{fmt(bd.data.total)}</b> ر.س ({digits(rows.length)} بنداً{bd.data.truncated ? ' معروضاً' : ''}) — يساوي الرقم المعروض.
              {bd.data.truncated && ' عُرض أول ٥٠٠ صف فقط — الإجمالي يشمل كل الصفوف رغم ذلك.'}
            </p>
          )}
          <ExportDialog<BreakdownRow> open={exp} onClose={() => setExp(false)} title={req.title}
            fileName={`cash-${req.term}.csv`} rows={rows} columns={[
              { label: 'الجهة', value: (r) => isSupplierRow(r) ? r.supplierName : isContractorRow(r) ? r.contractorName : r.client },
              { label: 'المستند', value: (r) => isSupplierRow(r) ? r.invoiceNumber : '' },
              { label: 'المشروع', value: (r) => isSupplierRow(r) ? '' : r.project ?? '' },
              { label: 'التاريخ', value: (r) => isSupplierRow(r) ? r.dueDate ?? '' : isContractorRow(r) ? r.releaseDue ?? '' : r.date },
              { label: 'المبلغ', value: (r) => r.amount.toFixed(2) },
            ]} />
        </div>
      )}
    </Modal>
  );
}

function SupTable({ rows, onOpen }: { rows: SupplierBdRow[]; onOpen: (account: string) => void }) {
  return (
    <div className="tbl-wrap sec-cash-bdwrap"><table className="sec-cash-bd">
      <thead><tr><th>المورد</th><th>الفاتورة</th><th>تاريخ الفاتورة</th><th>الاستحقاق</th><th className="n">المبلغ</th><th>التأخر</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} className="go" onClick={() => onOpen(r.account)}>
          <td><b>{r.supplierName}</b></td><td className="num">{r.invoiceNumber}</td><td>{d(r.invoiceDate)}</td>
          <td>{r.dueDate ? d(r.dueDate) : <span className="dash">بلا تاريخ</span>}</td>
          <td className="n"><Money value={r.amount} /></td>
          <td>{r.daysOverdue ? <span className="pill d">{digits(r.daysOverdue)} يوماً</span> : '—'}</td>
        </tr>))}</tbody>
    </table></div>
  );
}
function ConTable({ rows, onOpen }: { rows: ContractorBdRow[]; onOpen: (code: string) => void }) {
  return (
    <div className="tbl-wrap sec-cash-bdwrap"><table className="sec-cash-bd">
      <thead><tr><th>المقاول</th><th>المشروع</th><th>الإفراج المتوقع</th><th className="n">المبلغ</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} className="go" onClick={() => onOpen(r.contractorCode)}>
          <td><b>{r.contractorName}</b></td><td>{r.project || '—'}</td>
          <td>{r.releaseDue ? d(r.releaseDue) : <span className="dash">بلا تاريخ</span>}</td>
          <td className="n"><Money value={r.amount} /></td>
        </tr>))}</tbody>
    </table></div>
  );
}
function RcvTable({ rows }: { rows: ReceivableBdRow[] }) {
  return (
    <div className="tbl-wrap sec-cash-bdwrap"><table className="sec-cash-bd">
      <thead><tr><th>التاريخ</th><th>العميل</th><th>المشروع</th><th className="n">المبلغ</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}><td>{d(r.date)}</td><td><b>{r.client}</b></td><td>{r.project || '—'}</td><td className="n"><Money value={r.amount} /></td></tr>))}</tbody>
    </table></div>
  );
}
