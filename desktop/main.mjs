import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
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
    return JSON.parse(readFileSync(settingsPath(), 'utf-8'));
  } catch {
    return {};
  }
};
const writeSettings = (patch) =>
  writeFileSync(settingsPath(), `${JSON.stringify({ ...readSettings(), ...patch }, null, 2)}\n`);

let serverProc = null;

function startLocalServer() {
  if (serverProc) return;
  serverProc = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(LOCAL_PORT) },
    stdio: 'inherit',
  });
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

  ipcMain.handle('vault:choose', async (_e, mode, url) => {
    writeSettings({ mode, url: url ?? null });
    await openApp(win);
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
