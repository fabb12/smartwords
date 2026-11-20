'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ClipboardPaste, Copy, FolderOpen, ImagePlus, RefreshCw, X } from 'lucide-react';
import { clipboardImage } from '../lib/editor-images';
import { ideaFields, IDEA_STYLES, parsePromptAnswer, type PromptIdea } from '../lib/image-ideas';
import { chartSvg, parseChartAnswer, type ChartSpec } from '../lib/idea-chart';
import type { Run } from './companion';

// Finestra aperta dal tasto destro: il prompt per un generatore di immagini, oppure un grafico (o schema) disegnato
// automaticamente con la sua didascalia, da controllare prima di inserirlo nel documento.
export type InsertedChart = { svg: string; width: number; height: number; caption: string; alt: string };

// Il primo file immagine fra quelli trascinati o incollati.
const firstImage = (files: FileList | null | undefined) => Array.from(files || []).find(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|heic|heif)$/i.test(f.name)) || null;

export function ImageIdeaDialog({ kind, context, run, onInsertChart, onInsertImage, onClose }: { kind: 'prompt' | 'chart'; context: string; run: Run; onInsertChart: (chart: InsertedChart) => Promise<string>; onInsertImage: (image: Blob, caption: string, alt: string) => Promise<string>; onClose: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'), [error, setError] = useState('');
  const [style, setStyle] = useState('auto'), [idea, setIdea] = useState<PromptIdea | null>(null), [spec, setSpec] = useState<ChartSpec | null>(null);
  const [prompt, setPrompt] = useState(''), [caption, setCaption] = useState(''), [copied, setCopied] = useState(''), [inserting, setInserting] = useState(false);
  const [picture, setPictureState] = useState<{ blob: Blob; url: string } | null>(null), [dragging, setDragging] = useState(false), [alt, setAlt] = useState('');
  const controller = useRef<AbortController | null>(null), runRef = useRef(run), fileInput = useRef<HTMLInputElement>(null);
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
        setIdea(parsed); setPrompt(parsed.prompt); setCaption(parsed.caption); setAlt(parsed.alt);
      }
      setState('ready');
    } catch (err) {
      if (mine.signal.aborted || (err as Error).name === 'AbortError') return;
      setError((err as Error).message); setState('error');
    }
  }, [kind, context]);
  useEffect(() => { void generate('auto'); return () => controller.current?.abort(); }, [generate]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true); }, [onClose]);

  // L'immagine creata dal generatore: anteprima finché non si inserisce o se ne sceglie un'altra.
  const setPicture = useCallback((blob: Blob | null) => setPictureState(old => { if (old) URL.revokeObjectURL(old.url); return blob ? { blob, url: URL.createObjectURL(blob) } : null; }), []);
  const choose = useCallback((file: Blob | null) => {
    if (!file) { setError('Questo non è un file immagine: usa PNG, JPEG, WebP, GIF o HEIC.'); return; }
    setError(''); setPicture(file);
  }, [setPicture]);
  const lastUrl = useRef(''); useEffect(() => { lastUrl.current = picture?.url || ''; }, [picture]);
  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);
  // Ctrl+V con un'immagine negli appunti, ovunque nella finestra (il testo incollato nei campi resta normale).
  useEffect(() => {
    if (kind !== 'prompt') return;
    const paste = (e: ClipboardEvent) => { const file = firstImage(e.clipboardData?.files); if (!file) return; e.preventDefault(); choose(file); };
    document.addEventListener('paste', paste); return () => document.removeEventListener('paste', paste);
  }, [kind, choose]);
  async function pasteFromClipboard() { try { choose(await clipboardImage()); } catch (err) { setError((err as Error).message); } }
  function drop(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setDragging(false); const file = firstImage(e.dataTransfer.files); if (file) choose(file); else if (e.dataTransfer.files.length) choose(null); }
  async function insertPicture() {
    if (!picture || inserting) return;
    const text = caption.trim(); if (!text) { setError('Scrivi la didascalia prima di inserire l’immagine.'); return; }
    setInserting(true); setError('');
    const message = await onInsertImage(picture.blob, text, alt.trim() || text);
    setInserting(false);
    if (message) setError(message); else onClose();
  }
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
    <section className="modal idea-modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
      onDragOver={kind === 'prompt' ? e => e.preventDefault() : undefined} onDrop={kind === 'prompt' ? e => { e.preventDefault(); if (state === 'ready') drop(e); } : undefined}>
      <button className="modal-close" aria-label="Chiudi" onClick={onClose}><X size={20}/></button>
      <h2>{title}</h2>
      <p className="modal-subtitle">{kind === 'chart' ? 'Disegnato dal testo vicino al punto scelto: numeri solo se compaiono nel testo, altrimenti uno schema.' : 'Scritto leggendo il testo prima e dopo il punto scelto. Incollalo nel generatore che preferisci, poi aggiungi qui l’immagine ottenuta: va nel testo con la sua didascalia.'}</p>
      {state === 'loading' && <p className="idea-status" role="status"><RefreshCw size={16} className="spin"/>{kind === 'chart' ? 'Sto disegnando il grafico…' : 'Sto scrivendo il prompt…'}</p>}
      {error && <p className="warning" role="alert">{error}</p>}
      {state === 'ready' && kind === 'prompt' && idea && <>
        <label>Stile<select aria-label="Stile dell’immagine" value={style} onChange={e => { setStyle(e.target.value); void generate(e.target.value); }}>{IDEA_STYLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Prompt (in inglese, funziona con quasi tutti i generatori)<textarea aria-label="Prompt per il generatore di immagini" rows={6} value={prompt} onChange={e => setPrompt(e.target.value)}/></label>
        <label>Didascalia proposta<input aria-label="Didascalia" value={caption} maxLength={300} onChange={e => setCaption(e.target.value)}/></label>
        <div className="form-footer">
          <button type="button" className={picture ? '' : 'primary'} onClick={() => void copy('prompt')}>{copied === 'prompt' ? <Check size={16}/> : <Copy size={16}/>}{copied === 'prompt' ? 'Prompt copiato' : 'Copia il prompt'}</button>
          <button type="button" onClick={() => void copy('caption')} disabled={!caption.trim()}>{copied === 'caption' ? <Check size={16}/> : <Copy size={16}/>}{copied === 'caption' ? 'Didascalia copiata' : 'Copia la didascalia'}</button>
          <button type="button" onClick={() => void generate(style)}><RefreshCw size={16}/>Rigenera</button>
        </div>
        <h3 className="idea-step">Aggiungi l’immagine generata</h3>
        <div className={'idea-drop' + (dragging ? ' over' : '') + (picture ? ' filled' : '')} onDragEnter={e => { e.preventDefault(); setDragging(true); }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={drop}>
          {picture ? <img src={picture.url} alt={alt || caption || 'Immagine scelta'}/> : <p>Trascina qui l’immagine creata dal generatore, oppure incollala con Ctrl+V.</p>}
          <div className="idea-drop-actions">
            <button type="button" onClick={() => fileInput.current?.click()}><FolderOpen size={16}/>{picture ? 'Scegli un altro file…' : 'Scegli un file…'}</button>
            <button type="button" onClick={() => void pasteFromClipboard()}><ClipboardPaste size={16}/>Incolla dagli appunti</button>
            {picture && <button type="button" onClick={() => setPicture(null)}><X size={16}/>Togli</button>}
          </div>
          <input ref={fileInput} type="file" accept="image/*,.heic,.heif" hidden onChange={e => { const file = firstImage(e.target.files); e.target.value = ''; if (file) choose(file); else if (e.target.files?.length) choose(null); }}/>
        </div>
        {picture && <>
          <label>Testo alternativo (per gli screen reader)<input aria-label="Testo alternativo" value={alt} maxLength={200} onChange={e => setAlt(e.target.value)}/></label>
          <p className="form-note">L’immagine viene adattata alla pagina e inserita sotto il punto scelto, con la didascalia qui sopra sotto l’immagine, centrata, piccola e in corsivo. Puoi annullare con Ctrl+Z.</p>
          <div className="form-footer">
            <button type="button" className="primary" disabled={inserting || !caption.trim()} onClick={() => void insertPicture()}><ImagePlus size={16}/>{inserting ? 'Inserisco…' : 'Inserisci immagine e didascalia'}</button>
          </div>
        </>}
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
