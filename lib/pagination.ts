import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export const A4 = { width: 794, height: 1123, margin: 76, gap: 28 };
export const paginationKey = new PluginKey('scrivia-pagination');
type Break = { pos: number; height: number };
type Layout = { enabled: boolean; breaks: Break[]; pages: number };
const stride = A4.height + A4.gap;

// Page spacers are view decorations, never manuscript nodes. Reflow therefore
// leaves selection positions, undo history, exports and saved content intact.
function measure(view: EditorView): { breaks: Break[]; pages: number } {
  const dom = view.dom, breaks: Break[] = [];
  dom.classList.add('pagination-measuring');
  try {
    const box = dom.getBoundingClientRect(), scale = box.width / dom.offsetWidth || 1;
    let shift = 0, page = 0, bottom = A4.margin;
    const coords = (pos: number) => {
      const rect = view.coordsAtPos(pos, 1);
      return { top: (rect.top - box.top) / scale, bottom: (rect.bottom - box.top) / scale };
    };
    const move = (pos: number, top: number) => {
      page = Math.max(page + 1, Math.floor((top + shift) / stride));
      const height = Math.max(0, page * stride + A4.margin - top - shift);
      if (height > 0.5) { breaks.push({ pos, height }); shift += height; }
    };
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table' || node.type.name === 'image') {
        const el = view.nodeDOM(pos) as HTMLElement | null, rect = el?.getBoundingClientRect();
        if (rect) {
          const top = (rect.top - box.top) / scale, height = rect.height / scale;
          if (top + shift + height > page * stride + A4.height - A4.margin && height <= A4.height - 2 * A4.margin) move(pos, top);
          bottom = Math.max(bottom, top + shift + height);
          page = Math.max(page, Math.floor((bottom + A4.margin - 1) / stride));
        }
        return false;
      }
      if (!node.isTextblock) return true;
      let start = pos + 1; const end = pos + node.nodeSize - 1;
      // coordsAtPos is monotonic inside a text block. Find only the lines that
      // cross a page edge, rather than measuring every character in a book.
      while (coords(end).bottom + shift > page * stride + A4.height - A4.margin) {
        let lo = start, hi = end;
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (coords(mid).bottom + shift > page * stride + A4.height - A4.margin) hi = mid; else lo = mid + 1; }
        move(lo, coords(lo).top); start = lo;
      }
      bottom = Math.max(bottom, coords(end).bottom + shift);
      return false;
    });
    return { breaks, pages: Math.max(1, page + 1, Math.ceil((bottom + A4.margin + A4.gap) / stride)) };
  } finally { dom.classList.remove('pagination-measuring'); }
}

export const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins() {
    return [new Plugin<Layout>({
      key: paginationKey,
      state: {
        init: () => ({ enabled: false, breaks: [], pages: 1 }),
        apply(tr, old) {
          const next = tr.getMeta(paginationKey) as Partial<Layout> | undefined;
          if (next) return { ...old, ...next };
          return tr.docChanged ? { ...old, breaks: old.breaks.map(b => ({ ...b, pos: tr.mapping.map(b.pos) })).filter(b => b.pos <= tr.doc.content.size) } : old;
        },
      },
      props: {
        decorations(state) {
          const layout = paginationKey.getState(state) as Layout;
          if (!layout.enabled) return DecorationSet.empty;
          return DecorationSet.create(state.doc, layout.breaks.map(b => Decoration.widget(b.pos, () => {
            const gap = document.createElement('span'); gap.className = 'a4-page-break';
            gap.contentEditable = 'false'; gap.setAttribute('aria-hidden', 'true');
            gap.style.height = b.height + 'px'; return gap;
          }, { side: -1, key: `${b.pos}:${b.height}`, ignoreSelection: true })));
        },
      },
      view(view) {
        let frame = 0, destroyed = false;
        const schedule = () => {
          if (frame || destroyed) return;
          frame = requestAnimationFrame(() => {
            frame = 0; if (destroyed || view.composing) return;
            const old = paginationKey.getState(view.state) as Layout;
            if (!old.enabled) { view.dom.style.removeProperty('--a4-pages'); return; }
            const layout = measure(view); view.dom.style.setProperty('--a4-pages', String(layout.pages));
            if (JSON.stringify(layout.breaks) !== JSON.stringify(old.breaks) || layout.pages !== old.pages) {
              const tr = view.state.tr.setMeta(paginationKey, layout).setMeta('addToHistory', false);
              if (view.hasFocus()) tr.scrollIntoView();
              view.dispatch(tr);
            }
          });
        };
        const resize = new ResizeObserver(schedule); resize.observe(view.dom);
        view.dom.addEventListener('load', schedule, true); view.dom.addEventListener('compositionend', schedule); document.fonts?.ready.then(schedule);
        return { update(view, previous) {
          if (view.state.doc !== previous.doc || paginationKey.getState(view.state).enabled !== paginationKey.getState(previous).enabled) schedule();
        }, destroy() { destroyed = true; cancelAnimationFrame(frame); resize.disconnect(); view.dom.removeEventListener('load', schedule, true); view.dom.removeEventListener('compositionend', schedule); } };
      },
    })];
  },
});
