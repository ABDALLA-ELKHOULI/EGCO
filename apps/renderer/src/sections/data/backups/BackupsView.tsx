/**
 * النسخ الاحتياطي (م-٤٥، P-333..340) — كل النسخ، «نسخة الآن»، استعادة وحذف بتأكيد،
 * ومجلد خارجي (iCloud/Drive). الاستعادة عبر الجسر: نسخة «قبل الاستعادة» ثم إعادة تشغيل.
 */
import { Button, DataTable, Grid, Island, PageHeader, Pill, ago, confirm, dateTxt, toast, usePrefs, type Column } from '@/ui';
import { useEffect } from 'react';
import { useBackups } from '../hooks/useBackups';
import { inApp } from '../hooks/useAsync';
import { backupKindLabel, fmtSize, NOT_IN_APP } from '../lib/labels';
import { Callout } from '../import/parts';
import type { BackupInfo } from '../types';
import '../data.css';

export default function BackupsView() {
  usePrefs();
  const b = useBackups();
  const app = inApp();
  useEffect(() => { if (b.note) toast(b.note.text, { kind: b.note.ok ? 'ok' : 'error' }); }, [b.note]);

  async function askRestore(x: BackupInfo) {
    const ok = await confirm({
      title: `استعادة نسخة ${dateTxt(x.created_at)}`, confirmLabel: 'استعادة',
      body: <>ستُستبدل بياناتك الحالية بهذه النسخة ({backupKindLabel(x.kind)}، {ago(x.created_at)}). قبل الاستعادة نأخذ تلقائياً نسخة «قبل الاستعادة» من وضعك الحالي، ثم يُعاد تشغيل التطبيق.</>,
    });
    if (ok) void b.restore(x);
  }
  async function askDelete(x: BackupInfo) {
    const ok = await confirm({
      title: 'حذف النسخة الاحتياطية', danger: true, confirmLabel: 'حذف نهائياً',
      body: <>ستُحذف نسخة {dateTxt(x.created_at)} ({backupKindLabel(x.kind)}) نهائياً من القرص. <b>لا يمكن التراجع عن هذا.</b></>,
    });
    if (ok) void b.remove(x);
  }

  const columns: Column<BackupInfo>[] = [
    { key: 'created_at', label: 'التاريخ', required: true, value: (x) => x.created_at,
      render: (x) => <span title={x.name}>{dateTxt(x.created_at, { weekday: true })} <span className="cap num">{new Date(x.created_at).toTimeString().slice(0, 5)}</span><div className="cap">{ago(x.created_at)}</div></span> },
    { key: 'kind', label: 'النوع', render: (x) => <Pill tone={x.kind === 'daily' || x.kind === 'manual' ? 'ok' : 'neutral'}>{backupKindLabel(x.kind)}</Pill> },
    { key: 'size_bytes', label: 'الحجم', num: true, render: (x) => <span className="num">{fmtSize(x.size_bytes)}</span> },
    { key: '_a', label: '', sort: false, required: true, render: (x) => (
      <span className="rowacts tight">
        <Button size="sm" disabled={!app || b.busy !== null} onClick={(e) => { e.stopPropagation(); void askRestore(x); }}>{b.busy === `restore:${x.name}` ? '…' : 'استعادة'}</Button>
        <Button size="sm" kind="danger" disabled={b.busy !== null} onClick={(e) => { e.stopPropagation(); void askDelete(x); }}>{b.busy === `del:${x.name}` ? '…' : 'حذف'}</Button>
      </span>
    ) },
  ];

  return (
    <div className="sec-data">
      <PageHeader title="النسخ الاحتياطي"
        sub="نسخة يومية تلقائية عند أول فتح كل يوم، ونسخ قبل كل تحديث واستيراد واستعادة وتصفير"
        actions={<>
          <Button disabled={!app} onClick={() => void b.revealDir()}>فتح المجلد</Button>
          <Button kind="primary" data-testid="backup-now" disabled={b.busy !== null} onClick={() => void b.backupNow()}>{b.busy === 'now' ? 'جارٍ أخذ النسخة…' : 'نسخة الآن'}</Button>
        </>} />
      <Grid>
        <Island span={8} i={0} title="كل النسخ الاحتياطية السابقة"
          actions={<span className="cap">{b.lastDaily ? <>آخر نسخة يومية: {ago(b.lastDaily.created_at)}</> : 'لم تُؤخذ نسخة يومية بعد'}</span>}>
          {b.error && <Callout tone="bad">{b.error} <Button size="sm" onClick={b.refetch}>إعادة المحاولة</Button></Callout>}
          {b.items && (
            <DataTable<BackupInfo> id="data.backups" rows={b.items} rowKey="name" columns={columns} search={false}
              sort={{ key: 'created_at', dir: 'desc' }}
              empty={{ icon: 'db', title: 'لا توجد نسخ بعد', body: 'اضغط «نسخة الآن».', cta: 'نسخة الآن', onCta: () => void b.backupNow() }} />
          )}
          <p className="disclose">يُحتفظ بآخر ٣٠ نسخة يومية و٢٠ يدوية و١٠ قبل التحديث و١٠ قبل الاستيراد و٥ قبل الاستعادة و١٠ قبل التصفير؛ الأقدم يُحذف تلقائياً.</p>
          {!app && <Callout>الاستعادة وفتح المجلد {NOT_IN_APP}</Callout>}
        </Island>
        <Island span={4} i={1} title="مجلد خارجي — اختياري">
          <p className="cap">iCloud أو Google Drive أو قرص خارجي — تُنسخ إليه كل نسخة قادمة أيضاً فتنجو بياناتك إن تعطّل الجهاز.</p>
          <label className="fld"><span className="cap">المسار</span>
            <input dir="ltr" readOnly value={b.externalDir ?? ''} placeholder="غير مضبوط — النسخ على هذا الجهاز فقط" /></label>
          <div className="rowacts">
            <Button size="sm" disabled={!app || b.busy !== null} onClick={() => void b.pickExternal()}>اختيار…</Button>
            {b.externalDir && <Button size="sm" disabled={b.busy !== null} onClick={() => void b.clearExternal()}>إزالة</Button>}
          </div>
          <p className="cap">{b.externalDir ? 'ستُنسخ كل نسخة قادمة إلى المجلد الخارجي أيضاً' : 'غير مضبوط — النسخ على هذا الجهاز فقط'}</p>
        </Island>
      </Grid>
    </div>
  );
}
