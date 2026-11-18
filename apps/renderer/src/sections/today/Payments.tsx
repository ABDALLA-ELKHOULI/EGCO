/**
 * تسجيل الدفعات من «اليوم» و«المستحقات» — نافذة لطرف واحد، وتأكيد لعدة أطراف.
 * كل دفعة تُكتب في الخادم (لا تحديث تفاؤلي لأي رقم)، و«تراجع» يحذفها منطقياً.
 */
import { Modal, useForm, Field, FormGrid, toast, confirm, fmt, digits, dateTxt } from '@/ui';
import { useRecordPayment, useUndoPayment, type PayResult } from './data.ts';
import { sumHalalas, type PartyPayment } from './logic.ts';

export interface PayTarget { partyType: 'supplier' | 'contractor'; key: string; name: string; amount: number; doc?: string }

export function PayModal({ target, today, onClose }: { target: PayTarget | null; today: string; onClose: () => void }) {
  const rec = useRecordPayment();
  const undo = useUndoPayment();
  const form = useForm(
    { amount: target?.amount ?? null as number | null, date: today, doc: target?.doc ?? '' },
    {
      amount: { required: true, min: 0.01 },
      date: { required: true },
    },
  );
  if (!target) return null;
  return (
    <Modal open={!!target} onClose={onClose} title={'تسجيل دفعة — ' + target.name} size="md" dirty={form.dirty}
      actions={[{ label: 'إلغاء' }, {
        label: 'سجّل الدفعة', kind: 'primary', onClick: async (close) => {
          if (!form.validate()) return;
          const amount = Math.round(Number(form.values.amount) * 100) / 100;
          const r = await rec.mutateAsync({ partyType: target.partyType, key: target.key, amount, date: String(form.values.date), doc: String(form.values.doc || '') });
          close(true);
          toast('سُجّلت دفعة ' + fmt(amount) + ' ر.س لـ' + target.name, { kind: 'ok', undo: () => { undo.mutate(r); } });
        },
      }]}>
      <FormGrid>
        <Field form={form} name="amount" label="المبلغ (ر.س)" type="money" required
          help={target.amount > 0 ? 'المستحق المعروض ' + fmt(target.amount) + ' ر.س' : undefined} />
        <Field form={form} name="date" label="التاريخ" type="date" required />
        <Field form={form} name="doc" label="رقم المستند" />
      </FormGrid>
    </Modal>
  );
}

/** تسجيل عدة دفعات (دفعة واحدة لكل طرف) بعد تأكيد صريح. يعيد true إن سُجّلت. */
export function useBulkPay() {
  const rec = useRecordPayment();
  const undo = useUndoPayment();
  return async (items: PartyPayment[], today: string): Promise<boolean> => {
    if (!items.length) return false;
    const total = sumHalalas(items, (x) => x.amount);
    const ok = await confirm({
      title: 'تسجيل ' + (items.length > 1 ? digits(items.length) + ' دفعات' : 'دفعة'),
      body: (items.length === 1 ? 'دفعة لـ' + items[0].name + ' بمبلغ ' : 'دفعات لـ' + digits(items.length) + ' أطراف بإجمالي ')
        + fmt(total) + ' ر.س بتاريخ ' + dateTxt(today, { year: true }) + '. تُوزَّع على الأقدم أولاً.',
      confirmLabel: 'سجّل الدفع',
    });
    if (!ok) return false;
    const done: PayResult[] = [];
    try {
      for (const x of items) {
        done.push(await rec.mutateAsync({ partyType: x.partyType, key: x.key, amount: x.amount, date: today, doc: x.docs.join('، ') }));
      }
    } finally {
      if (done.length) {
        toast('سُجّلت ' + (done.length > 1 ? digits(done.length) + ' دفعات' : 'الدفعة') + ' · ' + fmt(sumHalalas(items.slice(0, done.length), (x) => x.amount)) + ' ر.س',
          { kind: 'ok', undo: () => { done.forEach((d) => undo.mutate(d)); } });
      }
    }
    return done.length === items.length;
  };
}
