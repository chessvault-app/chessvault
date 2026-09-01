import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The desktop shell. Two modes, chosen on first run and kept in
 * userData/desktop.json:
 *
 *   remote — a window onto a Chess Vault server somewhere else.
 *            Pure client; nothing runs locally.
 *   local  — self-hosted: the shell starts the repo's own server as a
 *            child process and points the window at it.
 *
 * The one architectural rule: the shell NEVER adds APIs of its own. The
 * web app talks to the same HTTP API in every mode, so the desktop build
 * can lag or disappear without leaving debt. (The chooser's tiny IPC is
 * shell configuration, not app surface.)
 *
 * Dev shape: local mode spawns the SYSTEM node (`node --import tsx`),
 * exactly like `npm start` — so native modules (better-sqlite3) load the
 * builds already in node_modules, no Electron ABI rebuilds. A packaged
 * build will instead ship a precompiled server; see desktop/README.md.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const LOCAL_PORT = 8788; // away from the dev server's 8787

const settingsPath = () => join(app.getPath('userData'), 'desktop.json');
const readSettings = () => {
  try {
    // BOM-tolerant: hand-edited or PowerShell-written files carry one.
    return JSON.parse(readFileSync(settingsPath(), 'utf-8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
};
const writeSettings = (patch) =>
  writeFileSync(settingsPath(), `${JSON.stringify({ ...readSettings(), ...patch }, null, 2)}\n`);

let serverProc = null;

/**
 * Is this URL served by the vault this window is showing?
 *
 * Local mode serves from loopback on LOCAL_PORT; remote mode from the
 * server the user chose. Anything else is the open web and belongs in the
 * browser.
 */
function isOwnOrigin(url) {
  // Compared as PARSED origins, never as string prefixes: with the vault
  // at https://vault.example.com, a prefix match also passed
  // https://vault.example.com.evil.io — and whatever a navigation lands
  // on inherits the preload bridge.
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  if (origin === `http://127.0.0.1:${LOCAL_PORT}`) return true;
  const settings = readSettings();
  if (settings.mode !== 'remote' || !settings.url) return false;
  try {
    return origin === new URL(settings.url).origin;
  } catch {
    return false;
  }
}

/**
 * A sentence, not electron-updater's stack.
 *
 * Its 404 message is ~2 kB: the URL, an explanation about tokens, then every
 * response header — which on github.com includes Set-Cookie, so the raw text
 * put a session cookie on screen in a settings panel. None of it helps anyone
 * decide what to do, and the useful part is one of three situations.
 */
function updateFailure(err) {
  const text = String(err?.message ?? err ?? '');
  if (/404|ENOTFOUND releases|no published versions/i.test(text)) {
    return 'no published release to update to yet';
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network|offline/i.test(text)) {
    return 'no internet connection';
  }
  if (/403|401|auth/i.test(text)) return 'the update feed refused the request';
  // Anything unforeseen: the first line only, and short enough to read.
  return text.split(/\r?\n/)[0].slice(0, 120);
}

/**
 * Where the bundled server's own words go.
 *
 * A packaged app has no terminal. The failure screen said "check the
 * terminal output" while the spawn discarded both streams, so the one
 * thing that knew why the server had not started was thrown away and the
 * reader was sent to look at nothing. Everything it says now lands in a
 * file beside the vault, and the screen names the file.
 */
function serverLogPath() {
  return join(app.getPath('userData'), 'server.log');
}

function startLocalServer() {
  if (serverProc) return;
  // An explicitly opened vault folder (Obsidian-style) wins everywhere;
  // its derived data rides inside it, so the folder travels whole.
  const chosen = readSettings().vaultDir;
  const vaultEnv = chosen
    ? { CHESS_VAULT_DIR: chosen, CHESS_VAULT_DATA: join(chosen, '.data') }
    : {};
  if (app.isPackaged) {
    // Shipped shape: the bundled server runs on Electron's own Node
    // (ELECTRON_RUN_AS_NODE), reading/writing the user's profile.
    const serverEntry = join(process.resourcesPath, 'server', 'index.mjs');
    serverProc = spawn(process.execPath, [serverEntry], {
      // serveStatic('./dist') is cwd-relative: resources/ holds dist/.
      cwd: process.resourcesPath,
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(LOCAL_PORT),
        // Loopback only: this server has no password — it is the window in
        // front of you — so it must not be reachable from the network.
        CHESS_BIND: '127.0.0.1',
        CHESS_VAULT_DIR: join(app.getPath('userData'), 'vault'),
        CHESS_VAULT_DATA: join(app.getPath('userData'), 'data'),
        ...vaultEnv,
      },
      // Kept, not discarded: this is the only account of a server that
      // refused to start, and on a packaged app nobody is watching a
      // console for it.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = createWriteStream(serverLogPath(), { flags: 'w' });
    log.write(`[desktop] ${new Date().toISOString()} starting ${serverEntry}
`);
    serverProc.stdout?.pipe(log);
    serverProc.stderr?.pipe(log);
  } else {
    // Dev shape: the repo's server on the system Node, exactly like
    // `npm start` — repo vault, no Electron-ABI native rebuilds.
    serverProc = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
      cwd: repoRoot,
      // A GUI process spawning a console app would pop a terminal window.
      windowsHide: true,
      env: { ...process.env, PORT: String(LOCAL_PORT), CHESS_BIND: '127.0.0.1', ...vaultEnv },
      stdio: 'inherit',
    });
  }
  serverProc.on('exit', (code) => {
    console.log(`[desktop] local server exited (${code})`);
    serverProc = null;
  });
}

/** Poll /api/health until the server answers (or give up after ~15 s). */
async function waitForServer(base) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Below this the app's stacked (phone) layout takes over anyway;
    // the floor keeps the window out of degenerate shapes.
    minWidth: 480,
    minHeight: 560,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    icon: join(here, 'icon.png'),
    // Chromium's defaults already isolate and sandbox, but the window that
    // carries the shell bridge states them itself: an Electron downgrade
    // or a changed default must not be able to regress this silently.
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Links to lichess/chess.com open in the real browser, not a new shell —
  // but only http(s), so a hostile page can't hand the OS an arbitrary URI
  // scheme (file:, smb:, ms-msdt:, …) to launch.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Pages served by our OWN vault open in a window of this app rather
    // than being handed to the browser: it is our content, and sending it
    // out of the app to read it is the wrong answer. No preload and no
    // node integration, so the new window is an ordinary page with none of
    // the shell bridge.
    //
    // The licences page used to be the one that took this path, and a
    // second app window turned out to be the wrong answer too — nothing in
    // it said what it was or how to get back. It is a route now
    // (#/settings/licenses), read in place. This stays for anything else
    // our own origin might open.
    if (isOwnOrigin(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The window carries the preload bridge (window.vaultShell). Never let an
  // in-page link navigate it to an arbitrary origin that would then inherit
  // that bridge — remote mode loads its server once, and that's the only
  // top-level navigation allowed.
  /**
   * A renderer that dies leaves the window painted in `backgroundColor` —
   * a black screen with no message, which is exactly what a user reports
   * and exactly what nobody can diagnose. Say what happened, and come
   * back: reloading costs a page load and beats quitting the app.
   *
   * `reason` is Chromium's own: 'crashed', 'oom', 'killed', …
   */
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[desktop] renderer gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload();
  });
  win.webContents.on('unresponsive', () => {
    console.error('[desktop] renderer unresponsive');
  });
  win.webContents.on('preload-error', (_event, path, error) => {
    console.error(`[desktop] preload failed (${path}):`, error?.message ?? error);
  });

  win.webContents.on('will-navigate', (event, url) => {
    // Own origins (parsed, not prefix-matched — see isOwnOrigin) and the
    // shell's OWN chooser page. `file://` as a whole was allowed here,
    // which would have let a page navigate the bridge-carrying window to
    // any local file; only the chooser needs it.
    const chooser = pathToFileURL(join(here, 'chooser.html')).href;
    const allowed = isOwnOrigin(url) || url.split('?')[0] === chooser;
    if (!allowed) event.preventDefault();
  });
  return win;
}

async function openApp(win) {
  const settings = readSettings();
  if (settings.mode === 'remote' && settings.url) {
    await win.loadURL(settings.url);
    return;
  }
  if (settings.mode === 'local') {
    startLocalServer();
    const base = `http://127.0.0.1:${LOCAL_PORT}`;
    if (await waitForServer(base)) await win.loadURL(base);
    else {
      await win.loadFile(join(here, 'chooser.html'), {
        query: { error: 'server', log: app.isPackaged ? serverLogPath() : '' },
      });
    }
    return;
  }
  await win.loadFile(join(here, 'chooser.html'));
}

/**
 * electron-updater is CommonJS, so `await import()` hands back a namespace
 * whose exports live under `.default` — destructuring `{ autoUpdater }`
 * from it yields undefined, every time, silently.
 *
 * This is why the app never updated itself: the launch check threw
 * "Cannot read properties of undefined", the catch logged it to a console
 * nobody opens, and a machine sat on 0.1.0 while the feed served three
 * newer builds correctly.
 */
async function updater() {
  const mod = await import('electron-updater');
  const found = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!found) throw new Error('electron-updater exposed no autoUpdater');
  return found;
}

/**
 * What the update is doing right now, in the app rather than in a console.
 *
 * A download of an eighty-megabyte installer used to be entirely silent:
 * the shell said "it installs when you quit" and then nothing for however
 * long the transfer took, so a slow connection and a stalled one looked
 * identical. The renderer gets every step of it, and asks for the current
 * one on mount because the launch check starts before any page has loaded.
 */
let updateState = { phase: 'idle' };
let updaterWired = false;

// Every open window, not the one that happened to exist when the updater
// was wired: macOS closes the last window without quitting and builds a new
// one on activate, and a captured reference would have gone quiet there
// while the download carried on.
function publishUpdate(next) {
  updateState = next;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('app:update-status', next);
  }
}

/**
 * The autoUpdater with its events attached exactly once — both the launch
 * check and the Settings button come through here, and a second set of
 * listeners would report every byte twice.
 */
async function wiredUpdater() {
  const autoUpdater = await updater();
  if (updaterWired) return autoUpdater;
  updaterWired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    publishUpdate({ phase: 'downloading', version: info?.version, transferred: 0, total: 0, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => {
    publishUpdate({
      phase: 'downloading',
      version: updateState.version,
      transferred: p?.transferred ?? 0,
      total: p?.total ?? 0,
      percent: p?.percent ?? 0,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    publishUpdate({ phase: 'ready', version: info?.version });
  });
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err?.message ?? err);
    // Only a download that broke gets said out loud. The launch check
    // fails routinely — offline, or no release published yet — and putting
    // that on the Settings card would make "could not update" the resting
    // state of every machine that starts up without a connection. Asking
    // with the button is what reports a check.
    if (updateState.phase === 'downloading') publishUpdate({ phase: 'failed', error: updateFailure(err) });
  });
  return autoUpdater;
}

app.whenReady().then(async () => {
  const win = createWindow();

  ipcMain.handle('vault:choose', async (_e, mode, url, vaultDir) => {
    // Remote mode loads this URL as a top-level page that inherits the
    // preload bridge — force https so a plaintext or exotic-scheme server
    // can never receive the session cookie or the bridge.
    if (mode === 'remote' && !/^https:\/\//i.test(url ?? '')) {
      return { error: 'The server address must start with https://' };
    }
    const previous = readSettings();
    writeSettings({ mode, url: url ?? null, vaultDir: vaultDir ?? null });
    // A different vault means a different server environment.
    serverProc?.kill();
    serverProc = null;
    try {
      await openApp(win);
    } catch (err) {
      // An address that does not answer must not be remembered, or the
      // next launch opens straight onto a dead page with no way back.
      writeSettings(previous);
      await win.loadFile(join(here, 'chooser.html'));
      return { error: `Could not reach that server (${err?.code ?? err?.message ?? 'no answer'}).` };
    }
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    feed: readSettings().mode === null ? null : process.env.CHESS_UPDATE_URL ?? null,
  }));

  /**
   * Ask the feed, and ANSWER — the automatic check on launch reports only
   * to a console, so an update that never arrives looks like an update that
   * was never released.
   */
  ipcMain.handle('app:check-updates', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try {
      const autoUpdater = await wiredUpdater();
      const result = await autoUpdater.checkForUpdates();
      const found = result?.updateInfo?.version;
      if (!found || found === app.getVersion()) return { state: 'current', version: app.getVersion() };
      return { state: 'available', version: found };
    } catch (err) {
      return { state: 'failed', error: updateFailure(err) };
    }
  });

  // Where the download has got to. Asked for on mount, because the launch
  // check runs before the app's own page exists to be sent anything.
  ipcMain.handle('app:update-status', () => updateState);

  // The restart the native dialog used to ask for, as a button on the page
  // that reported the download.
  ipcMain.handle('app:restart-to-update', async () => {
    if (updateState.phase !== 'ready') return false;
    const autoUpdater = await wiredUpdater();
    autoUpdater.quitAndInstall();
    return true;
  });

  // The same thing the Vault menu does, reachable from the app's settings.
  ipcMain.handle('vault:switch', async () => {
    writeSettings({ mode: null });
    serverProc?.kill();
    serverProc = null;
    await win.loadFile(join(here, 'chooser.html'));
  });
  // The title is the caller's, because this dialog is asked for by two
  // different questions now — where the vault lives, and where a folder
  // of Syzygy tables is. An older bridge passes nothing and gets the
  // vault wording, which is what it always said.
  ipcMain.handle('vault:pick-folder', async (_e, title) => {
    const picked = await dialog.showOpenDialog(win, {
      title: typeof title === 'string' && title.trim() ? title : 'Open vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Vault',
        submenu: [
          {
            label: 'Switch vault…',
            click: async () => {
              writeSettings({ mode: null });
              await win.loadFile(join(here, 'chooser.html'));
            },
          },
          { role: 'quit' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { role: 'togglefullscreen' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
        ],
      },
    ]),
  );

  await openApp(win);
  void checkForUpdates();
});

/**
 * Auto-update the shell from GitHub releases (electron-updater reads the
 * `build.publish` config). It downloads in the background and installs on
 * the next quit, so it never interrupts; what it is doing goes to the app's
 * own Settings page rather than to a modal.
 *
 * It used to end in a native message box, which arrives over whatever the
 * reader is in the middle of, is not in the app's language, and cannot be
 * got back once dismissed — so "Later" meant the offer to restart was gone
 * for the rest of the run. Dev runs and unsigned builds simply no-op.
 * Publish a release with `npm run desktop:release`.
 */
async function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const autoUpdater = await wiredUpdater();
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('[updater] disabled:', err?.message ?? err);
  }
}

app.on('window-all-closed', () => {
  // macOS apps stay running with no windows — quitting there would be
  // wrong, and the dock icon is expected to bring the app back.
  if (process.platform === 'darwin') return;
  serverProc?.kill();
  app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length > 0) return;
  await openApp(createWindow());
});
app.on('before-quit', () => serverProc?.kill());
