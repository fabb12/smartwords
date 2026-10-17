'use client';
// The writing companion: the four working modes, the creative project and voice, plot
// directions, story memory with evidence, style report and questions about the manuscript.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { BookOpen, Brain, Check, ChevronRight, CircleAlert, Feather, Flag, GitBranch, LoaderCircle, MessageCircle, PenLine, Quote, RefreshCw, ScanSearch, SendHorizontal, Sparkles, Target, X } from 'lucide-react';
import { blocksFromDoc, chapterAt, chapters, citeParts, cleanFacts, findConflicts, fingerprint, fingerprintTraits, hash, INTENTS, locate, parseJson, passages, retrieve, styleSimilarity, type Chapter, type DetectedIntent, type Evidence, type Fact, type Fingerprint, type Passage } from '../lib/narrative';
import { INTENSITIES, VOICES, MIX_AUTHORS, MAX_MIX_AUTHORS, blendShares, voiceById, voiceName } from '../lib/author-styles';
import type { Project } from '../lib/project';

export type Mode = 'libera' | 'assistita' | 'coscrittura' | 'revisione';
export const MODES: { id: Mode; name: string; icon: typeof Feather; hint: string }[] = [
  { id: 'libera', name: 'Libera', icon: Feather, hint: 'Nessun intervento: scrivi e basta. Nessun testo lascia il dispositivo.' },
  { id: 'assistita', name: 'Assistita', icon: Sparkles, hint: 'Suggerimenti discreti mentre scrivi, nella tua voce. Tab per accettare.' },
  { id: 'coscrittura', name: 'Co-scrittura', icon: PenLine, hint: 'Generazione creativa solo quando la chiedi: scene, voci, direzioni.' },
  { id: 'revisione', name: 'Revisione', icon: ScanSearch, hint: 'Analisi approfondite: coerenza con prove, stile, domande sul testo.' },
];
export function isMode(v: unknown): v is Mode { return MODES.some(m => m.id === v); }

// Runs a non-streaming analysis (JSON or answer) through the selected profile.
export type Run = (mode: string, fields: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
export type Ctx = { style: string; intent: string; brief: string; memory: string };
type SetProject = (update: (p: Project) => Project) => void;

const manuscript = (editor: Editor) => chapters(blocksFromDoc(editor.state.doc));
const failed = (err: unknown) => (err as Error).name === 'AbortError' ? '' : (err as Error).message;

export function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const current = MODES.find(m => m.id === mode)!;
  return <div className="mode-switch"><div className="mode-buttons" role="radiogroup" aria-label="Modalità di lavoro">
    {MODES.map(m => <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)} data-tip={m.hint}><m.icon size={15} /><span>{m.name}</span></button>)}
  </div><p className="mode-hint">{current.hint}</p></div>;
}

export function ProjectChip({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const voice = voiceById(project.voice.id), intensity = INTENSITIES.find(i => i.id === project.voice.intensity);
  return <button className="project-chip" onClick={onOpen} data-tip="Progetto creativo: genere, lettori, premessa e voce d’autore che l’AI deve seguire">
    <BookOpen size={15} /><span><small>Voce</small>{voiceName(voice.id, project.voice.blend)}{voice.id !== 'mine' && intensity ? ' · ' + intensity.name.toLowerCase() : ''}</span>
    <span className={'brief-state ' + (project.brief.premise || project.brief.genre ? 'set' : '')}>{project.brief.premise || project.brief.genre ? 'Progetto' : 'Definisci il progetto'}</span><ChevronRight size={14} />
  </button>;
}

export function IntentRow({ detected, choice, setChoice }: { detected: DetectedIntent; choice: string; setChoice: (v: string) => void }) {
  return <div className="intent-row">
    <div><Target size={14} /><span>Scena</span><strong>{choice === 'auto' ? detected.name : INTENTS.find(i => i.id === choice)?.name}</strong>
      {choice === 'auto' && detected.confidence > 0 && <small data-tip={'Riconosciuta dagli indizi: ' + detected.cues.join(', ')}>{detected.cues.slice(0, 2).join(', ')}</small>}</div>
    <select aria-label="Intenzione della scena" data-tip="Tipo di scena che stai scrivendo: guida tono e ritmo dei suggerimenti. «Riconosci automaticamente» lo deduce dal testo" value={choice} onChange={e => setChoice(e.target.value)}>
      {INTENTS.map(i => <option key={i.id} value={i.id}>{i.id === 'auto' ? 'Riconosci automaticamente' : i.name}</option>)}
    </select>
  </div>;
}

export function FreeCard({ fp }: { fp: Fingerprint }) {
  return <section className="free-card"><Feather size={20} /><h3>Solo tu e la pagina.</h3>
    <p>In scrittura libera l’AI non interviene e nessun testo viene inviato. La tua impronta stilistica continua a formarsi in locale.</p>
    <div className="mini-stats"><span><strong>{fp.words}</strong> parole</span><span><strong>{fp.avgSentence || '—'}</strong> parole per frase</span><span><strong>{Math.round(fp.dialogue * 100)}%</strong> dialogo</span></div>
  </section>;
}

// ---------- Project and voice ----------

export function ProjectModal({ project, setProject, onClose }: { project: Project; setProject: SetProject; onClose: () => void }) {
  const brief = project.brief, voice = project.voice;
  const setBrief = (k: keyof Project['brief'], v: string) => setProject(p => ({ ...p, brief: { ...p.brief, [k]: v } }));
  const setVoice = (v: Partial<Project['voice']>) => setProject(p => ({ ...p, voice: { ...p.voice, ...v } }));
  const blend = blendShares(voice.blend);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal project-modal" role="dialog" aria-modal="true" aria-label="Progetto creativo e voce" onClick={e => e.stopPropagation()}>
    <button className="modal-close tool" aria-label="Chiudi progetto" onClick={onClose}><X size={20} /></button>
    <span className="modal-icon"><BookOpen size={23} /></span><h2>Il tuo progetto creativo.</h2>
    <p className="modal-subtitle">Più l’assistente conosce le tue intenzioni, più ti aiuta a realizzarle, senza sostituirsi a te. Tutto è facoltativo.</p>
    <div className="form-grid"><label>Genere o forma<input maxLength={120} placeholder="Es. giallo psicologico, saggio divulgativo" value={brief.genre} onChange={e => setBrief('genre', e.target.value)} /></label>
      <label>Lettori<input maxLength={200} placeholder="Es. adulti, appassionati di scienza" value={brief.audience} onChange={e => setBrief('audience', e.target.value)} /></label></div>
    <label>Che cosa vuoi raccontare<textarea maxLength={1000} rows={3} placeholder="La premessa, il tema, l’effetto che vuoi ottenere nel lettore…" value={brief.premise} onChange={e => setBrief('premise', e.target.value)} /></label>
    <label>Note per l’assistente<textarea maxLength={1500} rows={2} placeholder="Es. Laura non deve mai sembrare una vittima; il colpevole si scopre solo alla fine." value={brief.notes} onChange={e => setBrief('notes', e.target.value)} /></label>
    <h3>Voce narrativa</h3><p className="form-note">«La mia voce» usa la tua impronta stilistica. Un autore di riferimento aggiunge le sue caratteristiche di stile, nella misura che scegli: i contenuti restano tuoi e nessun brano viene copiato.</p>
    <div className="voice-grid" role="radiogroup" aria-label="Voce narrativa">{VOICES.map(v => <button key={v.id} role="radio" data-tip={v.id === 'mix' ? 'Unisci da due a quattro autori e regola il peso di ciascuno' : v.id === 'custom' ? 'Descrivi le caratteristiche dello stile che cerchi' : v.family === 'mia' ? 'Usa la tua voce, misurata sul testo che hai scritto' : 'Ispirati ai tratti di stile di ' + v.name + ' (senza copiarne i brani)'} aria-checked={voice.id === v.id} className={'voice-card ' + (voice.id === v.id ? 'active' : '') + (v.family === 'mia' ? ' own' : '')} onClick={() => setVoice({ id: v.id })}><strong>{v.name}</strong><small>{v.tag}</small></button>)}</div>
    {voice.id === 'custom' && <label>Descrivi lo stile che cerchi<textarea maxLength={600} rows={3} placeholder="Es. frasi brevi e secche, molto dialogo, ironia amara, presente indicativo." value={voice.custom} onChange={e => setVoice({ custom: e.target.value })} /></label>}
    {voice.id === 'mix' && <fieldset className="voice-blend"><legend>Autori del mix</legend>
      <p className="form-note">Scegli da due a {MAX_MIX_AUTHORS} autori. I pesi sono relativi: la percentuale indica quanto ciascuno influenza la voce risultante.</p>
      <div className="blend-authors">{MIX_AUTHORS.map(v => { const selected = blend.some(b => b.id === v.id); return <label key={v.id}><input type="checkbox" checked={selected} disabled={!selected && blend.length >= MAX_MIX_AUTHORS} onChange={() => setVoice({ blend: selected ? blend.filter(b => b.id !== v.id).map(({ id, weight }) => ({ id, weight })) : [...blend.map(({ id, weight }) => ({ id, weight })), { id: v.id, weight: 50 }] })} />{v.name}</label>; })}</div>
      {blend.map(b => <label className="blend-weight" key={b.id} htmlFor={'blend-weight-' + b.id}>Peso di {voiceById(b.id).name}<output>{b.percent.toLocaleString('it-IT')}%</output><input id={'blend-weight-' + b.id} aria-label={'Peso di ' + voiceById(b.id).name} type="range" min={1} max={100} value={b.weight} onChange={e => setVoice({ blend: blend.map(({ id, weight }) => ({ id, weight: id === b.id ? Number(e.target.value) : weight })) })} /></label>)}
      {blend.length < 2 && <p className="form-note" role="status">Seleziona almeno due autori per creare il mix. Fino ad allora viene usata la tua voce.</p>}
    </fieldset>}
    {voice.id !== 'mine' && <div className="segmented intensity" role="radiogroup" aria-label="Intensità dello stile">{INTENSITIES.map(i => <button key={i.id} role="radio" aria-checked={voice.intensity === i.id} className={voice.intensity === i.id ? 'active' : ''} data-tip={i.hint} onClick={() => setVoice({ intensity: i.id })}>{i.name}</button>)}</div>}
    {voice.id !== 'mine' && voice.id !== 'custom' && voice.id !== 'mix' && <p className="form-note voice-traits">{voiceById(voice.id).traits}</p>}
    <div className="form-footer"><button className="primary" onClick={onClose}>Fatto<Check size={16} /></button></div>
  </section></div>;
}

// ---------- Co-writing: plot directions ----------

// Model output is untrusted JSON: every field is checked before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
type Direction = { title: string; premise: string; opening: string; consequences: { when: string; effect: string }[]; tension: number; risk: string; coherence: string };
function cleanDirections(raw: unknown): Direction[] {
  const list = (raw as { directions?: unknown[] })?.directions; if (!Array.isArray(list)) return [];
  const s = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 600) : '';
  return list.slice(0, 3).map((d: Loose) => ({ title: s(d?.title) || 'Direzione', premise: s(d?.premise), opening: s(d?.opening), risk: s(d?.risk), coherence: s(d?.coherence),
    tension: Math.max(1, Math.min(5, Math.round(Number(d?.tension) || 3))),
    consequences: Array.isArray(d?.consequences) ? d.consequences.slice(0, 4).map((c: Loose) => ({ when: s(c?.when), effect: s(c?.effect) })).filter((c: { effect: string }) => c.effect) : [] }))
    .filter(d => d.premise);
}

export function Directions({ editor, run, ctx, ready, onWrite }: { editor: Editor; run: Run; ctx: Ctx; ready: boolean; onWrite: (direction: string) => void }) {
  const [list, setList] = useState<Direction[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [open, setOpen] = useState(0);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  async function explore() {
    const { from } = editor.state.selection; const before = editor.state.doc.textBetween(0, from, '\n');
    if (before.trim().length < 80) { setError('Scrivi almeno qualche frase della scena: le direzioni partono da lì.'); return; }
    ctrl.current?.abort(); const c = new AbortController(); ctrl.current = c; setBusy(true); setError('');
    try {
      const raw = await run('directions', { text: before.slice(-3000), context: before.slice(0, -3000).slice(-6000), style: ctx.style, intent: ctx.intent, brief: ctx.brief, memory: ctx.memory }, c.signal);
      const found = cleanDirections(parseJson(raw)); if (!found.length) throw new Error('Il modello non ha restituito direzioni leggibili. Riprova.');
      setList(found); setOpen(0);
    } catch (err) { setError(failed(err)); } finally { if (ctrl.current === c) setBusy(false); }
  }
  return <div className="directions">
    <button className="wide-action" data-tip="L’AI immagina tre sviluppi della storia, con conseguenze, tensione e rischi" disabled={busy || !ready} onClick={() => void explore()}>{busy ? <LoaderCircle className="spin" size={16} /> : <GitBranch size={16} />}<span>{busy ? 'Immagino tre sviluppi…' : list ? 'Esplora altre tre direzioni' : 'Esplora tre direzioni'}<small>Dal punto in cui si trova il cursore</small></span></button>
    {error && <p className="panel-error">{error}</p>}
    {list?.map((d, i) => <article key={i} className={'direction-card ' + (open === i ? 'open' : '')}>
      <button className="direction-head" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}><span className="direction-index">{String.fromCharCode(65 + i)}</span><strong>{d.title}</strong><span className="tension" data-tip={`Tensione narrativa: ${d.tension} su 5`}>{[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= d.tension ? 'on' : ''} />)}</span></button>
      <p>{d.premise}</p>
      {open === i && <>
        {d.opening && <blockquote>{d.opening}</blockquote>}
        {!!d.consequences.length && <ol className="consequences">{d.consequences.map((c, j) => <li key={j}><small>{c.when}</small>{c.effect}</li>)}</ol>}
        {d.coherence && <p className="note-good"><Check size={13} />{d.coherence}</p>}
        {d.risk && <p className="note-risk"><CircleAlert size={13} />{d.risk}</p>}
        <button className="accept-direction" data-tip="Scrive dal cursore l’apertura della scena seguendo questa direzione" onClick={() => onWrite(`${d.title}. ${d.premise} ${d.opening ? 'Apertura suggerita: ' + d.opening : ''}`)}><PenLine size={14} />Scrivi l’inizio di questa scena</button>
      </>}
    </article>)}
    {list && <p className="form-note">Sono possibilità, non decisioni: scegli, mescola o ignora. Il testo entra nel manoscritto solo se lo accetti.</p>}
  </div>;
}

// ---------- Review: consistency, style, questions ----------

const REVIEW_TIPS = { coerenza: 'Memoria narrativa e contraddizioni tra capitoli, con le citazioni', stile: 'La tua impronta stilistica: frasi, ritmo, lessico, dialogo', chiedi: 'Fai domande sul manoscritto: le risposte citano i passaggi' };

type Issue = { type: string; message: string; severity: string; quote: Evidence; evidence: Evidence | null };

export function Review({ editor, project, setProject, run, ctx, fp, ready, jump }: { editor: Editor; project: Project; setProject: SetProject; run: Run; ctx: Ctx; fp: Fingerprint; ready: boolean; jump: (quote: string, fallback?: number) => void }) {
  const [tab, setTab] = useState<'coerenza' | 'stile' | 'chiedi'>('coerenza');
  return <div className="review">
    <div className="segmented review-tabs" role="tablist">{([['coerenza', 'Coerenza', Brain], ['stile', 'Stile', Feather], ['chiedi', 'Chiedi', MessageCircle]] as const).map(([id, name, Icon]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} data-tip={REVIEW_TIPS[id]} onClick={() => setTab(id)}><Icon size={13} />{name}</button>)}</div>
    {tab === 'coerenza' && <Consistency editor={editor} project={project} setProject={setProject} run={run} ctx={ctx} ready={ready} jump={jump} />}
    {tab === 'stile' && <StyleReport editor={editor} fp={fp} />}
    {tab === 'chiedi' && <Ask editor={editor} run={run} ctx={ctx} ready={ready} jump={jump} />}
  </div>;
}

function splitChunks(text: string, size = 9500): string[] {
  const out: string[] = []; let cur = '';
  for (const line of text.split('\n')) { if (cur && cur.length + line.length > size) { out.push(cur); cur = ''; } cur += (cur ? '\n' : '') + line.slice(0, size); }
  if (cur.trim()) out.push(cur); return out;
}

function Consistency({ editor, project, setProject, run, ctx, ready, jump }: { editor: Editor; project: Project; setProject: SetProject; run: Run; ctx: Ctx; ready: boolean; jump: (quote: string, fallback?: number) => void }) {
  const [progress, setProgress] = useState(''), [error, setError] = useState(''), [issues, setIssues] = useState<Issue[] | null>(null), [discarded, setDiscarded] = useState(0), [checking, setChecking] = useState(false), [reading, setReading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const conflicts = useMemo(() => findConflicts(project.facts, project.dismissed), [project.facts, project.dismissed]);
  const entities = useMemo(() => { const m = new Map<string, Fact[]>(); for (const f of project.facts) m.set(f.entity, [...(m.get(f.entity) || []), f]); return [...m.entries()].sort((a, b) => b[1].length - a[1].length); }, [project.facts]);

  async function updateMemory() {
    const chs = manuscript(editor);
    const todo = chs.filter(c => c.text.trim().length > 40 && project.analysed[c.title] !== hash(c.text));
    const titles = new Set(chs.map(c => c.title));
    setProject(p => ({ ...p, facts: p.facts.filter(f => titles.has(f.chapter)), analysed: Object.fromEntries(Object.entries(p.analysed).filter(([t]) => titles.has(t))) }));
    if (!todo.length) { setProgress('La memoria è già aggiornata: nessun capitolo è cambiato.'); return; }
    const calls = todo.reduce((n, c) => n + splitChunks(c.text).length, 0);
    if (calls > 4 && !window.confirm(`Analizzerò ${todo.length} capitoli con ${calls} richieste al provider. I capitoli già analizzati e non modificati saranno saltati. Procedo?`)) return;
    ctrl.current?.abort(); const c = new AbortController(); ctrl.current = c; setError(''); setReading(true);
    try {
      for (const [i, ch] of todo.entries()) {
        setProgress(`Leggo «${ch.title}» (${i + 1} di ${todo.length})…`);
        const found: Fact[] = [];
        for (const chunk of splitChunks(ch.text)) found.push(...cleanFacts(parseJson(await run('memory', { text: chunk, brief: ctx.brief }, c.signal)), ch, chs));
        const unique = found.filter((f, j) => found.findIndex(g => g.id === f.id) === j);
        setProject(p => ({ ...p, facts: [...p.facts.filter(f => f.chapter !== ch.title), ...unique], analysed: { ...p.analysed, [ch.title]: hash(ch.text) } }));
      }
      setProgress('Memoria aggiornata.');
    } catch (err) { setError(failed(err)); setProgress(''); } finally { if (ctrl.current === c) setReading(false); }
  }

  async function check() {
    const chs = manuscript(editor); const { from, to } = editor.state.selection;
    const current: Chapter | undefined = chapterAt(chs, from);
    const text = (from !== to ? editor.state.doc.textBetween(from, to, '\n') : current?.text || '').slice(0, 10000);
    if (text.trim().length < 40) { setError('Seleziona un passaggio o porta il cursore in un capitolo con del testo.'); return; }
    const others = passages(chs.filter(ch => ch !== current || from !== to)).filter(p => !text.includes(p.text.slice(0, 120)));
    const sent = retrieve(others, text, 12000);
    ctrl.current?.abort(); const c = new AbortController(); ctrl.current = c; setChecking(true); setError('');
    try {
      const raw = await run('check', { text, passages: sent.map(p => `[${p.id} · ${p.chapter}] ${p.text}`).join('\n\n'), memory: ctx.memory, brief: ctx.brief }, c.signal);
      const list = (parseJson<{ issues?: Loose[] }>(raw)?.issues || []);
      const kept: Issue[] = []; let dropped = 0;
      for (const it of list.slice(0, 20)) {
        const quote = typeof it?.quote === 'string' ? locate(chs, it.quote) : null;
        if (!quote || typeof it?.message !== 'string') { dropped++; continue; }
        const evidence = typeof it?.evidence === 'string' && it.evidence.trim() ? locate(chs, it.evidence) : null;
        kept.push({ type: String(it.type || 'continuità').slice(0, 30), message: it.message.slice(0, 400), severity: String(it.severity || 'media'), quote, evidence });
      }
      setIssues(kept); setDiscarded(dropped);
    } catch (err) { setError(failed(err)); } finally { if (ctrl.current === c) setChecking(false); }
  }

  const decide = (id: string, keep: boolean) => setProject(p => keep ? { ...p, confirmed: [...p.confirmed.filter(x => x !== id), id] } : { ...p, dismissed: [...p.dismissed, id], confirmed: p.confirmed.filter(x => x !== id) });
  const busy = reading || checking;
  return <div className="consistency">
    <button className="wide-action" data-tip="Rilegge i capitoli modificati e annota personaggi, luoghi, oggetti ed eventi, ognuno con la sua citazione" disabled={!ready || busy} onClick={() => void updateMemory()}>{reading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}<span>Aggiorna la memoria narrativa<small>{project.facts.length ? `${project.facts.length} fatti su ${entities.length} elementi · solo i capitoli cambiati` : 'Personaggi, luoghi, oggetti ed eventi, con le prove'}</small></span></button>
    <button className="wide-action" data-tip="Controlla che la selezione (o il capitolo) sia coerente con il resto del libro: personalità, cronologia, continuità" disabled={!ready || busy} onClick={() => void check()}>{checking ? <LoaderCircle className="spin" size={16} /> : <ScanSearch size={16} />}<span>Verifica il passaggio<small>La selezione, o il capitolo del cursore, contro il resto del libro</small></span></button>
    {progress && <p className="panel-progress">{progress}</p>}{error && <p className="panel-error">{error}</p>}

    {!!conflicts.length && <><div className="section-label">CONTRADDIZIONI TROVATE · {conflicts.length}</div>
      {conflicts.map(c => <article key={c.id} className={'evidence-card ' + (project.confirmed.includes(c.id) ? 'confirmed' : '')}>
        <header><CircleAlert size={14} /><strong>{c.entity}</strong><span>{c.attribute}</span>{project.confirmed.includes(c.id) && <em>da correggere</em>}</header>
        <button className="evidence" data-tip="Vai a questo passaggio nel testo" onClick={() => jump(c.a.quote, c.a.from)}><small>{c.a.chapter} · {c.a.value}</small>«{c.a.quote}»</button>
        <button className="evidence" data-tip="Vai a questo passaggio nel testo" onClick={() => jump(c.b.quote, c.b.from)}><small>{c.b.chapter} · {c.b.value}</small>«{c.b.quote}»</button>
        <div className="evidence-actions"><button data-tip="Segna la contraddizione come errore da correggere" onClick={() => decide(c.id, true)}><Flag size={13} />È un errore</button><button data-tip="È una scelta voluta: non segnalarla più" onClick={() => decide(c.id, false)}>È voluto, ignora</button></div>
      </article>)}</>}

    {issues && <><div className="section-label">VERIFICA DEL PASSAGGIO · {issues.length}</div>
      {!issues.length && <p className="note-good"><Check size={13} />Nessun problema di coerenza trovato.</p>}
      {issues.map((it, i) => <article key={i} className={'evidence-card sev-' + it.severity}>
        <header><CircleAlert size={14} /><strong>{it.type}</strong><span>{it.severity}</span></header><p>{it.message}</p>
        <button className="evidence" data-tip="Vai a questo passaggio nel testo" onClick={() => jump(it.quote.quote, it.quote.from)}><small>Qui · {it.quote.chapter}</small>«{it.quote.quote}»</button>
        {it.evidence && <button className="evidence" data-tip="Vai a questo passaggio nel testo" onClick={() => jump(it.evidence!.quote, it.evidence!.from)}><small>Prima · {it.evidence.chapter}</small>«{it.evidence.quote}»</button>}
      </article>)}
      {discarded > 0 && <p className="form-note">{discarded} {discarded === 1 ? 'avviso scartato' : 'avvisi scartati'}: la citazione indicata dal modello non esiste nel testo.</p>}</>}

    {!!entities.length && <><div className="section-label">MEMORIA NARRATIVA</div>
      {entities.map(([name, facts]) => <details key={name} className="memory-entity"><summary><strong>{name}</strong><small>{facts[0].kind} · {facts.length}</small></summary>
        {facts.map(f => <button key={f.id} className="memory-fact" onClick={() => jump(f.quote, f.from)} data-tip={'Vai al passaggio: «' + f.quote + '»'}><span>{f.attribute}</span>{f.value}<small>{f.chapter}</small></button>)}
      </details>)}</>}
    {!project.facts.length && !progress && <p className="form-note">La memoria registra solo fatti accompagnati da una citazione esatta del tuo testo: ogni avviso mostra dove l’ha trovata.</p>}
  </div>;
}

function StyleReport({ editor, fp }: { editor: Editor; fp: Fingerprint }) {
  const { $from, from, to } = editor.state.selection;
  const local = from !== to ? editor.state.doc.textBetween(from, to, '\n') : $from.parent.textContent;
  const localFp = useMemo(() => fingerprint(local), [local]);
  const similarity = localFp.words >= 25 && fp.words >= 150 ? styleSimilarity(fp, localFp) : null;
  return <div className="style-report">
    <p className="form-note">Misurata in locale su {fp.words} parole del documento.{!fp.reliable && ' Servono almeno 300 parole perché l’impronta sia affidabile.'}</p>
    <dl>{fingerprintTraits(fp).map(t => <div key={t.label}><dt>{t.label}</dt><dd>{t.value}</dd></div>)}</dl>
    <div className="similarity"><span>{from !== to ? 'Selezione' : 'Paragrafo corrente'}</span>{similarity === null ? <small>Seleziona almeno 25 parole per confrontarle con la tua voce.</small> : <><meter min={0} max={100} value={similarity} /><strong>{similarity}%</strong><small>somiglianza con la tua impronta (indicativa)</small></>}</div>
  </div>;
}

type Turn = { q: string; a: string; sent: Passage[]; error?: boolean };
const QUESTIONS = ['Questa scena è coerente con la personalità dei personaggi?', 'Quali indizi ho già lasciato sul mistero?', 'Che cosa sa ogni personaggio a questo punto?', 'Riassumi la trama fin qui.'];
function Ask({ editor, run, ctx, ready, jump }: { editor: Editor; run: Run; ctx: Ctx; ready: boolean; jump: (quote: string, fallback?: number) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]), [q, setQ] = useState(''), [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null), end = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [turns]);
  async function send(question: string) {
    question = question.trim(); if (!question || busy) return;
    const chs = manuscript(editor); const list = passages(chs); const cursor = editor.state.selection.from;
    const here = list.filter(p => p.pos <= cursor).slice(-2);
    const sent = retrieve(list, question, 14000, here.map(p => p.text));
    for (const p of here) if (!sent.includes(p)) sent.push(p);
    sent.sort((a, b) => a.pos - b.pos);
    const history = turns.slice(-3).map(t => `Domanda: ${t.q}\nRisposta: ${t.a}`).join('\n\n');
    ctrl.current?.abort(); const c = new AbortController(); ctrl.current = c; setBusy(true); setQ('');
    setTurns(t => [...t, { q: question, a: '', sent }]);
    try {
      const text = here.length ? `${question}\n\n(La scena corrente, dove si trova il cursore, corrisponde ai passaggi ${here.map(p => p.id).join(', ')}.)` : question;
      const a = await run('ask', { text, passages: sent.map(p => `[${p.id} · ${p.chapter}] ${p.text}`).join('\n\n'), memory: ctx.memory, brief: ctx.brief, history }, c.signal);
      setTurns(t => t.map((x, i) => i === t.length - 1 ? { ...x, a } : x));
    } catch (err) { const m = failed(err); setTurns(t => m ? t.map((x, i) => i === t.length - 1 ? { ...x, a: m, error: true } : x) : t.slice(0, -1)); }
    finally { if (ctrl.current === c) setBusy(false); }
  }
  return <div className="ask">
    {!turns.length && <><p className="form-note">Chiedi qualcosa sul tuo manoscritto: le risposte citano i passaggi, e un clic ti porta lì.</p>
      <div className="question-chips">{QUESTIONS.map(x => <button key={x} disabled={!ready} onClick={() => void send(x)}>{x}</button>)}</div></>}
    <div className="chat">{turns.map((t, i) => <div key={i} className="turn"><p className="q">{t.q}</p>
      <div className={'a ' + (t.error ? 'error' : '')}>{!t.a ? <LoaderCircle className="spin" size={15} /> : t.error ? t.a : citeParts(t.a, t.sent).map((part, j) => part.cite ? <button key={j} className="cite" data-tip={part.cite.chapter + ': ' + part.cite.text.slice(0, 160)} onClick={() => jump(part.cite!.text.split('\n')[0].slice(0, 120), part.cite!.pos)}><Quote size={10} />{part.cite.chapter}</button> : <span key={j}>{part.text}</span>)}</div>
    </div>)}<div ref={end} /></div>
    <form className="ask-form" onSubmit={e => { e.preventDefault(); void send(q); }}><textarea rows={2} aria-label="Domanda sul manoscritto" placeholder={ready ? 'Es. Laura reagirebbe davvero così?' : 'Collega un provider per fare domande'} disabled={!ready} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(q); } }} /><button aria-label="Invia domanda" data-tip="Invia la domanda (Invio)" disabled={!ready || busy || !q.trim()}><SendHorizontal size={16} /></button></form>
  </div>;
}
