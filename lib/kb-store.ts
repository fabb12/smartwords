// Knowledge bases can hold whole books, so they live in IndexedDB (not localStorage,
// which is shared with documents and limited to a few MB). Scoped per owner.
import { sanitizeKnowledgeBase, type KnowledgeBase } from './knowledge-base';

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

export async function listKnowledgeBases(owner = 'local'): Promise<KnowledgeBase[]> {
  const prefix = encodeURIComponent(owner) + ':', db = await open();
  let raw: unknown[] = [];
  if (db) { try { const store = db.transaction(STORE).objectStore(STORE); const keys = await done(store.getAllKeys()); const values = await done(store.getAll());
    raw = values.filter((_, i) => String(keys[i]).startsWith(prefix)); } finally { db.close(); } }
  else raw = [...memory].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  return raw.map(sanitizeKnowledgeBase).filter((k): k is KnowledgeBase => !!k).sort((a, b) => b.updated - a.updated);
}
export async function saveKnowledgeBase(kb: KnowledgeBase, owner = 'local') {
  const db = await open();
  if (!db) { memory.set(key(owner, kb.id), kb); return; }
  try { await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(kb, key(owner, kb.id))); }
  catch { throw new Error('Knowledge base non salvata: spazio del dispositivo insufficiente.'); }
  finally { db.close(); }
}
export async function deleteKnowledgeBase(id: string, owner = 'local') {
  const db = await open();
  if (!db) { memory.delete(key(owner, id)); return; }
  try { await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key(owner, id))); } finally { db.close(); }
}
const activeKey = (owner: string) => 'scrivia:kb-active:' + encodeURIComponent(owner);
export function readActiveKb(owner = 'local') { try { return localStorage.getItem(activeKey(owner)) || ''; } catch { return ''; } }
export function storeActiveKb(id: string, owner = 'local') { try { if (id) localStorage.setItem(activeKey(owner), id); else localStorage.removeItem(activeKey(owner)); } catch { /* per session only */ } }
