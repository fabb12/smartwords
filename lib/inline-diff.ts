import type { Node } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { wordDiff } from './ai-governor.ts';

// A proposal shown and applied as changes inside the text: unchanged words stay
// where they are, untouched; only what really changes is struck out and replaced.

export type InlineEdit = { from: number; to: number; insert: string };

// Text of from..to with the document position of every character. Line breaks
// and block boundaries read as "\n".
export function textMap(doc: Node, from: number, to: number) {
  let text = ''; const pos: number[] = []; let lastBlock = -1;
  doc.nodesBetween(from, to, (node, at) => {
    if (node.isTextblock) { if (lastBlock >= 0 && text) { text += '\n'; pos.push(at + 1); } lastBlock = at; return true; }
    if (node.isText) {
      const start = Math.max(from, at), end = Math.min(to, at + node.nodeSize);
      for (let p = start; p < end; p++) { text += node.text![p - at]; pos.push(p); }
    } else if (node.isLeaf && node.isInline && at >= from && at < to) { text += node.type.name === 'hardBreak' ? '\n' : ' '; pos.push(at); }
    return true;
  });
  pos.push(to);
  return { text, pos };
}

// Edits that turn from..to into proposal, in document order. null when the two
// texts share too little: then a word-by-word view would only be noise.
export function inlineEdits(doc: Node, from: number, to: number, proposal: string, minShared = 0.2): InlineEdit[] | null {
  const { text, pos } = textMap(doc, from, to);
  const parts = wordDiff(text, proposal);
  const shared = parts.filter(p => p.type === 'same').reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0);
  const total = Math.max(text.replace(/\s/g, '').length, proposal.replace(/\s/g, '').length);
  if (total && shared / total < minShared) return null;
  const edits: InlineEdit[] = []; let at = 0;
  for (const part of parts) {
    if (part.type === 'same') { at += part.text.length; continue; }
    const start = pos[at], last = edits.at(-1);
    if (part.type === 'del') {
      const end = pos[at + part.text.length - 1] + 1;
      if (last && last.to === start && !last.insert) last.to = end; else edits.push({ from: start, to: end, insert: '' });
      at += part.text.length;
    } else if (last && last.to === start) last.insert += part.text;
    else edits.push({ from: start, to: start, insert: part.text });
  }
  return edits;
}

// Applies the edits in place, keeping the marks of the replaced words (bold,
// italic, links…). Returns false when the range spans several paragraphs.
export function applyInlineEdits(tr: Transaction, from: number, to: number, proposal: string): boolean {
  const $from = tr.doc.resolve(from), $to = tr.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;
  const edits = inlineEdits(tr.doc, from, to, proposal, 0);
  if (!edits) return false;
  const schema = tr.doc.type.schema, startStep = tr.steps.length;
  for (const edit of [...edits].reverse()) {
    const node = tr.doc.nodeAt(edit.from), marks = node?.isText && edit.to > edit.from ? node.marks : tr.doc.resolve(edit.from).marks();
    const pieces = edit.insert.split('\n').flatMap((line, i) => [...(i && schema.nodes.hardBreak ? [schema.nodes.hardBreak.create()] : []), ...(line ? [schema.text(line, marks)] : [])]);
    tr.replaceWith(edit.from, edit.to, Fragment.fromArray(pieces));
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.slice(startStep).map(to, 1))));
  return true;
}
