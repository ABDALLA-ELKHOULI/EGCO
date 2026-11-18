/**
 * نموذج التحصيل (P-240) داخل Modal بحارس. العميل/المشروع/الوحدة بقوائم اقتراح (datalist) كالقديم
 * — Field في @/ui لا يدعم datalist، فهذه الثلاثة حقول أصلية مربوطة بنفس useForm.
 * «محصّل» يتطلب تاريخ تحصيل (الخادم يرفض غيره).
 */
import { useId } from 'react';
import { Field, FormGrid, Modal, useForm } from '@/ui';
import { todayIso } from '../logic/money';
import { unitsForClient } from '../logic/collections';
import type { Revenue, RevenueInput } from '../types';

export function RevenueModal({ open, mode, row, projects, clients, allRows, onClose, onSubmit }: {
  open: boolean; mode: 'add' | 'edit' | 'collect'; row: Revenue | null;
  projects: string[]; clients: string[]; allRows: Revenue[];
  onClose: () => void; onSubmit: (v: RevenueInput) => Promise<unknown>;
}) {
  // المفتاح يعيد إنشاء النموذج عند تبديل الصف — قيم أولية جديدة بلا تزامن يدوي
  return open ? <Inner key={(row?.id ?? 'new') + mode} {...{ mode, row, projects, clients, allRows, onClose, onSubmit }} /> : null;
}

function Inner({ mode, row, projects, clients, allRows, onClose, onSubmit }: {
  mode: 'add' | 'edit' | 'collect'; row: Revenue | null; projects: string[]; clients: string[]; allRows: Revenue[];
  onClose: () => void; onSubmit: (v: RevenueInput) => Promise<unknown>;
}) {
  const id = useId();
  const form = useForm({
    client: row?.client ?? '', project: row?.project ?? '', unit: row?.unit ?? '',
    amount: (row?.amount ?? null) as number | null, dueDate: row?.dueDate ?? '',
    status: (mode === 'collect' ? 'collected' : row?.status ?? 'open') as string,
    collectedOn: mode === 'collect' ? todayIso() : row?.collectedOn ?? '', notes: row?.notes ?? '',
  }, {
    client: (v) => (String(v ?? '').trim() ? null : 'العميل مطلوب'),
    amount: { required: true, min: 0.01, message: 'المبلغ أكبر من صفر' },
    collectedOn: (v, all) => (all.status === 'collected' && !v ? 'تاريخ التحصيل مطلوب لحالة «محصّل»' : null),
  });
  const v = form.values;
  const units = unitsForClient(allRows, String(v.client));
  const title = mode === 'add' ? 'إضافة تحصيل' : mode === 'collect' ? 'تسجيل تحصيل' : 'تعديل تحصيل';
  return (
    <Modal open onClose={onClose} title={title} size="md" dirty={form.dirty}
      actions={[{ label: 'إلغاء' }, {
        label: mode === 'add' ? 'أضف' : 'حفظ', kind: 'primary', onClick: async (close) => {
          if (!form.validate()) return;
          await onSubmit({
            client: String(v.client).trim(), project: String(v.project).trim(), unit: String(v.unit).trim(),
            amount: Number(v.amount), dueDate: v.dueDate || null, status: v.status === 'collected' ? 'collected' : 'open',
            collectedOn: v.status === 'collected' ? (v.collectedOn || null) : null, notes: String(v.notes),
          });
          close(true);
        },
      }]}>
      <div className="sec-cash">
        {row && row.source !== 'manual' && <p className="cap">صف مستورد من ملف — التعديل محفوظ هنا، والمصدر يبقى «ملف».</p>}
        <FormGrid>
          <label className="f-field sec-cash-dl"><span className="cap">العميل *</span>
            <input className="sec-cash-in" list={id + 'c'} value={String(v.client)} aria-invalid={!!form.errors.client}
              ref={(el) => form._reg('client', el)} onChange={(e) => form.set('client', e.target.value)} />
            <datalist id={id + 'c'}>{clients.map((c) => <option key={c} value={c} />)}</datalist>
            {form.errors.client && <span className="f-err">{form.errors.client}</span>}</label>
          <label className="f-field sec-cash-dl"><span className="cap">المشروع</span>
            <input className="sec-cash-in" list={id + 'p'} value={String(v.project)} onChange={(e) => form.set('project', e.target.value)} />
            <datalist id={id + 'p'}>{projects.map((p) => <option key={p} value={p} />)}</datalist></label>
          <label className="f-field sec-cash-dl"><span className="cap">الوحدة</span>
            <input className="sec-cash-in" list={id + 'u'} value={String(v.unit)} onChange={(e) => form.set('unit', e.target.value)} />
            <datalist id={id + 'u'}>{units.map((u) => <option key={u} value={u} />)}</datalist></label>
          <Field form={form} name="amount" label="المبلغ" type="money" required />
          <Field form={form} name="dueDate" label="تاريخ الاستحقاق" type="date" help="بلا تاريخ لن يدخل منحنى التدفق النقدي." />
          <Field form={form} name="status" label="الحالة" type="select" options={[{ value: 'open', label: 'مفتوح' }, { value: 'collected', label: 'محصّل' }]} />
          {v.status === 'collected' && <Field form={form} name="collectedOn" label="تاريخ التحصيل" type="date" required />}
          <Field form={form} name="notes" label="ملاحظات" type="textarea" rows={2} full />
        </FormGrid>
      </div>
    </Modal>
  );
}
