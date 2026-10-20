import type { JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { applyTypography, headingTypography, typographyDirective, type Typography } from './ai-typography.ts';

export const HIGHLIGHT = { type: 'highlight', attrs: { color: '#e0e8b9' } };

// The model can describe a small set of semantic formatting choices. We build
// editor JSON ourselves: HTML, links, images, CSS and scripts are never interpreted.
function inline(text: string, depth = 0): JSONContent[] {
  const out: JSONContent[] = []; let at = 0;
  if (depth >= 3) return text ? [{ type: 'text', text }] : [];
  while (at < text.length) {
    const start = Math.min(...['*', '_', '=='].map(m => text.indexOf(m, at)).map(i => i < 0 ? Infinity : i));
    if (start === Infinity) { out.push({ type: 'text', text: text.slice(at) }); break; }
    if (start > at) out.push({ type: 'text', text: text.slice(at, start) });
    const char = text[start];
    // ==text== marks the single most important idea of a section.
    if (char === '=') {
      const end = text.indexOf('==', start + 2), body = end >= 0 ? text.slice(start + 2, end) : '';
      if (end < 0 || !body.trim() || /^[\s=]|[\s=]$/.test(body)) { out.push({ type: 'text', text: '==' }); at = start + 2; continue; }
      out.push(...inline(body, depth + 1).map(n => ({ ...n, marks: [...(n.marks || []), HIGHLIGHT] })));
      at = end + 2; continue;
    }
    // An underscore inside an identifier is literal, not italic Markdown.
    if (char === '_' && start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) { out.push({ type: 'text', text: char }); at = start + 1; continue; }
    const marker = text.startsWith(char.repeat(3), start) ? char.repeat(3) : text.startsWith(char.repeat(2), start) ? char.repeat(2) : char, end = text.indexOf(marker, start + marker.length);
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
  answer = answer.replace(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i, '$1');
  const lines = answer.replace(/\r\n?/g, '\n').split('\n'), content: JSONContent[] = [];
  let pendingStyle: Typography | null = null, paragraphStyle: Typography | null = null;
  let paragraph: string[] = [];
  const styled = (node: JSONContent, style: Typography | null) => style ? applyTypography(node, style) : node;
  const flush = () => {
    if (!paragraph.length) return;
    content.push(styled({ type: 'paragraph', content: paragraph.flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...inline(line)]) }, paragraphStyle));
    paragraph = []; paragraphStyle = null;
  };
  for (const line of lines) {
    if (!line.trim()) { flush(); continue; }
    const directive = typographyDirective(line);
    if (directive) { flush(); pendingStyle = directive; continue; }
    const heading = /^(#{1,3})[ \t]+(.+)$/.exec(line);
    const bullet = /^[ \t]*[-+*][ \t]+(.+)$/.exec(line), ordered = /^[ \t]*(\d+)[.)][ \t]+(.+)$/.exec(line);
    if (heading) { flush(); content.push(styled({ type: 'heading', attrs: { level: heading[1].length }, content: inline(heading[2]) }, { ...headingTypography(heading[1].length), ...pendingStyle })); pendingStyle = null; }
    else if (bullet || ordered) {
      flush(); const type = bullet ? 'bulletList' : 'orderedList', last = content.at(-1);
      const item = styled({ type: 'listItem', content: [{ type: 'paragraph', content: inline(bullet ? bullet[1] : ordered![2]) }] }, pendingStyle); pendingStyle = null;
      if (last?.type === type) last.content!.push(item);
      else content.push({ type, ...(ordered ? { attrs: { start: Math.max(1, Math.min(100000, Number(ordered[1]))) } } : {}), content: [item] });
    } else { if (!paragraph.length) { paragraphStyle = pendingStyle; pendingStyle = null; } paragraph.push(line); }
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
export function replaceAiFormatting(tr: Transaction, from: number, to: number, content: JSONContent[], inheritStyle = true): Transaction {
  if (!content.length) return tr;
  const $from = tr.doc.resolve(from), $to = tr.doc.resolve(to);
  const inherited = inheritStyle ? (tr.storedMarks || (from < to && $from.nodeAfter?.isText ? $from.nodeAfter.marks : $from.marks())).filter(m => m.type.name === 'textStyle') : [];
  const inherit = (n: JSONContent): JSONContent => {
    if (n.type === 'text') {
      const marks = n.marks || [], own = marks.find(m => m.type === 'textStyle');
      const attrs = { ...inherited[0]?.attrs, ...own?.attrs };
      return { ...n, marks: [...marks.filter(m => m.type !== 'textStyle'), ...(own || inherited.length ? [{ type: 'textStyle', attrs }] : [])] };
    }
    return { ...n, ...(n.content ? { content: n.content.map(inherit) } : {}) };
  };
  const nodes = content.map(n => tr.doc.type.schema.nodeFromJSON(inherit(n)));
  let openStart = nodes[0].type.name === 'paragraph' ? 1 : 0, openEnd = nodes.at(-1)!.type.name === 'paragraph' ? 1 : 0;
  if ($from.parent.isTextblock && $from.parentOffset === 0 && (nodes[0].type.name !== 'paragraph' || $from.parent.type.name !== 'paragraph')) {
    from = $from.before(); openStart = 0;
  }
  if ($to.parent.isTextblock && $to.parentOffset === $to.parent.content.size && (nodes.at(-1)!.type.name !== 'paragraph' || $to.parent.type.name !== 'paragraph')) {
    to = $to.after(); openEnd = 0;
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
