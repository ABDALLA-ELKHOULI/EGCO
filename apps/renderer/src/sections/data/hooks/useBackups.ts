/**
 * النسخ الاحتياطي (م-٤٥): القائمة، النسخة اليومية عند الفتح، يدوية، استعادة عبر
 * الجسر (تأخذ «قبل الاستعادة» ثم تعيد التشغيل)، حذف، ومجلد خارجي.
 */
import { useCallback, useEffect, useState } from 'react';
import { dataApi } from '../api';
import { fmtSize } from '../lib/labels';
import { useAction, useAsync } from './useAsync';
import type { BackupInfo } from '../types';

export function useBackups() {
  // اليومية أولاً ثم القائمة — كي تظهر النسخة التي أُخذت للتو.
  const [dailyChecked, setDailyChecked] = useState(false);
  const act = useAction();
  useEffect(() => {
    dataApi.backupDailyIfDue()
      .then((r) => { if (r.taken && r.backup?.warning) act.setNote({ ok: false, text: r.backup.warning }); })
      .catch(() => undefined)
      .finally(() => setDailyChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useAsync(() => dataApi.backups(), [], { enabled: dailyChecked });
  const ext = useAsync(() => dataApi.backupSettings(), []);
  const [externalDir, setExternalDir] = useState<string | null>(null);
  useEffect(() => { if (ext.data) setExternalDir(ext.data.externalDir); }, [ext.data]);

  const items = list.data?.items;
  const lastDaily = items?.find((b) => b.kind === 'daily') ?? null;

  const backupNow = useCallback(() => act.run('now', async () => {
    const r = await dataApi.createBackup();
    list.refetch();
    return r.backup.warning
      ? { ok: false, text: `أُخذت النسخة محلياً، لكن: ${r.backup.warning}` }
      : { ok: true, text: `أُخذت نسخة: ${r.backup.name} (${fmtSize(r.backup.size_bytes)})` };
  }), [act, list]);

  /** الاستعادة تعيد تشغيل التطبيق عند النجاح — لا رسالة نجاح تُرى. */
  const restore = useCallback((b: BackupInfo) => act.run(`restore:${b.name}`, async () => {
    if (!window.egco) return;
    const r = await window.egco.restoreBackup(b.name);
    if (!r.canceled && !r.ok) return { ok: false, text: r.error ?? 'تعذّرت الاستعادة' };
  }), [act]);

  /** التأكيد في الواجهة (Modal بحارس) قبل الاستدعاء — لا window.confirm. */
  const remove = useCallback((b: BackupInfo) => act.run(`del:${b.name}`, async () => {
    await dataApi.deleteBackup(b.name);
    list.refetch();
  }), [act, list]);

  const pickExternal = useCallback(() => act.run('ext', async () => {
    const dir = await window.egco?.pickExternalBackupDir();
    if (!dir) return;
    const r = await dataApi.saveBackupSettings(dir);
    setExternalDir(r.externalDir);
    return { ok: true, text: 'ستُنسخ كل نسخة قادمة إلى المجلد الخارجي أيضاً' };
  }), [act]);

  const clearExternal = useCallback(() => act.run('ext', async () => {
    const r = await dataApi.saveBackupSettings(null);
    setExternalDir(r.externalDir);
  }), [act]);

  return {
    items, lastDaily, error: list.error, isLoading: !dailyChecked || list.isLoading, refetch: list.refetch,
    externalDir, busy: act.busy, note: act.note,
    backupNow, restore, remove, pickExternal, clearExternal,
    revealDir: () => window.egco?.revealBackupsDir(),
  };
}
