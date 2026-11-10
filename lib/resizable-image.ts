import Image from '@tiptap/extension-image';
import type { Node } from '@tiptap/pm/model';

// Image with drag handles on its corners. Tiptap's own node view ignores width/height changes that do not
// come from a drag, so the size bar and «Sistema formattazione» (which set the attributes) would change the
// document without changing what is on screen: the size is copied to the element on every update.
type View = { element: HTMLElement; update: (node: Node, ...rest: unknown[]) => boolean };
const px = (value: unknown) => { const n = Number(value); return n > 0 ? n + 'px' : ''; };

export const ResizableImage = Image.extend({
  addNodeView() {
    const make = this.parent?.();
    if (!make) return null;
    return (props) => {
      const view = make(props) as unknown as View;
      const update = view.update.bind(view);
      view.update = (node, ...rest) => {
        const ok = update(node, ...rest);
        if (ok) { view.element.style.width = px(node.attrs.width); view.element.style.height = px(node.attrs.height); }
        return ok;
      };
      return view as never;
    };
  },
});
