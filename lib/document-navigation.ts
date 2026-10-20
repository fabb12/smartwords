import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

export function setParagraphRole(tr: Transaction, level: 0 | 1 | 2 | 3) {
  const { $from, $to } = tr.selection, from = $from.parent.isTextblock ? $from.start() : $from.pos, to = $to.parent.isTextblock ? $to.end() : $to.pos;
  const fontSize = ['18px','38px','28px','22px'][level], schema = tr.doc.type.schema;
  let changed = false;
  tr.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!['paragraph','heading'].includes(node.type.name)) return true;
    if (parent?.type.name !== 'doc') return false;
    changed = true;
    tr.setNodeMarkup(pos, level ? schema.nodes.heading : schema.nodes.paragraph, { ...node.attrs, ...(level ? { level } : {}) });
    if (schema.marks.textStyle) node.descendants((child, offset) => { if (child.isText) tr.addMark(pos + 1 + offset, pos + 1 + offset + child.nodeSize, schema.marks.textStyle.create({ ...child.marks.find(mark => mark.type.name === 'textStyle')?.attrs, fontSize })); });
    return false;
  });
  if (changed && tr.selection.empty && schema.marks.textStyle) {
    const marks = tr.storedMarks || tr.selection.$from.marks();
    tr.setStoredMarks([...marks.filter(mark => mark.type.name !== 'textStyle'), schema.marks.textStyle.create({ ...marks.find(mark => mark.type.name === 'textStyle')?.attrs, fontSize })]);
  }
  return tr;
}

export type OutlineEntry = { pos: number; from: number; to: number; level: number; text: string; parents: number[]; children: boolean };
export function documentOutline(doc: Node, paragraphs = false): OutlineEntry[] {
  const entries: OutlineEntry[] = [], stack: OutlineEntry[] = [];
  doc.descendants((node, pos, parent) => {
    // Table cell paragraphs belong to the table, not the chapter outline.
    if (parent?.type.name !== 'doc') return node.type.name !== 'table';
    const heading = node.type.name === 'heading';
    if (!heading && !(paragraphs && node.type.name === 'paragraph' && node.textContent.trim())) return;
    const level = heading ? Math.max(1,Math.min(6,Number(node.attrs.level)||1)) : 7;
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    const entry = { pos, from: pos + 1, to: pos + node.nodeSize - 1, level, text: node.textContent.trim() || 'Titolo senza testo', parents: stack.map(item => item.pos), children: false };
    if (stack.length) stack.at(-1)!.children = true;
    entries.push(entry); if (heading) stack.push(entry);
    return false;
  });
  return entries;
}
export type DocumentMatch = { from: number; to: number; before: string; text: string; after: string };
export function searchDocument(doc: Node, query: string, limit = 250) {
  const matches: DocumentMatch[] = []; let truncated = false;
  if (!query.trim()) return { matches, truncated };
  const pattern = new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  doc.descendants((block, pos) => {
    if (truncated) return false;
    if (!block.isTextblock) return true;
    let text = ''; const offsets: number[] = [];
    block.descendants((node, offset) => {
      if (node.isText) { for (let i = 0; i < node.text!.length; i++) offsets.push(pos + 1 + offset + i); text += node.text; }
      else if (node.isLeaf) { text += node.type.name === 'hardBreak' ? '\n' : '\ufffc'; offsets.push(pos + 1 + offset); }
    });
    for (const match of text.matchAll(pattern)) {
      if (matches.length === limit) { truncated = true; break; }
      const start = match.index!, end = start + match[0].length;
      matches.push({ from: offsets[start], to: offsets[end - 1] + 1, before: text.slice(Math.max(0, start - 35), start), text: match[0], after: text.slice(end, end + 65) });
    }
    return false;
  });
  return { matches, truncated };
}
