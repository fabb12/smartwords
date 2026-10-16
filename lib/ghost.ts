import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
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
