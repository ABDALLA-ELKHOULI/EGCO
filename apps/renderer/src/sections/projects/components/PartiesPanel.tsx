/* م-٥٠ · «أطراف المشروع» — موردون ومقاولون مُسندون للمشروع بمبلغ لكلٍّ منهم (API-CONTRACT §٣).
   نفس الطرف قد يكون في عدة مشاريع بمبالغ مختلفة؛ هنا إسنادات هذا المشروع فقط.
   لا تحديث تفاؤلي: الحفظ يُرسل ثم يُعاد الجلب. الإجمالي = assignedTotal من الخادم + صف إجمالي DataTable. */
import { useEffect, useMemo, useState } from 'react';
import {
  Button, DataTable, Field, FormGrid, Island, Modal, Money, Pill, Seg, int, toast, useForm, type Column,
} from '@/ui';
import { usePartyMutations, usePartySearch } from '../hooks';
import { countsOf, excludeAssigned, isOverrun, toView, validateAmount, type PartyRowView } from '../logic/parties';
import { num, toDec } from '../logic/money';
import type { Dec, PartySearchHit, PartyType, ProjectKey, ProjectParty } from '../types';
import { paths, useNav } from '../nav';
import { ErrorBox } from './bits';

const TYPE_TXT: Record<PartyType, string> = { supplier: 'مورد', contractor: 'مقاول' };
const ATTR_TXT: Record<ProjectParty['attribution'], string> = {
  single: 'كل حركته على هذا المشروع', shared: 'مورد في عدة مشاريع — فواتيره لا تحمل مشروعاً، فلا نوزّعها تخميناً',
  entries: 'من قيود الدفتر الموسومة بهذا المشروع',
};
const dash = <span className="dash">—</span>;

export function PartiesPanel({ project, parties, assignedTotal, error, loading, onRetry, i }: {
  project: ProjectKey; parties: ProjectParty[] | undefined; assignedTotal: Dec | undefined;
  error: unknown; loading: boolean; onRetry: () => void; i?: number;
}) {
  const go = useNav();
  const { put, remove } = usePartyMutations(project);
  const [filter, setFilter] = useState<'all' | PartyType>('all');
  const [editing, setEditing] = useState<ProjectParty | 'new' | null>(null);

  const all = useMemo(() => parties ?? [], [parties]);
  const rows = useMemo(() => (filter === 'all' ? all : all.filter((p) => p.partyType === filter)).map(toView), [all, filter]);
  const c = countsOf(all);

  async function doRemove(p: ProjectParty) {
    await remove.mutateAsync({ t: p.partyType, partyId: p.partyId });
    toast(`أُزيل «${p.name}» من المشروع`, {
      kind: 'info',
      undo: () => { put.mutate({ t: p.partyType, partyId: p.partyId, body: { amount: p.amount, notes: p.notes } }); },
    });
  }

  const columns: Column<PartyRowView>[] = [
    { key: 'name', label: 'الطرف', required: true, searchValue: (r) => `${r.name} ${r.partyId}`,
      render: (r) => (<><b>{r.name}</b> <Pill tone="neutral">{TYPE_TXT[r.partyType]}</Pill>
        <span className="cap num"> {r.partyId}</span>
        {!r.linked && <div className="cap">له قيود على المشروع بلا إسناد صريح</div>}</>) },
    { key: 'amountN', label: 'المُسند', money: true, sortValue: (r) => r.amountN ?? -1,
      render: (r) => r.amountN == null ? <span className="cap">بلا مبلغ</span> : <Money value={r.amountN} /> },
    { key: 'executedN', label: 'المنفّذ (فواتير/مستخلصات)', money: true,
      render: (r) => r.executedN == null ? <span className="cap" title={ATTR_TXT[r.attribution]}>غير قابل للنسبة</span>
        : <Money value={r.executedN} className={isOverrun(r) ? 't-warn' : undefined} /> },
    { key: 'paidN', label: 'المدفوع', money: true, render: (r) => r.paidN == null ? dash : <Money value={r.paidN} /> },
    { key: 'openN', label: 'المفتوح', money: true, render: (r) => r.openN == null ? dash : <Money value={r.openN} /> },
    { key: 'overdueN', label: 'المتأخر', money: true,
      render: (r) => r.overdueN ? <Money value={r.overdueN} className="t-danger" /> : dash },
    { key: 'notes', label: 'ملاحظات', hidden: true, sort: false, render: (r) => r.notes || dash },
    { key: 'acts', label: '', sort: false, required: true, render: (r) => (
      <span className="sp-rowacts" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={() => setEditing(r)}>{r.linked ? 'تعديل' : 'إسناد'}</Button>
        {r.linked && <Button size="sm" kind="ghost" onClick={() => void doRemove(r)} aria-label={`إزالة ${r.name}`}>إزالة</Button>}
      </span>) },
  ];

  const status = (error as { status?: number } | null)?.status;
  return (
    <Island span={12} i={i} title="أطراف المشروع"
      actions={<Button size="sm" kind="primary" icon="users" onClick={() => setEditing('new')} disabled={!!error}>إضافة طرف</Button>}>
      {error ? (status === 404
        ? <p className="empty-note">إسناد الأطراف بمبالغ غير متاح في هذه النسخة من الخدمة بعد.</p>
        : <ErrorBox error={error} onRetry={onRetry} />) : (
        <>
          <div className="sp-ptop">
            <p className="cap">مجموع المُسند (من الخادم): <Money value={num(assignedTotal)} />
              {c.noAmount > 0 && <> · {int(c.noAmount)} طرف بلا مبلغ — خارج المجموع، لا يُحسب صفراً</>}
              {c.overrun > 0 && <> · <span className="t-warn">{int(c.overrun)} تجاوز منفّذه إسناده</span></>}
              {c.shared > 0 && <> · {int(c.shared)} مورد مشترك بين مشاريع</>}</p>
            <Seg label="نوع الطرف" value={filter} onChange={setFilter}
              options={[{ value: 'all', label: 'الكل' }, { value: 'supplier', label: 'الموردون' }, { value: 'contractor', label: 'المقاولون' }]} />
          </div>
          <DataTable<PartyRowView>
            id="projects.parties" rows={rows} rowKey="key" columns={columns}
            sort={{ key: 'amountN', dir: 'desc' }}
            total={{ keys: ['amountN', 'executedN', 'paidN', 'openN', 'overdueN'], label: 'إجمالي المعروض' }}
            onRowClick={(r) => go(r.partyType === 'supplier' ? paths.supplier(r.partyId) : paths.contractor(r.partyId))}
            empty={{ icon: 'users', title: loading ? 'جارٍ التحميل…' : 'لا أطراف مُسندة لهذا المشروع',
              body: 'أضف مورداً أو مقاولاً مع مبلغ إسناده على هذا المشروع.', cta: 'إضافة طرف', onCta: () => setEditing('new') }}
          />
          <p className="disclose">المُسند = ما اتُّفق عليه مع الطرف على هذا المشروع · المنفّذ = فواتير المورد (إن كان على هذا المشروع وحده)
            أو مستخلصات المقاول الموسومة بالمشروع · المفتوح = المنفّذ − المدفوع (من الخادم). «غير قابل للنسبة» = لا نوزّع تخميناً.</p>
        </>
      )}
      {editing && (
        <AssignModal existing={editing === 'new' ? null : editing} taken={all}
          onClose={() => setEditing(null)}
          onSave={async (h, body) => { await put.mutateAsync({ t: h.partyType, partyId: h.partyId, body }); }} />
      )}
    </Island>
  );
}

type Pick = { partyType: PartyType; partyId: string; name: string };

function AssignModal({ existing, taken, onClose, onSave }: {
  existing: ProjectParty | null; taken: ProjectParty[];
  onClose: () => void; onSave: (p: Pick, body: { amount: string | null; notes: string }) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<'all' | PartyType>('all');
  const [picked, setPicked] = useState<Pick | null>(existing);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(t); }, [query]);
  const search = usePartySearch(debounced, type === 'all' ? undefined : type, !existing);
  const results: PartySearchHit[] = useMemo(() => excludeAssigned(search.data ?? [], taken), [search.data, taken]);
  const form = useForm({ amount: num(existing?.amount ?? null), notes: existing?.notes ?? '' }, {
    amount: (v) => validateAmount(v == null ? null : Number(v)),
  });

  return (
    <Modal open onClose={onClose} size="md" title={existing ? `إسناد «${existing.name}» على هذا المشروع` : 'إضافة طرف للمشروع'}
      actions={[{ label: 'إلغاء' }, {
        label: 'حفظ', kind: 'primary', disabled: !picked, onClick: async (close) => {
          if (!picked || !form.validate()) return;
          await onSave(picked, { amount: toDec(form.values.amount), notes: form.values.notes.trim() });
          toast(existing?.linked ? 'حُدّث الإسناد' : `أُسند «${picked.name}» للمشروع`, { kind: 'ok' });
          close(true);
        },
      }]}>
      {!existing && (
        <div className="sp-picker">
          <div className="sp-ptop">
            <input type="search" className="sp-search" placeholder="ابحث باسم المورد/المقاول أو رقم الحساب/الكود…"
              aria-label="بحث عن طرف" value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); }} autoFocus />
            <Seg label="النوع" value={type} onChange={setType}
              options={[{ value: 'all', label: 'الكل' }, { value: 'supplier', label: 'مورد' }, { value: 'contractor', label: 'مقاول' }]} />
          </div>
          {picked ? (
            <p className="sp-picked"><b>{picked.name}</b> <Pill tone="neutral">{TYPE_TXT[picked.partyType]}</Pill>
              <span className="cap num">{picked.partyId}</span>
              <Button size="sm" kind="ghost" onClick={() => setPicked(null)}>تغيير</Button></p>
          ) : (
            <ul className="sp-results" aria-label="نتائج البحث">
              {search.isLoading && <li className="cap">جارٍ البحث…</li>}
              {search.error != null && <li className="sp-err">{String((search.error as Error)?.message ?? search.error)}</li>}
              {!search.isLoading && !search.error && results.length === 0 && <li className="cap">لا نتائج — أو الطرف مُسند لهذا المشروع أصلاً.</li>}
              {results.map((h) => (
                <li key={`${h.partyType}:${h.partyId}`}>
                  <button type="button" onClick={() => setPicked(h)}>
                    <b>{h.name}</b> <span className="cap">{TYPE_TXT[h.partyType]} · <span className="num">{h.account}</span>
                      {h.projects.length > 0 && <> · مشاريعه: {h.projects.join('، ')}</>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <FormGrid>
        <Field form={form} name="amount" label="مبلغ الإسناد على هذا المشروع" type="money"
          help="اتركه فارغاً إن لم يُتفق على مبلغ بعد — لن يُحسب صفراً" />
        <Field form={form} name="notes" label="ملاحظات" type="textarea" rows={2} full />
      </FormGrid>
    </Modal>
  );
}
