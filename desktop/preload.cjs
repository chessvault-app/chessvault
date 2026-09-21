const { contextBridge, ipcRenderer } = require('electron');

/** The band's height, the shell's overlay and the page's band agreeing:
    40px, the height Windows 11 apps draw their own bars at (measured on
    the Claude desktop app: a 40px band, icons on a 40px pitch). */
const TITLE_BAR_HEIGHT = 40;

// Shell configuration only — the app itself never sees this surface.
contextBridge.exposeInMainWorld('vaultShell', {
  choose: (mode, url, vaultDir) => ipcRenderer.invoke('vault:choose', mode, url, vaultDir),
  pickFolder: (title) => ipcRenderer.invoke('vault:pick-folder', title),
  // Back to the chooser, so the app can offer this somewhere findable
  // rather than only from a menu bar hidden behind Alt.
  switchVault: () => ipcRenderer.invoke('vault:switch'),
  // The vault's folder, opened in the OS file manager (Settings, Vault).
  revealVault: () => ipcRenderer.invoke('vault:reveal'),
  // What this shell is, and whether a newer one exists. Update failures
  // used to go to a console nobody opens.
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
  // A download used to say nothing at all while it ran, and finish in a
  // native dialog. Both now belong to the page: it asks where the download
  // has got to, listens for the rest of it, and offers the restart itself.
  updateStatus: () => ipcRenderer.invoke('app:update-status'),
  onUpdateStatus: (fn) => {
    const listener = (_e, state) => fn(state);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  },
  restartToUpdate: () => ipcRenderer.invoke('app:restart-to-update'),
  // The window's chrome. The shell hides the native title bar and keeps
  // the OS's window controls as an overlay; the page draws the band
  // itself (components/title-bar) and needs to know it may, where the
  // controls are, and how tall the band is. The app menu, which hides
  // behind Alt once the bar is gone, pops up from the band's own button.
  titleBar: {
    platform: process.platform,
    height: TITLE_BAR_HEIGHT,
    // The app menu's verbs, run by the shell; the page draws the menu
    // itself (the native popup is the OS's own face, in the OS's own
    // language, and on Windows it clipped its descenders).
    command: (name) => ipcRenderer.invoke('window:command', name),
    setColors: (colors) => ipcRenderer.invoke('window:title-bar-colors', colors),
    // The OS's window material (Mica on Windows 11, sidebar vibrancy on
    // macOS). `material()` is what the page asks at startup so it can
    // put `data-window-material` on the root and let its ground go
    // transparent; `setMaterial` is the Settings switch. Both answer
    // { supported: false } anywhere the OS has no such thing, which is
    // every browser, Linux and Windows 10.
    material: () => ipcRenderer.invoke('window:material'),
    setMaterial: (on) => ipcRenderer.invoke('window:material-set', on),
    // The window's own theme, so the material is tinted by the APP's
    // theme and not by the OS's.
    setTheme: (resolved) => ipcRenderer.invoke('window:theme', resolved),
  },
});
