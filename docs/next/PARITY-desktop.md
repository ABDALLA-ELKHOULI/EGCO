# PARITY-desktop.md — تكافؤ سطح المكتب (وكيل D)

Closes AUDIT A-004 (desktop). Reference: `v0.13.0` (7292093). Lines are in the current working tree
(`apps/desktop/src/`, uncommitted D wave). Status: ✅ = code present and checked by reading + diff
against `git show v0.13.0` (all 16 v0.13 `ipcMain.handle`/send channels still exist, none removed);
build + `tsc --noEmit` clean. **Runtime in a real window was not exercised** — see the end of this file.
P-517 / P-522 / P-528 are listed for completeness (claimed with desktop/data).

| P-id | Behaviour | main | preload (`window.egco`) | Status |
|---|---|---|---|---|
| P-420 | `.xlsx/.xlsm` classified by backend `POST /api/v1/import/classify`, fallback `suppliers_excel` | main/index.ts:367-380 (called from detectSource :382) | — | ✅ |
| P-510 | Single bridge, contextIsolation + sandbox, no ipcRenderer exposed | main/index.ts:183-189 | preload/index.ts:52 | ✅ |
| P-511 | `app:backendUrl` | main/index.ts:281 | preload/index.ts:78 `backendUrl()` | ✅ |
| P-512 | `app:info` version/platform/dataDir | main/index.ts:283-287 | :79 `info()` | ✅ |
| P-513 | `dialog:pickFile` + filters + type detection | main/index.ts:324-330, 400-411 | :81 `pickFile()` | ✅ |
| P-514 | `dialog:pickFiles` multi-select | main/index.ts:417-429 | :83 `pickFiles()` | ✅ |
| P-515 | detectSource: pdf/csv/xls sniff «كشف المقاولين» UTF-16LE/xlsx→backend | main/index.ts:347-355, 367-380, 382-394 | — | ✅ |
| P-516 | `dialog:pickDirectory` | main/index.ts:435-438 | :84 `pickDirectory()` | ✅ |
| P-517 | `data:export` via VACUUM INTO backup | main/index.ts:455-486 | :86 `exportData()` | ✅ |
| P-518 | `data:import`: confirm → `before-import-*` (keep 10) → replace → relaunch | main/index.ts:488-523 | :88 `importData()` | ✅ |
| P-519 | `shell:revealDataDir` | main/index.ts:525 | :89 `revealDataDir()` | ✅ |
| P-520 | `backup:revealDir` (mkdir) | main/index.ts:534-537 | :92 `revealBackupsDir()` | ✅ |
| P-521 | `backup:pickExternalDir` (createDirectory) | main/index.ts:540-546 | :94 `pickExternalBackupDir()` | ✅ |
| P-522 | `backup:restore` strict name + stop backend + before-restore + wal/shm cleanup + relaunch | main/index.ts:568-607 | :97 `restoreBackup()` | ✅ |
| P-523 | `export:pdf` save dialog → printToPDF A4 → reveal | main/index.ts:617-640 | :101 `exportPdf()` | ✅ |
| P-524 | `update:check` real status (unavailable-dev/checking/error) | main/index.ts:294-307 | :103 `checkForUpdates()` | ✅ |
| P-525 | `update:install` quitAndInstall | main/index.ts:310-314 | :105 `installUpdate()` | ✅ |
| P-526 | `update:status` broadcast | main/index.ts:31-33, 115-129, 130-133 | :107-111 `onUpdateStatus()` | ✅ |
| P-527 | auto-update at launch (packaged only), autoDownload, **no** install on quit, ask-first dialog | main/index.ts:99-160, 163-171 | — | ✅ (+ new: POST `/events/system` on available/downloaded, 404-tolerant) |
| P-528 | `before-update-*` backup on download (keep 10), failure non-blocking | main/index.ts:65-81, 84-91, 131 | — | ✅ |
| P-529 | `app:backend-restarted` {url, recovered, error} | main/index.ts:254-256 + backend.ts:42-46, 145-174 | :113-117 `onBackendRestarted()` | ✅ |
| P-530 | Backend supervisor: loopback free port, /health 30s, 5 restarts/5 min, same port first, stderr tail 6, EGCO_API_PORT/EGCO_DATA_DIR, intentional-stop flag | backend.ts:16-18, 30-38, 67-78, 80-91, 107-175, 177-181 | — | ✅ |
| P-531 | Startup failure → «تعذّر تشغيل الخدمة» + tail, quit | main/index.ts:260-268 | — | ✅ |
| P-532 | Single-instance lock + restore/focus | main/index.ts:220-229 | — | ✅ |
| P-533 | will-download → native save dialog in Downloads → reveal | main/index.ts:239-246 | — | ✅ |
| P-534 | Window + external links in browser | main/index.ts:173-216; windowState.ts:11-12, 25; chrome.ts:18, 33-39 | — | ✅ **changed by design (PLAN/D brief):** min 1100×720 → 1024×680; default 1600×950 kept but saved size/position restored; bg #FBFAF7 → theme canvas #F5F4F1 / #10131A; hiddenInset kept on macOS, Windows now hidden + titleBarOverlay (44px, navy). Links: setWindowOpenHandler :210-213 |
| P-535 | window-all-closed quits (not macOS), stop backend before quit, activate recreates | main/index.ts:271-277 | — | ✅ |
| P-550 | Single SQLite `{userData}/egco.db`, passed via EGCO_DATA_DIR | main/index.ts:448; backend.ts:112 | — | ✅ |

## Not verified at runtime
Electron binary now runs (v33.4.11), but no GUI session was driven: dialogs, printToPDF, restore/
import relaunch, updater (packaged-only), title-bar placement, OS notifications, badge and
window-state restore are verified by code reading + typecheck only. Needs one manual pass on
macOS and Windows before flipping the PARITY.md rows.
