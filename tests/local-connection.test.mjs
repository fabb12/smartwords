import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once, EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { deviceModels } from '../lib/device-models.ts';
import { localModelFetch } from '../lib/local-transport.ts';
import { ollamaBrowserCommand } from '../lib/local-setup.ts';
import native from '../desktop/local-models.cjs';

async function server(t, handler) {
  const app = createServer(handler); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); return new Promise(resolve => app.close(resolve)); });
  return `http://127.0.0.1:${app.address().port}`;
}
const input = (url, extra = {}) => ({ id: 'test-id', url, method: 'GET', token: '', ...extra });

test('native desktop transport permits only loopback model endpoints, safe methods and bounded payloads', () => {
  for (const url of ['http://localhost:11434/api/tags', 'http://127.0.0.1:1234/api/v0/models', 'http://[::1]:11434/v1/models']) assert.equal(native.validateLocalRequest(input(url)).url, url);
  for (const url of ['https://example.com/v1/models', 'http://localhost.evil.test/v1/models', 'http://192.168.1.2/v1/models', 'file:///etc/passwd', 'http://user:pass@localhost/v1/models', 'http://localhost/v1/models?key=x', 'http://localhost/api/delete', 'http://localhost/v1/models#x']) assert.throws(() => native.validateLocalRequest(input(url)));
  assert.throws(() => native.validateLocalRequest(input('http://localhost/api/tags', { method: 'POST', body: '{}' })));
  assert.throws(() => native.validateLocalRequest(input('http://localhost/v1/chat/completions', { method: 'POST', body: 'x'.repeat(200001) })));
  assert.throws(() => native.validateLocalRequest(input('http://localhost/v1/models', { token: 'bad\nheader' })));
  assert.equal(native.trustedFrame('app://scrivia/index.html'), true);
  for (const url of ['https://scrivia/index.html', 'app://scrivia.evil/index.html', 'app://user@scrivia/index.html', undefined]) assert.equal(native.trustedFrame(url), false);
});

test('installed model discovery uses native Ollama and LM Studio lists, including unloaded LLMs', async t => {
  const paths = [];
  const base = await server(t, (req, res) => {
    paths.push(req.url); assert.equal(req.headers.authorization, 'Bearer local-token');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.2:latest' }, { name: 'qwen3:8b' }, {}] }));
    else if (req.url === '/api/v0/models') res.end(JSON.stringify({ data: [{ id: 'downloaded-llm', type: 'llm', state: 'not-loaded' }, { id: 'loaded-llm', type: 'llm', state: 'loaded' }, { id: 'embed-only', type: 'embeddings' }] }));
    else { res.writeHead(500); res.end(); }
  });
  assert.deepEqual(await deviceModels(base, 'local-token', undefined, '', 'ollama'), ['llama3.2:latest', 'qwen3:8b']);
  assert.deepEqual(await deviceModels(base, 'local-token', undefined, '', 'lmstudio'), ['downloaded-llm', 'loaded-llm']);
  assert.deepEqual(paths, ['/api/tags', '/api/v0/models']);
});

test('older local servers fall back to compatible discovery; authentication failures are actionable', async t => {
  let denied = false;
  const base = await server(t, (req, res) => {
    if (denied) { res.writeHead(401); res.end(); }
    else if (req.url !== '/v1/models') { res.writeHead(404); res.end(); }
    else { res.setHeader('Content-Type', 'application/json'); res.end('{"data":[{"id":"old-server-model"}]}'); }
  });
  for (const provider of ['ollama', 'lmstudio']) assert.deepEqual(await deviceModels(base, '', undefined, '', provider), ['old-server-model']);
  denied = true;
  await assert.rejects(() => deviceModels(base, '', undefined, '', 'lmstudio'), /token valido/);
});

test('native requests work against servers without CORS, preserve UTF-8 streaming and never follow redirects', async t => {
  let auth, origin, leaked = 0;
  const base = await server(t, (req, res) => {
    origin = req.headers.origin; auth = req.headers.authorization;
    if (req.url === '/v1/models') { res.writeHead(302, { Location: base + '/forbidden' }); res.end(); return; }
    if (req.url === '/forbidden') { leaked++; res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    const bytes = Buffer.from('È un modello locale'); res.write(bytes.subarray(0, 1)); setImmediate(() => res.end(bytes.subarray(1)));
  });
  const events = [];
  await native.performLocalRequest(input(base + '/api/tags', { token: 'secret' }), e => events.push(e), new AbortController().signal);
  assert.equal(origin, undefined); assert.equal(auth, 'Bearer secret');
  assert.equal(events.filter(e => e.type === 'chunk').map(e => e.text).join(''), 'È un modello locale');
  assert.equal(events[0].type, 'headers'); assert.equal(events.at(-1).type, 'done');
  await assert.rejects(() => native.performLocalRequest(input(base + '/v1/models', { token: 'secret' }), () => {}, new AbortController().signal));
  assert.equal(leaked, 0);
});

test('desktop IPC rejects foreign pages and delivers model responses only to the requesting frame', async t => {
  let calls = 0;
  const base = await server(t, (_req, res) => { calls++; res.end('{"models":[]}'); });
  const ipc = new EventEmitter(), sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false });
  native.registerLocalModels(ipc);
  ipc.emit('scrivia:local-request', { sender, senderFrame: { url: 'https://untrusted.test', send: () => assert.fail('foreign frame received data') } }, input(base + '/api/tags'));
  const events = [], done = new Promise(resolve => {
    ipc.emit('scrivia:local-request', { sender, senderFrame: { url: 'app://scrivia/index.html', send: (channel, e) => { assert.equal(channel, 'scrivia:local:test-id'); events.push(e); if (e.type === 'done') resolve(); } } }, input(base + '/api/tags'));
  });
  await done; assert.equal(calls, 1); assert.equal(events[0].status, 200);
});

test('native IPC cancellation is scoped to the requesting desktop window', async t => {
  let closed = false, finish;
  const disconnected = new Promise(resolve => { finish = resolve; });
  const base = await server(t, (_req, res) => { res.write('first chunk'); res.on('close', () => { closed = true; finish(); }); });
  const ipc = new EventEmitter(), sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false });
  const foreign = Object.assign(new EventEmitter(), { id: 2, isDestroyed: () => false });
  native.registerLocalModels(ipc);
  const frame = { url: 'app://scrivia/index.html', send: () => {} };
  await new Promise(resolve => {
    frame.send = (_channel, event) => { if (event.type === 'chunk') resolve(); };
    ipc.emit('scrivia:local-request', { sender, senderFrame: frame }, input(base + '/api/tags'));
  });
  ipc.emit('scrivia:local-cancel', { sender: foreign, senderFrame: frame }, 'test-id');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false);
  ipc.emit('scrivia:local-cancel', { sender, senderFrame: frame }, 'test-id');
  await disconnected; assert.equal(closed, true);
});

test('renderer transport uses the desktop bridge instead of browser fetch and propagates cancellation', async t => {
  const original = globalThis.fetch; let stopped = 0;
  globalThis.fetch = () => { throw new Error('Browser CORS blocked'); };
  globalThis.window = { scriviaDesktop: { localRequest: (_req, send) => {
    queueMicrotask(() => { send({ type: 'headers', status: 200 }); send({ type: 'chunk', text: 'Pronto: è locale' }); send({ type: 'done' }); });
    return () => { stopped++; };
  } } };
  t.after(() => { globalThis.fetch = original; delete globalThis.window; });
  const response = await localModelFetch('http://localhost:11434/api/tags', { signal: new AbortController().signal });
  assert.equal(await response.text(), 'Pronto: è locale'); assert.equal(stopped, 1);
  const controller = new AbortController();
  globalThis.window.scriviaDesktop.localRequest = (_req, send) => { queueMicrotask(() => send({ type: 'headers', status: 200 })); return () => { stopped++; }; };
  const pending = await localModelFetch('http://localhost:11434/api/tags', { signal: controller.signal });
  const text = pending.text(); controller.abort(); await assert.rejects(text, { name: 'AbortError' }); assert.equal(stopped, 2);
});

test('preload bridge removes listeners on completion and explicit cancellation and is included in installers', () => {
  const ipc = new EventEmitter(), sent = []; let bridge;
  ipc.sendSync = () => 'test'; ipc.send = (...args) => sent.push(args);
  vm.runInNewContext(readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), { process: { platform: 'linux' }, require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } } }) });
  const events = [], stop = bridge.localRequest({ id: 'request-1' }, e => events.push(e));
  ipc.emit('scrivia:local:request-1', {}, { type: 'done' });
  assert.equal(events.length, 1); assert.equal(ipc.listenerCount('scrivia:local:request-1'), 0);
  stop(); assert.equal(sent.at(-1)[0], 'scrivia:local-cancel');
  const files = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url))).build.files;
  assert.ok(files.includes('local-models.cjs'));
});

test('browser setup commands restrict CORS to the current origin and reject command injection', () => {
  const origin = 'https://fabb12.github.io';
  assert.equal(ollamaBrowserCommand(origin, 'windows'), '$env:OLLAMA_ORIGINS="https://fabb12.github.io"; ollama serve');
  assert.match(ollamaBrowserCommand(origin, 'mac'), /^launchctl setenv/);
  assert.equal(ollamaBrowserCommand('http://127.0.0.1:5173', 'linux'), "OLLAMA_ORIGINS='http://127.0.0.1:5173' ollama serve");
  for (const bad of ['*', "https://site'; bad", 'https://site/extra', 'app://scrivia']) assert.equal(ollamaBrowserCommand(bad, 'linux'), '');
});
