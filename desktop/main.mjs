import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (url.startsWith(`http://127.0.0.1:${LOCAL_PORT}`)) return true;
  const settings = readSettings();
  return Boolean(settings.mode === 'remote' && settings.url && url.startsWith(settings.url));
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
      stdio: 'ignore',
    });
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
    backgroundColor: '#14161d',
    autoHideMenuBar: true,
    icon: join(here, 'icon.png'),
    webPreferences: { preload: join(here, 'preload.cjs') },
  });
  // Links to lichess/chess.com open in the real browser, not a new shell —
  // but only http(s), so a hostile page can't hand the OS an arbitrary URI
  // scheme (file:, smb:, ms-msdt:, …) to launch.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Pages served by our OWN vault — the licences page is the one that
    // matters — open in a window of this app rather than being handed to
    // the browser. It is our content; sending it out of the app to read it
    // is the wrong answer. No preload and no node integration, so the new
    // window is an ordinary page with none of the shell bridge.
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
  win.webContents.on('will-navigate', (event, url) => {
    const settings = readSettings();
    const allowed =
      url.startsWith(`http://127.0.0.1:${LOCAL_PORT}`) ||
      (settings.mode === 'remote' && settings.url && url.startsWith(settings.url)) ||
      url.startsWith('file://');
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
    else await win.loadFile(join(here, 'chooser.html'), { query: { error: 'server' } });
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
      const autoUpdater = await updater();
      const result = await autoUpdater.checkForUpdates();
      const found = result?.updateInfo?.version;
      if (!found || found === app.getVersion()) return { state: 'current', version: app.getVersion() };
      return { state: 'available', version: found };
    } catch (err) {
      return { state: 'failed', error: updateFailure(err) };
    }
  });

  // The same thing the Vault menu does, reachable from the app's settings.
  ipcMain.handle('vault:switch', async () => {
    writeSettings({ mode: null });
    serverProc?.kill();
    serverProc = null;
    await win.loadFile(join(here, 'chooser.html'));
  });
  ipcMain.handle('vault:pick-folder', async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Open vault folder',
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
  void checkForUpdates(win);
});

/**
 * Auto-update the shell from GitHub releases (electron-updater reads the
 * `build.publish` config). Silent by design: download in the background and
 * install on the next quit, so it never interrupts. Dev runs and unsigned
 * builds simply no-op. Publish a release with `npm run desktop:release`.
 */
async function checkForUpdates(win) {
  if (!app.isPackaged) return;
  try {
    const autoUpdater = await updater();
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', (info) => {
      // Let the user finish now instead of waiting for a quit, if they want.
      void dialog
        .showMessageBox(win, {
          type: 'info',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          title: 'Update ready',
          message: `Chess Vault ${info.version} is ready to install.`,
          detail: 'It will install automatically when you quit, or restart now.',
        })
        .then((r) => {
          if (r.response === 0) autoUpdater.quitAndInstall();
        });
    });
    autoUpdater.on('error', (err) => console.error('[updater]', err?.message ?? err));
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
