// Browser-only backend used by the static build (GitHub Pages): it mirrors the
// /api routes on top of localStorage and calls the AI providers directly.
import { ASSIST_MODES, assistPrompts, isProvider, providerError, providerRequest, type Provider } from './providers';
import { EMPTY_PROJECT, sanitizeProject } from './project';
import { assistStream } from './assist-stream';
import { desktop } from './desktop';
import { openaiSpeechRequest, speechError } from './read-aloud';
import { activeCloud } from './cloud-state';
import { docText, sanitizeStats, wordCount, type ActivityDay, type DocStats } from './activity';

type StoredDoc = { id: string; title: string; content: string; updated: number; version: number; created?: number; words?: number; chars?: number; workSeconds?: number; edits?: number; opens?: number; lastOpened?: number | null };
type StoredRevision = { id: string; title: string; content: string; created: number };
type StoredProfile = { id: string; name: string; provider: Provider; model: string; key: string; hint?: string; daily_limit: number; created: number };

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
// In the desktop app keys are stored encrypted with the system keychain ("enc:" prefix).
function seal(key: string) { const data = desktop()?.protect(key); return data ? 'enc:' + data : key; }
function unseal(key: string) { return key.startsWith('enc:') ? desktop()?.reveal(key.slice(4)) || '' : key; }
const validText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const today = () => new Date().toISOString().slice(0, 10);
// Daily request counters: with a cloud account they are kept per account (and synced with the other settings).
const usageKey = () => { const cloud = activeCloud(); return cloud ? 'usage:' + cloud.userId : 'usage'; };
export function usageToday(id: string) { const u = read<{ day: string; counts: Record<string, number> }>(usageKey(), { day: today(), counts: {} }); return u.day === today() ? u.counts[id] || 0 : 0; }
const usage = usageToday;
function bumpUsage(id: string) { const u = read<{ day: string; counts: Record<string, number> }>(usageKey(), { day: today(), counts: {} });
  const counts = u.day === today() ? u.counts : {}; counts[id] = (counts[id] || 0) + 1; write(usageKey(), { day: today(), counts }); }

// Statistics of a stored document; documents saved before this feature fall back to what is known.
function statsOf(d: StoredDoc): DocStats {
  const text = d.words === undefined ? docText(safeJson(d.content)) : '';
  return { created: d.created ?? d.updated, updated: d.updated, words: d.words ?? wordCount(text), chars: d.chars ?? text.length, workSeconds: d.workSeconds ?? 0,
    edits: d.edits ?? 0, opens: d.opens ?? 0, lastOpened: d.lastOpened ?? null };
}
function safeJson(text: string): unknown { try { return JSON.parse(text); } catch { return null; } }
const summaryOf = (d: StoredDoc) => ({ id: d.id, title: d.title, updated: d.updated, version: d.version, stats: statsOf(d) });

// The profile used for a request, with its key: from the cloud (decrypted on demand) or from this browser.
async function profileFor(id: string): Promise<{ provider: Provider; model: string; key: string; limit: number; id: string } | { error: string }> {
  const cloud = activeCloud();
  if (cloud) {
    try {
      const p = await cloud.resolveProfile(id);
      if (!p || !isProvider(p.provider)) return { error: 'Configura e seleziona un profilo API.' };
      return { provider: p.provider, model: p.model, key: p.key, limit: p.limit, id };
    } catch (error) { return { error: (error as Error).message }; }
  }
  const p = read<StoredProfile[]>('profiles', []).find(x => x.id === id);
  if (!p || !isProvider(p.provider)) return { error: 'Configura e seleziona un profilo API.' };
  return { provider: p.provider, model: p.model, key: unseal(p.key), limit: p.daily_limit, id };
}

function addRevision(document: string, revision: StoredRevision) {
  const list = [revision, ...read<StoredRevision[]>('revisions:' + document, [])].sort((a, b) => b.created - a.created).slice(0, 30);
  write('revisions:' + document, list);
}

export async function localApi(path: string, body?: Body, method = 'POST'): Promise<Body> {
  const url = new URL(path, 'https://local.scrivia/'); const route = url.pathname.slice(1);
  const cloud = activeCloud();
  if (cloud) return cloud.api(route, url.searchParams, body, method);
  const id = url.searchParams.get('id');
  if (route === 'activity') {
    if (!validText(body?.document, 100) || !validText(body?.day, 10)) throw new Error('Attività non valida.');
    const seconds = Math.min(3600, Math.max(0, Math.round(Number(body.seconds) || 0))), words = Math.min(200000, Math.max(0, Math.round(Number(body.words) || 0)));
    const docs = read<StoredDoc[]>('documents', []);
    if (!docs.some(d => d.id === body.document)) throw new Error('Documento non trovato.');
    write('documents', docs.map(d => d.id === body.document ? { ...d, workSeconds: (d.workSeconds ?? 0) + seconds } : d));
    const days = read<ActivityDay[]>('activity', []), today = days.find(d => d.day === body.day);
    if (today) { today.seconds += seconds; today.words += words; } else days.push({ day: body.day, seconds, words });
    write('activity', days.sort((a, b) => a.day.localeCompare(b.day)).slice(-730));
    return { ok: true };
  }
  if (route === 'opened') {
    write('documents', read<StoredDoc[]>('documents', []).map(d => d.id === body?.document ? { ...d, opens: (d.opens ?? 0) + 1, lastOpened: Date.now() } : d));
    return { ok: true };
  }
  if (route === 'stats') {
    const docs = read<StoredDoc[]>('documents', []).map(statsOf), days = read<ActivityDay[]>('activity', []);
    return sanitizeStats({ documents: docs.length, words: docs.reduce((n, d) => n + d.words, 0), characters: docs.reduce((n, d) => n + d.chars, 0),
      workSeconds: docs.reduce((n, d) => n + d.workSeconds, 0), firstDocumentAt: docs.length ? Math.min(...docs.map(d => d.created)) : null, days });
  }
  if (route === 'documents') {
    const docs = read<StoredDoc[]>('documents', []);
    if (body === undefined) {
      if (id && url.searchParams.has('history')) return read<StoredRevision[]>('revisions:' + id, []);
      if (id) { const doc = docs.find(d => d.id === id); if (!doc) throw new Error('Documento non trovato.'); return { ...summaryOf(doc), content: doc.content }; }
      return docs.map(summaryOf).sort((a, b) => b.updated - a.updated);
    }
    if (method === 'DELETE') {
      if (!docs.some(d => d.id === body.id)) throw new Error('Documento non trovato.');
      write('documents', docs.filter(d => d.id !== body.id));
      try { localStorage.removeItem(PREFIX + 'revisions:' + body.id); localStorage.removeItem(PREFIX + 'project:' + body.id); } catch { /* storage blocked: the document is already gone */ }
      return { ok: true };
    }
    if (!validText(body.title, 150) || body.content?.type !== 'doc') throw new Error('Documento non valido.');
    const content = JSON.stringify(body.content); const now = Date.now();
    const text = typeof body.words === 'number' && typeof body.chars === 'number' ? '' : docText(body.content);
    const words = typeof body.words === 'number' ? Math.max(0, Math.round(body.words)) : wordCount(text), chars = typeof body.chars === 'number' ? Math.max(0, Math.round(body.chars)) : text.length;
    if (!body.id) { const doc: StoredDoc = { id: crypto.randomUUID(), title: body.title, content, updated: now, version: 1, created: now, words, chars, workSeconds: 0, edits: 0, opens: 0, lastOpened: null }; write('documents', [doc, ...docs]); return { id: doc.id, version: 1, updated: now }; }
    const old = docs.find(d => d.id === body.id && d.version === body.version);
    if (!old) throw new Error('Il documento è cambiato in un’altra scheda. Esporta la tua copia prima di ricaricare.');
    const recent = read<StoredRevision[]>('revisions:' + old.id, []).some(r => r.created > now - 60000);
    if (!recent) addRevision(old.id, { id: crypto.randomUUID(), title: old.title, content: old.content, created: old.updated });
    const changed = old.content !== content || old.title !== body.title;
    write('documents', docs.map(d => d.id === old.id ? { ...d, title: body.title, content, updated: changed ? now : d.updated, version: d.version + 1, words, chars, created: d.created ?? d.updated, edits: (d.edits ?? 0) + (changed ? 1 : 0) } : d));
    return { id: old.id, version: old.version + 1, updated: changed ? now : old.updated };
  }
  if (route === 'revisions') {
    if (!validText(body?.title, 150) || body.content?.type !== 'doc') throw new Error('Versione non valida.');
    if (!read<StoredDoc[]>('documents', []).some(d => d.id === body.document)) throw new Error('Documento non trovato.');
    addRevision(body.document, { id: crypto.randomUUID(), title: body.title, content: JSON.stringify(body.content), created: Date.now() });
    return { ok: true };
  }
  if (route === 'profiles') {
    const profiles = read<StoredProfile[]>('profiles', []);
    if (body === undefined) return { vaultReady: true, profiles: profiles.map(({ key, hint, ...p }) => ({ ...p, hint: hint ?? key.slice(-4), used: usage(p.id) })) };
    if (method === 'DELETE') { write('profiles', profiles.filter(p => p.id !== body.id)); return { ok: true }; }
    if (!validText(body.name, 80) || !isProvider(body.provider) || !validText(body.model, 150) || !Number.isInteger(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 10000) throw new Error('Controlla nome, provider, modello e limite.');
    const existing = body.id ? profiles.find(p => p.id === body.id) : undefined;
    if (body.id && !existing) throw new Error('Profilo non trovato.');
    if (!body.key && (!existing || existing.provider !== body.provider)) throw new Error('Inserisci la chiave API del provider.');
    if (body.key && (!validText(body.key, 4096) || /\s/.test(body.key))) throw new Error('Chiave API non valida.');
    const profile: StoredProfile = { id: existing?.id || crypto.randomUUID(), name: body.name, provider: body.provider, model: body.model, key: body.key ? seal(body.key) : existing!.key, hint: body.key ? body.key.slice(-4) : existing!.hint ?? existing!.key.slice(-4), daily_limit: body.dailyLimit, created: existing?.created || Date.now() };
    write('profiles', existing ? profiles.map(p => p.id === profile.id ? profile : p) : [...profiles, profile]);
    return { id: profile.id };
  }
  if (route === 'projects') {
    const document = url.searchParams.get('document') || body?.document;
    if (!validText(document, 100)) throw new Error('Documento mancante.');
    if (body === undefined) return sanitizeProject(read('project:' + document, EMPTY_PROJECT));
    if (!read<StoredDoc[]>('documents', []).some(d => d.id === document)) throw new Error('Documento non trovato.');
    write('project:' + document, sanitizeProject(body.data));
    return { ok: true };
  }
  throw new Error('Operazione non disponibile.');
}

const failure = (error: string, status = 400) => Response.json({ error }, { status });
export async function localAssist(b: Body, signal: AbortSignal): Promise<Response> {
  if (!validText(b.profile, 100) || !validText(b.text, 10000) || !(ASSIST_MODES as readonly string[]).includes(b.mode)) return failure('Richiesta non valida.');
  const p = await profileFor(b.profile);
  if ('error' in p) return failure(p.error);
  if (usage(p.id) >= p.limit) return failure('Limite giornaliero del profilo raggiunto.', 429);
  const key = p.key;
  if (!key) return failure(activeCloud() ? 'Chiave API non trovata nel cloud: inseriscila di nuovo nel profilo.' : 'Chiave API non leggibile su questo computer: inseriscila di nuovo nel profilo.');
  bumpUsage(p.id);
  const { system, prompt, maxTokens, images } = assistPrompts(b);
  const config = providerRequest(p.provider, p.model, key, system, prompt, maxTokens, images);
  if (p.provider === 'anthropic') config.headers['anthropic-dangerous-direct-browser-access'] = 'true';
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), b.text.length>2000&&['complete','rewrite','format','voice','formal'].includes(b.mode)?120000:45000);
  signal.addEventListener('abort', () => controller.abort(), { once: true });
  let upstream: Response;
  try { upstream = await fetch(config.url, { method: 'POST', headers: config.headers, body: JSON.stringify(config.body), signal: controller.signal }); }
  catch { clearTimeout(timer); return failure('Il provider non risponde o blocca le richieste dal browser. Riprova.', 502); }
  if (!upstream.ok || !upstream.body) { clearTimeout(timer); await upstream.body?.cancel(); return failure(providerError(upstream.status), upstream.status === 429 ? 429 : 502); }
  const stream = assistStream(upstream.body, p.provider, { provider: p.provider, model: p.model, system, prompt }, () => { controller.abort(); clearTimeout(timer); });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
}

// Neural read-aloud with a stored OpenAI profile, called directly from the browser.
export async function localSpeech(b: Body, signal: AbortSignal): Promise<Response> {
  if (!validText(b.profile, 100) || !validText(b.text, 4000) || !validText(b.voice, 40) || !validText(b.model, 80)) return failure('Richiesta non valida.');
  const p = await profileFor(b.profile);
  if ('error' in p || p.provider !== 'openai') return failure('Per le voci neurali scegli un profilo OpenAI.');
  const key = p.key;
  if (!key) return failure(activeCloud() ? 'Chiave API non trovata nel cloud: inseriscila di nuovo nel profilo.' : 'Chiave API non leggibile su questo computer: inseriscila di nuovo nel profilo.');
  const config = openaiSpeechRequest(key, b.model, b.voice, { text: b.text });
  let upstream: Response;
  try { upstream = await fetch(config.url, { method: 'POST', headers: config.headers, body: JSON.stringify(config.body), signal }); }
  catch (error) { if (signal.aborted) throw error; return failure('Il servizio vocale non risponde. Riprova.', 502); }
  if (!upstream.ok) { await upstream.body?.cancel(); return failure(speechError(upstream.status), upstream.status === 429 ? 429 : 502); }
  return upstream;
}
