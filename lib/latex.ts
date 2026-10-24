// LaTeX tools for the LaTeX studio: preview (LaTeX → HTML), export of a Scrivia
// document (TipTap JSON → LaTeX), editing helpers and a quick syntax check.
// The converter handles the subset used by books and essays; derived from the
// reader of fabb12/libro-futuro.

export type LatexPreview = { html: string; notes: string[] };
export type OutlineItem = { level: number; title: string; index: number; line: number };
export type StructureItem = { path: string; title: string; part: string };
export type LatexIssue = { line: number; message: string };
export type Edit = { text: string; start: number; end: number };

const ACCENTS: Record<string, Record<string, string>> = {
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü' },
  '~': { n: 'ñ', a: 'ã', o: 'õ' },
};

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// \`{a}, \'e … → Unicode, for titles shown outside the preview.
export function latexAccentsToText(s: string) {
  return String(s).replace(/\\([`'^"~])\{?([a-zA-Z])\}?/g, (m, acc: string, ch: string) => ACCENTS[acc]?.[ch] || ch);
}

// Plain title from a LaTeX fragment: accents, quotes and simple commands removed.
export function latexPlain(s: string) {
  return latexAccentsToText(s)
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/``|''/g, '"')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripComments(src: string) {
  return src
    .replace(/\\begin\{comment\}[\s\S]*?\\end\{comment\}/g, '')
    .replace(/\\iffalse[\s\S]*?\\fi\b/g, '')
    .split('\n')
    .map(line => {
      for (let i = 0; i < line.length; i++) if (line[i] === '%' && line[i - 1] !== '\\') return line.slice(0, i);
      return line;
    })
    .join('\n');
}

type Result = { block?: string; inline?: string; parbreak?: boolean } | null;

export function latexToHtml(input: string): LatexPreview {
  const notes: string[] = [];
  let src = stripComments(input);
  let pos = 0;

  const readCmdName = () => { let n = ''; while (pos < src.length && /[a-zA-Z]/.test(src[pos])) n += src[pos++]; return n; };
  const skipWs = () => { while (pos < src.length && /[ \t\n]/.test(src[pos])) pos++; };
  const star = () => { if (src[pos] === '*') pos++; };
  function readBraceArg(): string | null {
    const save = pos; skipWs();
    if (src[pos] !== '{') { pos = save; return null; }
    pos++;
    let depth = 1, out = '';
    while (pos < src.length && depth > 0) {
      const c = src[pos];
      if (c === '\\' && (src[pos + 1] === '{' || src[pos + 1] === '}' || src[pos + 1] === '\\')) { out += c + src[pos + 1]; pos += 2; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { pos++; break; } }
      out += c; pos++;
    }
    return out;
  }
  function readOptArg(): string | null {
    const save = pos; skipWs();
    if (src[pos] !== '[') { pos = save; return null; }
    pos++;
    let out = '';
    while (pos < src.length && src[pos] !== ']') out += src[pos++];
    pos++;
    return out;
  }
  const arg = () => readBraceArg() || '';
  function fragment(s: string) {
    const savedSrc = src, savedPos = pos;
    src = s; pos = 0;
    const html = parseBlocks(null, true);
    src = savedSrc; pos = savedPos;
    return html;
  }
  function splitItems(body: string) {
    const items: string[] = [];
    let depth = 0, cur = '', i = 0;
    while (i < body.length) {
      if (body[i] === '\\') {
        if (body.startsWith('\\begin', i)) depth++;
        else if (body.startsWith('\\end', i)) depth--;
        else if (depth === 0 && body.startsWith('\\item', i) && !/[a-zA-Z]/.test(body[i + 5] || '')) {
          items.push(cur); cur = ''; i += 5;
          const opt = body.slice(i).match(/^\s*\[([^\]]*)\]/);
          if (opt) { cur = '\\textbf{' + opt[1] + '} '; i += opt[0].length; }
          continue;
        }
      } else if (body[i] === '{') depth++;
      else if (body[i] === '}') depth--;
      cur += body[i]; i++;
    }
    items.push(cur);
    return items.length > 1 ? items.slice(1) : items;
  }
  function envBody(name: string) {
    let depth = 1, body = '';
    const open = '\\begin{' + name + '}', close = '\\end{' + name + '}';
    while (pos < src.length) {
      if (src.startsWith(open, pos)) { depth++; body += open; pos += open.length; continue; }
      if (src.startsWith(close, pos)) { depth--; pos += close.length; if (depth === 0) return body; body += close; continue; }
      body += src[pos++];
    }
    return body;
  }
  function box(cls: string, title: string | null, inner: string) {
    return `<div class="latex-box ${cls}">${title ? `<div class="latex-box-title">${fragment(title)}</div>` : ''}${inner}</div>`;
  }
  function handleEnv(name: string) {
    const opt = readOptArg();
    const body = envBody(name);
    switch (name) {
      case 'itemize': case 'enumerate': case 'description': {
        const tag = name === 'enumerate' ? 'ol' : 'ul';
        return `<${tag}>${splitItems(body).map(it => '<li>' + fragment(it) + '</li>').join('')}</${tag}>`;
      }
      case 'quote': case 'quotation': case 'modernquote': case 'displayquote':
        return '<blockquote>' + fragment(body) + '</blockquote>';
      case 'flushright': return '<div class="latex-right">' + fragment(body) + '</div>';
      case 'flushleft': return '<div class="latex-left">' + fragment(body) + '</div>';
      case 'center': case 'figure': case 'figure*': case 'table': {
        const inner = fragment(body);
        return /data-imgpath|<figcaption/.test(inner) ? '<figure>' + inner + '</figure>' : '<div class="latex-center">' + inner + '</div>';
      }
      case 'minipage': return '<div class="latex-center">' + fragment(body.replace(/^\s*\{[^}]*\}/, '')) + '</div>';
      case 'tabular': case 'tabularx': case 'longtable': return table(body.replace(/^\s*\{[^}]*\}/, ''));
      case 'verbatim': case 'lstlisting': return '<pre>' + escapeHtml(body.replace(/^\n/, '')) + '</pre>';
      case 'equation': case 'equation*': case 'align': case 'align*': case 'displaymath':
        return '<pre class="latex-math">' + escapeHtml(body.trim()) + '</pre>';
      case 'abstract': return box('abstract', 'Sommario', fragment(body));
      case 'concetto': return box('concetto', opt, fragment(body));
      case 'codice': return box('codice', opt, '<pre>' + escapeHtml(body.trim()) + '</pre>');
      case 'boxdati': return box('dati', opt, fragment(body));
      case 'tcolorbox': return box('concetto', null, fragment(body));
      case 'document': return fragment(body);
      default: return fragment(body);
    }
  }
  function table(body: string) {
    const rows = body
      .replace(/\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\})/g, '')
      .split(/\\\\(?:\[[^\]]*\])?/)
      .map(r => r.trim())
      .filter(Boolean);
    return '<table>' + rows.map(r => '<tr>' + r.split(/(?<!\\)&/).map(c => '<td>' + fragment(c.trim()) + '</td>').join('') + '</tr>').join('') + '</table>';
  }
  function img(path: string, opt: string | null) {
    const m = opt?.match(/width\s*=\s*([\d.]+)\\(?:text|line|column)width/);
    const style = m ? ` style="width:${Math.round(parseFloat(m[1]) * 100)}%"` : '';
    return `<span class="latex-img"><img data-imgpath="${escapeHtml(path)}" alt=""${style}><span class="latex-img-label">${escapeHtml(path)}</span></span>`;
  }
  const heading = (tag: string): Result => { star(); readOptArg(); return { block: `<${tag}>` + fragment(arg()) + `</${tag}>` }; };
  const wrap = (open: string, close: string): Result => ({ inline: open + fragment(arg()) + close });

  function command(name: string): Result {
    switch (name) {
      case 'chapter': return heading('h1');
      case 'section': return heading('h2');
      case 'subsection': return heading('h3');
      case 'subsubsection': case 'paragraph': return heading('h4');
      case 'title': return { block: '<h1>' + fragment(arg()) + '</h1>' };
      case 'textit': case 'emph': case 'textsl': return wrap('<em>', '</em>');
      case 'textbf': case 'firstwords': return wrap('<strong>', '</strong>');
      case 'textsc': case 'smallcaps': return wrap('<span class="latex-sc">', '</span>');
      case 'texttt': case 'url': return wrap('<code>', '</code>');
      case 'underline': case 'uline': return wrap('<u>', '</u>');
      case 'sout': return wrap('<s>', '</s>');
      case 'MakeUppercase': case 'uppercase': return wrap('<span style="text-transform:uppercase">', '</span>');
      case 'textls': readOptArg(); return { inline: fragment(arg()) };
      case 'href': { arg(); return { inline: '<u>' + fragment(arg()) + '</u>' }; }
      case 'fbox': case 'mbox': case 'makebox': readOptArg(); return wrap('<span class="latex-fbox">', '</span>');
      case 'footnote': {
        readOptArg();
        notes.push(fragment(arg()));
        const n = notes.length;
        return { inline: `<sup class="latex-fnref" data-note="${n - 1}">${n}</sup>` };
      }
      case 'includegraphics': { star(); const opt = readOptArg(); return { inline: img(arg(), opt) }; }
      case 'immagine': { const path = arg(); const desc = arg(); return { block: '<figure>' + img(path, null) + '<figcaption>' + fragment(desc) + '</figcaption></figure>' }; }
      case 'caption': readOptArg(); return { block: '<figcaption>' + fragment(arg()) + '</figcaption>' };
      case 'captionof': arg(); return { block: '<figcaption>' + fragment(arg()) + '</figcaption>' };
      case 'epigraph': case 'chapterquote': {
        const q = fragment(arg()), a = fragment(arg());
        return { block: `<div class="latex-epigraph"><div>${q}</div><div class="latex-epigraph-source">${a}</div></div>` };
      }
      case 'human': case 'humanbox': return { block: `<div class="latex-msg human"><span>UMANO</span>${fragment(arg())}</div>` };
      case 'ai': case 'aibox': return { block: `<div class="latex-msg ai"><span>AI</span>${fragment(arg())}</div>` };
      case 'bigskip': case 'medskip': case 'smallskip': return { block: '<div class="latex-skip"></div>' };
      case 'vspace': star(); arg(); return { block: '<div class="latex-skip"></div>' };
      case 'hspace': star(); arg(); return { inline: ' ' };
      case 'rule': readOptArg(); arg(); arg(); return { block: '<hr>' };
      case 'par': case 'newline': return name === 'par' ? { parbreak: true } : { inline: '<br>' };
      case 'c': { const a = arg(); return { inline: a === 'c' ? 'ç' : a === 'C' ? 'Ç' : a }; }
      case 'index': readOptArg(); arg(); return { inline: '' };
      case 'label': arg(); return { inline: '' };
      case 'ref': case 'pageref': case 'eqref': arg(); return { inline: '<em>(rif.)</em>' };
      case 'cite': case 'citep': case 'citet': { readOptArg(); readOptArg(); return { inline: '[' + escapeHtml(arg()) + ']' }; }
      case 'color': case 'pagestyle': case 'thispagestyle': case 'bibliographystyle': case 'bibliography': case 'usetikzlibrary':
        arg(); return { inline: '' };
      case 'usepackage': case 'documentclass': readOptArg(); arg(); return { inline: '' };
      case 'newcommand': case 'renewcommand': case 'providecommand': { star(); arg(); readOptArg(); readOptArg(); arg(); return { inline: '' }; }
      case 'newenvironment': case 'renewenvironment': { star(); arg(); readOptArg(); readOptArg(); arg(); arg(); return { inline: '' }; }
      case 'newtcolorbox': { arg(); readOptArg(); readOptArg(); arg(); return { inline: '' }; }
      case 'definecolor': arg(); arg(); arg(); return { inline: '' };
      case 'addcontentsline': arg(); arg(); arg(); return { inline: '' };
      case 'setcounter': case 'setlength': case 'addtolength': arg(); arg(); return { inline: '' };
      case 'input': case 'include': return { block: `<div class="latex-input">↳ ${escapeHtml(arg())}</div>` };
      case 'graphicspath': case 'printindex': readOptArg(); readBraceArg(); return { inline: '' };
      case 'makeindex': readOptArg(); return { inline: '' };
      case 'lettrine': { readOptArg(); const a = arg(), b = arg(); return { inline: '<span class="latex-lettrine">' + fragment(a) + '</span>' + fragment(b) }; }
      case 'maketitle': case 'noindent': case 'centering': case 'justifying': case 'raggedright': case 'raggedleft':
      case 'clearpage': case 'cleardoublepage': case 'newpage': case 'vfill': case 'hfill': case 'item':
      case 'sffamily': case 'rmfamily': case 'ttfamily': case 'bfseries': case 'itshape': case 'scshape': case 'normalfont':
      case 'tiny': case 'small': case 'footnotesize': case 'scriptsize': case 'normalsize':
      case 'large': case 'Large': case 'LARGE': case 'huge': case 'Huge':
      case 'tableofcontents': case 'listoffigures': case 'appendix':
      case 'frontmatter': case 'mainmatter': case 'backmatter': case 'protect':
      case 'hrule': case 'linebreak': case 'nolinebreak': case 'nopagebreak': case 'pagebreak':
      case 'phantomsection': case 'indent': case 'relax': case 'selectfont': case 'today':
        return { inline: name === 'today' ? new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '' };
      case 'ldots': case 'dots': case 'textellipsis': return { inline: '…' };
      case 'textquotedblleft': return { inline: '“' };
      case 'textquotedblright': return { inline: '”' };
      case 'guillemotleft': return { inline: '«' };
      case 'guillemotright': return { inline: '»' };
      case 'textcopyright': case 'copyright': return { inline: '©' };
      case 'textbackslash': return { inline: '\\' };
      case 'textasciitilde': return { inline: '~' };
      case 'textasciicircum': return { inline: '^' };
      case 'S': return { inline: '§' };
      case 'LaTeX': return { inline: 'LaTeX' };
      case 'TeX': return { inline: 'TeX' };
      case 'begin': case 'end': return null;
      default: {
        // Unknown command: show the content of its first argument, if any.
        readOptArg();
        const a = readBraceArg();
        return { inline: a !== null ? fragment(a) : '' };
      }
    }
  }

  function parseBlocks(stopEnv: string | null, inline: boolean): string {
    let html = '', para = '';
    const flush = () => {
      const t = para.trim();
      if (t) html += inline && !/<(h\d|div|figure|blockquote|ul|ol|figcaption|hr|pre|table)/.test(html + t) ? t : '<p>' + t + '</p>';
      para = '';
    };
    while (pos < src.length) {
      const c = src[pos];
      if (c === '\\') {
        pos++;
        const next = src[pos];
        if (next === '\\') { pos++; star(); readOptArg(); para += '<br>'; continue; }
        if ('%&_#$'.includes(next)) { para += escapeHtml(next); pos++; continue; }
        if (next === '{' || next === '}') { para += next; pos++; continue; }
        if (next === ',' || next === ' ' || next === ';' || next === ':') { para += ' '; pos++; continue; }
        if (next === '-' || next === '/' || next === '@') { pos++; continue; }
        if (next === '[' || next === '(') {
          const close = next === '[' ? '\\]' : '\\)';
          const end = src.indexOf(close, pos);
          const math = src.slice(pos + 1, end < 0 ? src.length : end);
          pos = end < 0 ? src.length : end + 2;
          para += `<code class="latex-math">${escapeHtml(math.trim())}</code>`;
          continue;
        }
        if (ACCENTS[next]) {
          pos++;
          let ch: string | null = null;
          if (src[pos] === '{') { const a = readBraceArg(); ch = a && a.length === 1 ? a : null; if (!ch && a) { para += escapeHtml(a); continue; } }
          else { ch = src[pos]; pos++; }
          para += (ch && ACCENTS[next][ch]) || ch || '';
          continue;
        }
        const name = readCmdName();
        if (!name) continue;
        if (name === 'begin') { const env = readBraceArg() || ''; flush(); html += handleEnv(env); continue; }
        if (name === 'end') { const env = readBraceArg(); if (stopEnv && env === stopEnv) { flush(); return html; } continue; }
        if (name === 'part') {
          star(); readOptArg();
          flush(); html += '<div class="latex-part">' + fragment(arg()) + '</div>';
          continue;
        }
        const r = command(name);
        if (!r) continue;
        if (r.parbreak) { flush(); continue; }
        if (r.block) { flush(); html += r.block; continue; }
        para += r.inline || '';
        continue;
      }
      if (c === '$') {
        const display = src[pos + 1] === '$';
        const start = pos + (display ? 2 : 1);
        const end = src.indexOf(display ? '$$' : '$', start);
        const math = src.slice(start, end < 0 ? src.length : end);
        pos = end < 0 ? src.length : end + (display ? 2 : 1);
        para += `<code class="latex-math">${escapeHtml(math.trim())}</code>`;
        continue;
      }
      if (c === '\n') {
        let j = pos + 1;
        while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
        if (src[j] === '\n') { flush(); while (pos < src.length && /\s/.test(src[pos])) pos++; }
        else { para += ' '; pos++; }
        continue;
      }
      if (c === '`') { if (src[pos + 1] === '`') { para += '“'; pos += 2; } else { para += '‘'; pos++; } continue; }
      if (c === "'") { if (src[pos + 1] === "'") { para += '”'; pos += 2; } else { para += '’'; pos++; } continue; }
      if (c === '-') {
        if (src.startsWith('---', pos)) { para += '—'; pos += 3; }
        else if (src.startsWith('--', pos)) { para += '–'; pos += 2; }
        else { para += '-'; pos++; }
        continue;
      }
      if (c === '<' && src[pos + 1] === '<') { para += '«'; pos += 2; continue; }
      if (c === '>' && src[pos + 1] === '>') { para += '»'; pos += 2; continue; }
      if (c === '~') { para += '&nbsp;'; pos++; continue; }
      if (c === '{' || c === '}') { pos++; continue; }
      para += escapeHtml(c);
      pos++;
    }
    flush();
    return html;
  }

  // A full document shows only its body.
  const body = src.match(/\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/);
  if (body) src = body[1];
  const html = parseBlocks(null, false);
  return { html, notes };
}

// Preview HTML with footnotes listed at the end, ready to show.
export function latexPreviewHtml(src: string) {
  const { html, notes } = latexToHtml(src);
  if (!notes.length) return html;
  return html + '<section class="latex-notes"><h4>Note</h4><ol>' + notes.map((n, i) => `<li id="latex-note-${i}">${n}</li>`).join('') + '</ol></section>';
}

// HTML for the rich-text editor: footnotes become [n] plus a closing list,
// images (which have no address outside the repository) become a mention.
export function latexToEditorHtml(src: string) {
  const { html, notes } = latexToHtml(src);
  let out = html
    .replace(/<sup class="latex-fnref" data-note="(\d+)">\d+<\/sup>/g, (m, i: string) => `[${Number(i) + 1}]`)
    .replace(/<span class="latex-img"><img data-imgpath="([^"]*)"[^>]*><span class="latex-img-label">[^<]*<\/span><\/span>/g, (m, p: string) => `<em>[immagine: ${p}]</em>`)
    .replace(/<div class="latex-part">([\s\S]*?)<\/div>/g, '<h1>$1</h1>')
    .replace(/<div class="latex-input">[\s\S]*?<\/div>/g, '')
    .replace(/<div class="latex-skip"><\/div>/g, '')
    .replace(/<figcaption>([\s\S]*?)<\/figcaption>/g, '<p><em>$1</em></p>')
    .replace(/<\/?figure>/g, '');
  if (notes.length) out += '<h2>Note</h2><ol>' + notes.map(n => `<li><p>${n}</p></li>`).join('') + '</ol>';
  return out;
}

// ---------------------------------------------------------------------------
// Scrivia document (TipTap JSON) → LaTeX
// ---------------------------------------------------------------------------
type Mark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = { type?: string; text?: string; marks?: Mark[]; attrs?: Record<string, unknown>; content?: DocNode[] };

export function escapeLatex(text: string) {
  return text
    .replace(/\\/g, '\u0000')
    .replace(/([{}$&#_%])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u0000/g, '\\textbackslash{}')
    .replace(/…/g, '\\ldots{}');
}

function inline(nodes: DocNode[] = []): string {
  return nodes.map(n => {
    if (n.type === 'hardBreak') return '\\\\\n';
    if (n.type === 'image') return '';
    if (n.type !== 'text' || !n.text) return inline(n.content);
    let out = escapeLatex(n.text);
    for (const m of n.marks || []) {
      if (m.type === 'bold') out = `\\textbf{${out}}`;
      else if (m.type === 'italic') out = `\\textit{${out}}`;
      else if (m.type === 'underline') out = `\\underline{${out}}`;
      else if (m.type === 'code') out = `\\texttt{${out}}`;
      else if (m.type === 'link' && typeof m.attrs?.href === 'string' && /^https?:\/\//.test(m.attrs.href)) out = `\\href{${m.attrs.href.replace(/([%#\\])/g, '\\$1')}}{${out}}`;
    }
    return out;
  }).join('');
}

const HEADINGS = ['chapter', 'section', 'subsection', 'subsubsection', 'paragraph'];

function block(n: DocNode, depth: number, chapterLevel: number): string {
  const children = (nodes: DocNode[] = []) => nodes.map(c => block(c, depth + 1, chapterLevel)).filter(Boolean).join('\n\n');
  switch (n.type) {
    case 'doc': return children(n.content);
    case 'heading': {
      const level = Number(n.attrs?.level) || 1;
      const cmd = HEADINGS[Math.min(HEADINGS.length - 1, Math.max(0, level - chapterLevel))];
      return `\\${cmd}{${inline(n.content)}}`;
    }
    case 'paragraph': {
      const text = inline(n.content).trim();
      if (!text) return '';
      const align = n.attrs?.textAlign;
      if (align === 'center') return `\\begin{center}\n${text}\n\\end{center}`;
      if (align === 'right') return `\\begin{flushright}\n${text}\n\\end{flushright}`;
      return text;
    }
    case 'blockquote': return `\\begin{quote}\n${children(n.content)}\n\\end{quote}`;
    case 'bulletList': case 'orderedList': {
      const env = n.type === 'bulletList' ? 'itemize' : 'enumerate';
      const items = (n.content || []).map(li => '  \\item ' + (li.content || []).map(c => block(c, depth + 1, chapterLevel)).filter(Boolean).join('\n\n').replace(/\n/g, '\n  '));
      return `\\begin{${env}}\n${items.join('\n')}\n\\end{${env}}`;
    }
    case 'codeBlock': return `\\begin{verbatim}\n${(n.content || []).map(c => c.text || '').join('')}\n\\end{verbatim}`;
    case 'horizontalRule': return '\\bigskip\\noindent\\rule{\\textwidth}{0.4pt}\\bigskip';
    case 'image': return '% Immagine non esportata: caricala in images/ e inseriscila con \\includegraphics.';
    case 'table': {
      const rows = (n.content || []).map(r => (r.content || []).map(cell => (cell.content || []).map(c => block(c, depth + 1, chapterLevel)).filter(Boolean).join(' ')));
      const cols = Math.max(1, ...rows.map(r => r.length));
      return `\\begin{center}\n\\begin{tabular}{${'l'.repeat(cols)}}\n\\toprule\n${rows.map(r => r.join(' & ') + ' \\\\').join('\n')}\n\\bottomrule\n\\end{tabular}\n\\end{center}`;
    }
    default: return n.content ? children(n.content) : inline([n]);
  }
}

// chapter: 'chapter' maps H1 to \chapter (book), 'section' maps H1 to \section (article).
export function docToLatex(doc: DocNode, options: { title?: string; top?: 'chapter' | 'section'; standalone?: boolean } = {}) {
  const chapterLevel = options.top === 'section' ? 0 : 1;
  const body = block(doc, 0, chapterLevel).replace(/\n{3,}/g, '\n\n').trim();
  const hasHeading = (doc.content || []).some(n => n.type === 'heading');
  const head = options.title && !hasHeading ? `\\${options.top === 'section' ? 'section' : 'chapter'}{${escapeLatex(options.title)}}\n\n` : '';
  if (!options.standalone) return `% ${options.title ? escapeLatex(options.title).replace(/\n/g, ' ') : 'Documento'} — esportato da Scrivia\n${head}${body}\n`;
  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[italian]{babel}',
    '\\usepackage{booktabs}',
    '\\usepackage{hyperref}',
    options.title ? `\\title{${escapeLatex(options.title)}}` : '',
    '\\date{}',
    '\\begin{document}',
    options.title ? '\\maketitle' : '',
    '',
    block(doc, 0, 0).replace(/\n{3,}/g, '\n\n').trim(),
    '',
    '\\end{document}',
    '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

// ---------------------------------------------------------------------------
// Structure: chapter order from main.tex and outline of a file
// ---------------------------------------------------------------------------
export function texPath(p: string) {
  const clean = p.trim().replace(/^\.\//, '');
  return /\.[a-z]+$/i.test(clean) ? clean : clean + '.tex';
}

export function projectStructure(mainTex: string): StructureItem[] {
  const items: StructureItem[] = [];
  let part = 'Inizio';
  let pending = '';
  for (const raw of mainTex.split('\n')) {
    const line = raw.trim();
    const banner = line.match(/^%\s*PARTE\s+([IVXLC\d]+)\s*[:.-]\s*(.+)$/i);
    if (banner) { pending = 'Parte ' + banner[1].toUpperCase() + ' — ' + latexPlain(banner[2]); continue; }
    if (line.startsWith('%')) continue;
    if (/\\mainmatter\b/.test(line)) part = 'Testo';
    if (/\\backmatter\b/.test(line)) part = 'Fine';
    if (/\\appendix\b/.test(line)) part = 'Appendice';
    const p = line.match(/\\part\*?(?:\[[^\]]*\])?\{([^}]*)\}/);
    if (p) { part = pending && pending.toLowerCase().includes(latexPlain(p[1]).toLowerCase()) ? pending : latexPlain(p[1]); pending = ''; continue; }
    const m = line.match(/^\\(?:input|include)\{([^}]+)\}\s*(?:%\s*(.*))?$/);
    if (!m) continue;
    const path = texPath(m[1]);
    if (path.startsWith('misc/')) continue;
    if (/^parts\//.test(path)) { part = pending || latexPlain(path.replace(/^parts\/|\.tex$/g, '')); pending = ''; continue; }
    if (pending) { part = pending; pending = ''; }
    const comment = latexPlain(m[2] || '');
    items.push({ path, title: comment || path.split('/').pop()!.replace(/\.tex$/, ''), part });
  }
  return items;
}

export function documentOutline(src: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const re = /\\(part|chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  const levels: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const before = src.slice(lineStart, m.index);
    if (/(^|[^\\])%/.test(before)) continue;
    out.push({ level: levels[m[1]], title: latexPlain(m[2]), index: m.index, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

export function firstHeading(src: string) {
  return documentOutline(src).find(i => i.level <= 1)?.title || '';
}

// ---------------------------------------------------------------------------
// Editing helpers (pure: they return the new text and selection)
// ---------------------------------------------------------------------------

// Wraps the selection in \cmd{…}; toggles it off when already wrapped.
export function wrapCommand(text: string, start: number, end: number, cmd: string): Edit {
  const sel = text.slice(start, end);
  const open = '\\' + cmd + '{';
  if (text.slice(Math.max(0, start - open.length), start) === open && text[end] === '}')
    return { text: text.slice(0, start - open.length) + sel + text.slice(end + 1), start: start - open.length, end: end - open.length };
  if (sel.startsWith(open) && sel.endsWith('}')) {
    const inner = sel.slice(open.length, -1);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  return { text: text.slice(0, start) + open + sel + '}' + text.slice(end), start: start + open.length, end: start + open.length + sel.length };
}

// Turns the selected lines (or the current line) into a heading: \section{…}.
export function setHeading(text: string, start: number, end: number, cmd: string): Edit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd < 0) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const existing = line.match(/^\s*\\(?:part|chapter|section|subsection|subsubsection)\*?\{(.*)\}\s*$/);
  const title = existing ? existing[1] : (start === end ? line.trim() : text.slice(start, end).trim()) || 'Titolo';
  const replaced = `\\${cmd}{${title}}`;
  if (start !== end && !existing) {
    const out = text.slice(0, start) + '\n' + replaced + '\n' + text.slice(end);
    return { text: out, start: start + cmd.length + 3, end: start + cmd.length + 3 + title.length };
  }
  const out = text.slice(0, lineStart) + replaced + text.slice(lineEnd);
  return { text: out, start: lineStart + cmd.length + 2, end: lineStart + cmd.length + 2 + title.length };
}

// Wraps the selection in an environment; lists turn each line into an \item.
export function wrapEnvironment(text: string, start: number, end: number, env: string, option = ''): Edit {
  const sel = text.slice(start, end);
  const list = env === 'itemize' || env === 'enumerate';
  const inner = list
    ? (sel.trim() ? sel.split('\n').filter(l => l.trim()).map(l => '  \\item ' + l.trim().replace(/^\\item\s*/, '')).join('\n') : '  \\item ')
    : sel || '';
  const open = `\\begin{${env}}${option}\n`;
  const blockText = open + inner + `\n\\end{${env}}`;
  const ins = insertBlock(text, start, blockText, end);
  const caret = ins.start + open.length + (list && !sel.trim() ? '  \\item '.length : 0);
  return { text: ins.text, start: caret, end: caret + (list && !sel.trim() ? 0 : inner.length) };
}

// Inserts a block isolated by blank lines (a figure glued to a paragraph changes the layout).
export function insertBlock(text: string, pos: number, snippet: string, replaceTo = pos): Edit {
  const before = text.slice(0, pos), after = text.slice(replaceTo);
  const pre = !before.trim() ? '' : /\n\s*\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
  const post = !after.trim() ? '\n' : /^\s*\n\s*\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n';
  const blockText = pre + snippet + post;
  return { text: before + blockText + after, start: pos + pre.length, end: pos + pre.length + snippet.length };
}

// Comments or uncomments the selected lines with %.
export function toggleComment(text: string, start: number, end: number): Edit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', Math.max(end - (end > start && text[end - 1] === '\n' ? 1 : 0), start));
  if (lineEnd < 0) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const commented = lines.every(l => !l.trim() || /^\s*%/.test(l));
  const next = lines.map(l => !l.trim() ? l : commented ? l.replace(/^(\s*)% ?/, '$1') : '% ' + l).join('\n');
  return { text: text.slice(0, lineStart) + next + text.slice(lineEnd), start: lineStart, end: lineStart + next.length };
}

// Safe image name for LaTeX and URLs: no spaces, accents or brackets.
export function sanitizeImageName(name: string, mime = '') {
  const types: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' };
  let ext = '';
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  if (m) { ext = m[1].toLowerCase(); name = name.slice(0, -(m[1].length + 1)); }
  if (ext === 'jpeg') ext = 'jpg';
  if (!/^(png|jpg|gif|webp|svg|pdf)$/.test(ext)) ext = types[mime] || '';
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'immagine';
  return ext ? base + '.' + ext : base;
}

export function figureSnippet(fileName: string, width = 0.8, caption = '', folder = 'images') {
  const w = Math.min(1, Math.max(0.1, width || 0.8));
  const lines = ['\\begin{figure}[htbp]', '    \\centering', `    \\includegraphics[width=${String(+w.toFixed(2))}\\textwidth]{${folder ? folder + '/' : ''}${fileName}}`];
  if (caption.trim()) {
    lines.push(`    \\caption{${escapeLatex(caption.trim())}}`);
    lines.push(`    \\label{fig:${fileName.replace(/\.[^.]+$/, '')}}`);
  }
  lines.push('\\end{figure}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Checks and search
// ---------------------------------------------------------------------------

// Quick check of the mistakes that most often stop a compilation.
export function checkLatex(input: string): LatexIssue[] {
  const issues: LatexIssue[] = [];
  const src = stripComments(input).replace(/\\begin\{verbatim\}[\s\S]*?\\end\{verbatim\}/g, m => m.replace(/[^\n]/g, ' '));
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  const envs: { name: string; index: number }[] = [];
  const open: number[] = [];
  const alignedLines = new Set<number>(); // lines inside tables and formulas, where & is legal
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const env = src.slice(i, i + 80).match(/^\\(begin|end)\s*\{([^}]*)\}/);
      if (!env) { i++; continue; }
      if (env[1] === 'begin') envs.push({ name: env[2], index: i });
      else {
        const last = envs.pop();
        if (!last) issues.push({ line: lineOf(i), message: `\\end{${env[2]}} senza \\begin corrispondente.` });
        else if (last.name !== env[2]) issues.push({ line: lineOf(i), message: `\\end{${env[2]}} chiude \\begin{${last.name}} aperto alla riga ${lineOf(last.index)}.` });
        if (last && /tabular|align|array|matrix|eqnarray|longtable/.test(last.name))
          for (let l = lineOf(last.index); l <= lineOf(i); l++) alignedLines.add(l);
      }
      i += env[0].length - 1;
      continue;
    }
    if (c === '{') open.push(i);
    else if (c === '}') {
      if (!open.length) issues.push({ line: lineOf(i), message: 'Parentesi graffa chiusa in più.' });
      else open.pop();
    }
  }
  for (const i of open.slice(0, 3)) issues.push({ line: lineOf(i), message: 'Parentesi graffa aperta e mai chiusa.' });
  for (const e of envs) issues.push({ line: lineOf(e.index), message: `\\begin{${e.name}} senza \\end{${e.name}}.` });
  // Characters that LaTeX treats as special outside tables and formulas.
  src.split('\n').forEach((raw, n) => {
    const line = raw.replace(/\$[^$]*\$/g, '');
    if (!alignedLines.has(n + 1) && /(^|[^\\])&/.test(line)) issues.push({ line: n + 1, message: 'Carattere & senza \\ davanti: fuori da una tabella scrivi \\&.' });
    if (/(^|[^\\])_/.test(line) && !/\\(includegraphics|input|include|label|ref|pageref|url|href|index|immagine|cite)\b/.test(line)) issues.push({ line: n + 1, message: 'Trattino basso _ senza \\ davanti: fuori dalle formule scrivi \\_.' });
  });
  const seen = new Set<string>();
  return issues.filter(i => { const k = i.line + i.message; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.line - b.line);
}

// Text without commands, for full-text search.
export function latexSearchText(src: string) {
  return latexAccentsToText(stripComments(src));
}

export type SearchHit = { index: number; line: number; snippet: string };
export function searchLatex(src: string, query: string, max = 50): SearchHit[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const hay = src.toLocaleLowerCase();
  const hits: SearchHit[] = [];
  let at = 0;
  while (hits.length < max && (at = hay.indexOf(q, at)) !== -1) {
    const s = Math.max(0, at - 40), e = Math.min(src.length, at + q.length + 40);
    hits.push({ index: at, line: src.slice(0, at).split('\n').length, snippet: (s > 0 ? '…' : '') + src.slice(s, e).replace(/\s+/g, ' ') + (e < src.length ? '…' : '') });
    at += q.length;
  }
  return hits;
}

export function countWords(src: string) {
  const text = latexToHtml(src).html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  return (text.match(/[\p{L}\p{N}’']+/gu) || []).length;
}
