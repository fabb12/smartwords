import type { JSONContent } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { parseAiFormatting } from './ai-formatting.ts';

export type FormatRange = { from: number; to: number; text: string };
export type FormatReplacement = FormatRange & { content: JSONContent[] };

// Group adjacent prose blocks, but never consume images, tables or code as plain
// text. Long paragraphs are divided at a word boundary. All coordinates remain
// relative to the original document until the complete proposal is accepted.
export function formatRanges(doc: Node, from: number, to: number, limit = 6000) {
  const ranges: (FormatRange & { top: boolean })[] = []; let skipped = 0;
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isTextblock) return;
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
  const parsed = parseAiFormatting(answer);
  if (!parsed.content.length || words(parsed.text) !== words(range.text))
    throw new Error('L’AI ha cambiato parole o punteggiatura: la proposta di sola formattazione è stata scartata. Il documento è rimasto invariato.');

  // Preserve links, code and typeface data character by character. Only semantic
  // emphasis and block layout come from the model, never new wording or URLs.
  const original: NonNullable<JSONContent['marks']>[] = [];
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isText) return;
    const text = node.text!.slice(Math.max(0, range.from - pos), Math.min(node.text!.length, range.to - pos));
    const marks = node.marks.filter(m => ['textStyle','link','code','subscript','superscript'].includes(m.type.name)).map(m => m.toJSON());
    for (const char of text) if (!/\s/u.test(char)) original.push(marks);
  });
  let at = 0, previous: NonNullable<JSONContent['marks']> = [];
  const restore = (node: JSONContent): JSONContent[] => {
    if (node.type !== 'text') return [{ ...node, ...(node.content ? { content: node.content.flatMap(restore) } : {}) }];
    const result: JSONContent[] = [];
    for (const char of node.text || '') {
      const marks = /\s/u.test(char) ? previous : original[at++] || [];
      previous = marks;
      const combined = [...(node.marks || []), ...marks], last = result.at(-1);
      if (last && JSON.stringify(last.marks) === JSON.stringify(combined)) last.text += char;
      else result.push({ type: 'text', text: char, marks: combined });
    }
    return result;
  };
  const content = parsed.content.flatMap(restore);
  // Keep the separator where a selected range or page ends inside a paragraph.
  const left = doc.textBetween(Math.max(0, range.from - 1), range.from), right = doc.textBetween(range.to, Math.min(doc.content.size, range.to + 1));
  if (/\S$/.test(left) && /^\s/.test(range.text) && !/^\s/.test(parsed.text) && content[0].type === 'paragraph')
    content[0].content!.unshift({ type: 'text', text: ' ' });
  if (/\S/.test(right) && /\s$/.test(range.text) && !/\s$/.test(parsed.text) && content.at(-1)!.type === 'paragraph')
    content.at(-1)!.content!.push({ type: 'text', text: ' ' });
  return { ...range, content };
}
