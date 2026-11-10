'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ImagePlus, RefreshCw, X } from 'lucide-react';
import { ideaFields, IDEA_STYLES, parsePromptAnswer, type PromptIdea } from '../lib/image-ideas';
import { chartSvg, parseChartAnswer, type ChartSpec } from '../lib/idea-chart';
import type { Run } from './companion';

// Finestra aperta dal tasto destro: il prompt per un generatore di immagini, oppure un grafico (o schema) disegnato
// automaticamente con la sua didascalia, da controllare prima di inserirlo nel documento.
export type InsertedChart = { svg: string; width: number; height: number; caption: string; alt: string };

export function ImageIdeaDialog({ kind, context, run, onInsertChart, onClose }: { kind: 'prompt' | 'chart'; context: string; run: Run; onInsertChart: (chart: InsertedChart) => Promise<string>; onClose: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'), [error, setError] = useState('');
  const [style, setStyle] = useState('auto'), [idea, setIdea] = useState<PromptIdea | null>(null), [spec, setSpec] = useState<ChartSpec | null>(null);
  const [prompt, setPrompt] = useState(''), [caption, setCaption] = useState(''), [copied, setCopied] = useState(''), [inserting, setInserting] = useState(false);
  const controller = useRef<AbortController | null>(null), runRef = useRef(run);
  // `run` cambia a ogni render del workspace: la richiesta non deve ripartire per questo
  useEffect(() => { runRef.current = run; });

  const generate = useCallback(async (chosenStyle: string) => {
    controller.current?.abort(); const mine = controller.current = new AbortController();
    setState('loading'); setError(''); setCopied('');
    try {
      const answer = await runRef.current(kind === 'chart' ? 'chart' : 'imageprompt', ideaFields(context, kind === 'chart' ? 'auto' : chosenStyle), mine.signal);
      if (mine.signal.aborted) return;
      if (kind === 'chart') {
        const parsed = parseChartAnswer(answer);
        if (!parsed) throw new Error('Dal testo vicino non si ricava un grafico o uno schema chiaro. Seleziona il passaggio da rappresentare oppure scrivi qualche frase in più.');
        setSpec(parsed); setCaption(parsed.caption);
      } else {
        const parsed = parsePromptAnswer(answer);
        if (!parsed) throw new Error('Dal testo vicino non si ricava un’immagine chiara. Seleziona il passaggio da illustrare oppure scrivi qualche frase in più.');
        setIdea(parsed); setPrompt(parsed.prompt); setCaption(parsed.caption);
      }
      setState('ready');
    } catch (err) {
      if (mine.signal.aborted || (err as Error).name === 'AbortError') return;
      setError((err as Error).message); setState('error');
    }
  }, [kind, context]);
  useEffect(() => { void generate('auto'); return () => controller.current?.abort(); }, [generate]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true); }, [onClose]);

  async function copy(what: 'prompt' | 'caption') {
    try { await navigator.clipboard.writeText(what === 'prompt' ? prompt : caption); setCopied(what); setTimeout(() => setCopied(c => c === what ? '' : c), 2500); }
    catch { setError('Copia non riuscita: seleziona il testo e usa Ctrl+C.'); }
  }
  async function insert() {
    if (!spec || inserting) return;
    setInserting(true); setError('');
    const { svg, width, height } = chartSvg(spec);
    const message = await onInsertChart({ svg, width, height, caption: caption.trim() || spec.caption, alt: spec.alt });
    setInserting(false);
    if (message) setError(message); else onClose();
  }
  const preview = spec ? chartSvg(spec).svg : '';
  const title = kind === 'chart' ? 'Grafico con didascalia' : 'Prompt per un’immagine';
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="modal idea-modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <button className="modal-close" aria-label="Chiudi" onClick={onClose}><X size={20}/></button>
      <h2>{title}</h2>
      <p className="modal-subtitle">{kind === 'chart' ? 'Disegnato dal testo vicino al punto scelto: numeri solo se compaiono nel testo, altrimenti uno schema.' : 'Scritto leggendo il testo prima e dopo il punto scelto. Incollalo nel generatore di immagini che preferisci.'}</p>
      {state === 'loading' && <p className="idea-status" role="status"><RefreshCw size={16} className="spin"/>{kind === 'chart' ? 'Sto disegnando il grafico…' : 'Sto scrivendo il prompt…'}</p>}
      {error && <p className="warning" role="alert">{error}</p>}
      {state === 'ready' && kind === 'prompt' && idea && <>
        <label>Stile<select aria-label="Stile dell’immagine" value={style} onChange={e => { setStyle(e.target.value); void generate(e.target.value); }}>{IDEA_STYLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Prompt (in inglese, funziona con quasi tutti i generatori)<textarea aria-label="Prompt per il generatore di immagini" rows={6} value={prompt} onChange={e => setPrompt(e.target.value)}/></label>
        <label>Didascalia proposta<input aria-label="Didascalia" value={caption} onChange={e => setCaption(e.target.value)}/></label>
        <p className="form-note">Quando hai l’immagine, tasto destro nello stesso punto → «Inserisci immagine da file»: poi «Scrivi la didascalia con l’AI» sull’immagine, oppure usa quella qui sopra.</p>
        <div className="form-footer">
          <button type="button" className="primary" onClick={() => void copy('prompt')}>{copied === 'prompt' ? <Check size={16}/> : <Copy size={16}/>}{copied === 'prompt' ? 'Prompt copiato' : 'Copia il prompt'}</button>
          <button type="button" onClick={() => void copy('caption')} disabled={!caption.trim()}>{copied === 'caption' ? <Check size={16}/> : <Copy size={16}/>}{copied === 'caption' ? 'Didascalia copiata' : 'Copia la didascalia'}</button>
          <button type="button" onClick={() => void generate(style)}><RefreshCw size={16}/>Rigenera</button>
        </div>
      </>}
      {state === 'ready' && kind === 'chart' && spec && <>
        <div className="idea-chart" role="img" aria-label={spec.alt || spec.caption} dangerouslySetInnerHTML={{ __html: preview }}/>
        <label>Didascalia<input aria-label="Didascalia del grafico" value={caption} maxLength={300} onChange={e => setCaption(e.target.value)}/></label>
        <p className="form-note">L’immagine viene inserita sotto il punto scelto, adattata alla pagina, con la didascalia sotto. Puoi annullare con Ctrl+Z.</p>
        <div className="form-footer">
          <button type="button" className="primary" disabled={inserting} onClick={() => void insert()}><ImagePlus size={16}/>{inserting ? 'Inserisco…' : 'Inserisci nel documento'}</button>
          <button type="button" onClick={() => void generate('auto')}><RefreshCw size={16}/>Rigenera</button>
          <button type="button" onClick={onClose}>Annulla</button>
        </div>
      </>}
      {state === 'error' && <div className="form-footer"><button type="button" className="primary" onClick={() => void generate(style)}><RefreshCw size={16}/>Riprova</button><button type="button" onClick={onClose}>Chiudi</button></div>}
    </section>
  </div>;
}
