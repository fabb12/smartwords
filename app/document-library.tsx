'use client';
// "Recenti" list: documents organised in groups, with delete, move and "add to the book".
import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { BookPlus, Check, ChevronDown, ChevronRight, Ellipsis, FileText, Folder, FolderInput, FolderPlus, Pencil, Trash2, X } from 'lucide-react';
import { addGroup, assignDoc, groupDocs, readGroups, removeGroup, renameGroup, storeGroups, toggleGroup, EMPTY_GROUPS, type DocGroup, type GroupState } from '../lib/document-groups';

export type LibraryDoc = { id: string; title: string; updated: number };

// Groups for the given account, saved on this device whenever they change.
export function useDocGroups(owner: string) {
  const [state, setState] = useState<GroupState>(EMPTY_GROUPS);
  useEffect(() => {
    const restore = setTimeout(() => setState(readGroups(owner)), 0);
    const sync = (e: StorageEvent) => { if (e.key === null || e.key === 'scrivia:doc-groups:' + owner) setState(readGroups(owner)); };
    window.addEventListener('storage', sync);
    return () => { clearTimeout(restore); window.removeEventListener('storage', sync); };
  }, [owner]);
  const update = useCallback((change: (s: GroupState) => GroupState) => {
    setState(old => { const next = change(old); if (next !== old) storeGroups(owner, next); return next; });
  }, [owner]);
  return [state, update] as const;
}

const date = (n: number) => new Date(n).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const DRAG = 'application/x-scrivia-doc';

function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return <form className="group-name-form" onSubmit={e => { e.preventDefault(); onDone(value.trim() || null); }}>
    <Folder size={15} />
    <input autoFocus value={value} maxLength={60} placeholder={placeholder} aria-label={placeholder} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(null); } }} onBlur={() => onDone(value.trim() || null)} />
    <button type="submit" className="lib-icon" aria-label="Conferma" onMouseDown={e => e.preventDefault()}><Check size={14} /></button>
  </form>;
}

export function DocumentLibrary({ docs, active, search, loaded, groups, setGroups, onOpen, onDelete, onAddToBook }: {
  docs: LibraryDoc[]; active: string; search: string; loaded: boolean;
  groups: GroupState; setGroups: (change: (s: GroupState) => GroupState) => void;
  onOpen: (id: string) => void;
  onDelete: (doc: LibraryDoc) => void;
  onAddToBook: (ids: string[], part?: string) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [naming, setNaming] = useState<null | { id: string; forDoc?: string }>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Menus close on a click elsewhere or with Escape.
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.lib-menu, .lib-menu-toggle')) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [menu]);

  const query = search.trim().toLowerCase();
  const shown = docs.filter(d => d.title.toLowerCase().includes(query));
  const sections = groupDocs(shown, groups).filter(s => s.group ? !query || s.docs.length : s.docs.length || !groups.groups.length);

  function createGroup(name: string | null, forDoc?: string) {
    setNaming(null);
    if (!name) return;
    const id = crypto.randomUUID();
    setGroups(s => { const next = addGroup(s, name, id); return forDoc ? assignDoc(next, forDoc, id) : next; });
  }
  function deleteGroup(g: DocGroup, count: number) {
    setMenu(null);
    if (count && !window.confirm(`Eliminare il gruppo «${g.name}»? ${count === 1 ? 'Il documento resta' : 'I ' + count + ' documenti restano'} nell’elenco, senza gruppo.`)) return;
    setGroups(s => removeGroup(s, g.id));
  }
  function drop(e: DragEvent, group: string) {
    e.preventDefault(); setDropTarget(null);
    const id = e.dataTransfer.getData(DRAG);
    if (id) setGroups(s => assignDoc(s, id, group));
  }
  const dropProps = (group: string) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(group || 'none'); } },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropTarget(t => t === (group || 'none') ? null : t); },
    onDrop: (e: DragEvent) => drop(e, group),
  });

  const docRow = (d: LibraryDoc) => {
    const current = groups.assign[d.id] || '';
    return <div key={d.id} className={'doc-row' + (menu === 'doc:' + d.id ? ' menu-open' : '')} draggable onDragStart={e => { e.dataTransfer.setData(DRAG, d.id); e.dataTransfer.effectAllowed = 'move'; }}>
      <button className={'doc-item ' + (active === d.id ? 'selected' : '')} data-tip={'Apri «' + d.title + '» · modificato il ' + date(d.updated) + (groups.groups.length ? ' · trascinalo su un gruppo per spostarlo' : '')} onClick={() => onOpen(d.id)}>
        <FileText size={18} /><span><strong>{d.title}</strong><small>{date(d.updated)}</small></span>{active === d.id && <span className="selected-dot" />}
      </button>
      <div className="doc-actions">
        <button className="lib-icon lib-menu-toggle" aria-label={'Altre azioni per «' + d.title + '»'} aria-expanded={menu === 'doc:' + d.id} data-tip="Sposta in un gruppo o aggiungi al libro" onClick={() => setMenu(m => m === 'doc:' + d.id ? null : 'doc:' + d.id)}><Ellipsis size={15} /></button>
        <button className="lib-icon danger" aria-label={'Cancella «' + d.title + '»'} data-tip="Cancella il documento" onClick={() => { setMenu(null); onDelete(d); }}><Trash2 size={15} /></button>
      </div>
      {menu === 'doc:' + d.id && <div className="lib-menu" role="menu">
        <button role="menuitem" onClick={() => { setMenu(null); onAddToBook([d.id]); }}><BookPlus size={15} />Aggiungi al libro LaTeX</button>
        <div className="lib-menu-label">Sposta in</div>
        {groups.groups.map(g => <button key={g.id} role="menuitemradio" aria-checked={current === g.id} onClick={() => { setMenu(null); setGroups(s => assignDoc(s, d.id, g.id)); }}><Folder size={15} />{g.name}{current === g.id && <Check size={14} className="lib-check" />}</button>)}
        {current && <button role="menuitem" onClick={() => { setMenu(null); setGroups(s => assignDoc(s, d.id, '')); }}><FolderInput size={15} />Togli dal gruppo</button>}
        <button role="menuitem" onClick={() => { setMenu(null); setNaming({ id: 'new', forDoc: d.id }); }}><FolderPlus size={15} />Nuovo gruppo…</button>
        <div className="lib-menu-sep" />
        <button role="menuitem" className="danger" onClick={() => { setMenu(null); onDelete(d); }}><Trash2 size={15} />Cancella</button>
      </div>}
    </div>;
  };

  return <div className="doc-library">
    <div className="library-label recent-label lib-head"><span>RECENTI</span>
      <button className="lib-icon" aria-label="Nuovo gruppo" data-tip="Crea un gruppo per organizzare i documenti (es. una parte del libro)" onClick={() => setNaming({ id: 'new' })}><FolderPlus size={15} /></button>
    </div>
    {naming?.id === 'new' && <NameInput initial="" placeholder="Nome del gruppo" onDone={name => createGroup(name, naming.forDoc)} />}
    <div className="doc-list">
      {sections.map(({ group, docs: list }) => {
        if (!group) return <div key="loose" className={'doc-group loose' + (dropTarget === 'none' ? ' drop' : '')} {...dropProps('')}>
          {groups.groups.length > 0 && <div className="group-head loose-head"><span className="group-title"><FileText size={14} />Senza gruppo</span><small>{list.length}</small></div>}
          {list.map(docRow)}
        </div>;
        const open = !group.collapsed || !!query;
        return <div key={group.id} className={'doc-group' + (dropTarget === group.id ? ' drop' : '')} {...dropProps(group.id)}>
          {naming?.id === group.id
            ? <NameInput initial={group.name} placeholder="Nome del gruppo" onDone={name => { setNaming(null); if (name) setGroups(s => renameGroup(s, group.id, name)); }} />
            : <div className={'group-head' + (menu === 'group:' + group.id ? ' menu-open' : '')}>
              <button className="group-title" aria-expanded={open} data-tip={open ? 'Comprimi il gruppo' : 'Espandi il gruppo'} onClick={() => setGroups(s => toggleGroup(s, group.id))}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={14} /><span>{group.name}</span></button>
              <small>{list.length}</small>
              <div className="doc-actions">
                <button className="lib-icon" aria-label={'Aggiungi il gruppo «' + group.name + '» al libro'} data-tip="Aggiungi tutti i documenti del gruppo al libro LaTeX, come una parte" disabled={!list.length} onClick={() => onAddToBook(list.map(d => d.id), group.name)}><BookPlus size={15} /></button>
                <button className="lib-icon lib-menu-toggle" aria-label={'Azioni per il gruppo «' + group.name + '»'} aria-expanded={menu === 'group:' + group.id} onClick={() => setMenu(m => m === 'group:' + group.id ? null : 'group:' + group.id)}><Ellipsis size={15} /></button>
              </div>
              {menu === 'group:' + group.id && <div className="lib-menu" role="menu">
                <button role="menuitem" disabled={!list.length} onClick={() => { setMenu(null); onAddToBook(list.map(d => d.id), group.name); }}><BookPlus size={15} />Aggiungi il gruppo al libro</button>
                <button role="menuitem" onClick={() => { setMenu(null); setNaming({ id: group.id }); }}><Pencil size={15} />Rinomina</button>
                <div className="lib-menu-sep" />
                <button role="menuitem" className="danger" onClick={() => deleteGroup(group, list.length)}><X size={15} />Elimina il gruppo</button>
              </div>}
            </div>}
          {open && list.map(docRow)}
          {open && !list.length && <p className="group-empty">Trascina qui un documento, o usa ⋯ › Sposta in.</p>}
        </div>;
      })}
      {!docs.length && loaded && <p className="muted">Crea il tuo primo documento.</p>}
      {docs.length > 0 && !shown.length && <p className="muted">Nessun documento trovato.</p>}
    </div>
  </div>;
}
