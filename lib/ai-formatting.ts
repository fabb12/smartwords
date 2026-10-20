import type { JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

// The model can describe a small set of semantic formatting choices. We build
// editor JSON ourselves: HTML, links, images, CSS and scripts are never interpreted.
function inline(text: string, depth = 0): JSONContent[] {
  const out: JSONContent[] = []; let at = 0;
  if (depth >= 3) return text ? [{ type: 'text', text }] : [];
  while (at < text.length) {
    const start = text.indexOf('*', at);
    if (start < 0) { out.push({ type: 'text', text: text.slice(at) }); break; }
    if (start > at) out.push({ type: 'text', text: text.slice(at, start) });
    const marker = text.startsWith('***', start) ? '***' : text.startsWith('**', start) ? '**' : '*', end = text.indexOf(marker, start + marker.length);
    const body = end >= 0 ? text.slice(start + marker.length, end) : '';
    if (end < 0 || !body.trim() || /^\s|\s$/.test(body)) { out.push({ type: 'text', text: marker }); at = start + marker.length; continue; }
    const marks = marker.length === 3 ? [{ type: 'bold' }, { type: 'italic' }] : [{ type: marker.length === 2 ? 'bold' : 'italic' }];
    out.push(...inline(body, depth + 1).map(n => ({ ...n, marks: [...(n.marks || []), ...marks] })));
    at = end + marker.length;
  }
  return out;
}
function plain(node: JSONContent): string {
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(plain).join(['bulletList', 'orderedList'].includes(node.type || '') ? '\n' : '');
}
export function parseAiFormatting(answer: string, preserveEdges = false): { content: JSONContent[]; text: string; rich: boolean } {
  const lines = answer.replace(/\r\n?/g, '\n').split('\n'), content: JSONContent[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    content.push({ type: 'paragraph', content: paragraph.flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...inline(line)]) });
    paragraph = [];
  };
  for (const line of lines) {
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{1,3})[ \t]+(.+)$/.exec(line);
    const bullet = /^[ \t]*[-+*][ \t]+(.+)$/.exec(line), ordered = /^[ \t]*(\d+)[.)][ \t]+(.+)$/.exec(line);
    if (heading) { flush(); content.push({ type: 'heading', attrs: { level: heading[1].length }, content: inline(heading[2]) }); }
    else if (bullet || ordered) {
      flush(); const type = bullet ? 'bulletList' : 'orderedList', last = content.at(-1);
      const item = { type: 'listItem', content: [{ type: 'paragraph', content: inline(bullet ? bullet[1] : ordered![2]) }] };
      if (last?.type === type) last.content!.push(item);
      else content.push({ type, ...(ordered ? { attrs: { start: Math.max(1, Math.min(100000, Number(ordered[1]))) } } : {}), content: [item] });
    } else paragraph.push(line);
  }
  flush();
  if (preserveEdges && content.length) {
    if (/^\n\n/.test(answer)) content.unshift({ type: 'paragraph' });
    else if (/^\n/.test(answer) && content[0].type === 'paragraph') content[0].content!.unshift({ type: 'hardBreak' });
    if (/\n\n$/.test(answer)) content.push({ type: 'paragraph' });
    else if (/\n$/.test(answer) && content.at(-1)!.type === 'paragraph') content.at(-1)!.content!.push({ type: 'hardBreak' });
  }
  const richNode = (n: JSONContent): boolean => n.type !== 'text' && n.type !== 'paragraph' || !!n.marks?.length || !!n.content?.some(richNode);
  return { content, text: content.map(plain).join('\n\n'), rich: content.length > 1 || content.some(richNode) };
}

// Open paragraph edges join the untouched prefix/suffix. Semantic block nodes
// (headings/lists) replace a whole selected text block when that is the scope.
export function replaceAiFormatting(tr: Transaction, from: number, to: number, content: JSONContent[]): Transaction {
  if (!content.length) return tr;
  const $from = tr.doc.resolve(from), $to = tr.doc.resolve(to);
  const inherited = (tr.storedMarks || (from < to && $from.nodeAfter?.isText ? $from.nodeAfter.marks : $from.marks())).filter(m => m.type.name === 'textStyle');
  const inherit = (n: JSONContent): JSONContent => {
    if (n.type === 'text') {
      const marks = [...inherited.map(m => m.toJSON()), ...(n.marks || [])];
      return { ...n, marks: marks.filter((m, i) => marks.findIndex(other => other.type === m.type) === i) };
    }
    return { ...n, ...(n.content ? { content: n.content.map(inherit) } : {}) };
  };
  const nodes = content.map(n => tr.doc.type.schema.nodeFromJSON(inherit(n)));
  let openStart = nodes[0].type.name === 'paragraph' ? 1 : 0, openEnd = nodes.at(-1)!.type.name === 'paragraph' ? 1 : 0;
  if ($from.sameParent($to) && $from.parent.isTextblock && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size
    && (nodes[0].type.name !== 'paragraph' || nodes.at(-1)!.type.name !== 'paragraph')) {
    from = $from.before(); to = $to.after(); openStart = 0; openEnd = 0;
  }
  const beforeSteps = tr.steps.length;
  tr.replaceRange(from, to, new Slice(Fragment.fromArray(nodes), openStart, openEnd));
  if (tr.steps.length > beforeSteps) {
    const last = tr.mapping.maps.at(-1)!; let end = from;
    last.forEach((_a, _b, _c, newEnd) => { end = newEnd; });
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
  }
  return tr.scrollIntoView();
}
