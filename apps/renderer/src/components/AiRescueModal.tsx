import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ContractorsResponse } from '@/lib/api';
import { ar, sar } from '@/lib/format';
import { Modal } from '@/components/Modal';

interface ExtractRow {
  date: string;
  debit: number;
  credit: number;
  description: string;
}

type Party = 'existing' | 'new';

/**
 * محاولة قراءة ملف تعذّرت قراءته العادية عبر الذكاء الاصطناعي — استخراج ثم
 * مراجعة كاملة قبل أي حفظ. لا شيء يُكتب في قاعدة البيانات قبل ضغط «حفظ».
 */
export function AiRescueModal({ path, fileName, onClose, onSaved }: {
  path: string;
  fileName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | undefined>();
  const [detectedName, setDetectedName] = useState<string | undefined>();
  const [rows, setRows] = useState<ExtractRow[]>([]);

  const [contractors, setContractors] = useState<ContractorsResponse['rows']>([]);
  const [party, setParty] = useState<Party>('new');
  const [existingCode, setExistingCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ code: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setErr(null);
    Promise.all([api.aiExtract(path), api.contractors()])
      .then(([extracted, list]) => {
        if (cancelled) return;
        setAccount(extracted.account ?? undefined);
        setDetectedName(extracted.name ?? undefined);
        setRows((extracted.rows ?? []).map((r: any) => ({
          date: r.date ?? '', debit: Number(r.debit) || 0,
          credit: Number(r.credit) || 0, description: r.description ?? '',
        })));
        setContractors(list.rows ?? []);
        setNewCode(extracted.account ?? '');
        setNewName(extracted.name ?? '');
      })
      .catch((e: any) => { if (!cancelled) setErr(e?.message ?? String(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [path]);

  function patchRow(i: number, upd: Partial<ExtractRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...upd } : r)));
  }

  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  const totalDebit = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
  const balance = totalDebit - totalCredit;

  const canSave = rows.length > 0
    && (party === 'existing' ? !!existingCode : (!!newCode.trim() && !!newName.trim()));

  async function save() {
    if (!canSave) return;
    setSaving(true); setSaveErr(null);
    try {
      const res = await api.aiCommitExtract({
        partyKind: 'contractor',
        ...(party === 'existing'
          ? { code: existingCode }
          : { newContractor: { code: newCode.trim(), name: newName.trim() } }),
        rows: rows.map((r) => ({
          date: r.date, debit: Number(r.debit) || 0,
          credit: Number(r.credit) || 0, description: r.description,
        })),
        sourceFile: path,
      });
      setSaved(res.contractor);
      onSaved();
    } catch (e: any) {
      setSaveErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="محاولة القراءة بالذكاء الاصطناعي" onClose={onClose} maxWidth={800}>
      <div className="stack">
        <div className="muted" style={{ fontSize: 12 }}>{fileName}</div>

        {busy && (
          <div className="state" aria-live="polite">
            جارٍ الاستخراج بالذكاء الاصطناعي… قد يستغرق ٣٠-٦٠ ثانية
          </div>
        )}

        {!busy && err && (
          <div className="callout bad" role="alert">{err}</div>
        )}

        {!busy && !err && saved && (
          <div className="callout ok">
            حُفظت {ar(rows.length)} حركة لحساب {saved.name} ({saved.code}) —
            تظهر الآن في «الملفات المرفوعة».
            <div style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={onClose}>إغلاق</button>
            </div>
          </div>
        )}

        {!busy && !err && !saved && (
          <>
            <div className="callout warn">
              هذه قراءة آلية — راجع كل صف قبل الحفظ؛ لن يُحفظ شيء قبل ضغطك حفظ
            </div>

            <div className="muted" style={{ fontSize: 12 }}>
              الحساب المكتشف: {account ?? '—'} · الاسم المكتشف: {detectedName ?? '—'}
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>التاريخ</th><th>مدين (ر.س)</th><th>دائن (ر.س)</th><th>الوصف</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input type="date" value={r.date}
                          onChange={(e) => patchRow(i, { date: e.target.value })} />
                      </td>
                      <td>
                        <input type="number" min={0} step="0.01" value={r.debit}
                          onChange={(e) => patchRow(i, { debit: Number(e.target.value) || 0 })} />
                      </td>
                      <td>
                        <input type="number" min={0} step="0.01" value={r.credit}
                          onChange={(e) => patchRow(i, { credit: Number(e.target.value) || 0 })} />
                      </td>
                      <td>
                        <input type="text" value={r.description}
                          onChange={(e) => patchRow(i, { description: e.target.value })} />
                      </td>
                      <td>
                        <button className="btn sm" aria-label="حذف السطر" onClick={() => removeRow(i)}>✗</button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="muted">لا سطور — احذف الملف أو أعد المحاولة</td></tr>
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="muted">الإجمالي</td>
                      <td className="num">{sar(totalDebit)}</td>
                      <td className="num">{sar(totalCredit)}</td>
                      <td colSpan={2} className="num">الرصيد: {sar(balance)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" checked={party === 'existing'}
                    onChange={() => setParty('existing')} />
                  مقاول موجود
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" checked={party === 'new'}
                    onChange={() => setParty('new')} />
                  مقاول جديد
                </label>
              </div>

              {party === 'existing' ? (
                <select value={existingCode} onChange={(e) => setExistingCode(e.target.value)}>
                  <option value="">اختر مقاولاً…</option>
                  {contractors.map((c: any) => (
                    <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                  ))}
                </select>
              ) : (
                <div style={{ display: 'flex', gap: 10 }}>
                  <input type="text" placeholder="الكود" value={newCode}
                    onChange={(e) => setNewCode(e.target.value)} style={{ flex: 1 }} />
                  <input type="text" placeholder="الاسم" value={newName}
                    onChange={(e) => setNewName(e.target.value)} style={{ flex: 2 }} />
                </div>
              )}
            </div>

            {saveErr && <div className="callout bad" role="alert">{saveErr}</div>}

            <div className="modal-foot">
              <button className="btn" onClick={onClose}>إلغاء</button>
              <button className="btn primary" onClick={save} disabled={!canSave || saving}>
                {saving ? 'جارٍ الحفظ…' : `حفظ ${ar(rows.length)} حركة`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
