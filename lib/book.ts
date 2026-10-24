// Adding Scrivia documents to the LaTeX book: every document becomes a chapter file
// in content/ and an \input line in main.tex, in the book's main matter.
// Adding the same document again updates its chapter instead of duplicating it.

const plainSlug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const stripTex = (p: string) => p.replace(/\.tex$/i, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeTitle = (s: string) => s.replace(/\\/g, '\\textbackslash{}').replace(/([{}$&#_%])/g, '\\$1').replace(/[\r\n]+/g, ' ');

// File for a document's chapter: the one it already has in this book, else content/<title>.tex
// (numbered when the name is taken by another file).
export function chapterPath(title: string, taken: Iterable<string>, remembered?: string) {
  if (remembered) return remembered;
  const used = new Set(taken), base = 'content/' + (plainSlug(title) || 'capitolo');
  let path = base + '.tex';
  for (let n = 2; used.has(path); n++) path = `${base}-${n}.tex`;
  return path;
}

// True when main.tex already includes the file (not counting commented lines).
export function includesInput(main: string, path: string) {
  const re = new RegExp('^[ \\t]*\\\\(?:input|include)\\{\\.?/?' + escapeRe(stripTex(path)) + '(?:\\.tex)?\\}', 'm');
  return re.test(main);
}

// Where new chapters go: before the back matter, the appendix or \end{document}.
// Comment lines just above it (a "BACK MATTER" banner, not a commented-out chapter) stay with what follows.
function insertionPoint(main: string) {
  const found = [/^\\backmatter\b/m, /^\\appendix\b/m, /^\\end\{document\}/m].map(re => main.search(re)).find(i => i >= 0);
  if (found === undefined) return undefined;
  let at: number = found;
  for (;;) {
    const lineStart: number = main.lastIndexOf('\n', at - 2) + 1;
    const line = main.slice(lineStart, at);
    if (at === 0 || !/^[ \t]*%/.test(line) || /\\(?:input|include)\{/.test(line)) return at;
    at = lineStart;
  }
}

// Adds the chapters missing from main.tex, optionally under a \part with the given name.
export function addToBook(main: string, chapters: { path: string; title: string }[], part?: string) {
  const missing = chapters.filter((c, i) => !includesInput(main, c.path) && chapters.findIndex(x => x.path === c.path) === i);
  if (!missing.length) return main;
  const lines: string[] = [];
  const partTitle = part?.trim();
  if (partTitle && !new RegExp('^[ \\t]*\\\\part\\*?\\{' + escapeRe(escapeTitle(partTitle)) + '\\}', 'm').test(main)) lines.push(`\\part{${escapeTitle(partTitle)}}`);
  for (const c of missing) lines.push(`\\input{${stripTex(c.path)}}   % ${c.title.replace(/[\r\n%]+/g, ' ').trim()}`);
  const block = lines.join('\n');
  const at = insertionPoint(main);
  if (at === undefined) return main.replace(/\s*$/, '\n' + block + '\n');
  return main.slice(0, at) + block + '\n\n' + main.slice(at);
}

// Which chapter file each document was saved to, per LaTeX project (GitHub repository or browser).
export type BookLinks = Record<string, string>;
export const bookLinksKey = (project: string) => 'scrivia:book-links:' + project;
export function readBookLinks(project: string): BookLinks {
  try {
    const raw = JSON.parse(localStorage.getItem(bookLinksKey(project)) || 'null');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string' && /^[\w.\-/ ]+\.tex$/.test(e[1]) && !e[1].includes('..')));
  } catch { return {}; }
}
export function storeBookLinks(project: string, links: BookLinks) {
  try { localStorage.setItem(bookLinksKey(project), JSON.stringify(links)); return true; } catch { return false; }
}
