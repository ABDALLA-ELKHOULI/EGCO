/** تفصيل مؤشر في شاشة التحصيلات — الصفوف من استجابة /revenues نفسها (لا مسار breakdown لها). */
import { Modal, Money, dateTxt, digits, usePrefs } from '@/ui';
import type { Revenue } from '../types';

export interface LiteReq { title: string; rule: string; rows: Revenue[]; total: number; dateKey: 'dueDate' | 'collectedOn' }

export function BreakdownLite({ req, onClose }: { req: LiteReq | null; onClose: () => void }) {
  usePrefs();
  return (
    <Modal open={req != null} onClose={onClose} size="lg" title={req ? `من أين جاء هذا الرقم؟ — ${req.title}` : ''} actions={[{ label: 'إغلاق', kind: 'primary' }]}>
      {req && (
        <div className="sec-cash">
          <p className="sec-cash-rule">{req.rule}</p>
          {req.rows.length === 0 ? <div className="sec-cash-empty">لا صفوف تكوّن هذا الرقم — قيمته صفر فعلاً لا لغياب البيانات.</div> : (
            <div className="tbl-wrap sec-cash-bdwrap"><table className="sec-cash-bd">
              <thead><tr><th>التاريخ</th><th>العميل</th><th>المشروع</th><th className="n">المبلغ</th></tr></thead>
              <tbody>{req.rows.map((r) => (
                <tr key={r.id}><td>{r[req.dateKey] ? dateTxt(r[req.dateKey]!) : '—'}</td><td><b>{r.client}</b>{r.unit && <span className="cap"> · {r.unit}</span>}</td><td>{r.project || '—'}</td><td className="n"><Money value={r.amount} /></td></tr>))}</tbody>
              <tfoot><tr><td colSpan={3}>المجموع ({digits(req.rows.length)} بنداً) — يساوي الرقم المعروض</td><td className="n"><Money value={req.total} /></td></tr></tfoot>
            </table></div>
          )}
        </div>
      )}
    </Modal>
  );
}
