import type { JSONContent } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { parseFormatPlan } from './format-plan.ts';
import { parseAiFormatting } from './ai-formatting.ts';
import { applyTypography, headingTypography } from './ai-typography.ts';

export type FormatRange = { from: number; to: number; text: string };
export type FormatReplacement = FormatRange & { content: JSONContent[] };

// Group adjacent prose blocks, but never consume images, tables or code as plain
// text. Long paragraphs are divided at a word boundary. All coordinates remain
// relative to the original document until the complete proposal is accepted.
// exclude lists block positions kept away from the model (recognized captions).
export function formatRanges(doc: Node, from: number, to: number, limit = 6000, exclude: ReadonlySet<number> = new Set()) {
  const ranges: (FormatRange & { top: boolean })[] = []; let skipped = 0;
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isTextblock) return;
    if (exclude.has(pos)) return false;
    if (node.type.name === 'codeBlock') { skipped++; return false; }
    let atom = false; node.descendants(child => { if (child.isLeaf && !child.isText && child.type.name !== 'hardBreak') atom = true; });
    if (atom) { skipped++; return false; }
    const start = Math.max(from, pos + 1), end = Math.min(to, pos + node.nodeSize - 1), top = parent?.type.name === 'doc';
    if (start > end) return false;
    let cursor = start;
    do {
      let next = Math.min(end, cursor + limit);
      if (next < end) {
        const floor = Math.max(cursor + 1, next - 500);
        while (next > floor && !/\s/u.test(doc.textBetween(next - 1, next, '\n\n', '\n'))) next--;
      }
      const text = doc.textBetween(cursor, next, '\n\n', '\n'), last = ranges.at(-1);
      if (top && last?.top && last.to + 2 === cursor && next - last.from <= limit) {
        last.to = next; last.text = doc.textBetween(last.from, next, '\n\n', '\n');
      } else ranges.push({ from: cursor, to: next, text, top });
      cursor = next;
    } while (cursor < end);
    return false;
  });
  return { ranges: ranges.filter(r => r.text.trim()).map(({ from, to, text }) => ({ from, to, text })), skipped };
}

const words = (text: string) => (text.match(/[\p{L}\p{M}\p{N}]+|[^\s]/gu) || []).join('\u0000');

export function formatReplacement(doc: Node, range: FormatRange, answer: string): FormatReplacement {
  return restoreFormatting(doc, range, parseAiFormatting(answer));
}

export function formatPlanReplacement(doc: Node, range: FormatRange, answer: string): FormatReplacement {
  return restoreFormatting(doc, range, { content: parseFormatPlan(range.text, answer), text: range.text }, false);
}

function restoreFormatting(doc: Node, range: FormatRange, parsed: {content: JSONContent[]; text: string}, promote = true): FormatReplacement {
  // Proposed titles are the only words the model may add; everything else must match.
  const kept = parsed.content.filter(node => !node.proposed).map(node => plainText(node)).join('\n\n');
  if (!parsed.content.some(node => !node.proposed) || words(kept) !== words(range.text))
    throw new Error('L’AI ha cambiato parole o punteggiatura: la proposta di sola formattazione è stata scartata. Il documento è rimasto invariato.');

  // Preserve links and non-visual marks character by character. Typeface may be
  // retained, but old sizes/colors must not override the AI's new hierarchy.
  const original: NonNullable<JSONContent['marks']>[] = [];
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isText) return;
    const text = node.text!.slice(Math.max(0, range.from - pos), Math.min(node.text!.length, range.to - pos));
    const marks = node.marks.filter(m => ['textStyle','link','code','subscript','superscript'].includes(m.type.name)).map(m => m.toJSON());
    for (const char of text) if (!/\s/u.test(char)) original.push(marks);
  });
  let at = 0, previous: NonNullable<JSONContent['marks']> = [];
  const restore = (node: JSONContent, heading = false): JSONContent[] => {
    if (node.proposed) return [node];
    if (node.type !== 'text') return [{ ...node, ...(node.content ? { content: node.content.flatMap(child => restore(child, heading || node.type === 'heading')) } : {}) }];
    const result: JSONContent[] = [];
    for (const char of node.text || '') {
      const marks = /\s/u.test(char) ? previous : original[at++] || [];
      previous = marks;
      const retained = marks.find(m => m.type === 'textStyle')?.attrs || {}, chosen = node.marks?.find(m => m.type === 'textStyle')?.attrs || {};
      const combined = [...(node.marks || []).filter(m => m.type !== 'textStyle'), ...marks.filter(m => m.type !== 'textStyle'), { type: 'textStyle', attrs: { ...retained, fontSize: heading ? chosen.fontSize : '18px', color: null, ...chosen } }], last = result.at(-1);
      if (last && JSON.stringify(last.marks) === JSON.stringify(combined)) last.text += char;
      else result.push({ type: 'text', text: char, marks: combined });
    }
    return result;
  };
  const content = (promote ? promoteHeadings(parsed.content, range.from <= 1) : parsed.content).flatMap(node => restore(node)).map(headingCase);
  // Keep the separator where a selected range or page ends inside a paragraph.
  const left = doc.textBetween(Math.max(0, range.from - 1), range.from), right = doc.textBetween(range.to, Math.min(doc.content.size, range.to + 1));
  if (/\S$/.test(left) && /^\s/.test(range.text) && !/^\s/.test(parsed.text) && content[0].type === 'paragraph')
    content[0].content!.unshift({ type: 'text', text: ' ' });
  if (/\S/.test(right) && /\s$/.test(range.text) && !/\s$/.test(parsed.text) && content.at(-1)!.type === 'paragraph')
    content.at(-1)!.content!.push({ type: 'text', text: ' ' });
  return { ...range, content };
}

// Case follows importance: the main title in capitals, the other headings with
// a capital initial. Body text is never touched. A character whose capital form
// has a different length (for example ß) is left as it is, so marks stay aligned.
export function headingCase(node: JSONContent): JSONContent {
  if (node.type !== 'heading') return node;
  const level = Number(node.attrs?.level) || 2, upper = level === 1 && plainText(node).trim().split(/\s+/).length <= 10;
  let first = true;
  const cased = (text: string) => [...text].map(char => {
    const big = char.toLocaleUpperCase('it');
    if (/[\p{L}\p{N}]/u.test(char) && first) { first = false; return big.length === char.length ? big : char; }
    return upper && big.length === char.length ? big : char;
  }).join('');
  const walk = (child: JSONContent): JSONContent => child.type === 'text' ? { ...child, text: cased(child.text || '') } : { ...child, ...(child.content ? { content: child.content.map(walk) } : {}) };
  return walk(node);
}

// Proposed titles stay in the proposal until accepted; the editor receives
// ordinary headings, or none at all when the writer leaves them out.
export function withProposedTitles(content: JSONContent[], include: boolean): JSONContent[] {
  return content.filter(node => include || !node.proposed).map(node => { if (!node.proposed) return node; const rest = { ...node }; delete rest.proposed; return rest; });
}

const plainText = (node: JSONContent): string => node.type === 'hardBreak' ? '\n' : node.type === 'text' ? node.text || '' : (node.content || []).map(plainText).join(['bulletList','orderedList','listItem'].includes(node.type || '') ? '\n' : '');
const isBold = (node: JSONContent) => node.type === 'text' && !!node.marks?.some(m => m.type === 'bold');

// Models often leave obvious title lines as plain or fully bold paragraphs.
// A short standalone line without final punctuation that introduces a longer
// block is promoted to a heading; dialogue, verses and sentences are left alone.
export function promoteHeadings(content: JSONContent[], documentStart = false): JSONContent[] {
  const levels = content.filter(n => n.type === 'heading').map(n => Number(n.attrs?.level) || 2);
  return content.map((node, i) => {
    if (node.type !== 'paragraph' || !node.content?.length || node.content.some(c => c.type !== 'text')) return node;
    const text = plainText(node).trim(), next = content[i + 1], nextText = next ? plainText(next).trim() : '';
    if (!text || text.length > 90 || text.split(/\s+/).length > 12 || !/^[\p{Lu}\p{N}]/u.test(text)) return node;
    const allBold = node.content.every(c => !c.text?.trim() || isBold(c));
    const introduces = !!next && ['paragraph', 'bulletList', 'orderedList'].includes(next.type || '') && nextText.length >= Math.max(60, text.length * 2);
    const titleLike = allBold ? !/[.,;]$/.test(text) && (introduces || !next) : introduces && !/[.,;:!?…"”»)\]]$/.test(text);
    if (!titleLike) return node;
    const level = documentStart && i === 0 && !levels.includes(1) ? 1 : /^\d+\.\d+/.test(text) ? 3 : 2;
    const children = node.content.map(c => ({ ...c, marks: c.marks?.filter(m => m.type !== 'bold') })).map(c => c.marks?.length ? c : { type: 'text', text: c.text });
    return applyTypography({ type: 'heading', attrs: { level }, content: children }, headingTypography(level));
  });
}

// Headings already present in the source, so the model keeps a coherent hierarchy.
export function sourceHeadings(doc: Node, range: FormatRange) {
  const found: string[] = [];
  doc.nodesBetween(range.from, range.to, node => { if (node.type.name === 'heading') found.push('#'.repeat(Number(node.attrs.level) || 2) + ' ' + node.textContent.slice(0, 60)); return node.isBlock && !node.isTextblock; });
  return found;
}

export type FormatSummary = {
  outline: { level: number; text: string; paragraphs: number; proposed?: boolean }[];
  headings: number; proposed: number; paragraphs: number; lists: number; concepts: string[]; highlights: string[];
};

// Compact description of a proposal: structure, counts and emphasized concepts,
// so the side panel stays short even for a whole document.
export function summarizeFormatting(parts: { content: JSONContent[] }[]): FormatSummary {
  const summary: FormatSummary = { outline: [], headings: 0, proposed: 0, paragraphs: 0, lists: 0, concepts: [], highlights: [] };
  let intro = 0;
  const collect = (node: JSONContent) => {
    if (node.type === 'text') {
      const text = node.text?.trim(), list = node.marks?.some(m => m.type === 'highlight') ? summary.highlights : node.marks?.some(m => m.type === 'bold') ? summary.concepts : null;
      if (text && list && !list.includes(text)) list.push(text.length > 80 ? text.slice(0, 77) + '…' : text);
      return;
    }
    node.content?.forEach(collect);
  };
  for (const node of parts.flatMap(part => part.content)) {
    if (node.type === 'heading') { if (node.proposed) summary.proposed++; else summary.headings++; summary.outline.push({ level: Number(node.attrs?.level) || 2, text: plainText(node).trim(), paragraphs: 0, ...(node.proposed ? { proposed: true } : {}) }); continue; }
    if (node.type === 'bulletList' || node.type === 'orderedList') summary.lists++;
    else if (node.type === 'paragraph' && plainText(node).trim()) { summary.paragraphs++; const last = summary.outline.at(-1); if (last) last.paragraphs++; else intro++; }
    collect(node);
  }
  if (intro && summary.outline.length) summary.outline.unshift({ level: 0, text: '', paragraphs: intro });
  return summary;
}
