const { contextBridge, ipcRenderer } = require('electron');

// Shell configuration only — the app itself never sees this surface.
contextBridge.exposeInMainWorld('vaultShell', {
  choose: (mode, url, vaultDir) => ipcRenderer.invoke('vault:choose', mode, url, vaultDir),
  pickFolder: () => ipcRenderer.invoke('vault:pick-folder'),
  // Back to the chooser, so the app can offer this somewhere findable
  // rather than only from a menu bar hidden behind Alt.
  switchVault: () => ipcRenderer.invoke('vault:switch'),
});
