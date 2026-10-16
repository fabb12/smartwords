// Bridge between the Scrivia page and the desktop app: version, platform and key encryption.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scriviaDesktop', {
  platform: process.platform,
  version: ipcRenderer.sendSync('scrivia:version'),
  protect: text => ipcRenderer.sendSync('scrivia:protect', String(text)),
  reveal: data => ipcRenderer.sendSync('scrivia:reveal', String(data)),
});
