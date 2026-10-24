import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { inlineEdits } from './inline-diff.ts';
export const ghostKey = new PluginKey('scrivia-ghost');
// complete: text shown after `from`; replace: the range from..to is marked and the proposal shown after it.
export type GhostMeta = { kind: 'complete' | 'replace'; from: number; to: number; text: string; done: boolean } | null;
function proposal(meta: NonNullable<GhostMeta>) {
  const el = document.createElement('span');
  el.className = 'ghost-text ghost-' + meta.kind + (meta.done ? '' : ' ghost-streaming');
  el.setAttribute('aria-hidden', 'true');
  el.appendChild(document.createTextNode(meta.text));
  if (meta.done) { const hint = document.createElement('kbd'); hint.className = 'ghost-hint'; hint.textContent = 'Tab'; el.appendChild(hint); }
  return el;
}
function addition(text: string) {
  const el = document.createElement('span');
  el.className = 'ghost-text ghost-add'; el.setAttribute('aria-hidden', 'true'); el.textContent = text;
  return el;
}
function hint(done: boolean) {
  const el = document.createElement('kbd');
  el.className = 'ghost-hint' + (done ? '' : ' ghost-streaming'); el.setAttribute('aria-hidden', 'true'); el.textContent = done ? 'Tab' : '…';
  return el;
}
function inlineDecorations(doc: Parameters<typeof inlineEdits>[0], ghost: NonNullable<GhostMeta>): Decoration[] | null {
  const edits = inlineEdits(doc, ghost.from, ghost.to, ghost.text);
  if (!edits) return null;
  // While the answer streams, the original after the last received word is not yet a deletion.
  if (!ghost.done && edits.length) { const last = edits.at(-1)!; if (last.to === ghost.to) last.to = last.from; }
  const out: Decoration[] = [];
  edits.forEach((edit, i) => {
    if (edit.to > edit.from) out.push(Decoration.inline(edit.from, edit.to, { class: 'ghost-original ghost-del' }));
    if (edit.insert) out.push(Decoration.widget(edit.to, () => addition(edit.insert), { side: 1, key: 'add:' + i + ':' + edit.insert }));
  });
  out.push(Decoration.widget(ghost.to, () => hint(ghost.done), { side: 2, key: 'hint:' + ghost.done }));
  return out;
}
export const Ghost = Extension.create({
  name: 'ghost',
  addProseMirrorPlugins() { return [new Plugin({
    key: ghostKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const ghost = tr.getMeta(ghostKey) as GhostMeta | undefined;
        if (ghost !== undefined) {
          if (!ghost?.text) return DecorationSet.empty;
          // A rewrite is shown inside the text: only changed words are struck out, with the new words in green next to them.
          if (ghost.kind === 'replace' && ghost.to > ghost.from) {
            const inline = inlineDecorations(tr.doc, ghost);
            if (inline) return DecorationSet.create(tr.doc, inline);
          }
          const decorations = [Decoration.widget(ghost.to, () => proposal(ghost), { side: 1, key: ghost.kind + (ghost.done ? ':done:' : ':') + ghost.text })];
          if (ghost.kind === 'replace' && ghost.to > ghost.from) decorations.unshift(Decoration.inline(ghost.from, ghost.to, { class: 'ghost-original' }));
          return DecorationSet.create(tr.doc, decorations);
        }
        return tr.docChanged || tr.selectionSet ? DecorationSet.empty : old;
      },
    },
    props: { decorations(state) { return this.getState(state); } },
  })]; },
});
