// Browser-only backend used by the static build (GitHub Pages): it mirrors the
// /api routes on top of localStorage and calls the AI providers directly.
import { ASSIST_MODES, assistPrompts, isProvider, providerError, providerRequest, readTokens, type Provider } from './providers';

type StoredDoc = { id: string; title: string; content: string; updated: number; version: number };
type StoredRevision = { id: string; title: string; content: string; created: number };
type StoredProfile = { id: string; name: string; provider: Provider; model: string; key: string; daily_limit: number; created: number };

declare global { interface Window { __SCRIVIA_LOCAL__?: boolean } }
// Request bodies mirror the JSON accepted by the /api routes and are validated field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const PREFIX = 'scrivia:';
function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
  catch { throw new Error('Spazio del browser esaurito: esporta e rimuovi immagini o documenti pesanti.'); }
}
const validText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const today = () => new Date().toISOString().slice(0, 10);
function usage(id: string) { const u = read<{ day: string; counts: Record<string, number> }>('usage', { day: today(), counts: {} }); return u.day === today() ? u.counts[id] || 0 : 0; }
function bumpUsage(id: string) { const u = read<{ day: string; counts: Record<string, number> }>('usage', { day: today(), counts: {} });
  const counts = u.day === today() ? u.counts : {}; counts[id] = (counts[id] || 0) + 1; write('usage', { day: today(), counts }); }

function addRevision(document: string, revision: StoredRevision) {
  const list = [revision, ...read<StoredRevision[]>('revisions:' + document, [])].sort((a, b) => b.created - a.created).slice(0, 30);
  write('revisions:' + document, list);
}

export async function localApi(path: string, body?: Body, method = 'POST'): Promise<Body> {
  const url = new URL(path, 'https://local.scrivia/'); const route = url.pathname.slice(1);
  const id = url.searchParams.get('id');
  if (route === 'documents') {
    const docs = read<StoredDoc[]>('documents', []);
    if (body === undefined) {
      if (id && url.searchParams.has('history')) return read<StoredRevision[]>('revisions:' + id, []);
      if (id) { const doc = docs.find(d => d.id === id); if (!doc) throw new Error('Documento non trovato.'); return doc; }
      return docs.map(({ id, title, updated, version }) => ({ id, title, updated, version })).sort((a, b) => b.updated - a.updated);
    }
    if (!validText(body.title, 150) || body.content?.type !== 'doc') throw new Error('Documento non valido.');
    const content = JSON.stringify(body.content); const now = Date.now();
    if (!body.id) { const doc = { id: crypto.randomUUID(), title: body.title, content, updated: now, version: 1 }; write('documents', [doc, ...docs]); return { id: doc.id, version: 1, updated: now }; }
    const old = docs.find(d => d.id === body.id && d.version === body.version);
    if (!old) throw new Error('Il documento è cambiato in un’altra scheda. Esporta la tua copia prima di ricaricare.');
    const recent = read<StoredRevision[]>('revisions:' + old.id, []).some(r => r.created > now - 60000);
    if (!recent) addRevision(old.id, { id: crypto.randomUUID(), title: old.title, content: old.content, created: old.updated });
    write('documents', docs.map(d => d.id === old.id ? { ...d, title: body.title, content, updated: now, version: d.version + 1 } : d));
    return { id: old.id, version: old.version + 1, updated: now };
  }
  if (route === 'revisions') {
    if (!validText(body?.title, 150) || body.content?.type !== 'doc') throw new Error('Versione non valida.');
    if (!read<StoredDoc[]>('documents', []).some(d => d.id === body.document)) throw new Error('Documento non trovato.');
    addRevision(body.document, { id: crypto.randomUUID(), title: body.title, content: JSON.stringify(body.content), created: Date.now() });
    return { ok: true };
  }
  if (route === 'profiles') {
    const profiles = read<StoredProfile[]>('profiles', []);
    if (body === undefined) return { vaultReady: true, profiles: profiles.map(({ key, ...p }) => ({ ...p, hint: key.slice(-4), used: usage(p.id) })) };
    if (method === 'DELETE') { write('profiles', profiles.filter(p => p.id !== body.id)); return { ok: true }; }
    if (!validText(body.name, 80) || !isProvider(body.provider) || !validText(body.model, 150) || !Number.isInteger(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 10000) throw new Error('Controlla nome, provider, modello e limite.');
    const existing = body.id ? profiles.find(p => p.id === body.id) : undefined;
    if (body.id && !existing) throw new Error('Profilo non trovato.');
    if (!body.key && (!existing || existing.provider !== body.provider)) throw new Error('Inserisci la chiave API del provider.');
    if (body.key && (!validText(body.key, 4096) || /\s/.test(body.key))) throw new Error('Chiave API non valida.');
    const profile: StoredProfile = { id: existing?.id || crypto.randomUUID(), name: body.name, provider: body.provider, model: body.model, key: body.key || existing!.key, daily_limit: body.dailyLimit, created: existing?.created || Date.now() };
    write('profiles', existing ? profiles.map(p => p.id === profile.id ? profile : p) : [...profiles, profile]);
    return { id: profile.id };
  }
  throw new Error('Operazione non disponibile.');
}

const failure = (error: string, status = 400) => Response.json({ error }, { status });
export async function localAssist(b: Body, signal: AbortSignal): Promise<Response> {
  if (!validText(b.profile, 100) || !validText(b.text, 10000) || !(ASSIST_MODES as readonly string[]).includes(b.mode)) return failure('Richiesta non valida.');
  const p = read<StoredProfile[]>('profiles', []).find(x => x.id === b.profile);
  if (!p || !isProvider(p.provider)) return failure('Configura e seleziona un profilo API.');
  if (usage(p.id) >= p.daily_limit) return failure('Limite giornaliero del profilo raggiunto.', 429);
  bumpUsage(p.id);
  const { system, prompt } = assistPrompts(b.mode, b.tone, b.text, b.context, b.after);
  const config = providerRequest(p.provider, p.model, p.key, system, prompt);
  if (p.provider === 'anthropic') config.headers['anthropic-dangerous-direct-browser-access'] = 'true';
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
  signal.addEventListener('abort', () => controller.abort(), { once: true });
  let upstream: Response;
  try { upstream = await fetch(config.url, { method: 'POST', headers: config.headers, body: JSON.stringify(config.body), signal: controller.signal }); }
  catch { clearTimeout(timer); return failure('Il provider non risponde o blocca le richieste dal browser. Riprova.', 502); }
  if (!upstream.ok || !upstream.body) { clearTimeout(timer); await upstream.body?.cancel(); return failure(providerError(upstream.status), upstream.status === 429 ? 429 : 502); }
  const provider = p.provider; const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(out) { try { let chars = 0;
      for await (const token of readTokens(upstream.body!, provider)) { chars += token.length; if (chars > 12000) throw new Error('Risposta troppo lunga.'); out.enqueue(encoder.encode(JSON.stringify({ text: token }) + '\n')); }
      out.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
    } catch { try { out.enqueue(encoder.encode(JSON.stringify({ error: 'Risposta interrotta. Riprova.' }) + '\n')); } catch {} }
      finally { clearTimeout(timer); try { out.close(); } catch {} } },
    cancel() { controller.abort(); clearTimeout(timer); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
}
