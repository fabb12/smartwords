// Bridge between the Scrivia page and the desktop app: version, platform and key encryption.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scriviaDesktop', {
  platform: process.platform,
  version: ipcRenderer.sendSync('scrivia:version'),
  protect: text => ipcRenderer.sendSync('scrivia:protect', String(text)),
  reveal: data => ipcRenderer.sendSync('scrivia:reveal', String(data)),
  localRequest: (request, onEvent) => {
    if (!request || typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(request.id) || typeof onEvent !== 'function') throw new Error('Richiesta locale non valida.');
    const channel = 'scrivia:local:' + request.id;
    const listener = (_event, data) => { onEvent(data); if (data.type === 'done' || data.type === 'error') ipcRenderer.removeListener(channel, listener); };
    ipcRenderer.on(channel, listener);
    ipcRenderer.send('scrivia:local-request', request);
    return () => { ipcRenderer.removeListener(channel, listener); ipcRenderer.send('scrivia:local-cancel', request.id); };
  },
});
