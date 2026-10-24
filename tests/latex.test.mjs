import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { checkLatex, countWords, docToLatex, documentOutline, figureSnippet, insertBlock, latexPreviewHtml, latexToEditorHtml, latexToHtml, projectStructure, sanitizeImageName, searchLatex, setHeading, toggleComment, wrapCommand, wrapEnvironment } from '../lib/latex.ts';

const chapter = String.raw`% commento che non deve comparire
\chapter{L'architettura del cervello}
\chapterquote{Siamo fatti per essere efficaci.}{Robert Wright, \textit{The Moral Animal}}

\section{Il sabotatore}
Immaginate una libreria\footnote{Esempio di \textbf{nota}.} --- un luogo ${'``'}tranquillo''.
Il 50\% dei lettori ${'\\`'}e d'accordo~davvero.

\begin{itemize}
  \item Primo punto
  \item Secondo \emph{punto}
\end{itemize}

\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.6\textwidth]{images/foto.png}
  \caption{Una foto}
\end{figure}
`;

test('preview renders headings, footnotes, lists, figures and typography', () => {
  const { html, notes } = latexToHtml(chapter);
  assert.match(html, /<h1>L’architettura del cervello<\/h1>/);
  assert.match(html, /<h2>Il sabotatore<\/h2>/);
  assert.match(html, /latex-epigraph/);
  assert.match(html, /<sup class="latex-fnref" data-note="0">1<\/sup>/);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /<strong>nota<\/strong>/);
  assert.match(html, /—/);
  assert.match(html, /“tranquillo”/);
  assert.match(html, /50% dei lettori è d’accordo/);
  assert.match(html, /<ul><li>\s*Primo punto\s*<\/li><li>\s*Secondo <em>punto<\/em>\s*<\/li><\/ul>/);
  assert.match(html, /<figure>.*data-imgpath="images\/foto.png".*style="width:60%".*<figcaption>Una foto<\/figcaption><\/figure>/s);
  assert.doesNotMatch(html, /commento/);
  assert.match(latexPreviewHtml(chapter), /<section class="latex-notes">/);
});

test('preview escapes HTML and attribute quotes from the source', () => {
  const { html } = latexToHtml('Testo <script>alert(1)</script> \\includegraphics{a" onerror="x.png}');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /" onerror="/);
});

test('a full document shows only its body', () => {
  const { html } = latexToHtml('\\documentclass{article}\\usepackage{x}\\newcommand{\\foo}{bar}\n\\begin{document}\nCiao \\textbf{mondo}\n\\end{document}');
  assert.equal(html, '<p>Ciao <strong>mondo</strong></p>');
});

test('editor HTML turns footnotes and images into plain content', () => {
  const html = latexToEditorHtml(chapter);
  assert.match(html, /libreria\[1\]/);
  assert.match(html, /<h2>Note<\/h2><ol><li><p>Esempio di <strong>nota<\/strong>\.<\/p><\/li><\/ol>/);
  assert.match(html, /\[immagine: images\/foto.png\]/);
  assert.doesNotMatch(html, /data-imgpath/);
});

test('structure follows main.tex with parts and comment titles', () => {
  const main = String.raw`\begin{document}
\input{frontmatter/titlepage}
\input{misc/options}
\mainmatter
% PARTE I: LA MENTE
\input{parts/part1}
\input{content/part1/chapter1}   % L'architettura
%\input{content/vecchio}
\part{Seconda parte}
\include{content/cap2}
\end{document}`;
  const s = projectStructure(main);
  assert.deepEqual(s.map(i => i.path), ['frontmatter/titlepage.tex', 'content/part1/chapter1.tex', 'content/cap2.tex']);
  assert.equal(s[1].title, "L'architettura");
  assert.equal(s[1].part, 'Parte I — LA MENTE');
  assert.equal(s[2].part, 'Seconda parte');
});

test('outline lists headings with their position and skips comments', () => {
  const o = documentOutline('\\chapter{Uno}\n% \\section{No}\ntesto\n\\section*{Due}\n\\subsection[breve]{Tre \\textit{bis}}');
  assert.deepEqual(o.map(i => [i.level, i.title, i.line]), [[1, 'Uno', 1], [2, 'Due', 4], [3, 'Tre bis', 5]]);
});

test('Scrivia documents export to LaTeX', () => {
  const t = text => ({ type: 'text', text });
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Titolo & tesi')] },
    { type: 'paragraph', content: [{ ...t('forte'), marks: [{ type: 'bold' }] }, t(' e '), { ...t('50% corsivo_x'), marks: [{ type: 'italic' }] }] },
    { type: 'heading', attrs: { level: 2 }, content: [t('Argomento')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('uno')] }] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [t('citazione')] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [t('a')] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [t('b')] }] }] }] },
  ] };
  const tex = docToLatex(doc, { title: 'Doc' });
  assert.match(tex, /\\chapter\{Titolo \\& tesi\}/);
  assert.match(tex, /\\textbf\{forte\} e \\textit\{50\\% corsivo\\_x\}/);
  assert.match(tex, /\\section\{Argomento\}/);
  assert.match(tex, /\\begin\{itemize\}\n {2}\\item uno\n\\end\{itemize\}/);
  assert.match(tex, /\\begin\{quote\}\ncitazione\n\\end\{quote\}/);
  assert.match(tex, /\\begin\{tabular\}\{ll\}[\s\S]*a & b \\\\/);
  assert.deepEqual(checkLatex(tex), []);
  const article = docToLatex(doc, { title: 'Doc', standalone: true });
  assert.match(article, /^\\documentclass/);
  assert.match(article, /\\section\{Titolo \\& tesi\}/);
  assert.match(article, /\\subsection\{Argomento\}/);
  assert.match(latexToHtml(article).html, /<h2>Titolo &amp; tesi<\/h2>/);
});

test('formatting commands wrap and unwrap the selection', () => {
  const a = wrapCommand('una parola qui', 4, 10, 'textbf');
  assert.equal(a.text, 'una \\textbf{parola} qui');
  assert.equal(a.text.slice(a.start, a.end), 'parola');
  const b = wrapCommand(a.text, a.start, a.end, 'textbf');
  assert.equal(b.text, 'una parola qui');
  const empty = wrapCommand('ab', 1, 1, 'footnote');
  assert.equal(empty.text, 'a\\footnote{}b');
  assert.equal(empty.start, 11);
});

test('headings, environments, comments and blocks', () => {
  const h = setHeading('riga uno\nTitolo nuovo\naltro', 12, 12, 'section');
  assert.equal(h.text, 'riga uno\n\\section{Titolo nuovo}\naltro');
  assert.equal(setHeading(h.text, 12, 12, 'chapter').text, 'riga uno\n\\chapter{Titolo nuovo}\naltro');
  const l = wrapEnvironment('a\nb', 0, 3, 'itemize');
  assert.equal(l.text, '\\begin{itemize}\n  \\item a\n  \\item b\n\\end{itemize}\n');
  const c = toggleComment('x\ny\nz', 2, 3);
  assert.equal(c.text, 'x\n% y\nz');
  assert.equal(toggleComment(c.text, 2, 5).text, 'x\ny\nz');
  const ins = insertBlock('Paragrafo.\nAltro.', 10, 'BLOCCO');
  assert.equal(ins.text, 'Paragrafo.\n\nBLOCCO\n\nAltro.');
});

test('images get safe names and a figure block', () => {
  assert.equal(sanitizeImageName('Foto Più bella (1).JPEG'), 'Foto_Piu_bella_1.jpg');
  assert.equal(sanitizeImageName('scatto', 'image/png'), 'scatto.png');
  const f = figureSnippet('grafico.png', 0.5, 'Dati 100%');
  assert.match(f, /\\includegraphics\[width=0\.5\\textwidth\]\{images\/grafico\.png\}/);
  assert.match(f, /\\caption\{Dati 100\\%\}/);
  assert.match(f, /\\label\{fig:grafico\}/);
});

test('syntax check reports unbalanced braces and environments', () => {
  const issues = checkLatex('\\textbf{aperta\n\\begin{itemize}\n\\item a\n\\end{enumerate}\nA & B\nnome_file');
  const text = issues.map(i => i.line + ':' + i.message).join('\n');
  assert.match(text, /1:Parentesi graffa aperta/);
  assert.match(text, /4:\\end\{enumerate\} chiude \\begin\{itemize\}/);
  assert.match(text, /5:Carattere &/);
  assert.match(text, /6:Trattino basso/);
  assert.deepEqual(checkLatex('\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}\n\\includegraphics{images/a_b.png} 5\\% \\_ $x_1$'), []);
});

test('search and word count', () => {
  const hits = searchLatex('Uno due\nTRE due', 'due');
  assert.deepEqual(hits.map(h => h.line), [1, 2]);
  assert.equal(countWords('\\chapter{Uno due}\nTre \\textbf{quattro}.% nascosto'), 4);
});

test('the LaTeX template is complete and passes the syntax check', () => {
  const root = new URL('../latex-template/', import.meta.url);
  const main = readFileSync(new URL('main.tex', root), 'utf8');
  for (const item of projectStructure(main)) readFileSync(new URL(item.path, root));
  for (const dir of ['content', 'frontmatter']) for (const f of readdirSync(new URL(dir, root)))
    assert.deepEqual(checkLatex(readFileSync(new URL(dir + '/' + f, root), 'utf8')), [], dir + '/' + f);
  assert.deepEqual(checkLatex(main), []);
  readFileSync(new URL('misc/options.tex', root));
  const workflow = readFileSync(new URL('.github/workflows/build-pdf.yml', root), 'utf8');
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /tag_name: pdf-\$\{\{ inputs.mode \}\}/);
  assert.match(main, /\\isdraftfalse/);
});
