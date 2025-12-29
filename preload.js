// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowHiderApi', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getWindows: () => ipcRenderer.invoke('get-windows'),
  saveSettings: (payload) => ipcRenderer.invoke('save-settings', payload),
  hideNow: () => ipcRenderer.invoke('hide-now'),
  showNow: () => ipcRenderer.invoke('show-now')
});
