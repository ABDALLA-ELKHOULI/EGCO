"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * العملية الرئيسية — النوافذ وصلاحيات النظام فقط.
 *
 * The renderer stays sandboxed: contextIsolation on, nodeIntegration off. Every OS
 * capability it needs is a single narrow function in the preload bridge.
 */
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const backend_1 = require("./backend");
let win = null;
async function createWindow() {
    win = new electron_1.BrowserWindow({
        width: 1600,
        height: 950,
        minWidth: 1100,
        minHeight: 720,
        show: false,
        backgroundColor: '#FBFAF7',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        webPreferences: {
            preload: node_path_1.default.join(__dirname, '..', 'preload', 'index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    win.once('ready-to-show', () => win?.show());
    if (!electron_1.app.isPackaged) {
        await win.loadURL('http://localhost:5173');
    }
    else {
        await win.loadFile(node_path_1.default.join(__dirname, '..', 'renderer', 'index.html'));
    }
    win.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
}
electron_1.app.whenReady().then(async () => {
    try {
        await (0, backend_1.startBackend)();
    }
    catch (e) {
        electron_1.dialog.showErrorBox('تعذّر تشغيل الخدمة', String(e));
        electron_1.app.quit();
        return;
    }
    await createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => { if (process.platform !== 'darwin')
    electron_1.app.quit(); });
electron_1.app.on('before-quit', backend_1.stopBackend);
/* ---------------------------------------------------------------- IPC */
electron_1.ipcMain.handle('app:backendUrl', () => (0, backend_1.backendUrl)());
electron_1.ipcMain.handle('app:info', () => ({
    version: electron_1.app.getVersion(),
    platform: process.platform,
    dataDir: electron_1.app.getPath('userData'),
}));
/**
 * اختيار الملف يتم هنا حتى لا تحتاج الواجهة صلاحية على نظام الملفات.
 *
 * One picker for every supported file. Filtering by a type the user chose beforehand
 * greyed out the file they actually wanted, which read as "the upload is broken" —
 * so the dialog now shows all supported files and the type is detected from the
 * extension instead of being asked for up front.
 */
electron_1.ipcMain.handle('dialog:pickFile', async () => {
    const r = await electron_1.dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'كل الملفات المدعومة', extensions: ['pdf', 'xlsx', 'xlsm', 'csv'] },
            { name: 'كشف حساب PDF', extensions: ['pdf'] },
            { name: 'Excel', extensions: ['xlsx', 'xlsm'] },
            { name: 'كل الملفات', extensions: ['*'] },
        ],
    });
    if (r.canceled || !r.filePaths[0])
        return null;
    const filePath = r.filePaths[0];
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    return {
        path: filePath,
        name: node_path_1.default.basename(filePath),
        source: ext === '.pdf' ? 'pdf_statement' : 'suppliers_excel',
    };
});
electron_1.ipcMain.handle('shell:revealDataDir', () => electron_1.shell.openPath(electron_1.app.getPath('userData')));
