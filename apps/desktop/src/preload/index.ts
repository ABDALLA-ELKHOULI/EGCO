/**
 * الجسر — the entire surface the UI can reach. Never expose ipcRenderer itself.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface PickedFile {
  path: string;
  name: string;
  source: 'pdf_statement' | 'suppliers_excel' | 'csv_statement' | 'debts_report_xls';
}

/** ما يصل بعد أن ماتت الخدمة الخلفية وأُعيد تشغيلها — العنوان الفعلي دائماً،
 * ونجحت المحاولة أو لا (وإن فشلت، نص الخطأ الحقيقي من الخدمة). */
export interface BackendRestartInfo {
  url: string;
  recovered: boolean;
  error?: string;
}

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'up-to-date'; version: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  | { state: 'unavailable-dev' };

contextBridge.exposeInMainWorld('egco', {
  backendUrl: (): Promise<string> => ipcRenderer.invoke('app:backendUrl'),
  info: () => ipcRenderer.invoke('app:info'),
  /** Returns the chosen file plus the type detected from its extension, or null. */
  pickFile: (): Promise<PickedFile | null> => ipcRenderer.invoke('dialog:pickFile'),
  /** Multi-select: returns every chosen file with its detected type, or []. */
  pickFiles: (): Promise<PickedFile[]> => ipcRenderer.invoke('dialog:pickFiles'),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),
  exportData: (): Promise<{ok: boolean; path?: string; error?: string; canceled?: boolean}> =>
    ipcRenderer.invoke('data:export'),
  importData: (): Promise<{ok: boolean; error?: string; canceled?: boolean}> =>
    ipcRenderer.invoke('data:import'),
  revealDataDir: (): Promise<string> => ipcRenderer.invoke('shell:revealDataDir'),
  /** حفظ الصفحة الحالية PDF عبر حوار حفظ أصلي — بديل window.print داخل التطبيق. */
  exportPdf: (opts: { filename: string; landscape?: boolean }):
    Promise<{ saved?: boolean; path?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('export:pdf', opts),
  /** يبدأ فحصاً يدوياً؛ الرد الفوري «جارٍ الفحص» فقط — النتيجة الحقيقية تصل عبر onUpdateStatus. */
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  /** يعيد تشغيل التطبيق لتثبيت تحديث سبق تنزيله. */
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  /** يستمع لحالة التحديث (فحص/توفر/تنزيل/اكتمال/خطأ) ويعيد دالة لإلغاء الاستماع. */
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: UpdateStatus) => cb(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  /** يستمع لإعادة تشغيل الخدمة الخلفية (نجحت أو فشلت) ويعيد دالة لإلغاء الاستماع. */
  onBackendRestarted: (cb: (info: BackendRestartInfo) => void): (() => void) => {
    const listener = (_e: unknown, info: BackendRestartInfo) => cb(info);
    ipcRenderer.on('app:backend-restarted', listener);
    return () => ipcRenderer.removeListener('app:backend-restarted', listener);
  },
});
