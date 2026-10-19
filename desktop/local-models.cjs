// Native loopback-only transport. No renderer CORS, arbitrary proxy URLs or redirects.
const ENDPOINTS = new Map([
  ['/api/tags', 'GET'], ['/api/v0/models', 'GET'], ['/v1/models', 'GET'], ['/v1/chat/completions', 'POST'],
]);
function validateLocalRequest(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(raw.id)) throw new Error('Richiesta locale non valida.');
  const url = new URL(raw.url);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || ENDPOINTS.get(url.pathname) !== raw.method) throw new Error('Endpoint locale non consentito.');
  if (typeof raw.token !== 'string' || raw.token.length > 4096 || /\s/.test(raw.token)) throw new Error('Token locale non valido.');
  if (raw.method === 'POST' && (typeof raw.body !== 'string' || Buffer.byteLength(raw.body) > 200_000)) throw new Error('Richiesta locale troppo grande.');
  return { id: raw.id, url: url.href, method: raw.method, token: raw.token, body: raw.method === 'POST' ? raw.body : undefined };
}
const trustedFrame = url => {
  try { const u = new URL(url); return u.protocol === 'app:' && u.host === 'scrivia' && !u.username && !u.password; } catch { return false; }
};

async function performLocalRequest(raw, send, signal) {
  const request = validateLocalRequest(raw);
  const response = await fetch(request.url, { method: request.method, body: request.body, redirect: 'error', signal,
    headers: { ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(request.token ? { Authorization: 'Bearer ' + request.token } : {}) } });
  send({ type: 'headers', status: response.status });
  if (response.body) {
    const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 2_000_000) throw new Error('Risposta locale troppo grande.');
        const text = decoder.decode(value, { stream: true }); if (text) send({ type: 'chunk', text });
      }
      const text = decoder.decode(); if (text) send({ type: 'chunk', text });
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  send({ type: 'done' });
}

function registerLocalModels(ipcMain) {
  const active = new Map();
  ipcMain.on('scrivia:local-request', (event, raw) => {
    if (!trustedFrame(event.senderFrame?.url)) return;
    let request;
    try { request = validateLocalRequest(raw); } catch { return; }
    const sender = event.sender, key = sender.id + ':' + request.id;
    const send = data => { if (!sender.isDestroyed() && trustedFrame(event.senderFrame?.url)) event.senderFrame.send('scrivia:local:' + request.id, data); };
    if (active.has(key) || [...active.keys()].filter(k => k.startsWith(sender.id + ':')).length >= 6) { send({ type: 'error', message: 'Troppe connessioni locali aperte.' }); return; }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), request.method === 'GET' ? 10000 : 120000);
    const disconnected = () => controller.abort();
    sender.once('destroyed', disconnected);
    active.set(key, controller);
    void performLocalRequest(request, send, controller.signal)
      .catch(() => { try { send({ type: 'error', message: 'Server locale non raggiungibile o risposta interrotta. Verifica che il server sia avviato.' }); } catch {} })
      .finally(() => { clearTimeout(timeout); sender.removeListener('destroyed', disconnected); active.delete(key); });
  });
  ipcMain.on('scrivia:local-cancel', (event, id) => {
    if (trustedFrame(event.senderFrame?.url) && typeof id === 'string') active.get(event.sender.id + ':' + id)?.abort();
  });
}
module.exports = { validateLocalRequest, trustedFrame, performLocalRequest, registerLocalModels };
