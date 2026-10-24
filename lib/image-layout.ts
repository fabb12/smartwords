import type { Mark, Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { A4 } from './pagination.ts';
import { FORMULA_FONT, isFormulaText } from './formulas.ts';

// Captions, formulas and image arrangement for the automatic formatting. Everything
// here is deterministic: the AI never sees captions or formulas, so they stay untouched.

export const CAPTION_STYLE = { fontSize: '14px', color: '#5f6368' };
const CONTENT_WIDTH = A4.width - 2 * A4.margin;
const CONTENT_HEIGHT = A4.height - 2 * A4.margin - 24;

// "Figura 3:", "Fig. 2 –", "Foto:", "Tavola IV.", "Fonte: ISTAT", "© Mario Rossi".
const LABEL = /^(?:fig(?:ura|ure)?\.?|foto(?:grafia)?|immagine|img\.?|tav(?:ola)?\.?|illustrazione|grafico|schema|mappa|didascalia|formula|equazione|eq\.?|photo|picture|image|chart|plate|equation)(?:\s*(?:n\.?\s*)?\(?[\dIVXLC]+(?:[.\-–][\dIVXLC]+)?[a-z]?\)?)?\s*[:.\-–—)]\s*/iu;
const CREDIT = /^(?:©|\(c\)\s|fonte\s*:|source\s*:|credits?\s*:|foto\s+di\s|ph\.\s|photo\s+by\s|courtesy\s)/iu;

export type CaptionStrength = 'label' | 'styled' | 'short' | null;

const plain = (node: Node) => node.textContent.replace(/\s+/g, ' ').trim();
function hasOnlyText(node: Node) {
  let ok = true;
  node.descendants(child => { if (child.isLeaf && !child.isText && child.type.name !== 'hardBreak') ok = false; });
  return ok;
}
const isEmpty = (node: Node) => node.type.name === 'paragraph' && !node.textContent.trim() && hasOnlyText(node);
const isImage = (node: Node | undefined) => node?.type.name === 'image';
// A paragraph holding only a formula ("E = mc²", "$a^2+b^2=c^2$  (1)").
export const isFormula = (node: Node | undefined) => !!node && node.type.name === 'paragraph' && hasOnlyText(node) && isFormulaText(node.textContent);
const isFigure = (node: Node | undefined) => isImage(node) || isFormula(node);

// How strongly a paragraph looks like a caption: an explicit label, a typical
// caption look (italic, centered, small), or only a short standalone line.
export function captionStrength(node: Node): CaptionStrength {
  if (node.type.name !== 'paragraph' || !hasOnlyText(node) || isFormula(node)) return null;
  const text = plain(node), words = text ? text.split(' ').length : 0;
  if (!text || text.length > 320) return null;
  if (LABEL.test(text) || CREDIT.test(text)) return 'label';
  if (text.length > 200 || words > 34) return null;
  let chars = 0, italic = 0, small = 0;
  node.descendants(child => {
    if (!child.isText || !child.text?.trim()) return;
    const n = child.text.replace(/\s/g, '').length; chars += n;
    if (child.marks.some(m => m.type.name === 'italic')) italic += n;
    const size = parseFloat(child.marks.find(m => m.type.name === 'textStyle')?.attrs.fontSize || '');
    if (size && size <= 15) small += n;
  });
  if (chars && (italic === chars || small === chars || node.attrs.textAlign === 'center' || /^\(.*\)$/u.test(text))) return 'styled';
  if (text.length <= 120 && words <= 18 && !node.textContent.includes('\n') && !/:$/.test(text)) return 'short';
  return null;
}

export type ImageLayoutOp = {
  kind: 'image' | 'formula';
  image: number;
  size?: { width: number; height: number };
  caption?: { pos: number; side: 'after' | 'before'; label: boolean };
  empties: number[];
};
export type ImageLayoutPlan = { ops: ImageLayoutOp[]; captions: number[]; formulas: number[]; images: number };

type Child = { node: Node; pos: number };

// Finds a caption for every top-level image within from..to, prefers the line
// below the image, and gives images of the same sequence a uniform width.
export function planImageLayout(doc: Node, from = 0, to = doc.content.size): ImageLayoutPlan {
  const children: Child[] = [];
  doc.forEach((node, pos) => children.push({ node, pos }));
  const claimed = new Set<number>(), ops: ImageLayoutOp[] = [];
  const nextFilled = (i: number, step: 1 | -1) => {
    const empties: number[] = []; let j = i + step;
    while (children[j] && isEmpty(children[j].node) && empties.length < 2) { empties.push(children[j].pos); j += step; }
    return { j, empties };
  };
  children.forEach((child, i) => {
    if (!isFigure(child.node)) return;
    const kind = isImage(child.node) ? 'image' : 'formula', op: ImageLayoutOp = { kind, image: child.pos, empties: [] };
    const after = nextFilled(i, 1), below = children[after.j];
    const strength = below && !claimed.has(after.j) ? captionStrength(below.node) : null;
    // A short plain line counts only when nothing else follows it, or another image does.
    const following = children[nextFilled(after.j, 1).j], lone = !following || isImage(following.node);
    // Formulas are often followed by explanations ("dove v è la velocità"): only an explicit label is their caption.
    if (strength && (kind === 'formula' ? strength === 'label' : strength !== 'short' || lone)) {
      claimed.add(after.j); op.caption = { pos: below.pos, side: 'after', label: strength === 'label' }; op.empties = after.empties;
    } else {
      const before = nextFilled(i, -1), above = children[before.j];
      const upper = above && before.j >= 0 && !claimed.has(before.j) ? captionStrength(above.node) : null;
      // Above the image only an explicit label or a typical caption look counts.
      if (upper === 'label' || (kind === 'image' && upper === 'styled' && !isImage(children[before.j - 1]?.node))) {
        claimed.add(before.j); op.caption = { pos: above.pos, side: 'before', label: upper === 'label' }; op.empties = before.empties;
      }
    }
    ops.push(op);
  });

  // Images separated only by captions or empty lines form a sequence: they get
  // the same width (the median, never enlarged), so the page looks ordered.
  const sequences: ImageLayoutOp[][] = [];
  const pictures = ops.filter(op => op.kind === 'image');
  pictures.forEach((op, k) => {
    const prev = pictures[k - 1], last = sequences.at(-1);
    if (prev && last) {
      const end = (o: ImageLayoutOp) => { const node = doc.nodeAt(o.image)!; return Math.max(o.image + node.nodeSize, o.caption?.side === 'after' ? o.caption.pos + doc.nodeAt(o.caption.pos)!.nodeSize : 0); };
      let gap = end(prev), adjacent = true;
      const start = op.caption?.side === 'before' ? Math.min(op.caption.pos, ...op.empties) : op.image;
      while (gap < start) { const node = doc.nodeAt(gap); if (!node || !isEmpty(node)) { adjacent = false; break; } gap += node.nodeSize; }
      if (adjacent) { last.push(op); return; }
    }
    sequences.push([op]);
  });
  for (const sequence of sequences) {
    const sized = sequence.map(op => ({ op, attrs: doc.nodeAt(op.image)!.attrs })).filter(({ attrs }) => Number(attrs.width) > 0 && Number(attrs.height) > 0);
    if (!sized.length) continue;
    const widths = sized.map(({ attrs }) => Math.min(Number(attrs.width), CONTENT_WIDTH)).sort((a, b) => a - b);
    const target = sequence.length > 1 ? widths[Math.floor((widths.length - 1) / 2)] : CONTENT_WIDTH;
    for (const { op, attrs } of sized) {
      const w = Number(attrs.width), h = Number(attrs.height);
      const ratio = Math.min(1, target / w, CONTENT_HEIGHT / h);
      const size = { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
      if (size.width !== w || size.height !== h) op.size = size;
    }
  }

  const inScope = (op: ImageLayoutOp) => {
    const image = doc.nodeAt(op.image)!, overlaps = (a: number, b: number) => a < to && b > from;
    return overlaps(op.image, op.image + image.nodeSize) || (!!op.caption && overlaps(op.caption.pos, op.caption.pos + doc.nodeAt(op.caption.pos)!.nodeSize));
  };
  const kept = ops.filter(inScope).filter(op => op.kind === 'formula' || op.caption || op.size || op.empties.length);
  return { ops: kept, captions: kept.flatMap(op => op.caption ? [op.caption.pos] : []), formulas: kept.filter(op => op.kind === 'formula').map(op => op.image), images: ops.filter(inScope).filter(op => op.kind === 'image').length };
}

// Caption look: centered, small, muted, italic; an explicit "Figura 2:" label in bold.
export function styleCaption(node: Node, label: boolean): Node {
  const schema = node.type.schema, italic = schema.marks.italic, bold = schema.marks.bold, textStyle = schema.marks.textStyle;
  const prefix = label ? (LABEL.exec(node.textContent.trimStart())?.[0].trimEnd().length || 0) + (node.textContent.length - node.textContent.trimStart().length) : 0;
  const parts: Node[] = []; let at = 0;
  node.forEach(child => {
    if (!child.isText) { parts.push(child); at += child.nodeSize; return; }
    const text = child.text!;
    const pieces = prefix > at && prefix < at + text.length ? [text.slice(0, prefix - at), text.slice(prefix - at)] : [text];
    let offset = at;
    for (const piece of pieces) {
      if (!piece) continue;
      const isLabel = offset < prefix;
      let marks: readonly Mark[] = child.marks.filter(m => m.type !== textStyle && m.type !== bold && m.type !== italic);
      const own = child.marks.find(m => m.type === textStyle)?.attrs || {};
      if (textStyle) marks = textStyle.create({ ...own, ...CAPTION_STYLE }).addToSet(marks);
      if (isLabel && bold) marks = bold.create().addToSet(marks);
      else if (italic) marks = italic.create().addToSet(marks);
      parts.push(schema.text(piece, marks));
      offset += piece.length;
    }
    at += text.length;
  });
  const attrs = 'textAlign' in node.attrs ? { ...node.attrs, textAlign: 'center' } : node.attrs;
  return node.type.create(attrs, parts, node.marks);
}

// Formula look: its own centered line in a mathematical typeface, words untouched.
export function styleFormula(node: Node): Node {
  const schema = node.type.schema, textStyle = schema.marks.textStyle, drop = [schema.marks.bold, schema.marks.highlight].filter(Boolean);
  const parts: Node[] = [];
  node.forEach(child => {
    if (!child.isText || !textStyle) { parts.push(child); return; }
    const own = child.marks.find(m => m.type === textStyle)?.attrs || {};
    parts.push(child.mark(textStyle.create({ ...own, fontFamily: FORMULA_FONT, fontSize: '20px', color: null }).addToSet(child.marks.filter(m => m.type !== textStyle && !drop.includes(m.type)))));
  });
  const attrs = 'textAlign' in node.attrs ? { ...node.attrs, textAlign: 'center' } : node.attrs;
  return node.type.create(attrs, parts, node.marks);
}

// Applies a plan computed on an earlier document: map translates its positions
// (for example after the AI replacements in the same transaction).
export function applyImageLayout(tr: Transaction, ops: ImageLayoutOp[], map: (pos: number) => number = pos => pos): Transaction {
  const mapped = ops.map(op => ({ ...op, image: map(op.image), caption: op.caption && { ...op.caption, pos: map(op.caption.pos) }, empties: op.empties.map(map) }));
  const start = (op: ImageLayoutOp) => Math.min(op.image, op.caption?.pos ?? Infinity, ...op.empties);
  for (const op of mapped.sort((a, b) => start(b) - start(a))) {
    const image = tr.doc.nodeAt(op.image);
    if (op.kind === 'formula' ? !isFormula(image ?? undefined) : !isImage(image ?? undefined)) continue;
    if (op.kind === 'formula') tr.replaceWith(op.image, op.image + image!.nodeSize, styleFormula(image!));
    if (op.size) tr.setNodeMarkup(op.image, undefined, { ...image!.attrs, ...op.size });
    const caption = op.caption && tr.doc.nodeAt(op.caption.pos);
    const valid = caption && caption.type.name === 'paragraph';
    const empties = op.empties.filter(pos => { const node = tr.doc.nodeAt(pos); return node && isEmpty(node); }).sort((a, b) => b - a);
    if (valid && op.caption!.side === 'after') {
      tr.replaceWith(op.caption!.pos, op.caption!.pos + caption.nodeSize, styleCaption(caption, op.caption!.label));
      for (const pos of empties) tr.delete(pos, pos + tr.doc.nodeAt(pos)!.nodeSize);
    } else if (valid) {
      tr.insert(op.image + image!.nodeSize, styleCaption(caption, op.caption!.label));
      for (const pos of empties) tr.delete(pos, pos + tr.doc.nodeAt(pos)!.nodeSize);
      tr.delete(op.caption!.pos, op.caption!.pos + caption.nodeSize);
    }
  }
  return tr;
}

export function describeImageLayout(plan: ImageLayoutPlan): string {
  if (!plan.ops.length) return '';
  const parts: string[] = [];
  const formulas = plan.formulas.length;
  const n = plan.captions.length, moved = plan.ops.filter(op => op.caption?.side === 'before').length, sized = plan.ops.filter(op => op.size).length;
  if (n) parts.push(n === 1 ? '1 didascalia riconosciuta e messa sotto' : `${n} didascalie riconosciute e messe sotto`);
  if (moved) parts.push(moved === 1 ? '1 spostata da sopra a sotto' : `${moved} spostate da sopra a sotto`);
  if (formulas) parts.push(formulas === 1 ? '1 formula centrata su una riga propria' : `${formulas} formule centrate su righe proprie`);
  if (sized) parts.push(sized === 1 ? '1 immagine ridimensionata' : `${sized} immagini allineate alla stessa larghezza`);
  return parts.join(', ') + '.';
}
