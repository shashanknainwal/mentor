// Safe bridge between the React renderer and the Electron main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mentor', {
  isDesktop: true,
  engineUrl: () => ipcRenderer.invoke('engine:url'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  engineLog: () => ipcRenderer.invoke('engine:log'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  setLoginItem: (enabled) => ipcRenderer.invoke('app:setLoginItem', enabled),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
  hideSpotlight: () => ipcRenderer.invoke('spotlight:hide'),
  openChatFromSpotlight: (sessionId) => ipcRenderer.invoke('spotlight:openChat', sessionId),
  on: (channel, fn) => {
    const allowed = ['navigate', 'spotlight:open'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
