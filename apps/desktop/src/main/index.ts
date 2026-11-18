/**
 * العملية الرئيسية — النوافذ وصلاحيات النظام فقط.
 *
 * The renderer stays sandboxed: contextIsolation on, nodeIntegration off. Every OS
 * capability it needs is a single narrow function in the preload bridge.
 */
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { backendErrorTail, backendUrl, onBackendRestart, startBackend, stopBackend } from './backend';
import { captureWindow, flushQueue, submitReport, systemDiagnostics, type SupportReport } from './support';
import { applyTheme, canvasColor, ThemeName, titleBarInsets, titleBarOptions } from './chrome';
import { OsNotifyPayload, setBadge, showOsNotification } from './notify';
import { loadWindowState, MIN_HEIGHT, MIN_WIDTH, trackWindowState } from './windowState';

let win: BrowserWindow | null = null;

/**
 * حالة التحديث المرسلة للواجهة — نفس الشكل يُستخدم للفحص التلقائي والفحص اليدوي،
 * لكن الفحص التلقائي عند الإقلاع لا يعرض شيئاً إن لم تكن شاشة الإعدادات مفتوحة
 * لتستمع له؛ الفحص اليدوي هو ما يجعل هذه الحالة مرئية للمستخدم.
 */
type UpdateStatus =
  | { state: 'checking' }
  | { state: 'up-to-date'; version: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  | { state: 'unavailable-dev' };

function sendUpdateStatus(status: UpdateStatus) {
  win?.webContents.send('update:status', status);
}

/**
 * حدث نظام للخادم (مركز الإشعارات) — المسار يبنيه وكيل الخادم؛ غيابه (404) أو
 * تعذّر الاتصال لا يُعدّ خطأً. يُرسل مرة واحدة لكل (حالة، إصدار).
 */
const postedUpdateEvents = new Set<string>();
async function postSystemEvent(key: string, title: string, detail: string): Promise<void> {
  if (postedUpdateEvents.has(key)) return;
  postedUpdateEvents.add(key);
  try {
    await fetch(`${backendUrl()}/api/v1/events/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'update', severity: 'info', title, detail }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* الخدمة غير متاحة — غير حرج */ }
}

/**
 * نسخة احتياطية قبل التحديث — تُؤخذ لحظة اكتمال التنزيل لا لحظة التثبيت.
 *
 * التثبيت له ثلاثة طرق: زر «تحديث الآن»، وزر «إعادة التشغيل» في الإعدادات،
 * و autoInstallOnAppQuit الذي يثبّت عند إغلاق التطبيق بلا أن يضغط المستخدم شيئاً.
 * الربط باكتمال التنزيل يغطّي الثلاثة بنقطة واحدة: ما إن ينزل التحديث حتى يصير
 * تثبيته حتمياً.
 *
 * الفشل هنا لا يوقف التحديث ولا يُظهر خطأً: التحديث نفسه لا يمسّ قاعدة البيانات
 * (ملف منفصل عن التطبيق)، والنسخة احتياطٌ لِما قد تفعله هجرات المخطَّط في الإصدار
 * الجديد. تعطيل تحديثٍ سليم بسبب تعذُّر النسخ ضررٌ أكبر من نفعه.
 */
function backupBeforeUpdate(version: string): void {
  try {
    const src = dbPath();
    if (!fs.existsSync(src)) return;
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(src, path.join(dir, `before-update-${version}-${stamp}.db`));
    pruneBackups(dir, 'before-update-', 10);
  } catch (e) {
    console.error('[update] تعذّرت النسخة الاحتياطية قبل التحديث:', e);
  }
}

/**
 * يُبقي آخر `keep` نسخة بالبادئة المعطاة — القاعدة تُقاس بالميغابايتات وتتراكم بلا سقف.
 * م-١٣: كانت مقصورة على `before-update-`، فتراكمت نسخ `before-import-*` بلا حدّ؛
 * الآن البادئة معامل، والأسقف نفسها التي يطبّقها الخادم (backup_service.KEEP).
 */
function pruneBackups(dir: string, prefix: string, keep: number): void {
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.db'))
    .sort();                      // الطابع الزمني ISO يجعل الترتيب الأبجدي زمنياً
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* نسخة عالقة لا تستحق تعطيل شيء */ }
  }
}

let updaterPromise: Promise<import('electron-updater').AppUpdater> | null = null;

/**
 * تهيئة واحدة يُعاد استخدامها للفحص التلقائي عند الإقلاع وللفحص اليدوي من الإعدادات —
 * حتى لا نسجّل نفس المستمعين مرتين ولا نفقد حالة electron-updater الداخلية.
 */
async function getAutoUpdater() {
  if (!updaterPromise) {
    updaterPromise = (async () => {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.autoDownload = true;
      // م-١٢ — كانت `true` هنا، فـ«لاحقاً» في حوار التحديث لا تمنع شيئاً فعلياً:
      // أول إغلاق عادي للتطبيق (لا `quitAndInstall` الصريح) يُثبّت التحديث صامتاً،
      // وغالباً هذا يحدث آخر الدوام والمستخدم غائب. الزر وعد بشيء ولم يفِ به.
      // `false` تجعل الإغلاق العادي لا يُثبّت شيئاً أبداً — التثبيت يحدث فقط حين
      // يضغط المستخدم صراحة («تحديث الآن» هنا أو «إعادة التشغيل» من الإعدادات)،
      // وكلاهما يستدعي `quitAndInstall()` مباشرة بلا حاجة لهذا العلم إطلاقاً.
      // لا يُلغي هذا النشر التلقائي نفسه: `autoDownload` يبقى `true`، والفحص
      // التلقائي (`setupAutoUpdate`) يعيد السؤال في كل إقلاع تالٍ — فالتحديث
      // المؤجَّل يُعرض على المستخدم من جديد بدل أن يُثبَّت بلا علمه أو يُنسى.
      autoUpdater.autoInstallOnAppQuit = false;

      autoUpdater.on('update-available', (info) => {
        sendUpdateStatus({ state: 'available', version: info.version });
        void postSystemEvent(`available-${info.version}`, `يتوفر إصدار جديد ${info.version}`,
          'يجري تنزيل التحديث في الخلفية.');
      });
      autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ state: 'up-to-date', version: info.version }));
      autoUpdater.on('download-progress', (p) => sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));

      // الفحص التلقائي عند الإقلاع كان يبتلع الخطأ بصمت — لا إنترنت يعني ببساطة لا
      // تحديث اليوم. هذا يبقى صحيحاً هنا؛ الفحص اليدوي أدناه هو من يُظهر الخطأ الحقيقي.
      autoUpdater.on('error', (err) => sendUpdateStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      }));

      autoUpdater.on('update-downloaded', async (info) => {
        backupBeforeUpdate(info.version);
        sendUpdateStatus({ state: 'downloaded', version: info.version });
        void postSystemEvent(`downloaded-${info.version}`, `التحديث ${info.version} جاهز للتثبيت`,
          'أُخذت نسخة احتياطية من البيانات قبل التثبيت. أعد التشغيل لتطبيق التحديث.');
        if (!win) return;
        const { response } = await dialog.showMessageBox(win, {
          type: 'info',
          title: 'تحديث جديد',
          message: `يتوفر إصدار جديد (${info.version}) من لوحة إعمار الخليج`,
          detail: 'تم تنزيل التحديث. بياناتك تبقى كما هي — التحديث يبدّل التطبيق فقط، '
                + 'وأُخذت نسخة احتياطية منها قبل التثبيت.',
          buttons: ['تحديث الآن وإعادة التشغيل', 'لاحقاً'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 0) autoUpdater.quitAndInstall();
      });

      return autoUpdater;
    })();
  }
  return updaterPromise;
}

/**
 * التحديث عن بُعد — يفحص إصدارات GitHub عند كل تشغيل.
 *
 * electron-updater only runs in the packaged app (dev builds skip it). The feed
 * comes from electron-builder.yml's publish block. Update flow is deliberately
 * ask-first: download happens in the background, but installation waits for the
 * user's yes — a finance app must never restart itself mid-work.
 */
async function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    const autoUpdater = await getAutoUpdater();
    await autoUpdater.checkForUpdates();
  } catch {
    /* updater unavailable (unpacked build) or check failed — non-intrusive by design */
  }
}

async function createWindow() {
  const saved = loadWindowState();
  win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(typeof saved.x === 'number' && typeof saved.y === 'number' ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: canvasColor(),   // يطابق السمة — لا وميض أبيض
    ...titleBarOptions(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (saved.maximized) win.maximize();
  if (saved.fullScreen) win.setFullScreen(true);
  trackWindowState(win);

  const sendInsets = () => win?.webContents.send('window:insets', titleBarInsets(win));
  win.on('enter-full-screen', sendInsets);
  win.on('leave-full-screen', sendInsets);
  win.on('focus', () => win?.webContents.send('window:focus', true));
  win.on('blur', () => win?.webContents.send('window:focus', false));
  win.on('closed', () => { win = null; });

  win.once('ready-to-show', () => win?.show());

  if (!app.isPackaged) {
    await win.loadURL('http://localhost:5173');
  } else {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * نسخة واحدة فقط — نسختان تفتحان خدمتين على نفس ملف القاعدة، فتظهر أخطاء
 * «database is locked» خاماً بلا ترجمة، وقد تتضارب كتابتان على نفس الحركة.
 */
// في التطوير: ملف تعريف منفصل حتى لا يصطدم بقفل النسخة المثبّتة ولا يلمس بياناتها
if (!app.isPackaged && process.env.EGCO_DATA_DIR) app.setPath('userData', process.env.EGCO_DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(async () => {
  // بلاغات حُفظت حين لم يكن هناك اتصال — تُرسل بصمت عند الإقلاع
  setTimeout(() => { void flushQueue(); }, 15000);
  /**
   * التنزيلات (تصدير Excel مثلاً) — حوار حفظ دائماً بالاسم العربي الصحيح.
   *
   * From the packaged file:// renderer a bare <a download> is unreliable on Windows;
   * routing every download through the native save dialog makes it explicit, then the
   * saved file is revealed in Explorer/Finder.
   */
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
    item.on('done', (_ev, state) => {
      if (state === 'completed') shell.showItemInFolder(item.getSavePath());
    });
  });

  /**
   * إن ماتت الخدمة أثناء الجلسة وأعادت نفسها (ربما على منفذ مختلف)، الواجهة
   * كانت تخزّن العنوان القديم مرة واحدة عند الإقلاع ولا تعيد سؤاله أبداً — فتظل
   * كل الطلبات تفشل بصمت على منفذ مُغلق. هذا يدفع العنوان الفعلي لها دائماً،
   * نجحت إعادة التشغيل أو فشلت، فلا تُترك عالقة على عنوان ميت.
   */
  onBackendRestart((info) => {
    win?.webContents.send('app:backend-restarted', info);
  });

  try {
    await startBackend();
  } catch (e) {
    // السبب الحقيقي يُعرض، لا «لم تستجب» وحدها: المستخدم على جهازه بلا دعم تقني،
    // و«database is locked» أو «Permission denied» يقول له ما يفعله بالضبط.
    const tail = backendErrorTail();
    dialog.showErrorBox('تعذّر تشغيل الخدمة',
      String(e) + (tail ? `\n\nتفاصيل من الخدمة:\n${tail}` : ''));
    app.quit();
    return;
  }
  await createWindow();
  setupAutoUpdate();   // non-blocking: the window is already up
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', stopBackend);

/* ---------------------------------------------------------------- IPC */

ipcMain.handle('app:backendUrl', () => backendUrl());

// ---- بلاغات الدعم (support.ts) ----
/** لقطة نافذة التطبيق — الواجهة تموّه المبالغ والأسماء قبل الطلب وتعيدها بعده. */
ipcMain.handle('support:capture', async () => (win ? captureWindow(win) : null));
/** معلومات تقنية تُرفق بالبلاغ: الإصدار والنظام وآخر أخطاء الخدمة الخلفية. */
ipcMain.handle('support:diagnostics', () => ({
  ...systemDiagnostics(),
  'آخر أخطاء الخدمة': backendErrorTail() || '—',
}));
ipcMain.handle('support:submit', (_e, report: SupportReport) => submitReport(report));

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dataDir: app.getPath('userData'),
}));

/**
 * فحص تحديث يدوي — بخلاف الفحص التلقائي الصامت عند الإقلاع، هذا يُعيد الحالة
 * الحقيقية دائماً (بما فيها الخطأ الفعلي) لأن المستخدم ضغط زراً وينتظر جواباً،
 * لا صمتاً قد يُقرأ خطأً على أنه «كل شيء محدَّث».
 */
ipcMain.handle('update:check', async (): Promise<UpdateStatus> => {
  if (!app.isPackaged) return { state: 'unavailable-dev' };
  try {
    const autoUpdater = await getAutoUpdater();
    sendUpdateStatus({ state: 'checking' });
    await autoUpdater.checkForUpdates();
    // النتيجة الفعلية (متوفر/محدَّث/خطأ) تصل عبر أحداث update:status أعلاه.
    return { state: 'checking' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sendUpdateStatus({ state: 'error', message });
    return { state: 'error', message };
  }
});

/** تثبيت فوري بعد أن ينزّل التطبيق التحديث ويضغط المستخدم زر «إعادة التشغيل الآن». */
ipcMain.handle('update:install', async () => {
  if (!app.isPackaged) return;
  const autoUpdater = await getAutoUpdater();
  autoUpdater.quitAndInstall();
});

/**
 * اختيار الملف يتم هنا حتى لا تحتاج الواجهة صلاحية على نظام الملفات.
 *
 * One picker for every supported file. Filtering by a type the user chose beforehand
 * greyed out the file they actually wanted, which read as "the upload is broken" —
 * so the dialog now shows all supported files and the type is detected from the
 * extension instead of being asked for up front.
 */
const PICK_FILTERS = [
  // ‏xls مُدرج: تقرير المديونيات المجمّع يصدر من النظام المحاسبي بصيغة Excel
  // القديمة (BIFF 97-2003). بدونه لا يستطيع المستخدم اختيار الملف أصلاً، مهما
  // كان الخادم قادراً على قراءته.
  { name: 'كل الملفات المدعومة', extensions: ['pdf', 'xlsx', 'xlsm', 'xls', 'csv'] },
  { name: 'كشف حساب PDF', extensions: ['pdf'] },
  { name: 'Excel', extensions: ['xlsx', 'xlsm', 'xls'] },
  { name: 'CSV', extensions: ['csv'] },
  { name: 'كل الملفات', extensions: ['*'] },
];

/**
 * يميّز صيغتَي xls القديمتين بلا مكتبة قراءة BIFF (لا توجد واحدة في هذا التطبيق):
 * اسم الورقة الأولى، أو أي نص فيها، يبحث عنه كنص UTF-16LE خام في بايتات الملف —
 * صيغة BIFF تخزّن النصوص العربية عادة بهذا الترميز، وBuffer.includes يبحث في
 * البايتات بلا اعتبار لمحاذاة الإزاحة، فلا حاجة لفكّ تركيب CFB/BIFF كاملاً.
 *
 * «كشف المقاولين» = لقطة الرصيد الجديدة (ورقتها الأولى تبدأ بهذا الاسم).
 * أي شيء آخر (وعلى رأسه «مديونية») هو تقرير المديونيات المجمّع القديم — نفس
 * التصنيف الذي يطبّقه الخادم في `_classify_xls()` عند مسح مجلد، فلا يختلف
 * المساران. عدم القدرة على القراءة (ملف تالف مثلاً) يبقى على التصنيف القديم
 * الافتراضي — الخادم سيرفض الملف برسالته العربية الواضحة لاحقاً على أي حال.
 */
function sniffXlsIsContractorsBalance(filePath: string): boolean {
  try {
    const buf = fs.readFileSync(filePath);
    const marker = Buffer.from('كشف المقاولين', 'utf16le');
    return buf.includes(marker);
  } catch {
    return false;
  }
}

/**
 * م-٣ — الامتداد وحده لا يميّز موازنة عن موردين (كلاهما .xlsx). قبل هذا الإصلاح
 * كل .xlsx كان يُصنَّف 'suppliers_excel' هنا بلا فحص، بينما الخادم (`classify_xlsx_source`
 * وقت الرفع الجماعي/مسح المجلد) يفتح الملف ويقرأ أسماء أوراقه — فمنتقي الملف
 * المفرد وحده كان يخمّن، فرفع ملف موازنة منفرداً لا يُحفظ (يُرسل بمصدر خاطئ).
 * لا مكتبة قراءة xlsx في عملية main، فيُسأل الخادم نفسه عبر `/import/classify` —
 * نقطة الحقيقة الوحيدة (`import_service.classify_path`) بدل نسخة موازية من
 * المنطق قد تنحرف عن الخادم بصمت. فشل الاتصال (خدمة لم تُقلع بعد) يبقى على
 * التصنيف الافتراضي القديم — الخادم سيرفض الملف برسالته العربية لاحقاً على أي حال.
 */
async function classifyXlsxViaBackend(filePath: string): Promise<'suppliers_excel' | 'budget_deviation' | 'budget_plan'> {
  try {
    const res = await fetch(`${backendUrl()}/api/v1/import/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    if (!res.ok) return 'suppliers_excel';
    const data = (await res.json()) as { source?: string };
    // الموازنة التقديرية (خطة شهرية) — كانت تسقط إلى «ملف موردين» فتفشل المعاينة
    if (data.source === 'budget_plan') return 'budget_plan';
    return data.source === 'budget_deviation' ? 'budget_deviation' : 'suppliers_excel';
  } catch {
    return 'suppliers_excel';
  }
}

async function detectSource(filePath: string):
    Promise<'pdf_statement' | 'csv_statement' | 'suppliers_excel' | 'debts_report_xls'
    | 'contractors_balance_xls' | 'budget_deviation' | 'budget_plan'> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'pdf_statement';
  if (ext === '.csv') return 'csv_statement';
  // ‏.xls القديم صار يحمل صيغتين: تقرير المديونيات المجمّع (BIFF قديم، يقرأه
  // xlrd لا openpyxl) ولقطة رصيد المقاولين الجديدة — الامتداد وحده لا يكفي
  // للتمييز بينهما، فتُسبَر أسماء الأوراق (انظر sniffXlsIsContractorsBalance).
  if (ext === '.xls') {
    return sniffXlsIsContractorsBalance(filePath) ? 'contractors_balance_xls' : 'debts_report_xls';
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    return classifyXlsxViaBackend(filePath);
  }
  return 'suppliers_excel';
}

ipcMain.handle('dialog:pickFile', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: PICK_FILTERS,
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const filePath = r.filePaths[0];
  return {
    path: filePath,
    name: path.basename(filePath),
    source: await detectSource(filePath),
  };
});

/**
 * اختيار عدة ملفات دفعة واحدة — نوع كل ملف يُكتشف من امتداده كما في الاختيار المفرد.
 */
ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: PICK_FILTERS,
  });
  if (r.canceled || !r.filePaths.length) return [];
  return Promise.all(r.filePaths.map(async (filePath) => ({
    path: filePath,
    name: path.basename(filePath),
    source: await detectSource(filePath),
  })));
});

/**
 * اختيار مجلد كامل — للرفع الجماعي.
 * The renderer gets only the path; the backend does the scanning, so the UI still
 * needs no filesystem access of its own.
 */
ipcMain.handle('dialog:pickDirectory', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

/**
 * تصدير واستيراد قاعدة البيانات — نقل الجهاز بضغطة بدل نسخ الملفات يدوياً.
 *
 * The DB is a single SQLite file. Doing the copy here (rather than telling the user to
 * dig through %APPDATA% / Library) is the difference between a transfer anyone can do
 * and one only its author can. Import relaunches the app because the backend holds the
 * file open.
 */
const dbPath = () => path.join(app.getPath('userData'), 'egco.db');

/** طابع زمني صالح لاسم ملف — نفس شكل الخادم (`2026-09-24T10-30-05`). */
const fileStamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * م-٤٥: التصدير كان ينسخ `egco.db` وهو مفتوح للكتابة (نسخة قد لا تُفتح). الآن
 * يطلب من الخدمة نسخة يدوية متّسقة (`VACUUM INTO`) ثم ينسخ ذلك الملف المغلق
 * إلى المسار الذي اختاره المستخدم. فشل الخدمة لا يُسقط للنسخ الحيّ — يُعرض كخطأ.
 */
async function requestManualBackup(): Promise<{ path: string; name: string }> {
  const res = await fetch(`${backendUrl()}/api/v1/backups`, { method: 'POST' });
  if (!res.ok) {
    let detail = `خطأ ${res.status}`;
    try { detail = String((await res.json()).detail ?? detail); } catch { /* نص الحالة يكفي */ }
    throw new Error(detail);
  }
  const data = (await res.json()) as { backup: { path: string; name: string } };
  return data.backup;
}

ipcMain.handle('data:export', async () => {
  const src = dbPath();
  if (!fs.existsSync(src)) return { ok: false, error: 'لا توجد قاعدة بيانات بعد' };
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog({
    title: 'تصدير نسخة من البيانات',
    defaultPath: `EGCO-data-${stamp}.db`,
    filters: [{ name: 'قاعدة بيانات', extensions: ['db'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    const backup = await requestManualBackup();
    fs.copyFileSync(backup.path, r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('data:import', async () => {
  const r = await dialog.showOpenDialog({
    title: 'استيراد ملف بيانات',
    properties: ['openFile'],
    filters: [{ name: 'قاعدة بيانات', extensions: ['db'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };

  const confirm = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['استبدال وإعادة التشغيل', 'إلغاء'],
    defaultId: 1,
    cancelId: 1,
    message: 'استبدال البيانات الحالية؟',
    detail: 'ستُحفظ نسخة من بياناتك الحالية بجانب القاعدة قبل الاستبدال، '
          + 'ثم يُعاد تشغيل التطبيق.',
  });
  if (confirm.response !== 0) return { ok: false, canceled: true };

  try {
    const dest = dbPath();
    if (fs.existsSync(dest)) {
      const backups = path.join(app.getPath('userData'), 'backups');
      fs.mkdirSync(backups, { recursive: true });
      fs.copyFileSync(dest, path.join(backups, `before-import-${fileStamp()}.db`));
      pruneBackups(backups, 'before-import-', 10);   // م-١٣
    }
    fs.copyFileSync(r.filePaths[0], dest);
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  app.relaunch();
  app.quit();
  return { ok: true };
});

ipcMain.handle('shell:revealDataDir', () => shell.openPath(app.getPath('userData')));

/* ---------------------------------------------------------------- النسخ الاحتياطي (م-٤٥) */

const backupsDir = () => path.join(app.getPath('userData'), 'backups');

/** نفس النمط الصارم الذي يفرضه الخادم — لا شرطة مائلة ولا `..` تصل إلى المسار. */
const BACKUP_NAME_RE = /^(daily|manual|before-update|before-import|before-restore|egco)-[A-Za-z0-9._-]+\.db$/;

ipcMain.handle('backup:revealDir', () => {
  fs.mkdirSync(backupsDir(), { recursive: true });
  return shell.openPath(backupsDir());
});

/** حوار اختيار مجلد خارجي (iCloud/Drive) — المسار يُحفظ عبر API من الواجهة. */
ipcMain.handle('backup:pickExternalDir', async () => {
  const r = await dialog.showOpenDialog({
    title: 'اختيار مجلد خارجي للنسخ الاحتياطي',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

/** ينتظر حتى تتوقف الخدمة فعلاً (health يفشل) — kill() لا ينتظر خروج العملية. */
async function waitForBackendStop(maxMs = 5000): Promise<void> {
  const url = `${backendUrl()}/health`;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
    } catch {
      return;                     // لم تعد تستجيب — توقفت
    }
    await new Promise((res) => setTimeout(res, 150));
  }
}

/**
 * الاستعادة: تأكيد أصلي → إيقاف الخدمة (تمسك الملف) → نسخة `before-restore-*` من
 * القاعدة الحالية (وهي مغلقة الآن، فالنسخ المباشر آمن) → استبدال `egco.db` →
 * إعادة تشغيل. ملفات `-wal`/`-shm` تُحذف إن وُجدت حتى لا يُطبَّق سجل قديم على
 * الملف الجديد. الاسم يُتحقَّق منه ويُحلّ داخل مجلد النسخ فقط.
 */
ipcMain.handle('backup:restore', async (_e, name: string) => {
  if (typeof name !== 'string' || !BACKUP_NAME_RE.test(name)) {
    return { ok: false, error: 'اسم نسخة غير صالح' };
  }
  const src = path.join(backupsDir(), name);
  if (path.dirname(path.resolve(src)) !== path.resolve(backupsDir()) || !fs.existsSync(src)) {
    return { ok: false, error: 'النسخة غير موجودة' };
  }
  const confirm = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['استعادة وإعادة التشغيل', 'إلغاء'],
    defaultId: 1,
    cancelId: 1,
    message: 'استعادة هذه النسخة؟',
    detail: `ستُستبدل بياناتك الحالية بمحتوى النسخة:\n${name}\n\n`
          + 'تُؤخذ نسخة من بياناتك الحالية أولاً (before-restore) حتى يمكن التراجع، '
          + 'ثم يُعاد تشغيل التطبيق.',
  });
  if (confirm.response !== 0) return { ok: false, canceled: true };

  try {
    stopBackend();
    await waitForBackendStop();
    const dest = dbPath();
    if (fs.existsSync(dest)) {
      fs.copyFileSync(dest, path.join(backupsDir(), `before-restore-${fileStamp()}.db`));
      pruneBackups(backupsDir(), 'before-restore-', 5);
    }
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try { fs.rmSync(dest + suffix, { force: true }); } catch { /* غير موجود غالباً */ }
    }
    fs.copyFileSync(src, dest);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  app.relaunch();
  app.quit();
  return { ok: true };
});

/**
 * تصدير PDF — بديل window.print() داخل التطبيق المحزوم.
 *
 * On Windows the print dialog offers no obvious save-as-PDF path, so the export is
 * done here: native save dialog, then printToPDF of the current page. The renderer's
 * @media print CSS already strips the app chrome, and printToPDF renders under print
 * media, so the file matches what the browser print path produced.
 */
ipcMain.handle('export:pdf', async (event, opts: { filename: string; landscape?: boolean }) => {
  try {
    const sender = event.sender;
    const parent = BrowserWindow.fromWebContents(sender) ?? undefined;
    const r = await dialog.showSaveDialog(parent as BrowserWindow, {
      title: 'حفظ PDF',
      defaultPath: path.join(app.getPath('documents'), opts.filename),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    // ‏preferCSSPageSize كان true فيتجاهل pageSize أدناه ويتبع @page في CSS.
    // ‏Chromium لا يدعم @page المسمّاة (page: اسم)، فكانت القاعدة تسقط ويعود
    // المحرّك إلى حجمه الافتراضي (Letter) بدل A4. الحجم يُملى من هنا الآن،
    // وهو المكان الوحيد الذي يعرف اتجاه كل تصدير على حدة.
    const data = await sender.printToPDF({
      printBackground: true,
      landscape: !!opts.landscape,
      pageSize: 'A4',
      preferCSSPageSize: false,
    });
    await fs.promises.writeFile(r.filePath, data);
    shell.showItemInFolder(r.filePath);
    return { saved: true, path: r.filePath };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

/* ---------------------------------------------------------------- شريط العنوان · الإشعارات · الشارة */

ipcMain.handle('window:insets', () => titleBarInsets(win));

/** الواجهة تبلغ سمتها الفعلية — يُحدَّث لون الخلفية وطبقة أزرار Windows. */
ipcMain.handle('window:setTheme', (_e, theme: ThemeName) => {
  if (theme !== 'light' && theme !== 'dark') return;
  applyTheme(win, theme);
});

ipcMain.handle('window:isFocused', () => !!win && !win.isDestroyed() && win.isFocused());

ipcMain.handle('notify:os', (_e, payload: OsNotifyPayload) => showOsNotification(win, payload));

ipcMain.handle('app:setBadge', (_e, count: number) => setBadge(win, count));
