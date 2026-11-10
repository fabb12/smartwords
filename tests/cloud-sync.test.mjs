import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptLocalSettings, clearSyncedSettings, createSettingsSync, isSyncedKey, joinReadAloud, splitReadAloud } from '../lib/cloud-sync.ts';
import { WorkClock, docText, formatDuration, localDay, recentDays, sanitizeStats, writingStreak, wordCount } from '../lib/activity.ts';

class Storage {
  map = new Map();
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
function backend(rows = [], secrets = {}) {
  const b = { rows: new Map(rows.map(r => [r.key, r.value])), secrets: { ...secrets }, puts: [], removed: [], secretCalls: [] };
  b.list = async () => [...b.rows].map(([key, value]) => ({ key, value }));
  b.put = async r => { b.puts.push(r); for (const x of r) b.rows.set(x.key, x.value); };
  b.remove = async k => { b.removed.push(k); for (const x of k) b.rows.delete(x); };
  b.getSecret = async n => b.secrets[n] ?? null;
  b.setSecret = async (n, v) => { b.secretCalls.push(['set', n, v]); b.secrets[n] = v; };
  b.deleteSecret = async n => { b.secretCalls.push(['delete', n]); delete b.secrets[n]; };
  return b;
}
const U = '11111111-1111-1111-1111-111111111111';

test('solo le impostazioni dell’utente corrente vengono sincronizzate, mai i token', () => {
  for (const k of ['scrivia:theme', 'scrivia:read-aloud', `scrivia:ai-preferences:${U}`, `scrivia:writing-rules:${U}`, `scrivia:toolbars:v1:${U}:normal`, `scrivia:doc-groups:${U}`, `scrivia:usage:${U}`])
    assert.ok(isSyncedKey(k, U), k);
  for (const k of ['scrivia:github-token', 'scrivia:github-settings', 'scrivia:device-profiles', 'scrivia:profiles', 'scrivia:documents', 'scrivia:simple', 'scrivia:ai-preferences:local', 'scrivia:ai-preferences:' + U + 'x', 'scrivia:ai-preferences:22222222-2222-2222-2222-222222222222', 'scrivia-auth', 'scrivia:kb-active:' + U])
    assert.ok(!isSyncedKey(k, U), k);
});

test('la chiave ElevenLabs viaggia come segreto, non come impostazione', () => {
  const raw = JSON.stringify({ engine: 'elevenlabs', elevenKey: 'sk-eleven', rate: 1.2 });
  const { value, secret } = splitReadAloud(raw);
  assert.equal(secret, 'sk-eleven'); assert.ok(!value.includes('sk-eleven')); assert.equal(JSON.parse(value).rate, 1.2);
  assert.equal(JSON.parse(joinReadAloud(value, 'sk-eleven')).elevenKey, 'sk-eleven');
  assert.equal(joinReadAloud(value, null), value);
  assert.deepEqual(splitReadAloud('non json'), { value: 'non json', secret: '' });
});

test('al primo accesso il cloud vince, le impostazioni solo locali salgono', async () => {
  const storage = new Storage(), b = backend([{ key: 'scrivia:theme', value: '"dark"' }, { key: `scrivia:writing-rules:${U}`, value: '{"x":1}' }]);
  storage.setItem('scrivia:theme', '"light"'); storage.setItem('scrivia:zoom', '"page"'); storage.setItem('scrivia:github-token', 'ghp_secret');
  const sync = createSettingsSync({ owner: U, storage, backend: b, intervalMs: 1e9 });
  await sync.pull(); sync.stop();
  assert.equal(storage.getItem('scrivia:theme'), '"dark"');
  assert.equal(storage.getItem(`scrivia:writing-rules:${U}`), '{"x":1}');
  assert.deepEqual(b.puts.flat().map(r => r.key), ['scrivia:zoom']);
  assert.ok(![...b.rows.keys()].includes('scrivia:github-token'));
});

test('le modifiche locali vengono inviate una volta sola; le cancellazioni arrivano al cloud', async () => {
  const storage = new Storage(), b = backend(), errors = [];
  const sync = createSettingsSync({ owner: U, storage, backend: b, intervalMs: 1e9, onError: e => errors.push(e) });
  await sync.pull();
  storage.setItem(`scrivia:ai-preferences:${U}`, '{"trigger":"tab"}');
  await sync.push(); await sync.push();
  assert.equal(b.puts.length, 1);
  storage.removeItem(`scrivia:ai-preferences:${U}`);
  await sync.push();
  assert.deepEqual(b.removed, [[`scrivia:ai-preferences:${U}`]]);
  sync.stop(); assert.deepEqual(errors, []);
});

test('read-aloud: il segreto parte solo quando cambia e torna sul dispositivo', async () => {
  const storage = new Storage(), b = backend([{ key: 'scrivia:read-aloud', value: '{"engine":"auto"}' }], { elevenlabs: 'k1' });
  const sync = createSettingsSync({ owner: U, storage, backend: b, intervalMs: 1e9 });
  await sync.pull();
  assert.equal(JSON.parse(storage.getItem('scrivia:read-aloud')).elevenKey, 'k1');
  storage.setItem('scrivia:read-aloud', JSON.stringify({ engine: 'auto', rate: 1.5, elevenKey: 'k1' }));
  await sync.push();
  assert.deepEqual(b.secretCalls, [], 'stessa chiave: nessun invio');
  assert.ok(!b.rows.get('scrivia:read-aloud').includes('k1'));
  storage.setItem('scrivia:read-aloud', JSON.stringify({ engine: 'auto', elevenKey: 'k2' }));
  await sync.push();
  assert.deepEqual(b.secretCalls, [['set', 'elevenlabs', 'k2']]);
  storage.setItem('scrivia:read-aloud', JSON.stringify({ engine: 'auto' }));
  await sync.push();
  assert.deepEqual(b.secretCalls.at(-1), ['delete', 'elevenlabs']);
  sync.stop();
});

test('un errore di rete non perde le modifiche: riprovano al giro dopo', async () => {
  const storage = new Storage(), b = backend(), errors = []; let fail = true; const put = b.put;
  b.put = async r => { if (fail) throw new Error('offline'); return put(r); };
  const sync = createSettingsSync({ owner: U, storage, backend: b, intervalMs: 1e9, onError: e => errors.push(e.message) });
  await sync.pull(); storage.setItem('scrivia:mode', '"libera"');
  await sync.push(); assert.deepEqual(errors, ['offline']);
  fail = false; await sync.push();
  assert.equal(b.rows.get('scrivia:mode'), '"libera"'); sync.stop();
});

test('uscita: le impostazioni dell’account spariscono, il resto no; adozione dei dati «local»', () => {
  const storage = new Storage();
  storage.setItem(`scrivia:writing-rules:${U}`, 'a'); storage.setItem('scrivia:theme', 'b'); storage.setItem('scrivia:github-token', 'c'); storage.setItem('scrivia:documents', 'd');
  clearSyncedSettings(storage, U);
  assert.deepEqual([...storage.map.keys()].sort(), ['scrivia:documents', 'scrivia:github-token']);
  storage.setItem('scrivia:writing-rules:local', 'rules'); storage.setItem('scrivia:toolbars:v1:local:normal', 'bars'); storage.setItem(`scrivia:doc-groups:${U}`, 'mine');
  storage.setItem('scrivia:doc-groups:local', 'old');
  assert.equal(adoptLocalSettings(storage, U), 2);
  assert.equal(storage.getItem(`scrivia:writing-rules:${U}`), 'rules');
  assert.equal(storage.getItem(`scrivia:toolbars:v1:${U}:normal`), 'bars');
  assert.equal(storage.getItem(`scrivia:doc-groups:${U}`), 'mine', 'non sovrascrive');
});

test('il tempo di scrittura conta solo con la pagina visibile e attività recente', () => {
  const clock = new WorkClock(60_000); let t = 1_000_000; clock.touch(t); clock.tick(t, true);
  for (let i = 0; i < 30; i++) { t += 1000; clock.tick(t, true); }
  assert.equal(clock.peek(), 30);
  for (let i = 0; i < 10; i++) { t += 1000; clock.tick(t, false); }
  assert.equal(clock.peek(), 30, 'pagina nascosta: il tempo non corre');
  t += 120_000; clock.touch(t); clock.tick(t, true); assert.equal(clock.peek(), 35, 'un timer sospeso aggiunge al massimo 5 secondi');
  for (let i = 0; i < 100; i++) { t += 1000; clock.tick(t, true); }
  assert.ok(clock.peek() < 35 + 61, 'dopo 60 secondi senza attività il tempo si ferma');
  const after = clock.peek(); assert.equal(clock.take(), after); assert.equal(clock.peek(), 0);
});

test('prelievo e restituzione dei secondi', () => {
  const clock = new WorkClock(); let t = 0; clock.touch(0); clock.tick(0, true);
  for (let i = 0; i < 7; i++) { t += 1500; clock.touch(t); clock.tick(t, true); }
  const taken = clock.take(); assert.equal(taken, 10);
  clock.restore(taken); assert.equal(clock.peek(), 10);
});

test('statistiche: serie di giorni, ultimi giorni, durata e testo dei documenti', () => {
  const today = '2026-11-10', days = [{ day: '2026-11-10', seconds: 60, words: 5 }, { day: '2026-11-09', seconds: 10, words: 0 }, { day: '2026-11-07', seconds: 90, words: 9 }];
  assert.equal(writingStreak(days, today), 2);
  assert.equal(writingStreak([{ day: '2026-11-09', seconds: 5, words: 0 }], today), 1, 'oggi non ancora iniziato');
  assert.equal(writingStreak([{ day: '2026-11-07', seconds: 5, words: 0 }], today), 0);
  const recent = recentDays(days, today, 5); assert.deepEqual(recent.map(d => d.day), ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']); assert.equal(recent[2].seconds, 0);
  assert.deepEqual([formatDuration(5), formatDuration(600), formatDuration(3660), formatDuration(7200)], ['5 s', '10 min', '1 h 1 min', '2 h']);
  assert.equal(localDay(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(sanitizeStats({ documents: '3', words: 10.4, days: [{ day: 'x' }, { day: '2026-01-01', seconds: -5, words: 2 }], firstDocumentAt: '2026-01-01T00:00:00Z' }).days.length, 1);
  assert.equal(wordCount(docText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno due' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'tre' }] }] })), 3);
});
