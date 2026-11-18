# جسر سطح المكتب — `window.egco`

The whole OS surface the renderer can reach (preload: `apps/desktop/src/preload/index.ts`,
types: `apps/renderer/src/types/global.d.ts`). `window.egco` is **undefined in the browser/dev-web
build** — always guard with `window.egco?.`.

## Platform and title bar

| Function | Returns | Notes |
|---|---|---|
| `platform` (sync string) | `'darwin' \| 'win32' \| 'linux'` | Available immediately; use for first paint. |
| `titleBarInsets()` | `Promise<TitleBarInsets>` | `{platform, height: 44, left, right, fullScreen}` |
| `onTitleBarInsets(cb)` | unsubscribe fn | Fires on enter/leave full screen. |
| `setTheme('light'\|'dark')` | `Promise<void>` | Call whenever the app theme changes: updates window `backgroundColor` (no white flash on reload) and the Windows caption-button overlay. |
| `isFocused()` / `onFocusChange(cb)` | bool / unsubscribe | Window focus state. |

### Insets (physical, NOT RTL-mirrored)
- **macOS** (`hiddenInset`): traffic lights at top-**left**, `left: 80`, `right: 0`. In full screen `left: 0`.
- **Windows** (`titleBarOverlay`, navy `#1B202B`, light symbols, height 44): min/max/close drawn by the OS at top-**right**, `right: 138`, `left: 0`. That corner sits over the navy sidebar (RTL), so the colour matches. Content under it is not clickable.
- **Linux**: same as Windows (overlay where supported).

### What the frontend must do
1. Reserve a 44px top strip in the shell (`height` from insets). Nothing focusable under the
   inset corner (`left`/`right` px).
2. Make the strip draggable: `-webkit-app-region: drag;` on the top bar container.
3. Every interactive element inside it (status island, buttons, search) MUST be
   `-webkit-app-region: no-drag;` or it will not receive clicks.
4. Status island: absolutely centred in the window (`left: 50%; transform: translateX(-50%)`),
   vertically centred in the 44px strip — it does not collide with either inset at ≥1024px width.
5. Don't render a custom title text; double-click on the drag region maximizes natively.

```css
.titlebar { height: 44px; -webkit-app-region: drag; }
.titlebar .island, .titlebar button, .titlebar input { -webkit-app-region: no-drag; }
```

## OS notifications and badge (DESIGN-DIRECTION §٦.١)

| Function | Returns | Notes |
|---|---|---|
| `notifyOs({title, body?, severity?, link?, kind?})` | `Promise<{shown:true} \| {shown:false, reason}>` | `reason`: `focused` · `rate-limited` · `unsupported` · `invalid`. Shown **only when the window is not focused**. Max **1 per `kind` per day** (persisted in `userData/notify-rate.json`; `kind` defaults to `title`). Call only for the OS-worthy events: cash deficit within 7 days (`kind:'deficit'`), backup failure (`kind:'backup_failed'`). |
| `onNotificationClicked(cb)` | unsubscribe | Click restores+focuses the window, then `cb({link, kind})` — navigate to `link`. |
| `setBadge(count)` | `Promise<void>` | Unread count. macOS dock badge / Linux badge; Windows has no numeric badge API without an icon — taskbar flashes when count>0 and window unfocused. Pass 0 to clear. |

## Unchanged existing API
`backendUrl()`, `info()`, `pickFile()`, `pickFiles()`, `pickDirectory()`, `exportData()`,
`importData()`, `revealDataDir()`, `revealBackupsDir()`, `pickExternalBackupDir()`,
`restoreBackup(name)`, `exportPdf({filename, landscape?})`, `checkForUpdates()`,
`installUpdate()`, `onUpdateStatus(cb)`, `onBackendRestarted(cb)`.

## Main-process behaviour (no renderer call needed)
- **Update events → backend:** on `update-available` and `update-downloaded` main POSTs
  `POST /api/v1/events/system {kind:'update', severity:'info', title, detail}` once per
  state+version. 404/network errors are ignored. Backup-before-update unchanged.
- **Window state:** size/position/maximized/fullscreen saved to `userData/window-state.json`;
  off-screen positions are discarded. Min size 1024×680.
- **Background colour** follows the OS theme at launch, then whatever `setTheme` last set.

## IPC channels (for reference)
invoke: `window:insets`, `window:setTheme`, `window:isFocused`, `notify:os`, `app:setBadge`
(plus all previous ones). main→renderer: `window:insets`, `window:focus`, `notify:clicked`,
`update:status`, `app:backend-restarted`.
