/**
 * الجسر — the entire surface the UI can reach. Never expose ipcRenderer itself.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface PickedFile {
  path: string;
  name: string;
  source: 'pdf_statement' | 'suppliers_excel' | 'csv_statement';
}

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
});
