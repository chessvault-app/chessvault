const { contextBridge, ipcRenderer } = require('electron');

// Shell configuration only — the app itself never sees this surface.
contextBridge.exposeInMainWorld('vaultShell', {
  choose: (mode, url) => ipcRenderer.invoke('vault:choose', mode, url),
});
