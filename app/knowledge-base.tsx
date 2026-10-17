'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookUser, Download, FileUp, Library, Sparkles, Trash2, X } from 'lucide-react';
import { KB_LIMITS, PERSONA_FIELDS, PERSONA_SAMPLE, addKbDocument, buildKbIndex, createKnowledgeBase, estimateTokens, exportKnowledgeBase, importKnowledgeBase, kbInstruction, kbStats, removeKbFile, type KbKind, type KbPersona, type KnowledgeBase, type StyleSource } from '../lib/knowledge-base';
import { KB_ACCEPT, KB_MAX_FILE, extractText } from './kb-extract';

const fmt = (n: number) => n.toLocaleString('it-IT');

// Compact, always-visible label of what is guiding the AI. "busy" makes it pulse while
// the AI is predicting or correcting, so the writer sees which knowledge base is used.
export function SourceBadge({ source, busy = false, compact = false, onClick }: { source: StyleSource; busy?: boolean; compact?: boolean; onClick?: () => void }) {
  const icon = source.kind === 'kb-personal' || source.kind === 'memory' ? <BookUser size={compact ? 12 : 13} /> : <Library size={compact ? 12 : 13} />;
  const prefix = source.kind === 'kb-personal' ? 'KB personale' : source.kind === 'kb-author' ? 'KB autore' : source.kind === 'famous' ? 'Stile' : source.kind === 'memory' ? 'Voce' : source.kind === 'custom' ? 'Stile' : 'Stile';
  const title = `${busy ? 'L’AI sta usando: ' : 'Fonte di stile attiva: '}${source.detail} — ${source.label}${source.extra ? ' + voce ' + source.extra : ''}. Clic per gestire le knowledge base.`;
  return <button type="button" className={`source-badge src-${source.kind}${busy ? ' is-busy' : ''}${compact ? ' compact' : ''}`} aria-label={title} data-tip={title} onClick={onClick} onMouseDown={e => e.preventDefault()}>
    <span className="source-dot" aria-hidden="true" />{icon}<span className="source-prefix">{prefix}</span><strong>{source.label}</strong>{source.extra && !compact && <em>+ {source.extra}</em>}
  </button>;
}

type Props = {
  bases: KnowledgeBase[]; activeId: string; ready: boolean; error: string;
  onActivate: (id: string) => void; onSave: (kb: KnowledgeBase) => Promise<void>; onDelete: (id: string) => Promise<void>;
  distill: (kb: KnowledgeBase, signal: AbortSignal) => Promise<KbPersona>; onClose: () => void;
};
export function KnowledgeBaseModal({ bases, activeId, ready, error: storeError, onActivate, onSave, onDelete, distill, onClose }: Props) {
  const [selected, setSelected] = useState(activeId || bases[0]?.id || '');
  const [creating, setCreating] = useState(!bases.length), [form, setForm] = useState({ name: '', author: '', kind: 'personal' as KbKind });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const kb = bases.find(b => b.id === selected) || null;
  const stats = kb ? kbStats(kb) : null;
  // Tokens actually sent per automatic completion with this knowledge base, vs. the whole corpus.
  const perRequest = useMemo(() => { const k = bases.find(b => b.id === selected); return k && k.chunks.length ? estimateTokens(kbInstruction(k, buildKbIndex(k), k.chunks[0].t.slice(0, 200), 'complete').length) : 0; }, [bases, selected]);
  function close() { pending.current?.abort(); onClose(); }

  async function create() {
    if (!form.name.trim()) { setError('Dai un nome alla knowledge base.'); return; }
    if (bases.length >= KB_LIMITS.bases) { setError(`Puoi avere fino a ${KB_LIMITS.bases} knowledge base: eliminane una.`); return; }
    const next = createKnowledgeBase(form.name, form.author, form.kind);
    try { await onSave(next); setSelected(next.id); setCreating(false); setForm({ name: '', author: '', kind: 'personal' }); setError(''); setMessage('Knowledge base creata: ora aggiungi i testi.'); }
    catch (err) { setError((err as Error).message); }
  }
  async function addFiles(list: FileList) {
    if (!kb) return; let next = kb; const failed: string[] = []; let added = 0;
    setError(''); setMessage('');
    for (const file of Array.from(list)) {
      setBusy(`Leggo «${file.name}»…`);
      try { const { text, format } = await extractText(file, setBusy); next = addKbDocument(next, file.name, format, text); added++; }
      catch (err) { failed.push((err as Error).message); }
    }
    try { if (added) await onSave(next); } catch (err) { failed.push((err as Error).message); }
    setBusy(''); if (failed.length) setError(failed.join(' '));
    if (added) setMessage(`${added} file aggiunti. Stile e mentalità aggiornati sul dispositivo${next.persona.distilled ? '; puoi distillare di nuovo il profilo con l’AI' : ''}.`);
  }
  async function runDistill() {
    if (!kb) return; const c = new AbortController(); pending.current = c;
    setBusy('Distillo mentalità e personalità…'); setError(''); setMessage('');
    try { const persona = await distill(kb, c.signal); if (c.signal.aborted) return; await onSave({ ...kb, persona }); setMessage('Profilo distillato: da ora viene inviato in forma compatta a ogni richiesta.'); }
    catch (err) { if (!c.signal.aborted) setError((err as Error).message); }
    finally { if (!c.signal.aborted) setBusy(''); }
  }
  async function update(patch: Partial<KnowledgeBase>) { if (!kb) return; try { await onSave({ ...kb, ...patch }); } catch (err) { setError((err as Error).message); } }
  function exportBase() { if (!kb) return; const url = URL.createObjectURL(new Blob([exportKnowledgeBase(kb)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = kb.name.replace(/[<>:"/\\|?*]/g, '_') + '.scrivia-kb.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function importBase(file: File) {
    setError('');
    try { if (bases.length >= KB_LIMITS.bases) throw new Error(`Puoi avere fino a ${KB_LIMITS.bases} knowledge base.`); const next = importKnowledgeBase(await file.text()); await onSave(next); setSelected(next.id); setCreating(false); setMessage('Knowledge base importata.'); }
    catch (err) { setError((err as Error).message); }
  }

  return <div className="modal-backdrop" onClick={close}><section className="modal kb-modal" role="dialog" aria-modal="true" aria-label="Knowledge base" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
    <button className="modal-close tool" aria-label="Chiudi knowledge base" onClick={close}><X size={20} /></button><span className="modal-icon"><Library size={24} /></span>
    <h2>Knowledge base di stile</h2>
    <p className="modal-subtitle">Carica testi tuoi o di un autore (PDF, Word, ODT, EPUB, RTF, HTML, Markdown, testo). Scrivia ne estrae stile, mentalità e temi, e le previsioni seguono quella voce.</p>

    <div className="kb-list" role="radiogroup" aria-label="Knowledge base attiva">
      <label className={'kb-item' + (!activeId ? ' active' : '')}><input type="radio" name="kb-active" checked={!activeId} onChange={() => onActivate('')} /><span className="kb-item-body"><strong>Nessuna</strong><small>Usa «La mia voce» o la voce d’autore scelta nel progetto</small></span></label>
      {bases.map(b => <div key={b.id} className={'kb-item' + (b.id === activeId ? ' active' : '') + (b.id === selected && !creating ? ' selected' : '')}>
        <input type="radio" name="kb-active" aria-label={'Usa ' + b.name + ' per le previsioni'} checked={b.id === activeId} onChange={() => onActivate(b.id)} />
        <button type="button" className="kb-item-body" aria-label={'Apri ' + b.name} onClick={() => { setSelected(b.id); setCreating(false); setConfirmDelete(false); }}><strong>{b.name}</strong><small><span className={'kb-kind ' + b.kind}>{b.kind === 'personal' ? 'personale' : 'autore'}</span>{b.author && ' · ' + b.author} · {b.files.length} file · {fmt(b.local.words)} parole</small></button>
      </div>)}
    </div>
    <div className="kb-row-actions"><button className="kb-link" onClick={() => { setCreating(!creating); setError(''); }}>{creating ? 'Annulla' : '+ Nuova knowledge base'}</button>
      <label className="kb-link kb-file">Importa (.scrivia-kb.json)<input type="file" accept=".json" aria-label="Importa knowledge base" onChange={e => { const f = e.target.files?.[0]; if (f) void importBase(f); e.target.value = ''; }} /></label></div>

    {creating && <div className="kb-create">
      <label>Nome<input value={form.name} maxLength={80} placeholder="Es. I miei racconti, Saggi di Calvino" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>Autore dei testi<input value={form.author} maxLength={80} placeholder="Es. il tuo nome, oppure Italo Calvino" onChange={e => setForm({ ...form, author: e.target.value })} /></label>
      <div className="segmented kb-kind-switch" role="radiogroup" aria-label="Tipo di knowledge base">
        <button role="radio" aria-checked={form.kind === 'personal'} className={form.kind === 'personal' ? 'active' : ''} onClick={() => setForm({ ...form, kind: 'personal' })}>Personale · i miei testi</button>
        <button role="radio" aria-checked={form.kind === 'author'} className={form.kind === 'author' ? 'active' : ''} onClick={() => setForm({ ...form, kind: 'author' })}>Autore · testi di altri</button>
      </div>
      <button className="primary" onClick={() => void create()}>Crea knowledge base</button>
    </div>}

    {kb && !creating && <div className="kb-detail">
      <div className="kb-detail-head"><h3>{kb.name}</h3>{kb.id !== activeId ? <button className="primary kb-use" onClick={() => onActivate(kb.id)}>Usa per le previsioni</button> : <span className="kb-in-use">● In uso nelle previsioni</span>}</div>
      <label className={'kb-upload' + (busy ? ' disabled' : '')}><FileUp size={18} /><span><strong>{busy || 'Aggiungi file'}</strong><small>Anche più file insieme · fino a {KB_MAX_FILE / 1_000_000} MB ciascuno · elaborati sul dispositivo</small></span>
        <input type="file" multiple accept={KB_ACCEPT} disabled={!!busy} aria-label="Aggiungi file alla knowledge base" onChange={e => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }} /></label>
      {kb.kind === 'author' && <p className="form-note">Usa testi che possiedi o di libero uso. Le proposte evocano stile e mentalità senza copiare frasi dei testi caricati.</p>}

      {stats && <div className="mini-stats kb-stats"><span><strong>{stats.files}</strong> file</span><span><strong>{fmt(stats.words)}</strong> parole</span><span><strong>{fmt(stats.chunks)}</strong> blocchi</span></div>}
      {!!kb.chunks.length && <p className="form-note kb-tokens"><strong>Ottimizzazione token:</strong> il corpus vale circa {fmt(stats!.corpusTokens)} token; a ogni previsione ne vengono inviati circa {fmt(perRequest)} (profilo compatto + 2–3 passaggi pertinenti scelti sul dispositivo con ricerca BM25).</p>}

      {!!kb.files.length && <details><summary>File ({kb.files.length})</summary>{kb.files.map(f => <div className="writing-memory-source" key={f.id}><div><strong>{f.name}</strong><small>{f.format.toUpperCase()} · {fmt(f.words)} parole</small></div><button disabled={!!busy} aria-label={'Rimuovi ' + f.name} onClick={() => void onSave(removeKbFile(kb, f.id)).catch(err => setError((err as Error).message))}>Rimuovi</button></div>)}</details>}

      {kb.local.words > 0 && <dl className="writing-memory-traits">
        {kb.local.style && <div><dt>Stile</dt><dd>{kb.local.style}{!kb.local.reliable && ' (provvisorio)'}</dd></div>}
        {!!kb.local.traits.length && <div><dt>Mentalità</dt><dd>{kb.local.traits.join(' · ')}</dd></div>}
        {!!kb.local.themes.length && <div><dt>Temi</dt><dd>{kb.local.themes.join(', ')}</dd></div>}
        {!!kb.local.expressions.length && <div><dt>Espressioni</dt><dd>{kb.local.expressions.join(' · ')}</dd></div>}
      </dl>}

      {!!kb.chunks.length && <div className="kb-persona">
        <div className="kb-persona-head"><h3>Personalità e mentalità</h3><button className="kb-distill" disabled={!!busy || !ready} onClick={() => void runDistill()}><Sparkles size={14} />{kb.persona.distilled ? 'Distilla di nuovo' : 'Distilla con l’AI'}</button></div>
        <p className="form-note">{ready ? `Una sola chiamata AI su un campione rappresentativo di circa ${fmt(estimateTokens(PERSONA_SAMPLE))} token; il risultato viene riusato a ogni previsione. Puoi correggerlo qui sotto.` : 'Collega un provider AI per distillare il profilo. Le misure locali qui sopra funzionano già senza AI.'}</p>
        {kb.persona.distilled ? <div className="kb-persona-fields">{PERSONA_FIELDS.map(([key, label]) => <label key={key}>{label}<textarea rows={2} maxLength={300} value={kb.persona[key] || ''} onChange={e => void update({ persona: { ...kb.persona, [key]: e.target.value } })} /></label>)}</div> : null}
      </div>}
      <label>Note sull’autore (facoltative)<textarea rows={2} maxLength={600} value={kb.notes} placeholder="Es. ironico ma mai cinico; ama le digressioni scientifiche; finali aperti." onChange={e => void update({ notes: e.target.value })} /></label>

      <div className="writing-memory-actions"><button className="kb-link" onClick={exportBase}><Download size={14} />Esporta</button><button className="kb-link danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />Elimina</button></div>
      {confirmDelete && <div className="warning"><p>Eliminare «{kb.name}» e i suoi testi da questo dispositivo?</p><button onClick={() => { setConfirmDelete(false); void onDelete(kb.id).then(() => setSelected(bases.find(b => b.id !== kb.id)?.id || '')).catch(err => setError((err as Error).message)); }}>Elimina</button><button onClick={() => setConfirmDelete(false)}>Annulla</button></div>}
    </div>}

    <p className="form-note">Testi, profilo e indice restano sul dispositivo (IndexedDB). Al provider AI vengono inviati solo il profilo compatto e pochi passaggi pertinenti, quando chiedi o ricevi un suggerimento.</p>
    {(error || storeError) && <p className="warning" role="alert">{error || storeError}</p>}{message && <p className="form-note" role="status">{message}</p>}
    <div className="form-footer"><button className="primary" onClick={close}>Fatto</button></div>
  </section></div>;
}
