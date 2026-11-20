import test from 'node:test';
import assert from 'node:assert/strict';
import { setActiveCloud } from '../lib/cloud-state.ts';
import { createKnowledgeBase } from '../lib/knowledge-base.ts';
import { deleteKnowledgeBase, listKnowledgeBases, saveKnowledgeBase } from '../lib/kb-store.ts';
import { readVoiceDefault, storeVoiceDefault } from '../lib/project.ts';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const U = '11111111-1111-1111-1111-111111111111';
function cloud() {
  const rows = new Map();
  setActiveCloud({ userId: U, async api(route, _p, body, method) {
    assert.equal(route, 'knowledge-bases');
    if (body === undefined) return [...rows.values()].map(v => structuredClone(v));
    if (method === 'DELETE') rows.delete(body.id); else rows.set(body.id, structuredClone(body));
    return { ok: true };
  } });
  return rows;
}

test('le knowledge base d’autore restano nell’account dopo un nuovo accesso o su un altro dispositivo', async () => {
  const rows = cloud();
  const kb = { ...createKnowledgeBase('Calvino', 'Italo Calvino', 'author'), updated: 10 };
  await saveKnowledgeBase(kb, U);
  assert.ok(rows.has(kb.id));
  // Another device: nothing local, the base comes from the cloud.
  const remoteOnly = { ...createKnowledgeBase('Levi', 'Primo Levi', 'author'), updated: 20 };
  rows.set(remoteOnly.id, remoteOnly);
  const list = await listKnowledgeBases(U);
  assert.deepEqual(list.map(k => k.name), ['Levi', 'Calvino']);
});

test('una base creata prima dell’accesso sale nel cloud; una eliminata altrove sparisce anche qui', async () => {
  const rows = cloud();
  setActiveCloud(null);
  const offline = { ...createKnowledgeBase('Bozza', '', 'personal'), updated: 5 };
  await saveKnowledgeBase(offline, U);
  rows.clear();
  const active = cloud();
  let list = await listKnowledgeBases(U);
  assert.ok(list.some(k => k.id === offline.id));
  assert.ok(active.has(offline.id));
  active.delete(offline.id); // deleted on another device
  list = await listKnowledgeBases(U);
  assert.ok(!list.some(k => k.id === offline.id));
  for (const k of list) await deleteKnowledgeBase(k.id, U);
  assert.equal((await listKnowledgeBases(U)).length, 0);
  setActiveCloud(null);
});

test('la voce d’autore scelta diventa quella dei nuovi documenti', () => {
  assert.equal(readVoiceDefault(U).id, 'mine');
  storeVoiceDefault({ id: 'mix', intensity: 'strong', custom: '', blend: [{ id: 'calvino', weight: 60 }, { id: 'levi', weight: 40 }] }, U);
  const v = readVoiceDefault(U);
  assert.equal(v.id, 'mix'); assert.equal(v.intensity, 'strong'); assert.equal(v.blend.length, 2);
});
