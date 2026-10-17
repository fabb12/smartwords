// Knowledge bases: collections of texts by one author (the writer, or another author)
// from which style and mindset are extracted to guide the AI.
//
// Token strategy (same pattern as a LangChain "split → index → retrieve" pipeline,
// implemented locally so nothing heavy ships to the browser):
// 1. documents are split into ~900-character chunks along paragraphs and sentences;
// 2. a style/mindset profile is measured locally once, and can be distilled by the AI
//    once into a compact persona (a single call on a bounded, stratified sample);
// 3. for every request only the persona plus the 2–3 chunks most relevant to the
//    current text (BM25, computed on the device) are sent, never the whole corpus.
import { STOP, describeFingerprint, fingerprint, hash, normalize, sentencesOf, wordsOf, type Fingerprint } from './narrative.ts';
import { writingExpressions } from './writing-memory.ts';

export type KbKind = 'personal' | 'author';
export type KbFile = { id: string; name: string; format: string; words: number; added: number; hash: string };
export type KbChunk = { f: string; t: string };
export const PERSONA_FIELDS = [
  ['summary', 'In sintesi'], ['mindset', 'Mentalità'], ['values', 'Valori e convinzioni'], ['emotional', 'Registro emotivo'],
  ['reasoning', 'Modo di ragionare'], ['themes', 'Temi ricorrenti'], ['voice', 'Voce e ritmo'], ['lexicon', 'Lessico tipico'], ['avoid', 'Cosa evita'],
] as const;
export type PersonaKey = typeof PERSONA_FIELDS[number][0];
export type KbPersona = Partial<Record<PersonaKey, string>> & { distilled?: number };
export type KbLocal = { words: number; style: string; traits: string[]; themes: string[]; expressions: string[]; reliable: boolean };
export type KnowledgeBase = {
  version: 1; id: string; name: string; author: string; kind: KbKind; notes: string;
  files: KbFile[]; chunks: KbChunk[]; persona: KbPersona; local: KbLocal; created: number; updated: number;
};

export const KB_LIMITS = { chunks: 1600, chunkSize: 900, fileChars: 2_500_000, bases: 12 };
// Modes where the knowledge base shapes the generated text.
export const KB_MODES: readonly string[] = ['complete', 'rewrite', 'shorten', 'voice', 'continue', 'directions'];
const EMPTY_LOCAL: KbLocal = { words: 0, style: '', traits: [], themes: [], expressions: [], reliable: false };
const str = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : '';
const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;
const newId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

export function createKnowledgeBase(name: string, author: string, kind: KbKind, now = Date.now()): KnowledgeBase {
  return { version: 1, id: newId(), name: name.trim().slice(0, 80) || 'Knowledge base', author: author.trim().slice(0, 80), kind, notes: '', files: [], chunks: [], persona: {}, local: EMPTY_LOCAL, created: now, updated: now };
}

// Recursive splitter: paragraphs first, then sentences, then words; never mid-word.
export function splitText(text: string, size = KB_LIMITS.chunkSize): string[] {
  const out: string[] = []; let current = '';
  const push = (piece: string, sep: string) => {
    if (!piece) return;
    if (current && current.length + sep.length + piece.length > size) { out.push(current); current = ''; }
    current = current ? current + sep + piece : piece;
  };
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n\s*\n|\n/).map(p => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)) {
    if (para.length <= size) { push(para, '\n'); continue; }
    for (const sentence of sentencesOf(para)) {
      if (sentence.length <= size) { push(sentence, current && !current.endsWith('\n') ? ' ' : ''); continue; }
      let part = '';
      for (const word of sentence.split(/\s+/)) { if (part && part.length + 1 + word.length > size) { push(part, ' '); part = ''; } part = part ? part + ' ' + word : word.slice(0, size); }
      push(part, ' ');
    }
  }
  if (current) out.push(current);
  return out;
}

// Light normalisation for files converted from PDF: rejoin hyphenated and wrapped lines.
export function cleanExtractedText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/­/g, '').replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/([^\n.!?:;»”"])\n(?=\p{Ll})/gu, '$1 ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// A stratified sample: evenly spaced chunks, so a long book is represented end to end.
export function stratifiedSample(chunks: KbChunk[], budget: number, piece = 700): string {
  if (!chunks.length) return '';
  const count = Math.max(1, Math.min(chunks.length, Math.floor(budget / Math.min(piece, 400))));
  const parts: string[] = []; let used = 0;
  for (let i = 0; i < count; i++) {
    const c = chunks[Math.floor(i * chunks.length / count)];
    let t = c.t.length > piece ? c.t.slice(0, piece).replace(/\s+\S*$/u, '') + '…' : c.t;
    if (used + t.length + 2 > budget) { t = t.slice(0, Math.max(0, budget - used - 2)).replace(/\s+\S*$/u, ''); if (t.length < 80) break; }
    parts.push(t); used += t.length + 2;
  }
  return parts.join('\n\n');
}

const HEDGE = new Set('forse probabilmente sembra sembrava pare credo penso magari presumibilmente immagino suppongo perhaps maybe probably seems guess'.split(' '));
const CERTAIN = new Set('certamente sicuramente ovviamente assolutamente chiaramente indubbiamente evidentemente necessariamente certainly surely obviously clearly definitely'.split(' '));
const CAUSAL = new Set('perché poiché quindi dunque infatti pertanto perciò siccome because therefore thus hence'.split(' '));
const CONTRAST = new Set('ma però tuttavia eppure invece anzi nondimeno but however yet although'.split(' '));
const READER = new Set('tu ti te tuo tua voi vi vostro lettore lettrice you your'.split(' '));
const WE = new Set('noi nostro nostra nostri nostre we our us'.split(' '));
const POSITIVE = new Set('gioia amore felice felicità speranza bellezza bello bella luce meraviglia sorriso calore tenerezza fiducia entusiasmo stupore pace grazia joy love hope beauty wonder'.split(' '));
const NEGATIVE = new Set('paura dolore morte buio tristezza solitudine angoscia rabbia colpa perdita vuoto ferita lutto ansia disperazione fear pain death grief loss anger darkness'.split(' '));
const per1000 = (n: number, total: number) => total ? n * 1000 / total : 0;

// Mindset and attitude as they show in the prose (not a clinical or personal profile).
export function mentalTraits(text: string, fp: Fingerprint): string[] {
  const words = wordsOf(text.toLowerCase().replace(/’/g, "'")); const total = words.length;
  if (total < 150) return [];
  const count = (set: Set<string>) => words.filter(w => set.has(w)).length;
  const hedge = per1000(count(HEDGE), total), certain = per1000(count(CERTAIN), total), causal = per1000(count(CAUSAL), total), contrast = per1000(count(CONTRAST), total);
  const reader = per1000(count(READER), total), we = per1000(count(WE), total), pos = count(POSITIVE), neg = count(NEGATIVE);
  const abstract = per1000(words.filter(w => w.length > 6 && /(zione|zioni|ità|ismo|ismi|ezza|enza|anza|tion|ness|ity)$/.test(w)).length, total);
  const out: string[] = [];
  if (hedge > certain * 1.6 && hedge >= 2.5) out.push('dubitativa: procede per ipotesi e sfumature («forse», «sembra»)');
  else if (certain > hedge * 1.6 && certain >= 1.5) out.push('assertiva: afferma con sicurezza, poche riserve');
  if (causal >= 9) out.push('argomentativa: concatena cause e conseguenze');
  if (contrast >= 14) out.push('dialettica: mette in tensione idee opposte («ma», «eppure»)');
  if (fp.punctuation.question >= 6) out.push('interrogativa: si pone e pone domande');
  if (reader >= 6 && fp.dialogue < 0.25) out.push('si rivolge direttamente al lettore');
  if (we >= 6) out.push('inclusiva: usa spesso il «noi»');
  if (abstract >= 22) out.push('concettuale: lessico astratto, ragiona per idee');
  else if (abstract <= 8) out.push('concreta: preferisce cose, gesti e immagini alle astrazioni');
  if (pos + neg >= 6) out.push(pos > neg * 1.8 ? 'tono emotivo luminoso: meraviglia, fiducia, calore' : neg > pos * 1.8 ? 'tono emotivo cupo: perdita, paura, inquietudine' : 'emotività ambivalente: luce e ombra convivono');
  if (fp.punctuation.exclamation >= 5) out.push('enfatica: esclamazioni frequenti');
  return out.slice(0, 7);
}

// Distinctive content words, recurring across several chunks (names excluded).
export function kbThemes(chunks: KbChunk[], max = 10): string[] {
  const df = new Map<string, number>(), tf = new Map<string, number>(), capital = new Map<string, number>();
  for (const c of chunks) {
    const seen = new Set<string>();
    for (const raw of wordsOf(c.t)) {
      const w = raw.toLowerCase().replace(/’/g, "'");
      if (w.length < 5 || STOP.has(w) || /\d/.test(w) || /'/.test(w)) continue;
      tf.set(w, (tf.get(w) || 0) + 1); if (/^\p{Lu}/u.test(raw)) capital.set(w, (capital.get(w) || 0) + 1); seen.add(w);
    }
    for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
  }
  const n = chunks.length, minDf = n >= 6 ? 2 : 1;
  return [...tf].filter(([w, f]) => (df.get(w) || 0) >= minDf && f >= 3 && (capital.get(w) || 0) / f < 0.6)
    .map(([w, f]) => [w, f * Math.log(1 + n / (df.get(w) || 1))] as const).sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

// Measured once per change of files: bounded sample keeps it fast on whole books.
export function localProfile(chunks: KbChunk[]): KbLocal {
  if (!chunks.length) return EMPTY_LOCAL;
  const sample = stratifiedSample(chunks, 120000, 1200);
  const fp = fingerprint(sample);
  const sources = [{ id: 'kb', title: 'kb', sample, updated: 0 }];
  return { words: chunks.reduce((a, c) => a + wordsOf(c.t).length, 0), style: describeFingerprint(fp), traits: mentalTraits(sample, fp), themes: kbThemes(chunks), expressions: writingExpressions(sources), reliable: fp.reliable };
}

export function addKbDocument(kb: KnowledgeBase, name: string, format: string, text: string, now = Date.now()): KnowledgeBase {
  const clean = text.slice(0, KB_LIMITS.fileChars).trim();
  if (wordsOf(clean).length < 20) throw new Error(`«${name}»: testo insufficiente (servono almeno 20 parole leggibili).`);
  const h = hash(clean);
  if (kb.files.some(f => f.hash === h)) throw new Error(`«${name}» è già nella knowledge base.`);
  const pieces = splitText(clean);
  if (kb.chunks.length + pieces.length > KB_LIMITS.chunks) throw new Error(`La knowledge base è piena: «${name}» richiede ${pieces.length} blocchi, ne restano ${Math.max(0, KB_LIMITS.chunks - kb.chunks.length)}. Crea un’altra knowledge base o rimuovi un file.`);
  const file: KbFile = { id: newId(), name: name.slice(0, 150), format: format.slice(0, 10), words: wordsOf(clean).length, added: now, hash: h };
  const chunks = [...kb.chunks, ...pieces.map(t => ({ f: file.id, t }))];
  return { ...kb, files: [...kb.files, file], chunks, local: localProfile(chunks), updated: now };
}
export function removeKbFile(kb: KnowledgeBase, fileId: string, now = Date.now()): KnowledgeBase {
  const chunks = kb.chunks.filter(c => c.f !== fileId);
  return { ...kb, files: kb.files.filter(f => f.id !== fileId), chunks, local: localProfile(chunks), updated: now };
}

// ---------- Retrieval (BM25, on the device) ----------
const termsOf = (s: string) => wordsOf(normalize(s)).filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.slice(0, 6));
export type KbIndex = { tf: Map<string, number>[]; len: number[]; df: Map<string, number>; avg: number };
export function buildKbIndex(kb: KnowledgeBase): KbIndex {
  const df = new Map<string, number>(), tf: Map<string, number>[] = [], len: number[] = [];
  for (const c of kb.chunks) {
    const m = new Map<string, number>(), terms = termsOf(c.t);
    for (const t of terms) m.set(t, (m.get(t) || 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
    tf.push(m); len.push(terms.length);
  }
  return { tf, len, df, avg: len.length ? len.reduce((a, b) => a + b, 0) / len.length : 0 };
}
export function retrieveKb(kb: KnowledgeBase, index: KbIndex, query: string, k = 3): KbChunk[] {
  if (!kb.chunks.length) return [];
  const q = [...new Set(termsOf(query))], N = kb.chunks.length, k1 = 1.4, b = 0.75;
  const scored = kb.chunks.map((c, i) => {
    let s = 0;
    for (const t of q) { const f = index.tf[i]?.get(t); if (!f) continue; const d = index.df.get(t) || 0;
      s += Math.log(1 + (N - d + 0.5) / (d + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (index.len[i] || 0) / (index.avg || 1))); }
    return { c, i, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const chosen: KbChunk[] = [], files = new Map<string, number>();
  // Diversity: prefer chunks from different files once the best match is in.
  for (const x of scored) { if ((files.get(x.c.f) || 0) >= 2) continue; chosen.push(x.c); files.set(x.c.f, (files.get(x.c.f) || 0) + 1); if (chosen.length === k) break; }
  // Nothing in common with the current text: fall back to representative chunks for the style.
  if (!chosen.length) { const step = Math.max(1, Math.floor(N / k)), seed = parseInt(hash(query).slice(0, 4), 36) % step;
    for (let i = seed; i < N && chosen.length < k; i += step) chosen.push(kb.chunks[i]); }
  return chosen;
}
const trimTo = (t: string, max: number) => t.length <= max ? t : (t.slice(0, max).replace(/[^.!?…»”]*$/u, '') || t.slice(0, max).replace(/\s+\S*$/u, '')) .trim();

// Compact JSON for the model. Budgets are smaller for automatic completions (frequent).
export function kbInstruction(kb: KnowledgeBase, index: KbIndex, query: string, mode: string): string {
  const auto = mode === 'complete';
  const persona = Object.fromEntries(PERSONA_FIELDS.map(([key]) => [key, str(kb.persona[key], 300).trim()]).filter(([, v]) => v));
  const passages = retrieveKb(kb, index, query, auto ? 2 : 3).map(c => trimTo(c.t, auto ? 420 : 600));
  const data = {
    kind: 'knowledge-base', relation: kb.kind === 'personal' ? 'the writer themself' : 'another author whose style and mindset to emulate',
    name: kb.name, ...(kb.author ? { author: kb.author } : {}),
    ...(Object.keys(persona).length ? { persona } : {}),
    ...(kb.local.style ? { measuredStyle: kb.local.style, confidence: kb.local.reliable ? 'established' : 'provisional' } : {}),
    ...(kb.local.traits.length ? { mindsetSignals: kb.local.traits } : {}),
    ...(kb.local.themes.length ? { themes: kb.local.themes.slice(0, auto ? 6 : 10) } : {}),
    ...(kb.local.expressions.length ? { recurringExpressions: kb.local.expressions.slice(0, 6) } : {}),
    ...(kb.notes.trim() ? { authorNotes: kb.notes.trim().slice(0, 500) } : {}),
    ...(passages.length ? { relevantPassages: passages } : {}),
  };
  return JSON.stringify(data).slice(0, 4500);
}
// Rough estimate (≈4 characters per token) shown to the writer.
export const estimateTokens = (chars: number) => Math.ceil(chars / 4);
export function kbStats(kb: KnowledgeBase) {
  const chars = kb.chunks.reduce((a, c) => a + c.t.length, 0);
  return { files: kb.files.length, chunks: kb.chunks.length, words: kb.local.words, corpusTokens: estimateTokens(chars), distilled: !!kb.persona.distilled };
}

// ---------- Persona distillation (one AI call on a bounded sample) ----------
export const PERSONA_SAMPLE = 9500;
export function personaSample(kb: KnowledgeBase) { return stratifiedSample(kb.chunks, PERSONA_SAMPLE); }
export function parsePersona(answer: string, now = Date.now()): KbPersona {
  const start = answer.indexOf('{'), end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Risposta del modello non leggibile: riprova.');
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(answer.slice(start, end + 1)); } catch { throw new Error('Risposta del modello non leggibile: riprova.'); }
  const persona: KbPersona = { distilled: now };
  for (const [key] of PERSONA_FIELDS) { const v = raw[key]; const text = Array.isArray(v) ? v.filter(x => typeof x === 'string').join(', ') : str(v, 400); if (text.trim()) persona[key] = text.trim().slice(0, 300); }
  if (Object.keys(persona).length < 3) throw new Error('Il modello non ha restituito un profilo utilizzabile: riprova.');
  return persona;
}

// ---------- Which source is guiding the AI (shown in the interface) ----------
export type StyleSource = { kind: 'kb-personal' | 'kb-author' | 'famous' | 'custom' | 'memory' | 'document'; label: string; detail: string; extra?: string };
export function styleSource(o: { kb?: KnowledgeBase | null; voiceId: string; voiceName: string; memoryActive: boolean }): StyleSource {
  const voice = o.voiceId !== 'mine' ? (o.voiceId === 'custom' ? 'stile personalizzato' : o.voiceName) : '';
  if (o.kb) return { kind: o.kb.kind === 'personal' ? 'kb-personal' : 'kb-author', label: o.kb.name,
    detail: o.kb.kind === 'personal' ? 'Knowledge base personale' : `Knowledge base d’autore${o.kb.author ? ': ' + o.kb.author : ''}`, ...(voice ? { extra: voice } : {}) };
  if (o.voiceId === 'custom') return { kind: 'custom', label: 'Stile personalizzato', detail: 'Stile descritto nel progetto' };
  if (voice) return { kind: 'famous', label: o.voiceName, detail: 'Voce d’autore famoso (progetto)' };
  if (o.memoryActive) return { kind: 'memory', label: 'La mia voce', detail: 'Memoria personale della tua scrittura' };
  return { kind: 'document', label: 'Questo testo', detail: 'Solo lo stile del documento aperto' };
}

// ---------- Persistence format ----------
export function sanitizeKnowledgeBase(raw: unknown): KnowledgeBase | null {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  if (!r || !validId(r.id)) return null;
  const files = (Array.isArray(r.files) ? r.files : []).filter((f): f is KbFile => !!f && validId(f.id) && typeof f.name === 'string')
    .map(f => ({ id: f.id, name: str(f.name, 150), format: str(f.format, 10), words: Number(f.words) || 0, added: Number(f.added) || 0, hash: str(f.hash, 40) }));
  const ids = new Set(files.map(f => f.id));
  const chunks = (Array.isArray(r.chunks) ? r.chunks : []).filter((c): c is KbChunk => !!c && ids.has(c.f) && typeof c.t === 'string' && c.t.length > 0)
    .slice(0, KB_LIMITS.chunks).map(c => ({ f: c.f, t: c.t.slice(0, KB_LIMITS.chunkSize * 2) }));
  const p = r.persona && typeof r.persona === 'object' ? r.persona as Record<string, unknown> : {};
  const persona: KbPersona = {}; for (const [key] of PERSONA_FIELDS) { const v = str(p[key], 300).trim(); if (v) persona[key] = v; }
  if (typeof p.distilled === 'number') persona.distilled = p.distilled;
  const l = r.local && typeof r.local === 'object' ? r.local as Partial<KbLocal> : null;
  const strings = (v: unknown, n: number) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 120)).slice(0, n) : [];
  const local: KbLocal = l && typeof l.words === 'number' ? { words: l.words, style: str(l.style, 800), traits: strings(l.traits, 8), themes: strings(l.themes, 12), expressions: strings(l.expressions, 8), reliable: !!l.reliable } : localProfile(chunks);
  return { version: 1, id: r.id, name: str(r.name, 80) || 'Knowledge base', author: str(r.author, 80), kind: r.kind === 'author' ? 'author' : 'personal', notes: str(r.notes, 600),
    files, chunks, persona, local, created: Number(r.created) || 0, updated: Number(r.updated) || 0 };
}
export function exportKnowledgeBase(kb: KnowledgeBase) { return JSON.stringify({ format: 'scrivia-knowledge-base', base: kb }); }
export function importKnowledgeBase(text: string, now = Date.now()): KnowledgeBase {
  let raw: { format?: string; base?: unknown };
  try { raw = JSON.parse(text); } catch { throw new Error('Il file non è una knowledge base Scrivia.'); }
  if (raw?.format !== 'scrivia-knowledge-base') throw new Error('Il file non è una knowledge base Scrivia.');
  const kb = sanitizeKnowledgeBase(raw.base);
  if (!kb) throw new Error('Knowledge base non valida.');
  return { ...kb, id: newId(), updated: now };
}
