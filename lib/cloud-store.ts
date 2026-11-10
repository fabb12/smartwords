// Cloud routes on Supabase: the same operations as the browser backend (lib/local-backend.ts), but the
// documents, revisions, creative projects, AI profiles and activity of the signed-in user live in the
// database. API keys are encrypted by Supabase Vault and only fetched when a request to the provider is made.
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_PROJECT, sanitizeProject } from './project.ts';
import { isProvider } from './providers.ts';
import { docText, sanitizeStats, wordCount, type DocStats } from './activity.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const validText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const time = (v: unknown) => typeof v === 'string' ? Date.parse(v) : null;

// Supabase errors are technical: keep them out of the interface.
export function cloudError(error: { message?: string; code?: string } | null | undefined): Error {
  const code = error?.code || '', message = error?.message || '';
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message)) return new Error('Connessione al cloud non riuscita. Il testo resta nell’editor: riprova tra poco.');
  if (code === 'PGRST301' || /JWT/i.test(message)) return new Error('Sessione scaduta: accedi di nuovo.');
  if (code === '42P01' || code === 'PGRST205' || /schema cache|does not exist/i.test(message)) return new Error('Il database cloud non è pronto: esegui supabase/schema.sql nel SQL Editor di Supabase.');
  if (code === '42501') return new Error('Operazione non consentita per questo account.');
  return new Error(message || 'Operazione cloud non riuscita.');
}
function ok<T>(result: { data: T; error: { message?: string; code?: string } | null }): T {
  if (result.error) throw cloudError(result.error);
  return result.data;
}

export const DOC_SUMMARY = 'id,title,updated_at,version,created_at,word_count,char_count,work_seconds,edit_count,open_count,last_opened_at';
export function docStats(row: Row): DocStats {
  return { created: time(row.created_at) ?? 0, updated: time(row.updated_at) ?? 0, words: row.word_count ?? 0, chars: row.char_count ?? 0,
    workSeconds: Number(row.work_seconds) || 0, edits: row.edit_count ?? 0, opens: row.open_count ?? 0, lastOpened: time(row.last_opened_at) };
}
const summary = (row: Row) => ({ id: row.id as string, title: row.title as string, updated: time(row.updated_at) ?? 0, version: row.version as number, stats: docStats(row) });

const int = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0;
const CHANGED = 'Il documento è cambiato in un’altra scheda o su un altro dispositivo. Esporta la tua copia prima di ricaricare.';

export function createCloudApi(client: SupabaseClient, usage: (profileId: string) => number) {
  const keys = new Map<string, string>(); // API keys already fetched in this session, never written to disk
  const meta = new Map<string, { provider: string; model: string; limit: number }>();

  async function documents(params: URLSearchParams, body: Body, method: string) {
    const id = params.get('id');
    if (body === undefined) {
      if (id && params.has('history')) {
        const rows = ok(await client.from('document_revisions').select('id,title,content,created_at').eq('document_id', id).order('created_at', { ascending: false }).limit(30)) as Row[];
        return rows.map(r => ({ id: r.id, title: r.title, content: JSON.stringify(r.content), created: time(r.created_at) ?? 0 }));
      }
      if (id) {
        const row = ok(await client.from('documents').select(DOC_SUMMARY + ',content').eq('id', id).maybeSingle()) as Row | null;
        if (!row) throw new Error('Documento non trovato.');
        return { ...summary(row), content: JSON.stringify(row.content) };
      }
      return (ok(await client.from('documents').select(DOC_SUMMARY).order('updated_at', { ascending: false })) as Row[]).map(summary);
    }
    if (method === 'DELETE') {
      const gone = ok(await client.from('documents').delete().eq('id', body.id).select('id')) as Row[];
      if (!gone.length) throw new Error('Documento non trovato.');
      return { ok: true };
    }
    if (!validText(body.title, 150) || body.content?.type !== 'doc') throw new Error('Documento non valido.');
    const text = docText(body.content);
    const words = typeof body.words === 'number' ? int(body.words, 10_000_000) : wordCount(text);
    const chars = typeof body.chars === 'number' ? int(body.chars, 100_000_000) : text.length;
    if (!body.id) {
      const row = ok(await client.from('documents').insert({ title: body.title, content: body.content, word_count: words, char_count: chars }).select('id,version,updated_at').single()) as Row;
      return { id: row.id, version: row.version, updated: time(row.updated_at) ?? Date.now() };
    }
    const rows = ok(await client.from('documents').update({ title: body.title, content: body.content, version: (body.version || 0) + 1, word_count: words, char_count: chars })
      .eq('id', body.id).eq('version', body.version).select('version,updated_at')) as Row[];
    if (!rows.length) throw new Error(CHANGED);
    return { id: body.id, version: rows[0].version, updated: time(rows[0].updated_at) ?? Date.now() };
  }

  async function revisions(body: Body) {
    if (!validText(body?.title, 150) || body.content?.type !== 'doc') throw new Error('Versione non valida.');
    ok(await client.from('document_revisions').insert({ document_id: body.document, title: body.title, content: body.content }));
    return { ok: true };
  }

  async function projects(params: URLSearchParams, body: Body) {
    const document = params.get('document') || body?.document;
    if (!validText(document, 100)) throw new Error('Documento mancante.');
    if (body === undefined) {
      const row = ok(await client.from('documents').select('project').eq('id', document).maybeSingle()) as Row | null;
      return sanitizeProject(row?.project ?? EMPTY_PROJECT);
    }
    const rows = ok(await client.from('documents').update({ project: sanitizeProject(body.data) }).eq('id', document).select('id')) as Row[];
    if (!rows.length) throw new Error('Documento non trovato.');
    return { ok: true };
  }

  async function profiles(body: Body, method: string) {
    if (body === undefined) {
      const rows = ok(await client.from('api_profiles').select('id,name,provider,model,daily_limit,key_hint,created_at').order('created_at')) as Row[];
      meta.clear(); for (const r of rows) meta.set(r.id, { provider: r.provider, model: r.model, limit: r.daily_limit });
      return { vaultReady: true, profiles: rows.map(r => ({ id: r.id, name: r.name, provider: r.provider, model: r.model, hint: r.key_hint, daily_limit: r.daily_limit, used: usage(r.id), created: time(r.created_at) ?? 0 })) };
    }
    if (method === 'DELETE') { ok(await client.from('api_profiles').delete().eq('id', body.id)); keys.delete(body.id); meta.delete(body.id); return { ok: true }; }
    if (!validText(body.name, 80) || !isProvider(body.provider) || !validText(body.model, 150) || !Number.isInteger(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 10000) throw new Error('Controlla nome, provider, modello e limite.');
    const existing = body.id ? ok(await client.from('api_profiles').select('id,provider').eq('id', body.id).maybeSingle()) as Row | null : null;
    if (body.id && !existing) throw new Error('Profilo non trovato.');
    if (!body.key && (!existing || existing.provider !== body.provider)) throw new Error('Inserisci la chiave API del provider.');
    if (body.key && (!validText(body.key, 4096) || /\s/.test(body.key))) throw new Error('Chiave API non valida.');
    const fields = { name: body.name, provider: body.provider, model: body.model, daily_limit: body.dailyLimit };
    let id: string;
    meta.delete(body.id || '');
    if (existing) { ok(await client.from('api_profiles').update(fields).eq('id', existing.id)); id = existing.id; }
    else id = (ok(await client.from('api_profiles').insert(fields).select('id').single()) as Row).id;
    if (body.key) {
      const saved = await client.rpc('set_api_key', { p_profile: id, p_key: body.key });
      if (saved.error) { if (!existing) await client.from('api_profiles').delete().eq('id', id); throw cloudError(saved.error); }
      keys.set(id, body.key);
    }
    return { id };
  }

  return {
    async api(route: string, params: URLSearchParams, body: Body, method: string): Promise<Body> {
      switch (route) {
        case 'documents': return documents(params, body, method);
        case 'revisions': return revisions(body);
        case 'projects': return projects(params, body);
        case 'profiles': return profiles(body, method);
        case 'activity': {
          if (!validText(body?.document, 100) || !validText(body?.day, 10)) throw new Error('Attività non valida.');
          ok(await client.rpc('log_activity', { p_document: body.document, p_seconds: int(body.seconds, 3600), p_words: int(body.words, 200000), p_day: body.day }));
          return { ok: true };
        }
        case 'opened': ok(await client.rpc('mark_opened', { p_document: body?.document })); return { ok: true };
        case 'stats': return sanitizeStats(ok(await client.rpc('user_stats', { p_days: 120 })));
        default: throw new Error('Operazione non disponibile.');
      }
    },
    async resolveProfile(id: string) {
      if (!meta.has(id)) await profiles(undefined, 'GET');
      const m = meta.get(id); if (!m) return null;
      let key = keys.get(id);
      if (!key) { key = (ok(await client.rpc('get_api_key', { p_profile: id })) as string | null) || ''; if (key) keys.set(id, key); }
      return { ...m, key };
    },
    forget() { keys.clear(); meta.clear(); },
  };
}
