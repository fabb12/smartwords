import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
export const ghostKey = new PluginKey('scrivia-ghost');
export const Ghost = Extension.create({
  name: 'ghost',
  addProseMirrorPlugins() { return [new Plugin({
    key: ghostKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const ghost = tr.getMeta(ghostKey);
        if (ghost !== undefined) {
          if (!ghost?.text) return DecorationSet.empty;
          const widget = Decoration.widget(ghost.pos, () => { const el = document.createElement('span'); el.className = 'ghost-text'; el.textContent = ghost.text; el.setAttribute('aria-hidden','true'); return el; }, {side:1});
          return DecorationSet.create(tr.doc,[widget]);
        }
        return tr.docChanged || tr.selectionSet ? DecorationSet.empty : old;
      },
    },
    props: { decorations(state) { return this.getState(state); } },
  })]; },
});
