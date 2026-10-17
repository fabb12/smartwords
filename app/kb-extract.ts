'use client';
// Text extraction for knowledge-base files, entirely in the browser.
import { cleanExtractedText } from '../lib/knowledge-base';
import { writingTextFromDocument } from '../lib/writing-memory';

export const KB_ACCEPT = '.pdf,.docx,.odt,.epub,.rtf,.txt,.md,.markdown,.html,.htm,.json,.csv';
export const KB_MAX_FILE = 100_000_000;
const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '');

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div,td,th,br';
function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,header>nav').forEach(n => n.remove());
  doc.querySelectorAll(BLOCKS).forEach(n => n.append('\n'));
  return (doc.body?.textContent || '').replace(/\n\s*\n+/g, '\n\n');
}
function xmlParagraphs(xml: string, tags: string[]): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: string[] = [];
  for (const el of Array.from(doc.getElementsByTagName('*'))) if (tags.includes(el.tagName)) out.push(el.textContent || '');
  return out.join('\n');
}
function rtfText(rtf: string): string {
  return rtf.replace(/\{\\\*[^{}]*\}/g, '').replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\s*\}/g, '')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode((+n + 65536) % 65536))
    .replace(/\\(par|line)\b ?/g, '\n').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
}
async function pdfText(data: ArrayBuffer, progress?: (msg: string) => void): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 2000); i++) {
      if (i % 10 === 0) progress?.(`PDF: pagina ${i} di ${doc.numPages}…`);
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map(it => 'str' in it ? it.str + (it.hasEOL ? '\n' : '') : '').join(''));
    }
  } finally { void doc.destroy(); }
  const text = pages.join('\n\n');
  if (text.replace(/\s/g, '').length < 50) throw new Error('il PDF non contiene testo selezionabile (forse è una scansione).');
  return text;
}
async function zipText(data: ArrayBuffer, kind: 'odt' | 'epub'): Promise<string> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  if (kind === 'odt') { const xml = await zip.file('content.xml')?.async('string'); if (!xml) throw new Error('file ODT non valido.'); return xmlParagraphs(xml, ['text:p', 'text:h']); }
  // EPUB: chapters in reading order (spine of the OPF package), falling back to file order.
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  let files: string[] = [];
  if (opfPath) {
    const opf = await zip.file(opfPath)?.async('string') || '', base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const items = new Map([...opf.matchAll(/<item\b[^>]*>/g)].map(m => [m[0].match(/id="([^"]+)"/)?.[1] || '', m[0].match(/href="([^"]+)"/)?.[1] || '']));
    files = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map(m => items.get(m[1]) || '').filter(Boolean).map(h => base + decodeURIComponent(h));
  }
  if (!files.length) files = Object.keys(zip.files).filter(f => /\.(x?html?)$/i.test(f)).sort();
  const parts: string[] = [];
  for (const f of files) { const html = await zip.file(f)?.async('string'); if (html) parts.push(htmlText(html)); }
  return parts.join('\n\n');
}

export async function extractText(file: File, progress?: (msg: string) => void): Promise<{ text: string; format: string }> {
  if (file.size > KB_MAX_FILE) throw new Error(`«${file.name}» supera ${KB_MAX_FILE / 1_000_000} MB.`);
  const format = ext(file.name);
  let text: string;
  try {
    if (format === 'pdf') text = await pdfText(await file.arrayBuffer(), progress);
    else if (format === 'docx') { const mammoth = await import('mammoth'); text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
    else if (format === 'odt' || format === 'epub') text = await zipText(await file.arrayBuffer(), format);
    else if (format === 'rtf') text = rtfText(await file.text());
    else if (format === 'html' || format === 'htm') text = htmlText(await file.text());
    else if (format === 'json') { const raw = JSON.parse(await file.text()); if (raw?.type !== 'doc') throw new Error('è accettato solo un documento Scrivia (.json).'); text = writingTextFromDocument(raw); }
    else if (format === 'md' || format === 'markdown') text = (await file.text()).replace(/```[\s\S]*?```/g, '').replace(/^#{1,6}\s+/gm, '').replace(/[*_`>]+/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
    else if (format === 'txt' || format === 'csv' || !format) text = await file.text();
    else throw new Error('formato non supportato.');
  } catch (err) { throw new Error(`«${file.name}»: ${(err as Error).message}`); }
  return { text: cleanExtractedText(text), format: format || 'txt' };
}
