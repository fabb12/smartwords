import type { JSONContent } from '@tiptap/core';
import { createElement, type ReactNode } from 'react';

// compact: headings and body use the panel's own sizes, so a long proposal
// never fills the side column with 38px titles.
export function AiFormatPreview({ content, compact = false }: { content: JSONContent[]; compact?: boolean }) {
  function render(node: JSONContent, key: number): ReactNode {
    if (node.type === 'text') {
      let text: ReactNode = node.text || '';
      for (const mark of node.marks || []) if (mark.type === 'bold' || mark.type === 'italic' || mark.type === 'highlight') text = createElement(mark.type === 'bold' ? 'strong' : mark.type === 'italic' ? 'em' : 'mark', null, text);
      const typography = node.marks?.find(mark => mark.type === 'textStyle')?.attrs, size = parseFloat(typography?.fontSize);
      return <span key={key} style={typography ? { fontFamily: typography.fontFamily || undefined, fontSize: compact || !size ? undefined : Math.min(size, 22) + 'px', color: typography.color || undefined } : undefined}>{text}</span>;
    }
    if (node.type === 'hardBreak') return <br key={key}/>;
    const tag = node.type === 'heading' ? 'h' + Math.max(1, Math.min(3, Number(node.attrs?.level) || 2))
      : node.type === 'bulletList' ? 'ul' : node.type === 'orderedList' ? 'ol' : node.type === 'listItem' ? 'li' : 'p';
    return createElement(tag, { key, ...(tag === 'ol' ? { start: node.attrs?.start } : {}) }, node.content?.map(render));
  }
  return <div className={'ai-format-preview' + (compact ? ' compact' : '')} role="region" aria-label="Anteprima della formattazione">{content.map(render)}</div>;
}
