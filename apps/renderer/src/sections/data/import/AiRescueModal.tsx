/**
 * محاولة القراءة بالذكاء الاصطناعي (P-371) — استخراج ثم مراجعة كاملة قبل أي حفظ.
 * لا شيء يُكتب قبل «حفظ». الإجماليات هنا للمراجعة فقط (بالهللات، sumHalalas)؛ الرصيد
 * الذي يُعتمد يحسبه الخادم بعد الحفظ (commit-extract يعيد balance).
 */
import { useEffect, useState } from 'react';
import { Modal, Money, Num, Seg, sumHalalas, usePrefs } from '@/ui';
import { dataApi, errMsg } from '../api';
import { Callout } from './parts';
import type { ExtractRow } from '../types';

type Party = 'existing' | 'new';

export function AiRescueModal({ path, fileName, onClose, onSaved }: {
  path: string; fileName: string; onClose: () => void; onSaved: () => void;
}) {
  usePrefs();
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [detectedName, setDetectedName] = useState<string | null>(null);
  const [rows, setRows] = useState<ExtractRow[]>([]);
  const [contractors, setContractors] = useState<{ code: string; name: string }[]>([]);
  const [party, setParty] = useState<Party>('new');
  const [existingCode, setExistingCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ code: string; name: string; added: number } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([dataApi.aiExtract(path), dataApi.contractors()])
      .then(([x, list]) => {
        if (!alive) return;
        setAccount(x.account ?? null); setDetectedName(x.name ?? null);
        setRows((x.rows ?? []).map((r) => ({
          date: r.date ?? '', debit: Number(r.debit) || 0, credit: Number(r.credit) || 0, description: r.description ?? '',
        })));
        setContractors((list.rows ?? []).map((c) => ({ code: String(c.code), name: String(c.name) })));
        setNewCode(x.account ?? ''); setNewName(x.name ?? '');
      })
      .catch((e: unknown) => { if (alive) setErr(errMsg(e)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [path]);

  const patch = (i: number, u: Partial<ExtractRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...u } : r)));
  const debit = sumHalalas(rows, (r) => r.debit);
  const credit = sumHalalas(rows, (r) => r.credit);
  const canSave = rows.length > 0 && (party === 'existing' ? !!existingCode : !!newCode.trim() && !!newName.trim());

  async function save(close: (force?: boolean) => void) {
    if (saved) { close(true); return; }
    if (!canSave) return;
    setSaveErr(null);
    try {
      const res = await dataApi.aiCommitExtract({
        partyKind: 'contractor',
        ...(party === 'existing' ? { code: existingCode } : { newContractor: { code: newCode.trim(), name: newName.trim() } }),
        rows, sourceFile: path,
      });
      setSaved({ ...res.contractor, added: res.added });
      onSaved();
    } catch (e) { setSaveErr(errMsg(e)); }
  }

  return (
    <Modal open onClose={onClose} title="محاولة القراءة بالذكاء الاصطناعي" size="lg"
      actions={saved ? [{ label: 'إغلاق', kind: 'primary', onClick: (c) => c(true) }] : [
        { label: 'إلغاء' },
        { label: `حفظ ${rows.length} حركة`, kind: 'primary', onClick: save, disabled: busy || !!err || !canSave },
      ]}>
      <div className="sec-data stack">
        <div className="cap">{fileName}</div>
        {busy && <p className="cap" aria-live="polite"><span className="spin" aria-hidden="true" /> جارٍ الاستخراج بالذكاء الاصطناعي… قد يستغرق ٣٠–٦٠ ثانية</p>}
        {!busy && err && <Callout tone="bad">{err}</Callout>}
        {saved && (
          <Callout tone="ok">حُفظت <Num value={saved.added} int /> حركة لحساب {saved.name} (<span className="num ltr">{saved.code}</span>) — تظهر الآن في «سجل الاستيراد».</Callout>
        )}
        {!busy && !err && !saved && (
          <>
            <Callout tone="warn">هذه قراءة آلية — راجع كل صف قبل الحفظ؛ لن يُحفظ شيء قبل ضغطك «حفظ».</Callout>
            <p className="cap">الحساب المكتشف: <span className="num ltr">{account ?? '—'}</span> · الاسم المكتشف: {detectedName ?? '—'}</p>
            <div className="tbl-wrap">
              <table className="rx">
                <thead><tr><th>التاريخ</th><th className="n">مدين (ر.س)</th><th className="n">دائن (ر.س)</th><th>الوصف</th><th /></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><input type="date" aria-label="التاريخ" value={r.date} onChange={(e) => patch(i, { date: e.target.value })} /></td>
                      <td><input type="number" aria-label="مدين" min={0} step="0.01" dir="ltr" value={r.debit} onChange={(e) => patch(i, { debit: Number(e.target.value) || 0 })} /></td>
                      <td><input type="number" aria-label="دائن" min={0} step="0.01" dir="ltr" value={r.credit} onChange={(e) => patch(i, { credit: Number(e.target.value) || 0 })} /></td>
                      <td><input type="text" aria-label="الوصف" value={r.description} onChange={(e) => patch(i, { description: e.target.value })} /></td>
                      <td><button type="button" className="btn sm ghost" aria-label="حذف السطر" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>حذف</button></td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={5} className="cap">لا سطور — أغلق النافذة أو أعد المحاولة</td></tr>}
                </tbody>
                {rows.length > 0 && (
                  <tfoot><tr>
                    <td className="cap">الإجمالي (للمراجعة)</td>
                    <td className="n"><Money value={debit} noCur /></td>
                    <td className="n"><Money value={credit} noCur /></td>
                    <td colSpan={2} className="cap">الرصيد يحسبه الخادم بعد الحفظ</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
            <Seg<Party> label="الطرف" value={party} onChange={setParty}
              options={[{ value: 'existing', label: 'مقاول موجود' }, { value: 'new', label: 'مقاول جديد' }]} />
            {party === 'existing' ? (
              <label className="fld"><span className="cap">المقاول</span>
                <select value={existingCode} onChange={(e) => setExistingCode(e.target.value)}>
                  <option value="">اختر مقاولاً…</option>
                  {contractors.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                </select>
              </label>
            ) : (
              <div className="fgrid">
                <label className="fld"><span className="cap">الكود</span><input dir="ltr" value={newCode} onChange={(e) => setNewCode(e.target.value)} /></label>
                <label className="fld"><span className="cap">الاسم</span><input value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
              </div>
            )}
            {saveErr && <Callout tone="bad">{saveErr}</Callout>}
          </>
        )}
      </div>
    </Modal>
  );
}
