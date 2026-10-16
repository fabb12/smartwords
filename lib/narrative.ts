// Narrative intelligence that runs in the browser, with no AI calls: manuscript structure,
// the author's style fingerprint, scene intent, story memory with verifiable evidence,
// conflict detection and passage retrieval for questions about the manuscript.

// ---------- Manuscript structure ----------

// A textblock of the document. map[i] is the document position of text[i], so a quote found
// in the text can be selected exactly in the editor.
export type Block = { pos: number; text: string; heading: number; map: number[] };
export type Chapter = { index: number; title: string; pos: number; blocks: Block[]; text: string };

type PMNode = { isText: boolean; isTextblock: boolean; text?: string | null; type: { name: string }; attrs: Record<string, unknown>;
  descendants(f: (node: PMNode, pos: number) => boolean | void): void; forEach(f: (node: PMNode, offset: number) => void): void };

export function blocksFromDoc(doc: unknown): Block[] {
  const blocks: Block[] = [];
  (doc as PMNode).descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = ''; const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) { for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i); text += child.text; }
      else if (child.type.name === 'hardBreak') { map.push(pos + 1 + offset); text += '\n'; }
    });
    blocks.push({ pos: pos + 1, text, heading: node.type.name === 'heading' ? Number(node.attrs.level) || 1 : 0, map });
    return false;
  });
  return blocks;
}

// Chapters start at level 1–2 headings. Without headings, long texts are cut into parts.
export function chapters(blocks: Block[], partSize = 6000): Chapter[] {
  const out: Chapter[] = [];
  const open = (title: string, pos: number) => { out.push({ index: out.length, title, pos, blocks: [], text: '' }); };
  const hasHeadings = blocks.some(b => b.heading && b.heading <= 2 && b.text.trim());
  for (const b of blocks) {
    if (hasHeadings && b.heading && b.heading <= 2 && b.text.trim()) { open(b.text.trim().slice(0, 80), b.pos); continue; }
    if (!out.length) open(hasHeadings ? 'Inizio' : 'Parte 1', b.pos);
    let last = out[out.length - 1];
    if (!hasHeadings && last.text.length > partSize) { open('Parte ' + (out.length + 1), b.pos); last = out[out.length - 1]; }
    last.blocks.push(b); if (b.text.trim()) last.text += (last.text ? '\n' : '') + b.text;
  }
  return out.filter(c => c.text.trim() || c.blocks.length);
}

export function chapterAt(chs: Chapter[], pos: number): Chapter | undefined {
  let found: Chapter | undefined; for (const c of chs) if (c.pos <= pos) found = c; return found || chs[0];
}

// FNV-1a: cheap fingerprint of a chapter to skip re-analysing unchanged text.
export function hash(text: string): string {
  let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// ---------- Text normalisation and evidence ----------

const QUOTES: Record<string, string> = { '’': "'", '‘': "'", '`': "'", '´': "'", '“': '"', '”': '"', '«': '"', '»': '"', '„': '"', '—': '-', '–': '-' };
// Normalised text plus, for each normalised character, the index of the original one.
function normalizeMap(s: string): { text: string; index: number[] } {
  let text = ''; const index: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = QUOTES[s[i]] ?? s[i].toLowerCase();
    if (/\s/.test(c)) { if (!text || text.endsWith(' ')) continue; c = ' '; }
    if (c.length !== 1) c = c[0];
    text += c; index.push(i);
  }
  return { text, index };
}
export function normalize(s: string): string { return normalizeMap(s).text.trim(); }

export type Evidence = { from: number; to: number; chapter: string; quote: string };
// Finds a quote in the manuscript, tolerant of typographic quotes, case, spacing and of an
// ellipsis inside the quote. Returns null when the quote is not really in the text.
export function locate(chs: Chapter[], quote: string, chapterHint?: string): Evidence | null {
  const parts = normalize(quote.replace(/^["'«“\s]+|["'»”\s]+$/g, '')).split(/\s*(?:\.\.\.|…|\[…\]|\(…\))\s*/).map(p => p.trim()).filter(p => p.length >= 6);
  if (!parts.length) return null;
  const needle = parts.sort((a, b) => b.length - a.length)[0];
  const ordered = chapterHint ? [...chs].sort((a, b) => Number(b.title === chapterHint) - Number(a.title === chapterHint)) : chs;
  for (const c of ordered) for (const b of c.blocks) {
    const n = normalizeMap(b.text); const at = n.text.indexOf(needle);
    if (at < 0) continue;
    const start = n.index[at], end = n.index[at + needle.length - 1];
    return { from: b.map[start] ?? b.pos, to: (b.map[end] ?? b.pos) + 1, chapter: c.title, quote: b.text.slice(start, end + 1) };
  }
  return null;
}

// ---------- Style fingerprint ----------

const STOP = new Set(('a ad al allo alla ai agli alle anche ancora avere aveva avevo che chi ci con come cosa così da dal dallo dalla dai dagli dalle dei degli delle del dello della di dove e ed è era erano essere fa fare fu già gli ha hanno ho i il in io la le lei li lo loro lui ma me mi mia mie miei mio ne nei negli nel nello nella nelle no noi non nostro o ogni per perché più poi quando quella quelle quelli quello questa queste questi questo qui se sé sei si sia siamo sono sopra sotto su sua sue sui suoi suo sul sullo sulla sulle tra fra tu tua tue tuo tuoi tutto tutti tutta tutte un una uno vi voi era stato stata essere sempre solo mai poco molto tanto quel quei ancora allora dopo prima mentre senza verso fino anzi però quindi oppure' +
  ' the and of to in that it is was he she his her for on with as at by an be this had not but from or have they you which').split(' '));

export type Fingerprint = {
  words: number; sentences: number; avgSentence: number; spread: number; avgParagraph: number; dialogue: number;
  richness: number; avgWord: number; punctuation: Record<'semicolon' | 'colon' | 'ellipsis' | 'exclamation' | 'question' | 'dash', number>;
  person: 'prima' | 'terza' | 'mista'; signature: string[]; reliable: boolean;
};

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
export const wordsOf = (s: string) => s.match(WORD) || [];
export function sentencesOf(s: string): string[] {
  return (s.match(/[^.!?…\n]+(?:[.!?…]+["»”’)]*|$)/g) || []).map(x => x.trim()).filter(x => wordsOf(x).length > 0);
}
const DIALOGUE_START = /^\s*(?:[«"“—–]|-\s)/;

export function fingerprint(text: string): Fingerprint {
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const words = wordsOf(text); const sentences = paragraphs.flatMap(sentencesOf);
  const lengths = sentences.map(s => wordsOf(s).length);
  const avgSentence = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const spread = lengths.length ? Math.sqrt(lengths.reduce((a, b) => a + (b - avgSentence) ** 2, 0) / lengths.length) : 0;
  const lower = words.map(w => w.toLowerCase().replace(/’/g, "'"));
  // Standardised type/token ratio over 50-word windows, so short and long texts compare fairly.
  const windows: number[] = []; for (let i = 0; i + 50 <= lower.length; i += 50) windows.push(new Set(lower.slice(i, i + 50)).size / 50);
  const richness = windows.length ? windows.reduce((a, b) => a + b, 0) / windows.length : lower.length ? new Set(lower).size / lower.length : 0;
  const per1000 = (re: RegExp) => words.length ? Math.round(((text.match(re) || []).length / words.length) * 10000) / 10 : 0;
  const narration = paragraphs.filter(p => !DIALOGUE_START.test(p)).join(' ').toLowerCase();
  const count = (list: string[]) => wordsOf(narration).filter(w => list.includes(w.toLowerCase())).length;
  const first = count(['io', 'mi', 'me', 'mio', 'mia', 'miei', 'mie', 'ero', 'avevo', 'sono', 'ho', 'noi', 'ci']);
  const third = count(['lui', 'lei', 'egli', 'ella', 'loro', 'suo', 'sua', 'suoi', 'sue', 'aveva', 'era', 'erano']);
  const freq = new Map<string, number>();
  for (const w of lower) if (w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)) freq.set(w, (freq.get(w) || 0) + 1);
  const signature = [...freq.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  return {
    words: words.length, sentences: sentences.length, avgSentence: round(avgSentence), spread: round(spread),
    avgParagraph: paragraphs.length ? round(words.length / paragraphs.length) : 0,
    dialogue: paragraphs.length ? round(paragraphs.filter(p => DIALOGUE_START.test(p)).length / paragraphs.length, 2) : 0,
    richness: round(richness, 2), avgWord: lower.length ? round(lower.reduce((a, w) => a + w.length, 0) / lower.length, 2) : 0,
    punctuation: { semicolon: per1000(/;/g), colon: per1000(/:/g), ellipsis: per1000(/…|\.\.\./g), exclamation: per1000(/!/g), question: per1000(/\?/g), dash: per1000(/\s[—–-]\s/g) },
    person: first > third * 1.5 ? 'prima' : third > first * 1.5 ? 'terza' : 'mista', signature, reliable: words.length >= 300,
  };
}
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function fingerprintTraits(fp: Fingerprint): { label: string; value: string }[] {
  const rhythm = fp.avgSentence ? fp.spread / fp.avgSentence : 0;
  const p = fp.punctuation;
  const habits = [p.semicolon >= 3 && 'punto e virgola', p.colon >= 4 && 'due punti', p.ellipsis >= 2 && 'puntini di sospensione', p.dash >= 2 && 'incisi con trattino', p.question >= 6 && 'domande', p.exclamation >= 4 && 'esclamazioni'].filter(Boolean) as string[];
  return [
    { label: 'Frasi', value: `${fp.avgSentence} parole in media (${fp.avgSentence < 11 ? 'brevi' : fp.avgSentence < 20 ? 'medie' : 'lunghe'})` },
    { label: 'Ritmo', value: rhythm > 0.75 ? 'molto variato: alterna frasi brevissime e periodi ampi' : rhythm > 0.45 ? 'variato' : 'regolare, frasi di lunghezza simile' },
    { label: 'Paragrafi', value: `${fp.avgParagraph} parole in media` },
    { label: 'Dialogo', value: `${Math.round(fp.dialogue * 100)}% dei paragrafi` },
    { label: 'Lessico', value: fp.richness >= 0.8 ? 'molto vario' : fp.richness >= 0.7 ? 'vario' : 'essenziale, con ripetizioni' },
    { label: 'Narratore', value: fp.person === 'prima' ? 'prima persona' : fp.person === 'terza' ? 'terza persona' : 'misto' },
    { label: 'Abitudini', value: habits.length ? habits.join(', ') : 'punteggiatura sobria' },
    { label: 'Parole ricorrenti', value: fp.signature.length ? fp.signature.join(', ') : '—' },
  ];
}
// Compact description sent to the model so that suggestions sound like the author.
export function describeFingerprint(fp: Fingerprint): string {
  if (fp.words < 80) return '';
  return fingerprintTraits(fp).filter(t => t.label !== 'Parole ricorrenti').map(t => `${t.label.toLowerCase()}: ${t.value}`).join('; ');
}

// 0–100: how close a proposal is to the author's fingerprint. Indicative, meant for passages of 25+ words.
export function styleSimilarity(author: Fingerprint, text: Fingerprint): number {
  if (!author.words || !text.words || !author.avgSentence || !text.avgSentence) return 0;
  const ln = (a: number, b: number) => Math.abs(Math.log((a + 0.5) / (b + 0.5)));
  let d = ln(author.avgSentence, text.avgSentence) * 1.2 + ln(author.avgWord, text.avgWord) * 3
    + Math.abs(author.spread / author.avgSentence - text.spread / text.avgSentence) * 0.8;
  if (text.words >= 100) d += Math.abs(author.richness - text.richness) * 2 + Math.abs(author.dialogue - text.dialogue);
  for (const k of Object.keys(author.punctuation) as (keyof Fingerprint['punctuation'])[]) d += Math.abs(author.punctuation[k] - text.punctuation[k]) / (author.punctuation[k] + text.punctuation[k] + 8) * 0.25;
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-d))));
}

// ---------- Narrative intent ----------

export const INTENTS = [
  { id: 'auto', name: 'Automatica', tone: '' },
  { id: 'romantica', name: 'Romantica', tone: 'intimo, sensoriale, delicato' },
  { id: 'suspense', name: 'Suspense', tone: 'teso, frasi più brevi, dettagli che inquietano' },
  { id: 'mistero', name: 'Mistero', tone: 'allusivo, indizi seminati senza svelare' },
  { id: 'azione', name: 'Azione', tone: 'rapido, verbi concreti, ritmo serrato' },
  { id: 'malinconica', name: 'Malinconica', tone: 'sommesso, memoria e assenza' },
  { id: 'ironica', name: 'Ironica', tone: 'leggero, arguto, understatement' },
  { id: 'riflessiva', name: 'Riflessiva / saggistica', tone: 'argomentativo, chiaro, domande e idee' },
  { id: 'dialogo', name: 'Dialogo', tone: 'battute naturali, sottotesto, poche didascalie' },
  { id: 'descrittiva', name: 'Descrittiva', tone: 'visivo, concreto, dettagli sensoriali' },
] as const;
export type IntentId = typeof INTENTS[number]['id'];

const LEXICON: Record<Exclude<IntentId, 'auto' | 'dialogo'>, string[]> = {
  romantica: ['amor', 'amat', 'bac', 'labbr', 'cuor', 'carezz', 'abbracc', 'desider', 'pelle', 'tenerezz', 'innamor', 'sguard', 'mano', 'mani', 'arross', 'sfior', 'cuore', 'tesoro', 'passion'],
  suspense: ['buio', 'ombr', 'passi', 'paur', 'sangue', 'urlo', 'url', 'cigol', 'coltell', 'minacc', 'trem', 'pistol', 'nascost', 'respir', 'silenzi', 'terror', 'scricchiol', 'pericol', 'improvvis'],
  mistero: ['indizi', 'segret', 'mister', 'scompars', 'chiave', 'lettera', 'enigm', 'sospett', 'indag', 'commissari', 'detective', 'cadavere', 'colpevol', 'alibi', 'prova', 'nascond'],
  azione: ['cors', 'corr', 'colp', 'spar', 'saltò', 'salt', 'afferr', 'fugg', 'insegu', 'scatt', 'lanci', 'esplo', 'pugno', 'calci', 'precipit', 'scappa'],
  malinconica: ['ricord', 'nostalgi', 'lacrim', 'assenz', 'perdit', 'rimpiant', 'malinconi', 'solitudin', 'addio', 'mancanz', 'pianse', 'piang', 'vuoto', 'lontan', 'autunno', 'morto', 'morte'],
  ironica: ['risat', 'ironi', 'buff', 'scherz', 'ridicol', 'sorris', 'comic', 'paradoss', 'figurarsi', 'ovviamente', 'naturalmente'],
  riflessiva: ['forse', 'pensier', 'domand', 'idea', 'univers', 'tempo', 'scienz', 'mente', 'realtà', 'cervell', 'teori', 'natura', 'evoluz', 'conoscenz', 'spazio', 'fisica', 'quindi', 'dunque', 'infatti', 'ipotesi'],
  descrittiva: ['colore', 'luce', 'odore', 'profum', 'cielo', 'mare', 'vento', 'strada', 'finestr', 'verde', 'azzurr', 'grigi', 'sole', 'nuvol', 'albero', 'paesaggi'],
};

export type DetectedIntent = { id: IntentId; name: string; tone: string; confidence: number; cues: string[] };
// Reads the last part of the text (the most recent lines count double) and guesses the kind of scene.
export function detectIntent(text: string): DetectedIntent {
  const tail = text.slice(-1500), recent = text.slice(-400);
  const scores = new Map<IntentId, number>(); const cues = new Map<IntentId, Set<string>>();
  const score = (chunk: string, weight: number) => {
    for (const w of wordsOf(chunk.toLowerCase())) for (const [id, stems] of Object.entries(LEXICON) as [IntentId, string[]][]) {
      if (w.length >= 3 && stems.some(s => w.startsWith(s))) { scores.set(id, (scores.get(id) || 0) + weight); if (!cues.has(id)) cues.set(id, new Set()); cues.get(id)!.add(w); }
    }
  };
  score(tail, 1); score(recent, 1);
  const lines = tail.split('\n').filter(l => l.trim()); const dialogue = lines.filter(l => DIALOGUE_START.test(l)).length;
  if (lines.length >= 3 && dialogue / lines.length >= 0.5) scores.set('dialogo', (scores.get('dialogo') || 0) + dialogue * 2);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((a, [, n]) => a + n, 0);
  if (!ranked.length || ranked[0][1] < 3) return { id: 'auto', name: 'Narrazione', tone: '', confidence: 0, cues: [] };
  const [id, n] = ranked[0]; const meta = INTENTS.find(i => i.id === id)!;
  return { id, name: meta.name, tone: meta.tone, confidence: round(n / total, 2), cues: [...(cues.get(id) || [])].slice(0, 4) };
}

// ---------- Story memory ----------

export type Fact = { id: string; entity: string; kind: string; attribute: string; value: string; quote: string; chapter: string; from?: number; to?: number };
export type Conflict = { id: string; entity: string; attribute: string; a: Fact; b: Fact };

// Extracts the first JSON object from a model answer (models sometimes add fences or text).
export function parseJson<T = unknown>(raw: string): T | null {
  const text = raw.replace(/```(?:json)?/gi, '');
  const start = text.search(/[[{]/); if (start < 0) return null;
  const open = text[start], close = open === '{' ? '}' : ']';
  let depth = 0, inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true; else if (c === open) depth++; else if (c === close && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)) as T; } catch { return null; }
    }
  }
  return null;
}

const str = (v: unknown, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
// Keeps only facts whose quote is really in the chapter: evidence is never invented.
export function cleanFacts(raw: unknown, chapter: Chapter, chs: Chapter[]): Fact[] {
  const list = (raw as { facts?: unknown })?.facts; if (!Array.isArray(list)) return [];
  const facts: Fact[] = [];
  for (const f of list.slice(0, 80)) {
    const entity = str(f?.entity, 80), attribute = str(f?.attribute, 60), value = str(f?.value, 160), quote = str(f?.quote, 300);
    if (!entity || !attribute || !value || !quote) continue;
    const where = locate([chapter], quote) || locate(chs, quote, chapter.title);
    if (!where) continue;
    facts.push({ id: hash(entity + '|' + attribute + '|' + value + '|' + where.from), entity, kind: str(f?.kind, 30) || 'altro', attribute, value, quote: where.quote, chapter: where.chapter, from: where.from, to: where.to });
  }
  return facts;
}

const ATTRIBUTE_GROUPS: [string, RegExp][] = [
  ['occhi', /occhi/], ['capelli', /capell|chiom/], ['età', /\bet[àa]\b|anni|compleanno|nato|nata|nascita/], ['altezza', /altezza|alt[oa]\b|statura/],
  ['professione', /professione|lavoro|mestiere|impiego|occupazione/], ['residenza', /citt[àa]|vive|abita|residenza|casa/],
  ['barba', /barba|baffi/], ['cicatrici', /cicatric/], ['relazione', /moglie|marito|fidanzat|compagn/], ['madre', /madre|mamma/], ['padre', /padre|papà/],
  ['nazionalità', /nazionalit|origin/], ['veicolo', /auto|macchina|moto/], ['animale', /cane|gatto|animale/],
];
export function canonicalAttribute(a: string): string {
  const s = normalize(a); for (const [name, re] of ATTRIBUTE_GROUPS) if (re.test(s)) return name; return s;
}
const GENERIC = new Set(['anni', 'anno', 'colo', 'tipo', 'molt', 'poco', 'abba', 'circ', 'semp']);
const stems = (v: string) => new Set(wordsOf(normalize(v)).filter(w => !/\d/.test(w) && w.length >= 3 && !STOP.has(w)).map(w => w.slice(0, 4)).filter(s => !GENERIC.has(s)));
const numbers = (v: string) => (v.match(/\d+/g) || []).join(',');
function sameValue(a: string, b: string): boolean {
  const x = normalize(a), y = normalize(b); if (x === y) return true;
  const na = numbers(a), nb = numbers(b); if (na && nb) return na === nb;
  if (x.includes(y) || y.includes(x)) return true;
  const sa = stems(a), sb = stems(b); for (const s of sa) if (sb.has(s)) return true; return !sa.size || !sb.size;
}
// Two facts about the same entity and attribute, with different values and different evidence.
export function findConflicts(facts: Fact[], dismissed: string[] = []): Conflict[] {
  const groups = new Map<string, Fact[]>();
  for (const f of facts) { const k = normalize(f.entity) + '|' + canonicalAttribute(f.attribute); groups.set(k, [...(groups.get(k) || []), f]); }
  const out: Conflict[] = [];
  for (const list of groups.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.from === b.from || sameValue(a.value, b.value)) continue;
    const [first, second] = (a.from ?? 0) <= (b.from ?? 0) ? [a, b] : [b, a];
    const id = hash([first.entity, canonicalAttribute(first.attribute), normalize(first.value), normalize(second.value)].join('|'));
    if (!dismissed.includes(id) && !out.some(c => c.id === id)) out.push({ id, entity: first.entity, attribute: canonicalAttribute(first.attribute), a: first, b: second });
  }
  return out;
}

// Short story bible for prompts: one line per entity, values grouped.
export function memorySummary(facts: Fact[], max = 3500): string {
  const byEntity = new Map<string, string[]>();
  for (const f of facts) { const line = `${f.attribute}: ${f.value} (${f.chapter})`; const l = byEntity.get(f.entity) || []; if (!l.includes(line)) l.push(line); byEntity.set(f.entity, l); }
  let out = '';
  for (const [entity, lines] of byEntity) { const row = `- ${entity}: ${lines.slice(0, 8).join('; ')}\n`; if (out.length + row.length > max) break; out += row; }
  return out.trim();
}

// ---------- Passages and retrieval for questions ----------

export type Passage = { id: string; chapter: string; pos: number; text: string };
export function passages(chs: Chapter[], size = 700): Passage[] {
  const out: Passage[] = [];
  for (const c of chs) {
    let text = '', pos = -1;
    const flush = () => { if (text.trim()) out.push({ id: 'P' + (out.length + 1), chapter: c.title, pos, text: text.trim() }); text = ''; pos = -1; };
    for (const b of c.blocks) { if (!b.text.trim()) continue; if (pos < 0) pos = b.pos; text += (text ? '\n' : '') + b.text; if (text.length >= size) flush(); }
    flush();
  }
  return out;
}
const terms = (s: string) => wordsOf(normalize(s)).filter(w => w.length >= 4 && !STOP.has(w)).map(w => w.slice(0, 5));
// Ranks passages by shared terms (rarer terms weigh more, names weigh double) and keeps the best
// ones within the character budget, in reading order. Small manuscripts are sent whole.
export function retrieve(list: Passage[], query: string, budget = 14000, extra: string[] = []): Passage[] {
  const total = list.reduce((a, p) => a + p.text.length, 0); if (total <= budget) return list;
  const q = new Set([...terms(query), ...extra.flatMap(terms)]);
  const names = new Set(wordsOf(query).filter(w => /^\p{Lu}/u.test(w)).map(w => normalize(w).slice(0, 5)));
  const df = new Map<string, number>(); const docs = list.map(p => new Set(terms(p.text)));
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) || 0) + 1);
  const scored = list.map((p, i) => { let s = 0; for (const t of q) if (docs[i].has(t)) s += Math.log(1 + list.length / (df.get(t) || 1)) * (names.has(t) ? 2 : 1); return { p, s }; })
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const chosen: Passage[] = []; let used = 0;
  for (const { p } of scored) { if (used + p.text.length > budget) continue; chosen.push(p); used += p.text.length; }
  return chosen.sort((a, b) => a.pos - b.pos);
}

export type AnswerPart = { text: string; cite?: Passage };
// Splits an answer into text and citations; citations to passages that were not provided are dropped.
export function citeParts(answer: string, sent: Passage[]): AnswerPart[] {
  const parts: AnswerPart[] = []; let last = 0;
  for (const m of answer.matchAll(/\[(P\d+)(?:\s*[,;]\s*(P\d+))*\]/g)) {
    parts.push({ text: answer.slice(last, m.index) });
    for (const id of m[0].match(/P\d+/g) || []) { const cite = sent.find(p => p.id === id); if (cite) parts.push({ text: id, cite }); }
    last = m.index! + m[0].length;
  }
  parts.push({ text: answer.slice(last) });
  return parts.filter(p => p.cite || p.text);
}
