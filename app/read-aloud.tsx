'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Pause, Play, Settings2, SkipBack, SkipForward, Square, TriangleAlert, Volume2, X } from 'lucide-react';
import {
  DEFAULT_READ_ALOUD, OPENAI_VOICES, READ_RATES, elevenSpeechRequest, groupChunks, naturalVoice, rankVoices, readChunks,
  readReadAloudSettings, speechError, storeReadAloudSettings, type ReadAloudSettings, type ReadChunk, type SpeechEngine,
} from '../lib/read-aloud';
import { readingKey, startDeviceReader, startNeuralReader, type Reader } from '../lib/read-aloud-player';
import { speakableText } from '../lib/formulas';
import { localSpeech } from '../lib/local-backend';

type ProfileLike = { id: string; name: string; provider: string };
type ElevenVoice = { id: string; name: string };
const ENGINE_NAMES: Record<SpeechEngine | 'auto', string> = { auto: 'Automatico (la voce più realistica disponibile)', openai: 'OpenAI · voci neurali', elevenlabs: 'ElevenLabs · voci neurali', device: 'Voci del dispositivo' };

export const readAloudSupported = () => typeof window !== 'undefined' && (typeof Audio !== 'undefined' || 'speechSynthesis' in window);

// Read aloud from the cursor (or the selection) with the most realistic voice
// available: OpenAI or ElevenLabs neural voices, otherwise the best device voice.
export function useReadAloud({ editor, profiles, local }: { editor: Editor | null; profiles: ProfileLike[]; local: boolean }) {
  const [settings, setSettingsState] = useState<ReadAloudSettings>(readReadAloudSettings);
  const [reading, setReading] = useState(false), [paused, setPaused] = useState(false), [waiting, setWaiting] = useState(false);
  const [sentence, setSentence] = useState(''), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]), [eleven, setEleven] = useState<ElevenVoice[]>([]), [elevenBusy, setElevenBusy] = useState(false);
  const reader = useRef<Reader | null>(null), chunks = useRef<ReadChunk[]>([]), index = useRef(0);
  const openaiProfiles = profiles.filter(p => p.provider === 'openai');

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => setVoices(rankVoices(window.speechSynthesis.getVoices()));
    load(); window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, []);

  const engine = (s: ReadAloudSettings): SpeechEngine => s.engine !== 'auto' ? s.engine
    : openaiProfiles.length ? 'openai' : s.elevenKey ? 'elevenlabs' : 'device';
  const highlight = useCallback((chunk: ReadChunk | null) => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(readingKey, chunk && chunk.to <= editor.state.doc.content.size ? { from: chunk.from, to: chunk.to } : null).setMeta('addToHistory', false));
    if (!chunk) return;
    try {
      const dom = editor.view.domAtPos(chunk.from).node, el = dom instanceof HTMLElement ? dom : dom.parentElement;
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch { /* position outside the view */ }
  }, [editor]);

  const finish = useCallback((message?: string) => {
    reader.current = null; setReading(false); setPaused(false); setWaiting(false); setSentence(''); highlight(null);
    if (message) { setError(message); setOpen(true); }
  }, [highlight]);

  // Positions follow edits made while reading.
  useEffect(() => {
    if (!editor || !reading) return;
    const follow = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map(pos: number, assoc?: number): number } } }) => {
      if (!transaction.docChanged) return;
      for (const c of chunks.current) { c.from = transaction.mapping.map(c.from, 1); c.to = Math.max(c.from, transaction.mapping.map(c.to, -1)); }
    };
    editor.on('transaction', follow);
    return () => { editor.off('transaction', follow); };
  }, [editor, reading]);
  useEffect(() => () => reader.current?.stop(), []);

  async function elevenVoices(key = settings.elevenKey): Promise<ElevenVoice[]> {
    setElevenBusy(true);
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
      if (!res.ok) throw new Error(speechError(res.status));
      const data = await res.json() as { voices?: { voice_id: string; name: string; labels?: Record<string, string> }[] };
      const list: ElevenVoice[] = (data.voices || []).map(v => ({ id: v.voice_id, name: v.name + (v.labels?.accent ? ' · ' + v.labels.accent : '') }));
      setEleven(list); return list;
    } finally { setElevenBusy(false); }
  }

  function fetcher(s: ReadAloudSettings, kind: SpeechEngine, list: ReadChunk[]) {
    return async (n: number, signal: AbortSignal): Promise<Blob> => {
      const text = speakableText(list[n].text);
      let res: Response;
      if (kind === 'openai') {
        const profile = openaiProfiles.find(p => p.id === s.openaiProfile) || openaiProfiles[0];
        if (!profile) throw new Error('Per le voci OpenAI aggiungi un profilo OpenAI nelle impostazioni.');
        const body = { profile: profile.id, text, voice: s.openaiVoice, model: s.openaiModel };
        res = local ? await localSpeech(body, signal) : await fetch('/api/speech', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        if (!s.elevenKey) throw new Error('Inserisci la chiave ElevenLabs nelle impostazioni di lettura.');
        const config = elevenSpeechRequest(s.elevenKey, s.elevenModel, s.elevenVoice, { text, previous: n ? speakableText(list[n - 1].text) : '', next: list[n + 1] ? speakableText(list[n + 1].text) : '' });
        try { res = await fetch(config.url, { method: 'POST', signal, headers: config.headers, body: JSON.stringify(config.body) }); }
        catch (e) { if (signal.aborted) throw e; throw new Error('ElevenLabs non risponde. Controlla la connessione.'); }
        if (!res.ok) throw new Error(speechError(res.status));
      }
      if (!res.ok) { const b = await res.json().catch(() => ({})) as { error?: string }; throw new Error(b.error || speechError(res.status)); }
      return res.blob();
    };
  }

  async function start(from?: number, current = settings) {
    if (!editor || editor.isDestroyed) return;
    reader.current?.stop(); setError(''); setPaused(false);
    const { state } = editor, sel = state.selection;
    let range = { from: sel.from, to: sel.to };
    if (from !== undefined) range = { from, to: state.doc.content.size };
    else if (sel.empty) { const start = sel.$from.depth ? sel.$from.before(1) : 0; range = { from: start, to: state.doc.content.size }; }
    let list = readChunks(state.doc, range.from, range.to);
    if (!list.length && sel.empty && from === undefined) list = readChunks(state.doc);
    if (!list.length) { setError('Non c’è testo da leggere.'); return; }
    const kind = engine(current);
    if (kind === 'elevenlabs' && !current.elevenVoice) {
      try { const found = await elevenVoices(current.elevenKey); if (!found[0]) throw new Error('Nessuna voce nel tuo account ElevenLabs.'); current = { ...current, elevenVoice: found[0].id }; changeSettings(current); }
      catch (e) { setError((e as Error).message); return; }
    }
    if (kind !== 'device') list = groupChunks(list);
    chunks.current = list; index.current = 0; setReading(true);
    const events = {
      onChunk: (n: number) => { index.current = n; setSentence(list[n].text); highlight(list[n]); },
      onEnd: (message?: string) => finish(message),
      onWaiting: setWaiting,
      onPaused: () => setPaused(true),
    };
    if (kind === 'device') {
      if (!('speechSynthesis' in window)) { finish('Questo browser non ha voci di sintesi: scegli OpenAI o ElevenLabs.'); return; }
      const all = window.speechSynthesis.getVoices(), ranked = rankVoices(all);
      const voice = all.find(v => v.voiceURI === current.deviceVoice) || ranked[0] || null;
      reader.current = startDeviceReader(list, voice, current.rate, events);
    } else reader.current = startNeuralReader(list, fetcher(current, kind, list), current.rate, events);
  }

  function changeSettings(next: ReadAloudSettings) { setSettingsState(next); storeReadAloudSettings(next); }
  // A new voice or engine continues from the sentence being read.
  function changeVoice(next: ReadAloudSettings) {
    changeSettings(next);
    if (reader.current) { const at = chunks.current[index.current]?.from; void start(at, next); }
  }
  function toggle() { if (reader.current) { reader.current.stop(); finish(); } else void start(); }
  function pauseResume() { if (!reader.current) return; if (paused) { reader.current.resume(); setPaused(false); } else { reader.current.pause(); setPaused(true); } }

  const active = engine(settings), deviceNatural = voices.some(naturalVoice);
  const element = (reading || error) ? <div className={'reading-bar' + (error && !reading ? ' bad' : '')} role="status" onMouseDown={e => { if (!(e.target as HTMLElement).closest('input,select')) e.preventDefault(); }}>
    {reading ? <>
      <Volume2 size={16} className={'reading-icon' + (waiting ? ' waiting' : '')} aria-hidden="true"/>
      <span className="reading-text">{waiting ? 'Preparo la voce…' : sentence}</span>
      <button aria-label="Frase precedente" data-tip="Frase precedente" onClick={() => reader.current?.skip(-1)}><SkipBack size={15}/></button>
      <button aria-label={paused ? 'Riprendi' : 'Pausa'} data-tip={paused ? 'Riprendi la lettura' : 'Metti in pausa'} onClick={pauseResume}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
      <button aria-label="Frase successiva" data-tip="Frase successiva" onClick={() => reader.current?.skip(1)}><SkipForward size={15}/></button>
      <select aria-label="Velocità di lettura" value={settings.rate} onChange={e => { const rate = Number(e.target.value); changeSettings({ ...settings, rate }); reader.current?.setRate(rate); }}>
        {READ_RATES.map(r => <option key={r} value={r}>{r.toLocaleString('it-IT')}×</option>)}
      </select>
      <button aria-label="Voce e impostazioni di lettura" aria-expanded={open} data-tip="Scegli voce e servizio" onClick={() => setOpen(!open)}><Settings2 size={15}/></button>
      <button className="reading-stop" onClick={toggle}><Square size={13}/>Ferma</button>
    </> : <><TriangleAlert size={15}/><span className="reading-text">{error}</span><button aria-label="Impostazioni di lettura" onClick={() => setOpen(!open)}><Settings2 size={15}/></button><button aria-label="Chiudi avviso" onClick={() => setError('')}><X size={15}/></button></>}
    {open && <div className="reading-settings">
      <label>Servizio<select value={settings.engine} onChange={e => changeVoice({ ...settings, engine: e.target.value as ReadAloudSettings['engine'] })}>
        {(['auto', 'openai', 'elevenlabs', 'device'] as const).map(k => <option key={k} value={k}>{ENGINE_NAMES[k]}</option>)}
      </select></label>
      {active === 'openai' && <>
        {openaiProfiles.length > 1 && <label>Profilo<select value={settings.openaiProfile || openaiProfiles[0].id} onChange={e => changeVoice({ ...settings, openaiProfile: e.target.value })}>{openaiProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label>Voce<select value={settings.openaiVoice} onChange={e => changeVoice({ ...settings, openaiVoice: e.target.value })}>{OPENAI_VOICES.map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}{v === 'marin' || v === 'cedar' ? ' · la più naturale' : ''}</option>)}</select></label>
        <label>Modello<input value={settings.openaiModel} spellCheck={false} onChange={e => changeSettings({ ...settings, openaiModel: e.target.value.trim() || DEFAULT_READ_ALOUD.openaiModel })}/></label>
        {!openaiProfiles.length && <p className="reading-hint">Aggiungi un profilo OpenAI in Impostazioni → AI per usare queste voci.</p>}
      </>}
      {active === 'elevenlabs' && <>
        <label>Chiave API<input type="password" autoComplete="off" value={settings.elevenKey} placeholder="sk_…" onChange={e => changeSettings({ ...settings, elevenKey: e.target.value.trim(), elevenVoice: '' })}/></label>
        <label>Voce<select value={settings.elevenVoice} onFocus={() => { if (!eleven.length && settings.elevenKey) void elevenVoices().catch(e => setError((e as Error).message)); }} onChange={e => changeVoice({ ...settings, elevenVoice: e.target.value })}>
          {!eleven.some(v => v.id === settings.elevenVoice) && <option value={settings.elevenVoice}>{settings.elevenVoice ? 'Voce salvata' : elevenBusy ? 'Carico le voci…' : 'Prima voce del tuo account'}</option>}
          {eleven.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select></label>
        <label>Modello<input value={settings.elevenModel} spellCheck={false} onChange={e => changeSettings({ ...settings, elevenModel: e.target.value.trim() || DEFAULT_READ_ALOUD.elevenModel })}/></label>
        <p className="reading-hint">La chiave resta solo in questo browser e va direttamente a ElevenLabs.</p>
      </>}
      {active === 'device' && <>
        <label>Voce<select value={settings.deviceVoice} onChange={e => changeVoice({ ...settings, deviceVoice: e.target.value })}>
          <option value="">La più naturale disponibile</option>
          {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{naturalVoice(v) ? ' ★' : ''}</option>)}
        </select></label>
        {!deviceNatural && <p className="reading-hint">Su questo dispositivo non ci sono voci neurali. Per voci davvero realistiche usa OpenAI o ElevenLabs, oppure Microsoft Edge (voci «Natural») o Chrome (voci Google).</p>}
      </>}
    </div>}
  </div> : null;

  return { reading, toggle, element };
}
