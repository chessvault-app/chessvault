import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The desktop shell. Two modes, chosen on first run and kept in
 * userData/desktop.json:
 *
 *   remote — a window onto a Chess Vault server (the cloud deployment).
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
      env: { ...process.env, PORT: String(LOCAL_PORT), ...vaultEnv },
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
  // Links to lichess/chess.com open in the real browser, not a new shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
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

app.whenReady().then(async () => {
  const win = createWindow();

  ipcMain.handle('vault:choose', async (_e, mode, url, vaultDir) => {
    writeSettings({ mode, url: url ?? null, vaultDir: vaultDir ?? null });
    // A different vault means a different server environment.
    serverProc?.kill();
    serverProc = null;
    await openApp(win);
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
});

app.on('window-all-closed', () => {
  serverProc?.kill();
  app.quit();
});
app.on('before-quit', () => serverProc?.kill());
