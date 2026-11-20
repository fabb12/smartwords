import Image from '@tiptap/extension-image';
import type { Node } from '@tiptap/pm/model';

// Image with drag handles on its corners. Tiptap's own node view ignores width/height changes that do not
// come from a drag, so the size bar and «Sistema formattazione» (which set the attributes) would change the
// document without changing what is on screen: the size is copied to the element on every update.
// The alignment («Allinea», «Centra», «Giustifica» on a selected image) is the textAlign attribute; it is shown on
// the flex container that holds the image and saved as text-align on the <img>.
type View = { dom?: HTMLElement; element: HTMLElement; update: (node: Node, ...rest: unknown[]) => boolean };
export const IMAGE_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
const showAlign = (view: View, node: Node) => {
  const box = view.dom || view.element, align = node.attrs.textAlign;
  if (IMAGE_ALIGNS.includes(align) && align !== 'center') box.dataset.align = align; else delete box.dataset.align;
};
const px = (value: unknown) => { const n = Number(value); return n > 0 ? n + 'px' : ''; };

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (el: HTMLElement) => (IMAGE_ALIGNS as readonly string[]).includes(el.style.textAlign) ? el.style.textAlign : null,
        renderHTML: (attrs: Record<string, unknown>) => attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {},
      },
    };
  },
  addNodeView() {
    const make = this.parent?.();
    if (!make) return null;
    return (props) => {
      const view = make(props) as unknown as View;
      const update = view.update.bind(view);
      showAlign(view, props.node as Node);
      view.update = (node, ...rest) => {
        const ok = update(node, ...rest);
        if (ok) { view.element.style.width = px(node.attrs.width); view.element.style.height = px(node.attrs.height); showAlign(view, node); }
        return ok;
      };
      return view as never;
    };
  },
});
