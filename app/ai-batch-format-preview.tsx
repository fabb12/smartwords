'use client';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { summarizeFormatting, withProposedTitles, type FormatReplacement } from '../lib/format-only';
import { AiFormatPreview } from './ai-format-preview';

const OUTLINE_ROWS = 10, CHIPS = 8;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const LEVEL_NAMES = ['Introduzione', 'Titolo', 'Sottotitolo', 'Titolo minore'];

// The side panel shows what changes (structure, counts, emphasized concepts)
// instead of the whole text; the formatted text stays one click away.
export function AiBatchFormatPreview({ parts, includeTitles = true, onIncludeTitles, imageNote }: { parts: FormatReplacement[]; includeTitles?: boolean; onIncludeTitles?: (value: boolean) => void; imageNote?: string }) {
  const [index, setIndex] = useState(0), [allOutline, setAllOutline] = useState(false), [allChips, setAllChips] = useState(false);
  const current = Math.min(index, parts.length - 1), summary = useMemo(() => summarizeFormatting(parts), [parts]);
  const rows = includeTitles ? summary.outline : summary.outline.filter(row => !row.proposed);
  const outline = allOutline ? rows : rows.slice(0, OUTLINE_ROWS);
  const chips = [...summary.highlights.map(text => ({ text, key: true })), ...summary.concepts.map(text => ({ text, key: false }))];
  const shownChips = allChips ? chips : chips.slice(0, CHIPS);
  const stats = [summary.headings && plural(summary.headings, 'titolo', 'titoli'), includeTitles && summary.proposed && plural(summary.proposed, 'titolo proposto', 'titoli proposti'), plural(summary.paragraphs, 'paragrafo', 'paragrafi'), summary.lists && plural(summary.lists, 'elenco', 'elenchi'), chips.length && plural(chips.length, 'concetto in evidenza', 'concetti in evidenza')].filter(Boolean) as string[];
  return <section className="format-batch-preview format-summary">
    <ul className="format-stats" aria-label="Riepilogo della formattazione">{stats.map(s => <li key={s}>{s}</li>)}</ul>
    {imageNote && <p className="format-images"><ImageIcon size={14} aria-hidden="true"/><span>Immagini e formule: {imageNote}</span></p>}
    {outline.length ? <div className="format-outline">
      <p className="format-label">Struttura</p>
      <ol>{outline.map((row, i) => <li key={i} className={'level-' + row.level + (row.proposed ? ' proposed' : '')} title={LEVEL_NAMES[row.level] + (row.proposed ? ' proposto' : '')}>
        <span className="format-outline-text">{row.level ? row.text : <em>Testo iniziale</em>}</span>
        {row.paragraphs > 0 && <span className="format-outline-count" title={plural(row.paragraphs, 'paragrafo', 'paragrafi')}>{row.paragraphs} §</span>}
      </li>)}</ol>
      {rows.length > OUTLINE_ROWS && <button className="format-more" onClick={() => setAllOutline(!allOutline)}>{allOutline ? 'Mostra meno' : `Altri ${rows.length - OUTLINE_ROWS} titoli`}</button>}
    </div> : <p className="format-empty">Nessun titolo riconosciuto: il testo resta organizzato in paragrafi.</p>}
    {summary.proposed > 0 && onIncludeTitles && <label className="format-proposed-toggle">
      <input type="checkbox" checked={includeTitles} onChange={e => onIncludeTitles(e.target.checked)}/>
      <span>Aggiungi i {plural(summary.proposed, 'titolo proposto', 'titoli proposti')} <small>(parole nuove, segnate con «proposto»)</small></span>
    </label>}
    {chips.length > 0 && <div className="format-concepts">
      <p className="format-label">In evidenza</p>
      <ul>{shownChips.map(c => <li key={(c.key ? '!' : '') + c.text} className={c.key ? 'key' : ''} title={c.key ? 'Idea principale (evidenziata)' : 'Concetto chiave (grassetto)'}>{c.text}</li>)}</ul>
      {chips.length > CHIPS && <button className="format-more" onClick={() => setAllChips(!allChips)}>{allChips ? 'Mostra meno' : `+${chips.length - CHIPS}`}</button>}
    </div>}
    <details className="format-sample">
      <summary>Anteprima del testo{parts.length > 1 ? ` · passaggio ${current + 1} di ${parts.length}` : ''}</summary>
      {parts.length > 1 && <div className="format-batch-navigation" role="group" aria-label="Passaggi formattati">
        <button aria-label="Passaggio precedente" disabled={current === 0} onClick={() => setIndex(current - 1)}><ChevronLeft size={16}/></button>
        <span>Passaggio {current + 1} di {parts.length}</span>
        <button aria-label="Passaggio successivo" disabled={current === parts.length - 1} onClick={() => setIndex(current + 1)}><ChevronRight size={16}/></button>
      </div>}
      <AiFormatPreview content={includeTitles ? parts[current].content : withProposedTitles(parts[current].content, false)} compact/>
    </details>
    <p className="format-batch-note">Solo formattazione: parole e punteggiatura restano quelle originali{summary.proposed && includeTitles ? ', salvo i titoli proposti' : ''}; i titoli prendono maiuscole e dimensione in base all’importanza. Accetta applica tutto.</p>
  </section>;
}
