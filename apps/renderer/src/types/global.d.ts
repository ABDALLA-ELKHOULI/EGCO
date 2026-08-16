export {};

export interface PickedFile {
  path: string;
  name: string;
  source: 'pdf_statement' | 'suppliers_excel' | 'csv_statement';
}

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'up-to-date'; version: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  | { state: 'unavailable-dev' };

declare global {
  interface Window {
    egco?: {
      backendUrl(): Promise<string>;
      info(): Promise<{ version: string; platform: string; dataDir: string }>;
      pickFile(): Promise<PickedFile | null>;
      pickFiles(): Promise<PickedFile[]>;
      pickDirectory(): Promise<string | null>;
      exportData(): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
      importData(): Promise<{ ok: boolean; error?: string; canceled?: boolean }>;
      revealDataDir(): Promise<string>;
      exportPdf(opts: { filename: string; landscape?: boolean }):
        Promise<{ saved?: boolean; path?: string; canceled?: boolean; error?: string }>;
      checkForUpdates(): Promise<UpdateStatus>;
      installUpdate(): Promise<void>;
      onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
    };
  }
}
