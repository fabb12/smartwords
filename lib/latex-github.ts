// GitHub client of the LaTeX studio: reads and commits the files of a LaTeX
// project, uploads images and starts the PDF compilation on GitHub Actions.
// Requests leave from the user's browser/desktop app; the token never enters
// the documents or the backend.
import { desktop } from './desktop.ts';

export type LatexSettings = { repository: string; branch: string; main: string; remember: boolean };
export type LatexFile = { path: string; sha: string; size: number };
export type PdfMode = 'finale' | 'bozza';
export type WorkflowRun = { id: number; status: string; conclusion: string | null; html_url: string; created_at: string };
export type PdfAsset = { url: string; apiUrl: string; name: string; updated: string };

const SETTINGS = 'scrivia:latex-settings', TOKEN = 'scrivia:latex-token';
export const PDF_WORKFLOW = 'build-pdf.yml';
export const WORKFLOW_PATH = '.github/workflows/' + PDF_WORKFLOW;
const API = 'https://api.github.com/repos/';
let session: { key: string; token: string } | undefined;

export class LatexConflict extends Error {
  constructor(path: string) { super(`Il file ${path} è cambiato su GitHub dopo che l’hai aperto. Ricaricalo oppure salva comunque la tua versione.`); }
}
export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
export function latexSettings(): LatexSettings {
  return { repository: '', branch: 'main', main: 'main.tex', remember: true, ...read<Partial<LatexSettings>>(SETTINGS, {}) };
}
function validate(s: LatexSettings) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s.repository)) throw new Error('Indica il repository nel formato proprietario/nome.');
  if (!s.branch || /[\s~^:?*[\\]|\.\./.test(s.branch)) throw new Error('Nome del ramo non valido.');
  if (!/^[^/][\w ./-]*\.tex$/.test(s.main) || s.main.includes('..')) throw new Error('Il file principale deve essere un percorso .tex, ad esempio main.tex.');
}
function storedToken() {
  const s = latexSettings();
  if (session?.key === s.repository) return session.token;
  const stored = read<string>(TOKEN, '');
  return stored.startsWith('enc:') ? desktop()?.reveal(stored.slice(4)) || '' : stored;
}
export function latexConnected() { const s = latexSettings(); return !!s.repository && !!storedToken(); }
export function disconnectLatex() { session = undefined; localStorage.removeItem(TOKEN); }

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function request(path: string, init: RequestInit = {}, token = storedToken(), repository = latexSettings().repository) {
  let r: Response;
  try {
    r = await fetch(API + repository + (path ? '/' + path : ''), {
      ...init, cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new GitHubError(0, 'Connessione a GitHub non riuscita: controlla la rete e riprova. Le modifiche restano nella bozza locale.');
  }
  return r;
}
async function fail(r: Response): Promise<never> {
  let detail = '';
  try { detail = ((await r.json()) as { message?: string }).message || ''; } catch { /* no body */ }
  const hint = r.status === 401 ? 'Token non valido o scaduto: ricollega GitHub.'
    : r.status === 403 ? 'GitHub ha rifiutato l’operazione: controlla i permessi del token (Contents, Actions o Workflows).'
    : r.status === 404 ? 'Repository, ramo o file non trovato, oppure il token non ha accesso.'
    : `Operazione GitHub non riuscita (${r.status}).`;
  throw new GitHubError(r.status, hint + (detail ? ' — ' + detail : ''));
}
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await request(path, init);
  if (!r.ok) return fail(r);
  return r.status === 204 ? (undefined as T) : (await r.json() as T);
}

export async function connectLatex(settings: LatexSettings, token: string) {
  validate(settings);
  const value = token.trim() || (settings.repository === latexSettings().repository ? storedToken() : '');
  if (!value || /\s/.test(value)) throw new Error('Inserisci un token GitHub con accesso al repository.');
  const r = await request('', {}, value, settings.repository);
  if (!r.ok) await fail(r);
  const info = await r.json() as { private: boolean; default_branch: string; permissions?: { push?: boolean } };
  localStorage.setItem(SETTINGS, JSON.stringify(settings));
  session = { key: settings.repository, token: value };
  if (settings.remember) { const enc = desktop()?.protect(value); localStorage.setItem(TOKEN, JSON.stringify(enc ? 'enc:' + enc : value)); }
  else localStorage.removeItem(TOKEN);
  return info;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export function decodeBase64(b64: string) {
  const bin = atob(b64.replace(/\s/g, ''));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
export function encodeBase64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function listFiles(): Promise<LatexFile[]> {
  const s = latexSettings();
  const tree = await json<{ tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean }>('git/trees/' + encodeURIComponent(s.branch) + '?recursive=1');
  return tree.tree.filter(t => t.type === 'blob').map(t => ({ path: t.path, sha: t.sha, size: t.size || 0 })).sort((a, b) => a.path.localeCompare(b.path));
}

export async function readText(path: string): Promise<{ text: string; sha: string }> {
  const s = latexSettings();
  const meta = await json<{ sha: string; encoding?: string; content?: string }>('contents/' + encodePath(path) + '?ref=' + encodeURIComponent(s.branch));
  let content = meta.content;
  if (meta.encoding !== 'base64' || !content) content = (await json<{ content: string }>('git/blobs/' + meta.sha)).content;
  return { text: new TextDecoder('utf-8').decode(decodeBase64(content)), sha: meta.sha };
}

export async function readBlob(sha: string): Promise<Uint8Array> {
  const blob = await json<{ content: string }>('git/blobs/' + encodeURIComponent(sha));
  return decodeBase64(blob.content);
}

async function put(path: string, base64: string, sha: string | undefined, message: string) {
  const r = await request('contents/' + encodePath(path), { method: 'PUT', body: JSON.stringify({ message, content: base64, branch: latexSettings().branch, ...(sha ? { sha } : {}) }) });
  if (r.status === 409 || (r.status === 422 && sha)) throw new LatexConflict(path);
  if (!r.ok) return fail(r);
  const saved = await r.json() as { content: { sha: string } };
  return saved.content.sha;
}
export function writeText(path: string, text: string, sha: string | undefined, message: string) {
  return put(path, encodeBase64(new TextEncoder().encode(text)), sha, message);
}
export function writeBytes(path: string, bytes: Uint8Array, sha: string | undefined, message: string) {
  return put(path, encodeBase64(bytes), sha, message);
}
export async function currentSha(path: string) {
  const r = await request('contents/' + encodePath(path) + '?ref=' + encodeURIComponent(latexSettings().branch));
  if (r.status === 404) return undefined;
  if (!r.ok) return fail(r);
  return ((await r.json()) as { sha: string }).sha;
}
export async function deleteFile(path: string, sha: string, message: string) {
  await json('contents/' + encodePath(path), { method: 'DELETE', body: JSON.stringify({ message, sha, branch: latexSettings().branch }) });
}

// Several files in a single commit (used to create a project from the template).
export async function commitFiles(files: { path: string; content: string }[], message: string) {
  const branch = encodeURIComponent(latexSettings().branch);
  const ref = await json<{ object: { sha: string } }>('git/ref/heads/' + branch);
  const parent = await json<{ tree: { sha: string } }>('git/commits/' + ref.object.sha);
  const tree = await json<{ sha: string }>('git/trees', { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }) });
  const commit = await json<{ sha: string }>('git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
  await json('git/refs/heads/' + branch, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  return commit.sha;
}

// ---------------------------------------------------------------------------
// PDF compilation (GitHub Actions)
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function dispatchPdf(mode: PdfMode) {
  await json('actions/workflows/' + PDF_WORKFLOW + '/dispatches', { method: 'POST', body: JSON.stringify({ ref: latexSettings().branch, inputs: { mode } }) });
}

// Finds the run just started (created after `since`), retrying until it appears.
export async function findRun(since: number, signal?: AbortSignal): Promise<WorkflowRun | null> {
  for (let i = 0; i < 20 && !signal?.aborted; i++) {
    try {
      const j = await json<{ workflow_runs: WorkflowRun[] }>('actions/workflows/' + PDF_WORKFLOW + '/runs?event=workflow_dispatch&per_page=10');
      const run = j.workflow_runs.filter(r => new Date(r.created_at).getTime() >= since - 15000).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (run) return run;
    } catch { /* brief network loss: try again */ }
    await sleep(3000);
  }
  return null;
}

export function getRun(id: number) { return json<WorkflowRun>('actions/runs/' + id); }

// Follows a run until it completes; a few network errors in a row are tolerated.
export async function waitForRun(run: WorkflowRun, onStatus: (run: WorkflowRun) => void, signal?: AbortSignal) {
  let current = run, errors = 0;
  for (let i = 0; i < 150 && !signal?.aborted; i++) {
    onStatus(current);
    if (current.status === 'completed') return current;
    await sleep(6000);
    try { current = await getRun(current.id); errors = 0; }
    catch (e) { if (++errors >= 10) throw e; }
  }
  return current;
}

// The workflow publishes the PDF on the release "pdf-<mode>"; any .pdf asset is accepted,
// so projects created by Scrivia (documento-*.pdf) and older ones (libro-*.pdf) both work.
export async function latestPdf(mode: PdfMode): Promise<PdfAsset | null> {
  const r = await request('releases/tags/pdf-' + mode);
  if (r.status === 404) return null;
  if (!r.ok) return fail(r);
  const rel = await r.json() as { assets?: { name: string; url: string; browser_download_url: string; updated_at: string }[] };
  const a = rel.assets?.find(x => /\.pdf$/i.test(x.name));
  return a ? { url: a.browser_download_url, apiUrl: a.url, name: a.name, updated: a.updated_at } : null;
}

// Downloads the PDF through the API (works for private repositories too).
export async function downloadPdf(asset: PdfAsset): Promise<Blob> {
  const r = await fetch(asset.apiUrl, { headers: { Accept: 'application/octet-stream', Authorization: 'Bearer ' + storedToken() } });
  if (!r.ok) return fail(r);
  return new Blob([await r.arrayBuffer()], { type: 'application/pdf' });
}

export function actionsUrl() { return 'https://github.com/' + latexSettings().repository + '/actions'; }
export function fileUrl(path: string) { const s = latexSettings(); return `https://github.com/${s.repository}/blob/${encodeURIComponent(s.branch)}/${encodePath(path)}`; }
