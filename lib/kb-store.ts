// Knowledge bases can hold whole books, so they live in IndexedDB (not localStorage,
// which is shared with documents and limited to a few MB). Scoped per owner.
// With a cloud account the bases are also saved in the account (table knowledge_bases), so they are
// still there after signing in again or on another device; IndexedDB stays as the local copy.
import { sanitizeKnowledgeBase, type KnowledgeBase } from './knowledge-base.ts';
import { activeCloud } from './cloud-state.ts';

// The cloud account that owns these bases, if the owner is the signed-in user.
function cloudFor(owner: string) { const cloud = activeCloud(); return cloud && cloud.userId === owner ? cloud : null; }
const route = (cloud: NonNullable<ReturnType<typeof activeCloud>>, body?: unknown, method = 'POST') => cloud.api('knowledge-bases', new URLSearchParams(), body, method);

const DB = 'scrivia-knowledge', STORE = 'bases';
const memory = new Map<string, KnowledgeBase>(); // fallback when IndexedDB is unavailable (private mode)
const key = (owner: string, id: string) => encodeURIComponent(owner) + ':' + id;

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
function done<T>(req: IDBRequest<T>): Promise<T> { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

// Local and cloud copies are merged: the most recent version of each base wins and is copied to the other side.
// A base that was already in the cloud and is gone from it was deleted on another device: it goes here too.
export async function listKnowledgeBases(owner = 'local'): Promise<KnowledgeBase[]> {
  const local = await listLocal(owner), cloud = cloudFor(owner);
  if (!cloud) return local;
  let remote: KnowledgeBase[];
  try { remote = ((await route(cloud)) as unknown[]).map(sanitizeKnowledgeBase).filter((k): k is KnowledgeBase => !!k); }
  catch (err) { console.warn('Knowledge base dal cloud:', (err as Error).message); return local; }
  const synced = readSynced(owner), merged = new Map<string, KnowledgeBase>();
  for (const kb of local) if (synced.has(kb.id) && !remote.some(k => k.id === kb.id)) await deleteLocal(kb.id, owner).catch(() => {});
  for (const kb of [...remote, ...local.filter(k => !synced.has(k.id) || remote.some(r => r.id === k.id))]) {
    const known = merged.get(kb.id); if (!known || kb.updated > known.updated) merged.set(kb.id, kb);
  }
  for (const kb of merged.values()) {
    const there = remote.find(k => k.id === kb.id), here = local.find(k => k.id === kb.id);
    try { if (!there || there.updated < kb.updated) await route(cloud, kb); synced.add(kb.id); }
    catch (err) { console.warn('Knowledge base non inviata al cloud:', (err as Error).message); }
    if (!here || here.updated < kb.updated) await saveLocal(kb, owner).catch(() => { /* the cloud copy is enough */ });
  }
  writeSynced(owner, new Set([...synced].filter(id => merged.has(id))));
  return [...merged.values()].sort((a, b) => b.updated - a.updated);
}
// Ids of the bases known to be in the cloud (device-only bookkeeping, never synced).
const syncedKey = (owner: string) => 'scrivia:kb-cloud:' + encodeURIComponent(owner);
function readSynced(owner: string): Set<string> { try { const v = JSON.parse(localStorage.getItem(syncedKey(owner)) || '[]'); return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []); } catch { return new Set(); } }
function writeSynced(owner: string, ids: Set<string>) { try { localStorage.setItem(syncedKey(owner), JSON.stringify([...ids])); } catch { /* recomputed next time */ } }
async function listLocal(owner: string): Promise<KnowledgeBase[]> {
  const prefix = encodeURIComponent(owner) + ':', db = await open();
  let raw: unknown[] = [];
  if (db) { try { const store = db.transaction(STORE).objectStore(STORE); const keys = await done(store.getAllKeys()); const values = await done(store.getAll());
    raw = values.filter((_, i) => String(keys[i]).startsWith(prefix)); } finally { db.close(); } }
  else raw = [...memory].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  return raw.map(sanitizeKnowledgeBase).filter((k): k is KnowledgeBase => !!k).sort((a, b) => b.updated - a.updated);
}
export async function saveKnowledgeBase(kb: KnowledgeBase, owner = 'local') {
  const cloud = cloudFor(owner);
  if (!cloud) return saveLocal(kb, owner);
  await saveLocal(kb, owner).catch(() => { /* the cloud copy is enough */ });
  try { await route(cloud, kb); } catch (err) { throw new Error('Knowledge base salvata solo su questo dispositivo: ' + (err as Error).message); }
  const synced = readSynced(owner); synced.add(kb.id); writeSynced(owner, synced);
}
async function saveLocal(kb: KnowledgeBase, owner: string) {
  const db = await open();
  if (!db) { memory.set(key(owner, kb.id), kb); return; }
  try { await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(kb, key(owner, kb.id))); }
  catch { throw new Error('Knowledge base non salvata: spazio del dispositivo insufficiente.'); }
  finally { db.close(); }
}
export async function deleteKnowledgeBase(id: string, owner = 'local') {
  const cloud = cloudFor(owner);
  if (cloud) { await route(cloud, { id }, 'DELETE'); const synced = readSynced(owner); synced.delete(id); writeSynced(owner, synced); }
  await deleteLocal(id, owner);
}
async function deleteLocal(id: string, owner: string) {
  const db = await open();
  if (!db) { memory.delete(key(owner, id)); return; }
  try { await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key(owner, id))); } finally { db.close(); }
}
const activeKey = (owner: string) => 'scrivia:kb-active:' + encodeURIComponent(owner);
export function readActiveKb(owner = 'local') { try { return localStorage.getItem(activeKey(owner)) || ''; } catch { return ''; } }
export function storeActiveKb(id: string, owner = 'local') { try { if (id) localStorage.setItem(activeKey(owner), id); else localStorage.removeItem(activeKey(owner)); } catch { /* per session only */ } }
