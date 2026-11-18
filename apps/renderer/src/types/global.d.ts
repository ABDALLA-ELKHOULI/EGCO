export {};

export interface PickedFile {
  path: string;
  name: string;
  source: 'pdf_statement' | 'suppliers_excel' | 'csv_statement' | 'debts_report_xls'
    | 'contractors_balance_xls' | 'budget_deviation' | 'budget_plan'
    // م-٢١ — نوع لا يعرفه الخادم بعد كل هذا التحقّق: تُعرض بحالة «غير مدعوم» بدل
    // أن تختفي من الطابور بصمت (انظر Import.tsx: isUnsupportedSource).
    | 'unsupported';
}

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

export interface TitleBarInsets {
  platform: string;
  /** ارتفاع شريط العنوان/السحب (44). */
  height: number;
  /** بكسلات محجوزة لأزرار النظام من الحافة الفيزيائية اليسرى/اليمنى (لا تنعكس مع RTL). */
  left: number;
  right: number;
  fullScreen: boolean;
}

export interface OsNotifyPayload {
  title: string;
  body?: string;
  severity?: 'info' | 'success' | 'warning' | 'danger';
  link?: string;
  kind?: string;
}

export type OsNotifyResult =
  | { shown: true }
  | { shown: false; reason: 'focused' | 'rate-limited' | 'unsupported' | 'invalid' };

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
      // النسخ الاحتياطي (م-٤٥)
      revealBackupsDir(): Promise<string>;
      pickExternalBackupDir(): Promise<string | null>;
      restoreBackup(name: string): Promise<{ ok: boolean; error?: string; canceled?: boolean }>;
      exportPdf(opts: { filename: string; landscape?: boolean }):
        Promise<{ saved?: boolean; path?: string; canceled?: boolean; error?: string }>;
      checkForUpdates(): Promise<UpdateStatus>;
      installUpdate(): Promise<void>;
      supportCapture?(): Promise<string | null>;
      supportDiagnostics?(): Promise<Record<string, unknown>>;
      supportSubmit?(r: { description: string; screen: string;
                          diagnostics: Record<string, unknown>; screenshotJpegBase64?: string }):
        Promise<{ state: 'sent' | 'queued' | 'local-only'; issueNumber?: number;
                  issueUrl?: string; message?: string }>;
      onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
      onBackendRestarted(cb: (info: BackendRestartInfo) => void): () => void;
      // شريط العنوان المخصّص
      platform: string;
      titleBarInsets(): Promise<TitleBarInsets>;
      onTitleBarInsets(cb: (i: TitleBarInsets) => void): () => void;
      setTheme(theme: 'light' | 'dark'): Promise<void>;
      isFocused(): Promise<boolean>;
      onFocusChange(cb: (focused: boolean) => void): () => void;
      // الإشعارات والشارة
      notifyOs(p: OsNotifyPayload): Promise<OsNotifyResult>;
      onNotificationClicked(cb: (d: { link: string | null; kind: string }) => void): () => void;
      setBadge(count: number): Promise<void>;
    };
  }
}
