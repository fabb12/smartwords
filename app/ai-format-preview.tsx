import type { JSONContent } from '@tiptap/core';
import { createElement, type ReactNode } from 'react';

export function AiFormatPreview({ content }: { content: JSONContent[] }) {
  function render(node: JSONContent, key: number): ReactNode {
    if (node.type === 'text') {
      let text: ReactNode = node.text || '';
      for (const mark of node.marks || []) if (mark.type === 'bold' || mark.type === 'italic') text = createElement(mark.type === 'bold' ? 'strong' : 'em', null, text);
      return <span key={key}>{text}</span>;
    }
    if (node.type === 'hardBreak') return <br key={key}/>;
    const tag = node.type === 'heading' ? 'h' + Math.max(1, Math.min(3, Number(node.attrs?.level) || 2))
      : node.type === 'bulletList' ? 'ul' : node.type === 'orderedList' ? 'ol' : node.type === 'listItem' ? 'li' : 'p';
    return createElement(tag, { key, ...(tag === 'ol' ? { start: node.attrs?.start } : {}) }, node.content?.map(render));
  }
  return <div className="ai-format-preview" role="region" aria-label="Anteprima della formattazione">{content.map(render)}</div>;
}
