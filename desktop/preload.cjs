const { contextBridge, ipcRenderer } = require('electron');

/** The band's height, the shell's overlay and the page's band agreeing. */
const TITLE_BAR_HEIGHT = 32;

// Shell configuration only — the app itself never sees this surface.
contextBridge.exposeInMainWorld('vaultShell', {
  choose: (mode, url, vaultDir) => ipcRenderer.invoke('vault:choose', mode, url, vaultDir),
  pickFolder: (title) => ipcRenderer.invoke('vault:pick-folder', title),
  // Back to the chooser, so the app can offer this somewhere findable
  // rather than only from a menu bar hidden behind Alt.
  switchVault: () => ipcRenderer.invoke('vault:switch'),
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
    popupMenu: (x, y) => ipcRenderer.invoke('window:menu', x, y),
    setColors: (colors) => ipcRenderer.invoke('window:title-bar-colors', colors),
  },
});
