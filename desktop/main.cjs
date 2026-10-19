// Scrivia desktop: the GitHub Pages build (out-pages) packaged with Electron.
// The app is served from app://scrivia, a fixed origin, so documents saved in its storage
// survive updates; AI providers are called directly, without the browser's CORS limits.
const { app, BrowserWindow, Menu, ipcMain, net, protocol, safeStorage, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { registerLocalModels } = require('./local-models.cjs');

const ORIGIN = 'app://scrivia';
const WEB = path.join(__dirname, 'web');
// Same endpoints as lib/providers.ts: only these hosts get the CORS headers below.
const PROVIDERS = ['https://api.openai.com/*', 'https://api.anthropic.com/*', 'https://generativelanguage.googleapis.com/*', 'https://api.groq.com/*', 'https://api.mistral.ai/*', 'https://api.deepseek.com/*', 'https://openrouter.ai/*', 'https://api.github.com/*'];

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();

function serveApp() {
  protocol.handle('app', async request => {
    const { host, pathname } = new URL(request.url);
    const file = path.join(WEB, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (host !== 'scrivia' || path.relative(WEB, file).startsWith('..')) return new Response('Not found', { status: 404 });
    try { return await net.fetch(pathToFileURL(file).toString()); } catch { return new Response('Not found', { status: 404 }); }
  });
}

// The renderer calls the providers like the browser version does. Here the request leaves
// without Origin (as from a server) and the answer is let through to the app.
function allowProviders() {
  const filter = { urls: PROVIDERS };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, done) => {
    const headers = { ...details.requestHeaders }; delete headers.Origin; delete headers.Referer;
    done({ requestHeaders: headers });
  });
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, done) => {
    const headers = Object.fromEntries(Object.entries(details.responseHeaders || {}).filter(([k]) => !k.toLowerCase().startsWith('access-control-')));
    headers['Access-Control-Allow-Origin'] = [ORIGIN];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['authorization, content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, accept, x-github-api-version'];
    done(details.method === 'OPTIONS' ? { responseHeaders: headers, statusLine: 'HTTP/1.1 204 No Content' } : { responseHeaders: headers });
  });
}

// API keys: encrypted with the system keychain (Windows DPAPI, macOS Keychain, Linux Secret Service).
function keyVault() {
  const trusted = event => event.senderFrame?.url.startsWith(ORIGIN + '/');
  ipcMain.on('scrivia:protect', (event, text) => {
    event.returnValue = trusted(event) && typeof text === 'string' && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : null;
  });
  ipcMain.on('scrivia:reveal', (event, data) => {
    try { event.returnValue = trusted(event) && typeof data === 'string' ? safeStorage.decryptString(Buffer.from(data, 'base64')) : null; } catch { event.returnValue = null; }
  });
  ipcMain.on('scrivia:version', event => { event.returnValue = app.getVersion(); });
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 760, minHeight: 560, show: false, backgroundColor: '#f5f5f1', title: 'Scrivia',
    icon: path.join(WEB, 'icons', 'icon-512.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  win.webContents.session.setSpellCheckerLanguages(['it-IT', 'en-US']);
  // Links to other sites open in the default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(ORIGIN + '/')) { event.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); } });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(ORIGIN + '/index.html');
}

// Updates come from the GitHub releases (Windows installer and Linux AppImage; macOS needs a signed build).
function checkForUpdates() {
  if (!app.isPackaged || !(process.platform === 'win32' || process.env.APPIMAGE)) return;
  try { const { autoUpdater } = require('electron-updater'); void autoUpdater.checkForUpdatesAndNotify().catch(() => {}); } catch { /* offline */ }
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.whenReady().then(() => {
  // macOS needs the standard menu for copy, paste and quit; elsewhere the app uses its own toolbar.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  serveApp(); allowProviders(); keyVault(); registerLocalModels(ipcMain); createWindow(); checkForUpdates();
});
