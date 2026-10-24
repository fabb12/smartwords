'use client';
// LaTeX studio: edit the sources of a LaTeX project (book, essay, thesis) with a
// live preview, commit them to GitHub, upload images and compile the PDF on
// GitHub Actions. Without GitHub it works on a local project kept in this browser.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bold, BookOpen, CircleCheck, Code, Columns2, Download, ExternalLink, Eye, FileArchive, FileCode, FilePlus2, FileText, Folder, GitBranch, Heading1, Heading2, Heading3, ImagePlus, Italic, LayoutTemplate, List, ListOrdered, ListTree, Loader2, Percent, Play, Quote, RefreshCw, Save, Search, Superscript, Tag, TriangleAlert, Underline, WandSparkles, X } from 'lucide-react';
import { checkLatex, countWords, docToLatex, documentOutline, figureSnippet, firstHeading, insertBlock, latexPreviewHtml, latexToEditorHtml, projectStructure, sanitizeImageName, searchLatex, setHeading, texPath, toggleComment, wrapCommand, wrapEnvironment, type DocNode, type Edit, type LatexIssue } from '../lib/latex';
import { actionsUrl, commitFiles, connectLatex, currentSha, disconnectLatex, dispatchPdf, downloadPdf, fileUrl, findRun, GitHubError, LatexConflict, latestPdf, latexConnected, latexSettings, listFiles, readBlob, readText, waitForRun, WORKFLOW_PATH, writeBytes, writeText, type LatexFile, type LatexSettings, type PdfAsset, type PdfMode, type WorkflowRun } from '../lib/latex-github';
import { templateFiles, templateZip } from '../lib/latex-template';

type Source = 'github' | 'local';
type OpenFile = { path: string; text: string; saved: string; sha?: string };
type View = 'split' | 'source' | 'preview';
type Side = 'struttura' | 'file' | 'indice' | 'cerca';
type Dialog = null | 'connect' | 'new' | 'image' | 'pdf' | 'template' | 'issues' | 'import';

const LOCAL = 'scrivia:latex-local', DRAFT = 'scrivia:latex-draft:', VIEW = 'scrivia:latex-view';
const TEXT_FILE = /\.(tex|bib|sty|cls|ist|bst|txt|md|yml|yaml)$|(^|\/)latexmkrc$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|svg|webp|pdf)$/i;

function readJson<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function writeJson(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches;
const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'capitolo';
const mime = (p: string) => /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.gif$/i.test(p) ? 'image/gif' : /\.svg$/i.test(p) ? 'image/svg+xml' : /\.webp$/i.test(p) ? 'image/webp' : /\.pdf$/i.test(p) ? 'application/pdf' : 'image/png';

// Adds \input{path} to main.tex before the back matter (or \end{document}).
export function addInput(main: string, path: string, title: string) {
  const line = `\\input{${path.replace(/\.tex$/, '')}}   % ${title}`;
  const at = [/^\\backmatter\b/m, /^\\appendix\b/m, /^\\end\{document\}/m].map(re => main.search(re)).find(i => i >= 0);
  if (at === undefined) return main.replace(/\s*$/, '\n' + line + '\n');
  return main.slice(0, at) + line + '\n\n' + main.slice(at);
}

// Minimal change between two texts, applied through the browser so Ctrl+Z still works.
function applyToTextarea(ta: HTMLTextAreaElement, edit: Edit, set: (t: string) => void) {
  const old = ta.value, next = edit.text;
  let a = 0; while (a < old.length && a < next.length && old[a] === next[a]) a++;
  let b = 0; while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
  ta.focus();
  ta.setSelectionRange(a, old.length - b);
  let ok = false;
  try { ok = document.execCommand('insertText', false, next.slice(a, next.length - b)); } catch { ok = false; }
  if (!ok || ta.value !== next) { ta.value = next; set(next); }
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(edit.start, edit.end); });
}

function Modal({ title, icon, children, onClose, wide }: { title: string; icon?: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const box = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); } };
    window.addEventListener('keydown', onKey, true);
    box.current?.querySelector<HTMLElement>('input:not([type=checkbox]),select,button.primary')?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return <div className="modal-backdrop latex-modal-backdrop" onClick={onClose}>
    <section ref={box} className={'modal latex-modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <button className="modal-close tool" aria-label="Chiudi" onClick={onClose}><X size={20} /></button>
      {icon && <span className="modal-icon">{icon}</span>}<h2>{title}</h2>
      {children}
    </section>
  </div>;
}

export function LatexStudio({ onClose, onOpenInEditor, currentDocument }: {
  onClose: () => void;
  onOpenInEditor: (title: string, html: string) => Promise<void> | void;
  currentDocument: () => { title: string; content: DocNode } | null;
}) {
  const [source, setSource] = useState<Source>(() => latexConnected() ? 'github' : 'local');
  const [settings, setSettings] = useState<LatexSettings>(latexSettings);
  const [files, setFiles] = useState<LatexFile[] | null>(null);
  const [local, setLocal] = useState<Record<string, string>>(() => readJson(LOCAL, {}));
  const [mainText, setMainText] = useState('');
  const [file, setFile] = useState<OpenFile | null>(null);
  const [view, setView] = useState<View>(() => readJson<View>(VIEW, 'split'));
  const [side, setSide] = useState<Side>('struttura');
  const [sideOpen, setSideOpen] = useState(() => !narrow());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState('');
  const [caret, setCaret] = useState({ line: 1, col: 1 });
  const [query, setQuery] = useState('');
  const [projectHits, setProjectHits] = useState<{ path: string; line: number; index: number; snippet: string }[] | null>(null);
  const [issues, setIssues] = useState<LatexIssue[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, { text: string; sha?: string }>());
  const images = useRef(new Map<string, string>());

  const prefix = source === 'github' ? `${settings.repository}@${settings.branch}:` : 'local:';
  const dirty = !!file && file.text !== file.saved;

  const flash = useCallback((msg: string) => { setNotice(msg); setTimeout(() => setNotice(n => n === msg ? '' : n), 3500); }, []);
  async function run(label: string, work: () => Promise<void>) {
    setBusy(label); setError('');
    try { await work(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }

  // ---------------------------------------------------------------- loading
  async function readFile(path: string, from: Source = source): Promise<{ text: string; sha?: string }> {
    if (from === 'local') return { text: local[path] ?? '' };
    const hit = cache.current.get(path);
    if (hit) return hit;
    const r = await readText(path);
    cache.current.set(path, r);
    return r;
  }
  async function refresh(from: Source = source) {
    cache.current.clear();
    if (from === 'local') { setMainText(local[latexSettings().main] || ''); return; }
    const main = latexSettings().main;
    const list = await listFiles();
    setFiles(list);
    setMainText(list.some(f => f.path === main) ? (await readFile(main, 'github')).text : '');
  }
  // Switching between the GitHub repository and the local project reloads the file list.
  function switchTo(next: Source) {
    if (dirty && !confirm('Le modifiche non salvate a ' + file!.path + ' restano come bozza su questo dispositivo. Cambiare progetto?')) return;
    setFile(null); setProjectHits(null);
    if (next === 'github' && !latexConnected()) { setDialog('connect'); return; }
    setSource(next);
    if (next === 'github') setFiles(null);
    void run('Carico il progetto…', () => refresh(next));
  }
  useEffect(() => { const t = setTimeout(() => switchTo(source)); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openFile(path: string, line?: number) {
    if (file && dirty) flash('Le modifiche a ' + file.path + ' restano come bozza su questo dispositivo.');
    await run('Apro ' + path + '…', async () => {
      const r = await readFile(path);
      const draft = readJson<string | null>(DRAFT + prefix + path, null);
      const text = draft !== null && draft !== r.text ? draft : r.text;
      setFile({ path, text, saved: r.text, sha: r.sha });
      if (draft !== null && draft !== r.text) flash('Ripresa la bozza non salvata di ' + path + '.');
      setProjectHits(null);
      if (narrow()) setSideOpen(false);
      requestAnimationFrame(() => { if (line) jumpToLine(line, text); else ta.current?.setSelectionRange(0, 0); });
    });
  }

  // Unsaved text is kept per file, so nothing is lost when switching or closing.
  useEffect(() => {
    if (!file) return;
    const key = DRAFT + prefix + file.path;
    if (file.text === file.saved) localStorage.removeItem(key); else writeJson(key, file.text);
  }, [file, prefix]);

  // ---------------------------------------------------------------- preview
  useEffect(() => {
    if (!file) return;
    const t = setTimeout(() => setPreview(/\.tex$/i.test(file.path) ? latexPreviewHtml(file.text) : ''), 250);
    return () => clearTimeout(t);
  }, [file]);
  useEffect(() => {
    const root = previewRef.current; if (!root || source !== 'github' || !files) return;
    root.querySelectorAll<HTMLImageElement>('img[data-imgpath]').forEach(async img => {
      const want = img.dataset.imgpath!.replace(/^\.?\//, '');
      const candidates = [want, 'images/' + want, ...['.png', '.jpg', '.jpeg', '.pdf'].flatMap(e => [want + e, 'images/' + want + e])];
      const f = candidates.map(c => files.find(x => x.path.toLowerCase() === c.toLowerCase())).find(Boolean);
      if (!f || /\.pdf$/i.test(f.path)) return;
      let url = images.current.get(f.sha);
      if (!url) {
        try { url = URL.createObjectURL(new Blob([await readBlob(f.sha) as BlobPart], { type: mime(f.path) })); images.current.set(f.sha, url); }
        catch { return; }
      }
      img.src = url; img.parentElement?.classList.add('loaded');
    });
  }, [preview, files, source]);
  useEffect(() => () => { images.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  // ---------------------------------------------------------------- editing
  const setText = useCallback((text: string) => setFile(f => f ? { ...f, text } : f), []);
  function edit(fn: (text: string, start: number, end: number) => Edit) {
    const el = ta.current; if (!el || !file) return;
    applyToTextarea(el, fn(el.value, el.selectionStart, el.selectionEnd), setText);
  }
  function jumpToLine(line: number, text = file?.text || '') {
    const el = ta.current; if (!el) return;
    const lines = text.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    jumpTo(start, start + (lines[line - 1]?.length || 0));
  }
  function jumpTo(start: number, end = start) {
    const el = ta.current; if (!el) return;
    if (view === 'preview') setView('split');
    el.focus(); el.setSelectionRange(start, end);
    // Scroll so the selection is near the top third.
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, el.value.slice(0, start).split('\n').length * lineHeight - el.clientHeight / 3);
  }
  function updateCaret() {
    const el = ta.current; if (!el) return;
    const before = el.value.slice(0, el.selectionStart).split('\n');
    setCaret({ line: before.length, col: before[before.length - 1].length + 1 });
  }

  // ---------------------------------------------------------------- saving
  async function save(force = false) {
    if (!file || !dirty) return;
    const f = file;
    let newSha = f.sha;
    await run('Salvo…', async () => {
      if (source === 'local') {
        const next = { ...local, [f.path]: f.text };
        if (!writeJson(LOCAL, next)) throw new Error('Spazio del browser esaurito: scarica il progetto in .zip.');
        setLocal(next);
      } else {
        let sha = f.sha;
        if (force) sha = await currentSha(f.path);
        try {
          sha = await writeText(f.path, f.text, sha, `Modifica ${f.path} con Scrivia`);
        } catch (e) {
          if (e instanceof LatexConflict && !force) {
            if (confirm(e.message + '\n\nOK = salva comunque la tua versione (sovrascrive quella su GitHub)\nAnnulla = non salvare ora')) return save(true);
            return;
          }
          throw e;
        }
        cache.current.set(f.path, { text: f.text, sha });
        newSha = sha;
      }
      setFile(cur => cur && cur.path === f.path ? { ...cur, saved: f.text, sha: newSha } : cur);
      if (f.path === settings.main) setMainText(f.text);
      flash(source === 'local' ? 'Salvato in questo browser' : '✓ Salvato su GitHub: ' + f.path);
      if (source === 'github') void listFiles().then(setFiles).catch(() => undefined);
    });
  }

  async function createFile(path: string, content: string, addToMain: string | null) {
    path = texPath(path);
    if (!/^[\w.\-/ ]+$/.test(path) || path.includes('..') || path.startsWith('/')) throw new Error('Percorso non valido: usa lettere, numeri, - e / (es. content/capitolo2.tex).');
    if (shown?.some(f => f.path === path)) throw new Error('Esiste già un file ' + path + '.');
    let main = mainText;
    if (addToMain !== null && main) main = addInput(main, path, addToMain);
    if (source === 'local') {
      const next = { ...local, [path]: content, ...(main !== mainText ? { [settings.main]: main } : {}) };
      if (!writeJson(LOCAL, next)) throw new Error('Spazio del browser esaurito.');
      setLocal(next);
    } else {
      const changes = [{ path, content }, ...(main !== mainText ? [{ path: settings.main, content: main }] : [])];
      await commitFiles(changes, `Aggiunge ${path} con Scrivia`);
      cache.current.clear();
      setFiles(await listFiles());
    }
    if (main !== mainText) setMainText(main);
    setFile({ path, text: content, saved: content });
    flash('Creato ' + path + (main !== mainText ? ' e aggiunto a ' + settings.main : ''));
  }

  // ---------------------------------------------------------------- keyboard
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); edit((t, s, en) => wrapCommand(t, s, en, 'textbf')); }
    else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); edit((t, s, en) => wrapCommand(t, s, en, 'textit')); }
    else if (mod && e.key === '/') { e.preventDefault(); edit(toggleComment); }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !dialog) { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  function close() {
    if (dirty && !confirm('Ci sono modifiche non salvate a ' + file!.path + '. Restano come bozza su questo dispositivo: chiudere lo studio?')) return;
    onClose();
  }
  useEffect(() => { writeJson(VIEW, view); }, [view]);

  // ---------------------------------------------------------------- derived
  const shown: LatexFile[] | null = source === 'local' ? Object.keys(local).sort().map(path => ({ path, sha: '', size: local[path].length })) : files;
  const structure = useMemo(() => projectStructure(mainText), [mainText]);
  const outline = useMemo(() => file && /\.tex$/i.test(file.path) ? documentOutline(file.text) : [], [file]);
  const words = useMemo(() => file && /\.tex$/i.test(file.path) ? countWords(file.text) : 0, [file]);
  const fileHits = useMemo(() => file && query.trim() ? searchLatex(file.text, query) : [], [file, query]);
  const textFiles = shown?.filter(f => TEXT_FILE.test(f.path)) || [];
  const imageFiles = shown?.filter(f => IMAGE_FILE.test(f.path) && !f.path.startsWith('.')) || [];
  const workflowInstalled = !!shown?.some(f => f.path === WORKFLOW_PATH);
  const title = (path: string) => { const c = cache.current.get(path)?.text ?? local[path]; return (c && firstHeading(c)) || ''; };

  async function searchProject() {
    await run('Cerco nel progetto…', async () => {
      const paths = textFiles.filter(f => /\.tex$/i.test(f.path)).map(f => f.path);
      const hits: { path: string; line: number; index: number; snippet: string }[] = [];
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
        while (next < paths.length) {
          const p = paths[next++];
          const text = file?.path === p ? file.text : (await readFile(p)).text;
          for (const h of searchLatex(text, query, 20)) hits.push({ path: p, ...h });
        }
      }));
      setProjectHits(hits.sort((a, b) => a.path.localeCompare(b.path) || a.index - b.index));
    });
  }

  async function projectZip() {
    await run('Preparo il progetto…', async () => {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      if (source === 'local') for (const [p, t] of Object.entries(local)) zip.file(p, t);
      else {
        for (const f of files || []) {
          if (TEXT_FILE.test(f.path)) zip.file(f.path, file?.path === f.path ? file.text : (await readFile(f.path)).text);
          else if (IMAGE_FILE.test(f.path) && f.size < 15_000_000) zip.file(f.path, await readBlob(f.sha));
        }
      }
      download(await zip.generateAsync({ type: 'blob' }), (source === 'github' ? settings.repository.split('/')[1] : 'progetto-latex') + '.zip');
    });
  }

  // ---------------------------------------------------------------- render
  const fileButton = (path: string, label: string, sub?: string) =>
    <button key={path} className={'latex-file' + (file?.path === path ? ' active' : '')} onClick={() => void openFile(path)} title={path}>
      <FileText size={14} /><span><strong>{label}</strong>{sub && <small>{sub}</small>}</span>
    </button>;

  const sidebar = <aside className="latex-side" aria-label="Progetto">
    <div className="latex-side-tabs" role="tablist">
      {([['struttura', 'Struttura', ListTree], ['file', 'File', Folder], ['indice', 'Indice', BookOpen], ['cerca', 'Cerca', Search]] as const).map(([id, label, Icon]) =>
        <button key={id} role="tab" aria-selected={side === id} className={side === id ? 'active' : ''} onClick={() => setSide(id)} data-tip={label}><Icon size={15} /><span>{label}</span></button>)}
    </div>
    <div className="latex-side-body">
      {side === 'struttura' && <>
        {!mainText && shown && <div className="latex-empty"><p>Nessun <code>{settings.main}</code> in questo progetto.</p><button className="primary" onClick={() => setDialog('template')}><LayoutTemplate size={15} />Crea dal modello</button></div>}
        {mainText && <>{fileButton(settings.main, settings.main, 'Struttura e metadati')}
          {structure.map((it, i) => <div key={it.path + i}>
            {(i === 0 || structure[i - 1].part !== it.part) && <div className="latex-part-label">{it.part}</div>}
            {fileButton(it.path, title(it.path) || it.title, it.path)}
          </div>)}
        </>}
      </>}
      {side === 'file' && <>
        {textFiles.map(f => fileButton(f.path, f.path.split('/').pop()!, f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : undefined))}
        {imageFiles.length > 0 && <><div className="latex-part-label">Immagini</div>{imageFiles.map(f =>
          <button key={f.path} className="latex-file" title="Inserisci nel capitolo aperto" disabled={!file} onClick={() => edit((t, s) => insertBlock(t, s, figureSnippet(f.path.replace(/^images\//, ''), 0.8, '', f.path.startsWith('images/') ? 'images' : '')))}><ImagePlus size={14} /><span><strong>{f.path.split('/').pop()}</strong><small>Inserisci</small></span></button>)}</>}
        {shown?.length === 0 && <p className="latex-empty">Progetto vuoto.</p>}
      </>}
      {side === 'indice' && (outline.length ? outline.map(o =>
        <button key={o.index} className={'latex-outline l' + o.level} onClick={() => jumpTo(o.index)}>{o.title}</button>)
        : <p className="latex-empty">{file ? 'Nessun \\chapter o \\section in questo file.' : 'Apri un file per vederne l’indice.'}</p>)}
      {side === 'cerca' && <>
        <label className="latex-search"><Search size={14} /><input placeholder="Cerca parola o frase" value={query} onChange={e => { setQuery(e.target.value); setProjectHits(null); }} onKeyDown={e => { if (e.key === 'Enter' && query.trim()) void searchProject(); }} /></label>
        {file && query.trim() && <><div className="latex-part-label">In {file.path.split('/').pop()} ({fileHits.length})</div>
          {fileHits.map(h => <button key={h.index} className="latex-hit" onClick={() => jumpTo(h.index, h.index + query.trim().length)}><small>riga {h.line}</small>{h.snippet}</button>)}</>}
        {query.trim() && <button className="quiet latex-wide" disabled={!!busy || !textFiles.length} onClick={() => void searchProject()}><Search size={14} />Cerca in tutto il progetto</button>}
        {projectHits && <><div className="latex-part-label">Nel progetto ({projectHits.length})</div>
          {projectHits.map(h => <button key={h.path + h.index} className="latex-hit" onClick={() => void openFile(h.path, h.line)}><small>{h.path} · riga {h.line}</small>{h.snippet}</button>)}</>}
      </>}
    </div>
    <div className="latex-side-foot">
      <button className="quiet" onClick={() => setDialog('new')} disabled={!shown}><FilePlus2 size={15} />Nuovo file</button>
      <button className="quiet" onClick={() => setDialog('import')} disabled={!shown}><WandSparkles size={15} />Dal documento Scrivia</button>
      <button className="quiet" onClick={() => setDialog('template')}><LayoutTemplate size={15} />Modello di progetto</button>
    </div>
  </aside>;

  const tool = (label: string, Icon: typeof Bold, action: () => void, extra = '') =>
    <button className={'tool ' + extra} aria-label={label} data-tip={label} disabled={!file} onMouseDown={e => e.preventDefault()} onClick={action}><Icon size={16} /></button>;

  const toolbar = <div className="latex-toolbar" role="toolbar" aria-label="Formattazione LaTeX">
    {tool('Grassetto (Ctrl+B) — \\textbf', Bold, () => edit((t, s, e) => wrapCommand(t, s, e, 'textbf')))}
    {tool('Corsivo (Ctrl+I) — \\textit', Italic, () => edit((t, s, e) => wrapCommand(t, s, e, 'textit')))}
    {tool('Enfasi — \\emph', Underline, () => edit((t, s, e) => wrapCommand(t, s, e, 'emph')))}
    {tool('Monospazio — \\texttt', Code, () => edit((t, s, e) => wrapCommand(t, s, e, 'texttt')))}
    <i />
    {tool('Capitolo — \\chapter', Heading1, () => edit((t, s, e) => setHeading(t, s, e, 'chapter')))}
    {tool('Sezione — \\section', Heading2, () => edit((t, s, e) => setHeading(t, s, e, 'section')))}
    {tool('Sottosezione — \\subsection', Heading3, () => edit((t, s, e) => setHeading(t, s, e, 'subsection')))}
    <i />
    {tool('Nota a piè di pagina — \\footnote', Superscript, () => edit((t, s, e) => wrapCommand(t, s, e, 'footnote')))}
    {tool('Citazione — quote', Quote, () => edit((t, s, e) => wrapEnvironment(t, s, e, 'quote')))}
    {tool('Elenco puntato — itemize', List, () => edit((t, s, e) => wrapEnvironment(t, s, e, 'itemize')))}
    {tool('Elenco numerato — enumerate', ListOrdered, () => edit((t, s, e) => wrapEnvironment(t, s, e, 'enumerate')))}
    {tool('Voce dell’indice analitico — \\index', Tag, () => edit((t, s, e) => { const sel = t.slice(s, e); return sel ? { text: t.slice(0, e) + `\\index{${sel}}` + t.slice(e), start: e, end: e + sel.length + 8 } : wrapCommand(t, s, e, 'index'); }))}
    {tool('Immagine', ImagePlus, () => setDialog('image'))}
    {tool('Commenta / togli commento (Ctrl+/)', Percent, () => edit(toggleComment))}
    <i />
    {tool('Controlla la sintassi', CircleCheck, () => { if (file) { setIssues(checkLatex(file.text)); setDialog('issues'); } })}
    <span className="latex-toolbar-spacer" />
    <div className="latex-view" role="group" aria-label="Vista">
      {([['source', 'Sorgente', FileCode], ['split', 'Affiancata', Columns2], ['preview', 'Anteprima', Eye]] as const).map(([id, label, Icon]) =>
        <button key={id} className={view === id ? 'active' : ''} aria-pressed={view === id} data-tip={label} onClick={() => setView(id)}><Icon size={15} /><span>{label}</span></button>)}
    </div>
  </div>;

  return <div className="latex-studio" role="dialog" aria-modal="true" aria-label="Studio LaTeX">
    <header className="latex-top">
      <button className="tool" aria-label="Mostra o nascondi il progetto" data-tip="Mostra o nascondi il progetto" onClick={() => setSideOpen(!sideOpen)}><ListTree size={18} /></button>
      <div className="latex-title"><strong>Studio LaTeX</strong><small>{source === 'github' ? <><GitBranch size={11} />{settings.repository || '—'} · {settings.branch}</> : 'Progetto locale in questo browser'}</small></div>
      <div className="latex-source" role="group" aria-label="Dove si trova il progetto">
        <button className={source === 'github' ? 'active' : ''} onClick={() => { if (source !== 'github') switchTo('github'); }}>GitHub</button>
        <button className={source === 'local' ? 'active' : ''} onClick={() => { if (source !== 'local') switchTo('local'); }}>Locale</button>
      </div>
      <span className="latex-top-spacer" />
      {source === 'github' && <button className="tool" aria-label="Collegamento GitHub" data-tip="Repository, ramo e token" onClick={() => setDialog('connect')}><GitBranch size={17} /></button>}
      <button className="tool" aria-label="Aggiorna" data-tip="Ricarica l’elenco dei file" disabled={!!busy} onClick={() => void run('Aggiorno…', () => refresh())}><RefreshCw size={17} /></button>
      <button className="tool" aria-label="Scarica il progetto" data-tip="Scarica tutto il progetto in .zip (per latexmk o Overleaf)" disabled={!shown?.length || !!busy} onClick={() => void projectZip()}><FileArchive size={17} /></button>
      <button className="tool" aria-label="Apri in Scrivia" data-tip="Apri questo file come documento Scrivia, con tutti gli strumenti di scrittura e l’AI" disabled={!file || !/\.tex$/i.test(file.path)} onClick={() => file && void onOpenInEditor(firstHeading(file.text) || file.path.split('/').pop()!.replace(/\.tex$/, ''), latexToEditorHtml(file.text))}><WandSparkles size={17} /></button>
      <button className="latex-save" disabled={!dirty || !!busy} onClick={() => void save()} data-tip={source === 'github' ? 'Salva su GitHub: ogni salvataggio è un commit (Ctrl+S)' : 'Salva in questo browser (Ctrl+S)'}><Save size={15} /><span>Salva</span></button>
      <button className="latex-compile" disabled={source !== 'github'} onClick={() => setDialog('pdf')} data-tip={source === 'github' ? 'Compila il PDF su GitHub Actions' : 'La compilazione richiede un repository GitHub'}><Play size={15} /><span>Compila PDF</span></button>
      <button className="tool" aria-label="Chiudi lo studio" data-tip="Torna all’editor (Esc)" onClick={close}><X size={19} /></button>
    </header>
    {error && <div className="error-banner" role="alert"><TriangleAlert size={15} /><span>{error}</span><button onClick={() => setError('')}>Chiudi</button></div>}
    <div className={'latex-body view-' + view + (sideOpen ? '' : ' no-side')}>
      {sideOpen && sidebar}
      <section className="latex-editor-pane">
        {toolbar}
        {file ? <div className="latex-panes">
          <textarea ref={ta} className="latex-source-text" spellCheck={false} aria-label={'Sorgente di ' + file.path} value={file.text}
            onChange={e => { setText(e.target.value); updateCaret(); }} onKeyDown={onKeyDown} onKeyUp={updateCaret} onClick={updateCaret} onSelect={updateCaret} />
          <div ref={previewRef} className="latex-preview" aria-label="Anteprima"
            onClick={e => { const n = (e.target as HTMLElement).closest<HTMLElement>('.latex-fnref'); if (n) previewRef.current?.querySelector('#latex-note-' + n.dataset.note)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
            {/\.tex$/i.test(file.path) ? <article className="latex-paper" dangerouslySetInnerHTML={{ __html: preview }} /> : <p className="latex-empty">Anteprima disponibile per i file .tex.</p>}
          </div>
        </div> : <div className="latex-welcome">
          <FileCode size={34} />
          <h3>{shown ? 'Scegli un file del progetto' : source === 'github' ? 'Collega un repository GitHub' : 'Progetto locale'}</h3>
          <p>Modifica i sorgenti LaTeX con anteprima immediata, salva ogni modifica come commit e compila il PDF su GitHub Actions. L’impaginazione resta in LaTeX; per scrivere con l’AI apri un capitolo in Scrivia con <WandSparkles size={13} />.</p>
          <div className="latex-welcome-actions">
            {source === 'github' && !latexConnected() && <button className="primary" onClick={() => setDialog('connect')}><GitBranch size={15} />Collega GitHub</button>}
            {mainText && <button className="primary" onClick={() => void openFile(settings.main)}><FileText size={15} />Apri {settings.main}</button>}
            {!mainText && <button className="primary" onClick={() => setDialog('template')}><LayoutTemplate size={15} />Crea un progetto dal modello</button>}
          </div>
        </div>}
        <footer className="latex-status">
          <span>{file ? <>{file.path}{dirty && <b className="latex-dirty"> · non salvato</b>}</> : 'Nessun file aperto'}</span>
          {busy ? <span><Loader2 size={12} className="spin" />{busy}</span> : notice ? <span role="status">{notice}</span> : null}
          {file && <span>riga {caret.line}, col {caret.col} · {words.toLocaleString('it-IT')} parole{source === 'github' && <> · <a href={fileUrl(file.path)} target="_blank" rel="noreferrer">GitHub <ExternalLink size={10} /></a></>}</span>}
        </footer>
      </section>
    </div>

    {dialog === 'connect' && <ConnectDialog settings={settings} onClose={() => { setDialog(null); if (!latexConnected() && source === 'github') setSource('local'); }}
      onConnected={s => { setSettings(s); setSource('github'); setFile(null); setFiles(null); setDialog(null); flash('Collegato a ' + s.repository); void run('Carico il progetto…', () => refresh('github')); }}
      onDisconnect={() => { disconnectLatex(); setDialog(null); setFile(null); setSource('local'); void run('Carico il progetto…', () => refresh('local')); }} />}
    {dialog === 'new' && <NewFileDialog hasMain={!!mainText} main={settings.main} onClose={() => setDialog(null)}
      onCreate={async (path, t, add) => { await createFile(path, `\\chapter{${t.replace(/([{}$&#_%])/g, '\\$1')}}\n\n`, add ? t : null); setDialog(null); }} />}
    {dialog === 'import' && <ImportDialog doc={currentDocument()} hasMain={!!mainText} onClose={() => setDialog(null)}
      onCreate={async (path, latex, t, add) => { await createFile(path, latex, add ? t : null); setDialog(null); }} />}
    {dialog === 'image' && file && <ImageDialog source={source} images={imageFiles} onClose={() => setDialog(null)}
      onInsert={async (choice) => {
        let name = choice.existing;
        if (choice.file) {
          const prepared = await prepareImage(choice.file);
          name = 'images/' + choice.name.replace(/\.[a-z0-9]+$/i, '') + '.' + prepared.ext;
          const existing = files?.find(f => f.path === name);
          if (existing && !confirm(`Esiste già ${name}: sovrascriverla?`)) return;
          await writeBytes(name, prepared.bytes, existing?.sha, (existing ? 'Aggiorna ' : 'Aggiunge ') + name + ' con Scrivia');
          setFiles(await listFiles());
        }
        if (!name) return;
        const inImages = name.startsWith('images/');
        edit((t, s) => insertBlock(t, s, figureSnippet(inImages ? name!.slice(7) : name!, choice.width, choice.caption, inImages ? 'images' : '')));
        setDialog(null);
        flash(choice.file ? '✓ Immagine caricata e inserita: ricorda di salvare il file' : 'Codice dell’immagine inserito');
      }} />}
    {dialog === 'pdf' && <PdfDialog workflowInstalled={workflowInstalled} dirty={dirty} onClose={() => setDialog(null)}
      onInstall={async () => { await commitFiles([{ path: WORKFLOW_PATH, content: templateFiles().find(f => f.path === WORKFLOW_PATH)!.content }], 'Aggiunge la compilazione PDF con Scrivia'); setFiles(await listFiles()); }} />}
    {dialog === 'template' && <TemplateDialog source={source} existing={shown?.map(f => f.path) || []} onClose={() => setDialog(null)}
      onCreate={async (o, overwrite) => {
        const all = templateFiles(o);
        const chosen = overwrite ? all : all.filter(f => !shown?.some(x => x.path === f.path));
        if (!chosen.length) throw new Error('Tutti i file del modello esistono già nel progetto.');
        if (source === 'local') { const next = { ...local, ...Object.fromEntries(chosen.map(f => [f.path, f.content])) }; writeJson(LOCAL, next); setLocal(next); setMainText(next[settings.main] || ''); }
        else { await commitFiles(chosen, 'Crea il progetto LaTeX dal modello Scrivia'); cache.current.clear(); const list = await listFiles(); setFiles(list); setMainText((await readText(settings.main)).text); }
        setDialog(null); setSide('struttura'); flash(`Creati ${chosen.length} file dal modello`);
      }}
      onZip={async o => download(await templateZip(o), 'modello-latex-scrivia.zip')} />}
    {dialog === 'issues' && <Modal title="Controllo della sintassi" icon={<CircleCheck size={24} />} onClose={() => setDialog(null)}>
      {issues.length ? <><p className="modal-subtitle">{issues.length === 1 ? 'Un possibile problema' : issues.length + ' possibili problemi'} in {file?.path}. Tocca una riga per andarci.</p>
        <div className="latex-issues">{issues.map((i, n) => <button key={n} onClick={() => { setDialog(null); requestAnimationFrame(() => jumpToLine(i.line)); }}><b>riga {i.line}</b>{i.message}</button>)}</div></>
        : <p className="security-note"><CircleCheck size={16} />Nessun errore evidente: parentesi e ambienti sono bilanciati. La verifica completa avviene durante la compilazione.</p>}
    </Modal>}
  </div>;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
function useAction() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function act(work: () => Promise<void | string>) {
    setBusy(true); setError(''); setMessage('');
    try { const m = await work(); if (m) setMessage(m); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return { busy, error, message, act, setMessage, setError };
}
const Feedback = ({ error, message }: { error: string; message: string }) => <>{error && <p className="warning" role="alert">{error}</p>}{message && <p className="form-note" role="status">{message}</p>}</>;

function ConnectDialog({ settings, onClose, onConnected, onDisconnect }: { settings: LatexSettings; onClose: () => void; onConnected: (s: LatexSettings) => void; onDisconnect: () => void }) {
  const [form, setForm] = useState(settings), [token, setToken] = useState('');
  const { busy, error, message, act } = useAction();
  const connected = latexConnected();
  return <Modal title="Progetto LaTeX su GitHub" icon={<GitBranch size={24} />} onClose={onClose}>
    <p className="modal-subtitle">Il repository che contiene <code>main.tex</code> e i capitoli. Ogni salvataggio diventa un commit; il PDF si compila con GitHub Actions.</p>
    <form onSubmit={e => { e.preventDefault(); void act(async () => { await connectLatex(form, token); onConnected(form); }); }}>
      <fieldset disabled={busy}>
        <div className="form-grid">
          <label>Repository<input required placeholder="proprietario/repository" value={form.repository} onChange={e => setForm({ ...form, repository: e.target.value.trim() })} /></label>
          <label>Ramo<input required value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value.trim() })} /></label>
        </div>
        <label>File principale<input required value={form.main} onChange={e => setForm({ ...form, main: e.target.value.trim() })} /></label>
        <label>Token GitHub<input type="password" autoComplete="off" value={token} placeholder={connected ? 'Lascia vuoto per mantenere il token attuale' : 'Token con accesso al repository'} onChange={e => setToken(e.target.value)} /></label>
        <p className="form-note">Crea un <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">token fine-grained</a> limitato a questo repository con i permessi <strong>Contents: Read and write</strong> (salvare), <strong>Actions: Read and write</strong> (compilare il PDF) e, solo per installare la compilazione, <strong>Workflows: Read and write</strong>. Il token va soltanto a GitHub.</p>
        <label className="github-remember"><input type="checkbox" checked={form.remember} onChange={e => setForm({ ...form, remember: e.target.checked })} />Ricorda il token su questo dispositivo</label>
        <div className="form-footer"><button className="primary" type="submit">{busy ? 'Collego…' : connected ? 'Aggiorna collegamento' : 'Collega'}</button>{connected && <button type="button" className="quiet" onClick={onDisconnect}>Scollega</button>}</div>
      </fieldset>
    </form>
    <Feedback error={error} message={message} />
  </Modal>;
}

function NewFileDialog({ hasMain, main, onClose, onCreate }: { hasMain: boolean; main: string; onClose: () => void; onCreate: (path: string, title: string, add: boolean) => Promise<void> }) {
  const [t, setT] = useState('Nuovo capitolo'), [path, setPath] = useState('content/nuovo-capitolo.tex'), [touched, setTouched] = useState(false), [add, setAdd] = useState(hasMain);
  const { busy, error, message, act } = useAction();
  return <Modal title="Nuovo file" icon={<FilePlus2 size={24} />} onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); void act(() => onCreate(path, t, add)); }}><fieldset disabled={busy}>
      <label>Titolo del capitolo<input value={t} onChange={e => { setT(e.target.value); if (!touched) setPath('content/' + slug(e.target.value) + '.tex'); }} /></label>
      <label>Percorso<input value={path} onChange={e => { setPath(e.target.value); setTouched(true); }} /></label>
      {hasMain && <label className="github-remember"><input type="checkbox" checked={add} onChange={e => setAdd(e.target.checked)} />Aggiungi a {main} (prima della parte finale)</label>}
      <div className="form-footer"><button className="primary" type="submit">{busy ? 'Creo…' : 'Crea'}</button></div>
    </fieldset></form>
    <Feedback error={error} message={message} />
  </Modal>;
}

function ImportDialog({ doc, hasMain, onClose, onCreate }: { doc: { title: string; content: DocNode } | null; hasMain: boolean; onClose: () => void; onCreate: (path: string, latex: string, title: string, add: boolean) => Promise<void> }) {
  const [top, setTop] = useState<'chapter' | 'section'>('chapter'), [path, setPath] = useState('content/' + slug(doc?.title || 'capitolo') + '.tex'), [add, setAdd] = useState(hasMain);
  const latex = useMemo(() => doc ? docToLatex(doc.content, { title: doc.title, top }) : '', [doc, top]);
  const { busy, error, message, act } = useAction();
  if (!doc) return <Modal title="Dal documento Scrivia" onClose={onClose}><p className="modal-subtitle">Apri un documento nell’editor prima di convertirlo.</p></Modal>;
  return <Modal title="Dal documento Scrivia" icon={<WandSparkles size={24} />} onClose={onClose} wide>
    <p className="modal-subtitle">Converte «{doc.title}» in LaTeX: titoli, grassetto, corsivo, elenchi, citazioni e tabelle. Le immagini vanno caricate in images/.</p>
    <div className="form-grid">
      <label>I titoli H1 diventano<select value={top} onChange={e => setTop(e.target.value as 'chapter' | 'section')}><option value="chapter">\chapter (libro)</option><option value="section">\section (articolo)</option></select></label>
      <label>Percorso<input value={path} onChange={e => setPath(e.target.value)} /></label>
    </div>
    {hasMain && <label className="github-remember"><input type="checkbox" checked={add} onChange={e => setAdd(e.target.checked)} />Aggiungi al file principale</label>}
    <pre className="latex-code-preview">{latex.slice(0, 4000)}{latex.length > 4000 ? '\n…' : ''}</pre>
    <div className="form-footer"><button className="quiet" onClick={() => download(new Blob([latex], { type: 'text/x-tex' }), slug(doc.title) + '.tex')}><Download size={15} />Scarica .tex</button><button className="primary" disabled={busy} onClick={() => void act(() => onCreate(path, latex, doc.title, add))}>{busy ? 'Creo…' : 'Aggiungi al progetto'}</button></div>
    <Feedback error={error} message={message} />
  </Modal>;
}

// PNG and JPG are kept; other formats (HEIC, WebP, GIF…) are converted to PNG, which pdflatex reads.
async function prepareImage(file: File): Promise<{ bytes: Uint8Array; ext: string }> {
  const type = file.type.toLowerCase();
  if (type === 'image/png') return { bytes: new Uint8Array(await file.arrayBuffer()), ext: 'png' };
  if (type === 'image/jpeg' || type === 'image/jpg') return { bytes: new Uint8Array(await file.arrayBuffer()), ext: 'jpg' };
  if (type === 'application/pdf') return { bytes: new Uint8Array(await file.arrayBuffer()), ext: 'pdf' };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('immagine non leggibile')); i.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('conversione fallita');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' };
  } catch {
    throw new Error('Formato non supportato da LaTeX (' + (type || 'sconosciuto') + '): scegli un PNG, JPG o PDF.');
  } finally { URL.revokeObjectURL(url); }
}

function ImageDialog({ source, images, onClose, onInsert }: { source: Source; images: LatexFile[]; onClose: () => void; onInsert: (c: { file?: File; name: string; existing?: string; width: number; caption: string }) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null), [name, setName] = useState(''), [existing, setExisting] = useState(''), [width, setWidth] = useState(0.8), [caption, setCaption] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const { busy, error, message, act } = useAction();
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  return <Modal title="Inserisci un’immagine" icon={<ImagePlus size={24} />} onClose={onClose}>
    <p className="modal-subtitle">{source === 'github' ? 'Carica un file in images/ (un commit) oppure scegli un’immagine già presente: il blocco figure viene inserito al cursore.' : 'Nel progetto locale si inserisce solo il codice: aggiungi il file nella cartella images/ quando compili.'}</p>
    {source === 'github' && <label>File dal dispositivo<input type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files?.[0] || null; setFile(f); setExisting(''); if (f) { setName(sanitizeImageName(f.name, f.type)); setPreviewUrl(URL.createObjectURL(f)); } }} /></label>}
    {previewUrl && file?.type.startsWith('image/') && <img className="latex-image-preview" src={previewUrl} alt="" />}
    {images.length > 0 && <label>Oppure un’immagine del progetto<select value={existing} onChange={e => { setExisting(e.target.value); setFile(null); }}><option value="">—</option>{images.map(i => <option key={i.path} value={i.path}>{i.path}</option>)}</select></label>}
    {!images.length && source === 'local' && <label>Nome del file in images/<input value={existing.replace(/^images\//, '')} placeholder="grafico.png" onChange={e => setExisting(e.target.value ? 'images/' + sanitizeImageName(e.target.value) : '')} /></label>}
    {file && <label>Nome in images/<input value={name} onChange={e => setName(sanitizeImageName(e.target.value, file.type))} /></label>}
    <label>Larghezza: {Math.round(width * 100)}% del testo<input type="range" min={0.2} max={1} step={0.05} value={width} onChange={e => setWidth(+e.target.value)} /></label>
    <label>Didascalia (facoltativa)<input value={caption} onChange={e => setCaption(e.target.value)} /></label>
    <div className="form-footer"><button className="quiet" onClick={onClose}>Annulla</button><button className="primary" disabled={busy || (!file && !existing)} onClick={() => void act(() => onInsert({ file: file || undefined, name, existing: existing || undefined, width, caption }))}>{busy ? 'Carico…' : 'Inserisci'}</button></div>
    <Feedback error={error} message={message} />
  </Modal>;
}

function PdfDialog({ workflowInstalled, dirty, onClose, onInstall }: { workflowInstalled: boolean; dirty: boolean; onClose: () => void; onInstall: () => Promise<void> }) {
  const [mode, setMode] = useState<PdfMode>('finale');
  const [status, setStatus] = useState(''), [run, setRun] = useState<WorkflowRun | null>(null), [running, setRunning] = useState(false);
  const [last, setLast] = useState<Partial<Record<PdfMode, PdfAsset | null>>>({});
  const [installed, setInstalled] = useState(workflowInstalled);
  const { busy, error, act, setError } = useAction();
  const abort = useRef<AbortController | null>(null);
  const loadLast = useCallback(async () => {
    const entries = await Promise.all((['finale', 'bozza'] as const).map(async m => [m, await latestPdf(m).catch(() => null)] as const));
    setLast(Object.fromEntries(entries));
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.all((['finale', 'bozza'] as const).map(async m => [m, await latestPdf(m).catch(() => null)] as const)).then(entries => { if (alive) setLast(Object.fromEntries(entries)); });
    return () => { alive = false; abort.current?.abort(); };
  }, []);

  async function open(asset: PdfAsset, save: boolean) {
    await act(async () => {
      let blob: Blob;
      try { blob = await downloadPdf(asset); }
      catch { window.open(asset.url, '_blank', 'noopener'); return; }
      if (save) download(blob, asset.name);
      else { const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    });
  }
  async function start() {
    setRunning(true); setError(''); setRun(null);
    abort.current = new AbortController();
    const since = Date.now();
    let dispatched = false;
    try {
      setStatus('Avvio della compilazione…');
      await dispatchPdf(mode); dispatched = true;
      setStatus('Compilazione avviata, cerco il processo…');
      const found = await findRun(since, abort.current.signal);
      if (!found) { setStatus('Avviata, ma non riesco a seguirne lo stato: controlla la scheda Actions su GitHub.'); return; }
      const done = await waitForRun(found, r => { setRun(r); setStatus(r.status === 'queued' ? 'In coda…' : r.status === 'in_progress' ? 'Compilazione in corso: servono alcuni minuti…' : 'Completamento…'); }, abort.current.signal);
      setRun(done);
      if (done.conclusion === 'success') {
        setStatus('✓ PDF pronto.');
        await loadLast();
        const asset = await latestPdf(mode);
        if (asset) void open(asset, true);
      } else if (done.status !== 'completed') setStatus('Ci sta mettendo più del previsto: seguila dalla pagina del processo.');
      else setStatus('Compilazione non riuscita: apri il log per vedere l’errore LaTeX.');
    } catch (e) {
      if (dispatched) setStatus('Connessione persa, ma la compilazione continua su GitHub: tra qualche minuto scarica il PDF da qui sotto.');
      else if (e instanceof GitHubError && (e.status === 403 || e.status === 404)) setError('Permesso negato o workflow mancante: il token deve avere Actions: Read and write e il file ' + WORKFLOW_PATH + ' deve essere sul ramo predefinito. ' + e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  }
  return <Modal title="Compila il PDF" icon={<Play size={24} />} onClose={() => { abort.current?.abort(); onClose(); }}>
    <p className="modal-subtitle">La compilazione gira su GitHub Actions con <code>latexmk</code> (pdflatex + indici analitici): non serve installare LaTeX. Il PDF viene pubblicato su una release con link fisso.</p>
    {!installed && <div className="warning"><p>Nel repository manca <code>{WORKFLOW_PATH}</code>, il processo che compila il PDF.</p><button className="primary" disabled={busy} onClick={() => void act(async () => { await onInstall(); setInstalled(true); })}>{busy ? 'Installo…' : 'Installa la compilazione'}</button><p className="form-note">Serve un token con permesso Workflows: Read and write. Il workflow deve trovarsi sul ramo predefinito del repository.</p></div>}
    {dirty && <p className="warning">Il file aperto ha modifiche non salvate: la compilazione usa la versione su GitHub. Salva prima di compilare.</p>}
    <label>Versione<select value={mode} disabled={running} onChange={e => setMode(e.target.value as PdfMode)}><option value="finale">Finale</option><option value="bozza">Bozza (filigrana e immagini segnaposto)</option></select></label>
    <div className="form-footer"><button className="primary" disabled={running || !installed} onClick={() => void start()}>{running ? <><Loader2 size={15} className="spin" />In corso…</> : <><Play size={15} />Compila</>}</button>{run && <a className="quiet" href={run.html_url} target="_blank" rel="noreferrer">Dettagli del processo <ExternalLink size={12} /></a>}</div>
    {status && <p className="form-note" role="status">{status}</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    <h3>PDF già generati</h3>
    <div className="latex-pdf-list">
      {(['finale', 'bozza'] as const).map(m => { const a = last[m]; return <div key={m} className="revision-row"><div><strong>{m === 'finale' ? 'Finale' : 'Bozza'}</strong><small>{a === undefined ? 'Controllo…' : a ? new Date(a.updated).toLocaleString('it-IT') : 'Non ancora generato'}</small></div>{a && <><button disabled={busy} onClick={() => void open(a, false)}>Apri</button><button disabled={busy} onClick={() => void open(a, true)}><Download size={13} /></button></>}</div>; })}
    </div>
    <p className="form-note"><a href={actionsUrl()} target="_blank" rel="noreferrer">Tutte le compilazioni su GitHub <ExternalLink size={11} /></a></p>
  </Modal>;
}

function TemplateDialog({ source, existing, onClose, onCreate, onZip }: { source: Source; existing: string[]; onClose: () => void; onCreate: (o: { title: string; author: string }, overwrite: boolean) => Promise<void>; onZip: (o: { title: string; author: string }) => Promise<void> }) {
  const [o, setO] = useState({ title: '', author: '' }), [overwrite, setOverwrite] = useState(false);
  const { busy, error, message, act } = useAction();
  const clash = templateFiles().filter(f => existing.includes(f.path)).length;
  return <Modal title="Modello di progetto" icon={<LayoutTemplate size={24} />} onClose={onClose}>
    <p className="modal-subtitle">Un progetto LaTeX pronto per un saggio o un libro argomentativo: stile tipografico (Source Serif, formato 17×24, indici analitici), copertina, bozza/finale e compilazione PDF su GitHub. I capitoli contengono solo la traccia: tesi, argomenti, obiezioni, conclusione.</p>
    <div className="form-grid"><label>Titolo<input value={o.title} placeholder="Titolo del saggio" onChange={e => setO({ ...o, title: e.target.value })} /></label><label>Autore<input value={o.author} placeholder="Nome Cognome" onChange={e => setO({ ...o, author: e.target.value })} /></label></div>
    {clash > 0 && <label className="github-remember"><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />Sovrascrivi i {clash} file già presenti (altrimenti vengono saltati)</label>}
    <div className="form-footer"><button className="quiet" disabled={busy} onClick={() => void act(() => onZip(o))}><FileArchive size={15} />Scarica .zip</button><button className="primary" disabled={busy} onClick={() => void act(() => onCreate(o, overwrite))}>{busy ? 'Creo…' : source === 'github' ? 'Crea nel repository' : 'Crea nel browser'}</button></div>
    <Feedback error={error} message={message} />
  </Modal>;
}
