// Files of the LaTeX project template (folder latex-template/): style, build
// settings, PDF workflow and placeholder chapters for an argumentative text.
import main from '../latex-template/main.tex?raw';
import options from '../latex-template/misc/options.tex?raw';
import indexStyle from '../latex-template/misc/italian_index.ist?raw';
import latexmkrc from '../latex-template/latexmkrc?raw';
import workflow from '../latex-template/.github/workflows/build-pdf.yml?raw';
import titlepage from '../latex-template/frontmatter/titlepage.tex?raw';
import copyrightpage from '../latex-template/frontmatter/copyrightpage.tex?raw';
import preface from '../latex-template/frontmatter/preface.tex?raw';
import backpage from '../latex-template/frontmatter/backpage.tex?raw';
import introduzione from '../latex-template/content/introduzione.tex?raw';
import argomenti from '../latex-template/content/argomenti.tex?raw';
import obiezioni from '../latex-template/content/obiezioni.tex?raw';
import conclusione from '../latex-template/content/conclusione.tex?raw';
import { WORKFLOW_PATH } from './latex-github.ts';

export const PDF_WORKFLOW_TEXT = workflow;

export type TemplateOptions = { title?: string; author?: string };

// Metadata of main.tex filled with the user's title and author, when given.
function personalise(text: string, o: TemplateOptions) {
  const esc = (s: string) => s.replace(/([{}$&#_%\\])/g, '\\$1');
  let out = text;
  if (o.title?.trim()) out = out.replace('\\newcommand{\\booktitle}{Titolo del saggio}', `\\newcommand{\\booktitle}{${esc(o.title.trim())}}`);
  if (o.author?.trim()) out = out.replace('\\newcommand{\\authorname}{Nome Cognome}', `\\newcommand{\\authorname}{${esc(o.author.trim())}}`);
  return out;
}

export function templateFiles(o: TemplateOptions = {}): { path: string; content: string }[] {
  return [
    { path: 'main.tex', content: personalise(main, o) },
    { path: 'misc/options.tex', content: options },
    { path: 'misc/italian_index.ist', content: indexStyle },
    { path: 'latexmkrc', content: latexmkrc },
    { path: 'frontmatter/titlepage.tex', content: titlepage },
    { path: 'frontmatter/copyrightpage.tex', content: copyrightpage },
    { path: 'frontmatter/preface.tex', content: preface },
    { path: 'frontmatter/backpage.tex', content: backpage },
    { path: 'content/introduzione.tex', content: introduzione },
    { path: 'content/argomenti.tex', content: argomenti },
    { path: 'content/obiezioni.tex', content: obiezioni },
    { path: 'content/conclusione.tex', content: conclusione },
    { path: 'images/.gitkeep', content: '' },
    { path: WORKFLOW_PATH, content: workflow },
  ];
}

// The template as a .zip, to compile it on the computer (latexmk) or on Overleaf.
export async function templateZip(o: TemplateOptions = {}, extra: { path: string; content: string }[] = []) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const all = new Map(templateFiles(o).map(f => [f.path, f.content]));
  for (const f of extra) all.set(f.path, f.content);
  for (const [path, content] of all) zip.file(path, content);
  return zip.generateAsync({ type: 'blob' });
}
