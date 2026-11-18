/* لوحة الحكم: قيمة العقد ↔ المُسند ↔ المنفّذ — كل المبالغ من الخادم؛ الهامش margin من الخادم.
   بلا قيمة عقد: نعرض ما نعرفه ونطلب القيمة، ولا نخمّن هامشاً. */
import { useState } from 'react';
import { Button, Field, FormGrid, Island, Modal, Money, useForm } from '@/ui';
import type { Verdict } from '../logic/verdict';
import { toDec } from '../logic/money';
import { useContractValueMutation } from '../hooks';
import { Pct } from './bits';

export function VerdictPanel({ v, projectId, supplierCost, contractorCost, i }: {
  v: Verdict; projectId: string; supplierCost: number | null; contractorCost: number | null; i?: number;
}) {
  const [editing, setEditing] = useState(false);
  const loss = v.kind === 'loss';
  const editBtn = <Button size="sm" kind={v.contractValue == null ? 'primary' : undefined} onClick={() => setEditing(true)}>
    {v.contractValue == null ? 'أدخل قيمة العقد' : 'تعديل قيمة العقد'}</Button>;
  return (
    <Island span={12} i={i} className={'sp-verdict' + (loss ? ' sp-verdict-loss' : '')} actions={editBtn}
      title={v.kind === 'unknown' ? 'لا نعرف إن كان هذا المشروع يكسب أو يخسر' : loss ? 'المشروع يخسر' : 'موقف المشروع'}>
      <div className="sum">
        <div>
          <div className="cap">{v.kind === 'unknown' ? 'الهامش' : loss ? 'تجاوز المنفّذ قيمة العقد بـ' : 'الهامش حتى الآن'}</div>
          <div className="hero">{v.margin == null ? <span className="dash">—</span>
            : <Money value={Math.abs(v.margin)} className={loss ? 't-warn' : 't-ok'} count />}</div>
          {v.marginPct != null && <span className="cap"><Pct value={Math.abs(v.marginPct)} fromPct /> من العقد</span>}
        </div>
        <div><div className="cap">قيمة العقد</div><div className="kpi"><Money value={v.contractValue} /></div></div>
        <div><div className="cap">المُسند للأطراف</div><div className="kpi"><Money value={v.assigned} /></div>
          {v.assignedPct != null && <span className="cap"><Pct value={v.assignedPct} fromPct /> من العقد</span>}</div>
        <div><div className="cap">المنفّذ</div><div className="kpi"><Money value={v.executed} /></div>
          <span className="cap">موردون <Money value={supplierCost} /> · مقاولون <Money value={contractorCost} /></span></div>
      </div>
      <p className="disclose">الهامش = قيمة العقد − المنفّذ المسجّل فقط (محسوب على الخادم؛ لا يشمل ما لم يُستورد بعد).
        {v.usedPct != null && <> استُهلك <Pct value={v.usedPct} fromPct /> من العقد.</>}
        {v.reasons.length > 0 && <> {v.reasons.join(' · ')}.</>}</p>
      {editing && <ContractValueModal projectId={projectId} current={v.contractValue} onClose={() => setEditing(false)} />}
    </Island>
  );
}

function ContractValueModal({ projectId, current, onClose }: { projectId: string; current: number | null; onClose: () => void }) {
  const save = useContractValueMutation();
  const form = useForm({ contractValue: current }, {
    contractValue: (v) => (v != null && (Number.isNaN(Number(v)) || Number(v) < 0) ? 'أدخل مبلغاً صحيحاً غير سالب' : null),
  });
  return (
    <Modal open onClose={onClose} size="sm" title="قيمة العقد مع المالك"
      actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', onClick: async (close) => {
        if (!form.validate()) return;
        await save.mutateAsync({ id: projectId, contractValue: toDec(form.values.contractValue) });
        close(true);
      } }]}>
      <FormGrid>
        <Field form={form} name="contractValue" label="قيمة العقد" type="money" full help="اتركها فارغة لمسح القيمة — يعود الحكم «غير معروف»." />
      </FormGrid>
    </Modal>
  );
}
