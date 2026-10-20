'use client';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from 'lucide-react';
import { documentOutline, searchDocument, setParagraphRole } from '../lib/document-navigation';
import { pageRangeAt } from '../lib/pagination';

export function DocumentNavigation({ editor, pages, count, onPages, onClose }: { editor: Editor; pages: number; count: number; onPages: () => void; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState(() => ({ doc: editor.state.doc, from: editor.state.selection.from }));
  const [tab, setTab] = useState<'outline' | 'pages' | 'results'>('outline'), [query, setQuery] = useState(''), [paragraphs, setParagraphs] = useState(false), [collapsed, setCollapsed] = useState<Set<number>>(new Set()), [shown, setShown] = useState(50);
  const search = useDeferredValue(query), outline = useMemo(() => documentOutline(snapshot.doc, paragraphs), [snapshot.doc, paragraphs]);
  const found = useMemo(() => searchDocument(snapshot.doc, search), [snapshot.doc, search]);
  const active = outline.findLast(entry => entry.from <= snapshot.from);
  const [pageItems, setPageItems] = useState<{ from: number; to: number; text: string }[]>([]);
  useEffect(() => {
    let frame = 0;
    const sync = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; if (!editor.isDestroyed) setSnapshot(previous => previous.doc === editor.state.doc && previous.from === editor.state.selection.from ? previous : { doc: editor.state.doc, from: editor.state.selection.from }); }); };
    sync(); editor.on('transaction', sync); return () => { editor.off('transaction', sync); cancelAnimationFrame(frame); };
  }, [editor]);
  useEffect(() => {
    if (tab !== 'pages' || !pages) return;
    const timer = setTimeout(() => { if (!editor.isDestroyed) setPageItems(Array.from({ length: Math.min(count, shown) }, (_, index) => { const range = pageRangeAt(editor.view, index); return { ...range, text: editor.state.doc.textBetween(range.from, range.to, ' ').slice(0,150) }; })); }, 120);
    return () => clearTimeout(timer);
  }, [editor, snapshot.doc, tab, pages, count, shown]);
  function jump(from: number, to = from) { const start = Math.min(from, editor.state.doc.content.size), end = Math.min(to, editor.state.doc.content.size); const range = start === end ? TextSelection.near(editor.state.doc.resolve(start)) : { from: start, to: end }; editor.chain().focus().setTextSelection({ from: range.from, to: range.to }).scrollIntoView().run(); }
  function next(back: boolean) {
    if (!found.matches.length) return;
    const current = found.matches.findIndex(match => match.from === editor.state.selection.from);
    const index = current < 0 ? (back ? found.matches.length - 1 : 0) : (current + (back ? -1 : 1) + found.matches.length) % found.matches.length;
    const match = found.matches[index]; jump(match.from, match.to);
  }
  const heading = editor.state.selection.$from.parent;
  return <aside className="document-navigation" aria-label="Navigazione documento" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <header><strong>Navigazione</strong><button aria-label="Chiudi navigazione" onClick={onClose}><X size={18}/></button></header>
    <div className="navigation-search"><Search size={15}/><input aria-label="Cerca nel documento" placeholder="Cerca nel documento" value={query} onChange={e => { setQuery(e.target.value); if (e.target.value) setTab('results'); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); next(e.shiftKey); } }}/>{query&&<button aria-label="Cancella ricerca documento" onClick={() => setQuery('')}><X size={14}/></button>}</div>
    <div className="navigation-tabs" role="tablist" aria-label="Navigazione per">{([['outline','Struttura'],['pages','Pagine'],['results','Risultati']] as const).map(([id,label]) => <button key={id} role="tab" id={`navigation-${id}`} aria-controls="navigation-panel" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="navigation-panel" id="navigation-panel" role="tabpanel" aria-labelledby={`navigation-${tab}`}>
    {tab === 'outline'&&<>
      <label className="navigation-style">Paragrafo corrente<select aria-label="Ruolo del paragrafo" disabled={editor.state.selection.$from.depth!==1||!["paragraph","heading"].includes(heading.type.name)} value={heading.type.name === 'heading' ? String(heading.attrs.level) : '0'} onChange={e => { const level = Number(e.target.value) as 0|1|2|3; editor.chain().focus().command(({ tr }) => { setParagraphRole(tr,level); return true; }).run(); }}>{heading.type.name==="heading"&&heading.attrs.level>3&&<option disabled value={heading.attrs.level}>Titolo {heading.attrs.level} (importato)</option>}<option value="0">Corpo del testo</option><option value="1">Capitolo · Titolo 1</option><option value="2">Sezione · Titolo 2</option><option value="3">Sottosezione · Titolo 3</option></select></label>
      <label className="navigation-paragraphs"><input type="checkbox" checked={paragraphs} onChange={e => setParagraphs(e.target.checked)}/>Mostra anche i paragrafi</label>
      {!outline.length&&<p className="navigation-empty">Scrivi il titolo di un capitolo e scegli «Capitolo · Titolo 1». Usa Sezione e Sottosezione per organizzarlo.</p>}
      <ol className="navigation-tree" role="tree" aria-label="Capitoli e sezioni">{outline.filter(entry => !entry.parents.some(pos => collapsed.has(pos))).slice(0,shown * 6).map(entry => <li key={entry.pos} role="treeitem" aria-selected={active?.pos === entry.pos} aria-level={entry.parents.length + 1} aria-expanded={entry.children ? !collapsed.has(entry.pos) : undefined} className={entry.level === 7 ? 'outline-paragraph' : ''} style={{ paddingLeft: 4 + entry.parents.length * 13 }}>
        {entry.children ? <button className="outline-toggle" aria-label={`${collapsed.has(entry.pos) ? 'Espandi' : 'Comprimi'} ${entry.text}`} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(entry.pos)) next.delete(entry.pos); else next.add(entry.pos); return next; })}>{collapsed.has(entry.pos) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</button> : <span className="outline-leaf"/>}
        <button className="outline-link" aria-current={active?.pos === entry.pos ? 'location' : undefined} title={entry.text} onClick={() => jump(entry.from)}>{entry.text}</button>
      </li>)}</ol>
      {outline.length > shown * 6&&<button className="navigation-more" onClick={() => setShown(value => value + 50)}>Mostra altri elementi</button>}
    </>}
    {tab === 'pages'&&(!pages ? <p className="navigation-empty">Le pagine sono disponibili nelle viste A4. <button onClick={onPages}>Attiva vista pagine</button></p> : <><p className="navigation-count">{count} {count === 1 ? 'pagina' : 'pagine'}</p><ol className="navigation-pages">{pageItems.map((item,index) => <li key={index}><button aria-label={`Vai a pagina ${index + 1}`} aria-current={snapshot.from >= item.from && (snapshot.from < item.to || index === count - 1) ? 'page' : undefined} onClick={() => jump(item.from)}><strong>Pagina {index + 1}</strong><span>{item.text || 'Pagina senza testo'}</span></button></li>)}</ol>{count > shown&&<button className="navigation-more" onClick={() => setShown(value => value + 50)}>Mostra altre 50 pagine</button>}</>)}
    {tab === 'results'&&<>{query.trim() ? <><div className="navigation-result-count"><span>{found.matches.length}{found.truncated ? '+' : ''} risultati</span><button aria-label="Risultato precedente" disabled={!found.matches.length} onClick={() => next(true)}><ChevronUp size={16}/></button><button aria-label="Risultato successivo" disabled={!found.matches.length} onClick={() => next(false)}><ChevronDown size={16}/></button></div><ol className="navigation-results">{found.matches.map(match => <li key={match.from}><button aria-label={`Vai al risultato: ${match.text}`} aria-current={snapshot.from === match.from ? 'location' : undefined} onClick={() => jump(match.from,match.to)}>{match.before}<mark>{match.text}</mark>{match.after}</button></li>)}</ol></> : <p className="navigation-empty">Cerca una parola o una frase, anche quando attraversa grassetti e corsivi.</p>}</>}
    </div>
  </aside>;
}
