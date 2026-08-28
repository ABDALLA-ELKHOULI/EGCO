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
    pruneUpdateBackups(dir);
  } catch (e) {
    console.error('[update] تعذّرت النسخة الاحتياطية قبل التحديث:', e);
  }
}

/** يُبقي آخر عشر نسخ تحديث فقط — القاعدة تُقاس بالميغابايتات وتتراكم بلا سقف. */
function pruneUpdateBackups(dir: string, keep = 10): void {
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith('before-update-') && f.endsWith('.db'))
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

      autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', version: info.version }));
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
  win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#FBFAF7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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
async function classifyXlsxViaBackend(filePath: string): Promise<'suppliers_excel' | 'budget_deviation'> {
  try {
    const res = await fetch(`${backendUrl()}/api/v1/import/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    if (!res.ok) return 'suppliers_excel';
    const data = (await res.json()) as { source?: string };
    return data.source === 'budget_deviation' ? 'budget_deviation' : 'suppliers_excel';
  } catch {
    return 'suppliers_excel';
  }
}

async function detectSource(filePath: string):
    Promise<'pdf_statement' | 'csv_statement' | 'suppliers_excel' | 'debts_report_xls'
    | 'contractors_balance_xls' | 'budget_deviation'> {
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
    fs.copyFileSync(src, r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: String(e) };
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
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(dest, path.join(backups, `before-import-${stamp}.db`));
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
