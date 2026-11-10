// Moves the data saved in this browser (documents, versions, creative projects, AI profiles with their keys)
// into the signed-in cloud account. The local copy is left untouched; what was moved is remembered so a
// second import never duplicates anything.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeProject } from './project.ts';
import { docText, wordCount } from './activity.ts';
import { adoptLocalSettings, type SyncStorage } from './cloud-sync.ts';

type LocalDoc = { id: string; title: string; content: string; updated: number; created?: number; words?: number; chars?: number; workSeconds?: number };
type LocalRevision = { title: string; content: string; created: number };
type LocalProfile = { id: string; name: string; provider: string; model: string; key: string; daily_limit: number };
export type ImportPlan = { documents: LocalDoc[]; profiles: LocalProfile[] };
type Done = { documents: string[]; profiles: string[] };

const PREFIX = 'scrivia:';
const doneKey = (owner: string) => PREFIX + 'cloud-imported:' + owner;
function read<T>(storage: SyncStorage, key: string, fallback: T): T { try { const raw = storage.getItem(PREFIX + key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function planImport(storage: SyncStorage, owner: string): ImportPlan {
  let done: Done = { documents: [], profiles: [] };
  try { const raw = JSON.parse(storage.getItem(doneKey(owner)) || 'null'); if (raw && Array.isArray(raw.documents) && Array.isArray(raw.profiles)) done = raw; } catch { /* nothing imported yet */ }
  const docs = read<LocalDoc[]>(storage, 'documents', []).filter(d => d && UUID.test(d.id) && typeof d.title === 'string' && d.title.trim() && typeof d.content === 'string' && !done.documents.includes(d.id));
  const profiles = read<LocalProfile[]>(storage, 'profiles', []).filter(p => p && typeof p.id === 'string' && !done.profiles.includes(p.id));
  return { documents: docs, profiles };
}

function remember(storage: SyncStorage, owner: string, documents: string[], profiles: string[]) {
  let done: Done = { documents: [], profiles: [] };
  try { const raw = JSON.parse(storage.getItem(doneKey(owner)) || 'null'); if (raw && Array.isArray(raw.documents) && Array.isArray(raw.profiles)) done = raw; } catch { /* start fresh */ }
  try { storage.setItem(doneKey(owner), JSON.stringify({ documents: [...done.documents, ...documents], profiles: [...done.profiles, ...profiles] })); } catch { /* it will be offered again */ }
}

export async function importLocalData(client: SupabaseClient, storage: SyncStorage, owner: string, reveal: (key: string) => string): Promise<{ documents: number; profiles: number; settings: number; skipped: number }> {
  const plan = planImport(storage, owner);
  let documents = 0, profiles = 0, skipped = 0;
  const importedDocs: string[] = [], importedProfiles: string[] = [];

  for (let i = 0; i < plan.documents.length; i += 10) {
    const chunk = plan.documents.slice(i, i + 10).flatMap(d => {
      try {
        const content = JSON.parse(d.content);
        if (content?.type !== 'doc') throw new Error('not a document');
        const text = docText(content), project = read<unknown>(storage, 'project:' + d.id, null);
        return [{ id: d.id, title: d.title.slice(0, 150), content, project: project ? sanitizeProject(project) : null, word_count: d.words ?? wordCount(text), char_count: d.chars ?? text.length,
          work_seconds: d.workSeconds ?? 0, created_at: new Date(d.created ?? d.updated).toISOString(), updated_at: new Date(d.updated).toISOString() }];
      } catch { skipped++; return []; }
    });
    if (!chunk.length) continue;
    const inserted = await client.from('documents').upsert(chunk, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (inserted.error) throw new Error(inserted.error.message);
    const fresh = new Set((inserted.data || []).map(r => r.id as string));
    documents += fresh.size;
    importedDocs.push(...chunk.map(d => d.id));
    const versions = chunk.filter(d => fresh.has(d.id)).flatMap(d => read<LocalRevision[]>(storage, 'revisions:' + d.id, []).slice(0, 30).flatMap(r => {
      try { const content = JSON.parse(r.content); return content?.type === 'doc' ? [{ document_id: d.id, title: String(r.title).slice(0, 150) || d.title, content, created_at: new Date(r.created).toISOString() }] : []; } catch { return []; }
    }));
    if (versions.length) { const saved = await client.from('document_revisions').insert(versions); if (saved.error) throw new Error(saved.error.message); }
  }

  if (plan.profiles.length) {
    const existing = await client.from('api_profiles').select('name,provider,model');
    if (existing.error) throw new Error(existing.error.message);
    const have = new Set((existing.data || []).map(p => [p.name, p.provider, p.model].join('\u0000')));
    for (const p of plan.profiles) {
      const key = typeof p.key === 'string' ? (p.key.startsWith('enc:') ? reveal(p.key.slice(4)) : p.key) : '';
      if (!key) { skipped++; continue; }
      if (have.has([p.name, p.provider, p.model].join('\u0000'))) { importedProfiles.push(p.id); continue; }
      const created = await client.from('api_profiles').insert({ name: p.name, provider: p.provider, model: p.model, daily_limit: p.daily_limit }).select('id').single();
      if (created.error) throw new Error(created.error.message);
      const saved = await client.rpc('set_api_key', { p_profile: created.data.id, p_key: key });
      if (saved.error) { await client.from('api_profiles').delete().eq('id', created.data.id); throw new Error(saved.error.message); }
      profiles++; importedProfiles.push(p.id);
    }
  }

  const settings = adoptLocalSettings(storage, owner);
  remember(storage, owner, importedDocs, importedProfiles);
  return { documents, profiles, settings, skipped };
}
