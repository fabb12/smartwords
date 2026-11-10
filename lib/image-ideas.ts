import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { captionStrength, styleCaption } from './image-layout.ts';

// Right-click menu on the page: ideas for an image at the point of the cursor. The AI reads the text around the point
// and either writes a prompt for an image generator or describes a chart/diagram that the browser draws (lib/idea-chart.ts).

export const IDEA_STYLES: [string, string][] = [['auto', 'Automatico'], ['photo', 'Fotografia realistica'], ['illustration', 'Illustrazione'], ['watercolor', 'Acquerello'], ['vector', 'Vettoriale minimale'], ['infographic', 'Infografica'], ['3d', 'Rendering 3D']];
const STYLE_HINT: Record<string, string> = { photo: 'realistic photograph', illustration: 'digital illustration', watercolor: 'watercolor painting', vector: 'minimal flat vector illustration', infographic: 'clean infographic style', '3d': '3D render' };

const clip = (text: string, max: number, end = false) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length <= max ? t : end ? '…' + t.slice(-max) : t.slice(0, max) + '…'; };
const readable = (n: Node) => n.type.name !== 'image' && n.textContent.trim().length > 0;

export type IdeaContext = { text: string; hasText: boolean; block: Node | null };

// What the model needs to understand which concept belongs at the point: the heading above, the passages before and
// after, and the selected text (or the paragraph at the point) as the concept to illustrate.
export function contextAround(doc: Node, from: number, to = from): IdeaContext {
  const blocks: Node[] = []; doc.forEach(node => blocks.push(node));
  if (!blocks.length) return { text: '', hasText: false, block: null };
  const index = Math.min(doc.resolve(Math.min(from, doc.content.size)).index(0), blocks.length - 1), here = blocks[index];
  const selected = from !== to ? doc.textBetween(from, to, '\n').trim() : '';
  let before = '', heading = '';
  for (let i = index - 1; i >= 0 && before.length < 1200; i--) {
    if (!readable(blocks[i])) continue;
    if (blocks[i].type.name === 'heading') { heading = blocks[i].textContent; break; }
    before = blocks[i].textContent + (before ? '\n' + before : '');
  }
  if (!heading && here.type.name === 'heading') heading = here.textContent;
  let after = '';
  for (let i = index + 1; i < blocks.length && after.length < 600; i++) {
    if (!readable(blocks[i])) continue;
    if (blocks[i].type.name === 'heading') break;
    after += (after ? '\n' : '') + blocks[i].textContent;
  }
  const atPoint = selected || (readable(here) && here.type.name !== 'heading' ? here.textContent : '');
  const parts = [heading && `Heading above: ${clip(heading, 160)}`, before && `Passage before the point: ${clip(before, 1200, true)}`,
    atPoint && (selected ? `Selected text, the concept to illustrate: ${clip(atPoint, 1500)}` : `Paragraph at the point: ${clip(atPoint, 1200)}`), after && `Passage after the point: ${clip(after, 600)}`].filter(Boolean);
  return { text: parts.join('\n'), hasText: !!(selected || atPoint || before || after || heading), block: here };
}

// Fields of the request for each mode (the profile is added by the caller).
export function ideaFields(context: string, style = 'auto') {
  return { text: context, ...(STYLE_HINT[style] ? { direction: STYLE_HINT[style] } : {}) };
}

export type PromptIdea = { prompt: string; caption: string; alt: string };
export function parsePromptAnswer(answer: string): PromptIdea | null {
  const start = answer.indexOf('{'), end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(answer.slice(start, end + 1)); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>, one = (v: unknown, max: number) => typeof v === 'string' ? clip(v, max) : '';
  const prompt = typeof r.prompt === 'string' ? r.prompt.replace(/[ \t]+/g, ' ').trim().replace(/^["“]+|["”]+$/g, '') : '';
  if (prompt.length < 20 || prompt.length > 1500) return null;
  return { prompt, caption: one(r.caption, 300).replace(/^["“«]+|["”»]+$/g, '').trim(), alt: one(r.alt, 200) };
}

// The top-level block is found again by identity: unchanged blocks keep their node object across edits elsewhere,
// so the point survives typing while the AI is working.
export function locateBlock(doc: Node, block: Node): number {
  let found = -1;
  doc.forEach((node, offset) => { if (found < 0 && node === block) found = offset; });
  return found;
}

// Puts the image and its caption after the block (an empty paragraph is replaced; an image that already has a caption
// below keeps it: the new figure goes after both). Returns the position after the figure, or null if the block is gone.
export function insertFigure(tr: Transaction, block: Node, image: { src: string; width: number; height: number; alt?: string }, caption: string): number | null {
  const pos = locateBlock(tr.doc, block); if (pos < 0) return null;
  const schema = tr.doc.type.schema;
  const figure = [schema.nodes.image.create(image), styleCaption(schema.nodes.paragraph.create(null, schema.text(caption)), false)];
  const empty = block.type.name === 'paragraph' && block.content.size === 0;
  let from = pos, to = pos + block.nodeSize;
  if (empty) { tr.replaceWith(from, to, figure); return from + figure[0].nodeSize + figure[1].nodeSize; }
  if (block.type.name === 'image') { const next = tr.doc.nodeAt(to); if (next && next.type.name === 'paragraph' && captionStrength(next)) to += next.nodeSize; }
  from = to; tr.insert(from, figure);
  return from + figure[0].nodeSize + figure[1].nodeSize;
}
