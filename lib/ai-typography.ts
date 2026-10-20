import type { JSONContent } from '@tiptap/core';

// A closed vocabulary lets the model choose typography without accepting CSS.
const FONTS: Record<string, string> = { sans: 'Arial', serif: 'Georgia', mono: 'Courier New' };
const COLORS: Record<string, string | null> = { default: null, green: '#345847', blue: '#285c8e', burgundy: '#7a334c', muted: '#5f6368' };
const SIZES = [14, 16, 18, 20, 22, 24, 28, 32, 38];
export type Typography = { fontFamily?: string; fontSize?: string; color?: string | null };

export const AI_TYPOGRAPHY_INSTRUCTION = 'Infer genuine titles, subtitles and paragraph breaks from meaning, even when the source has no formatting. Use # for a main title, ## for a subtitle and ### for a minor heading; ordinary prose must remain paragraphs. Heading sizes are applied automatically (38, 28, 22 px); format-only body text is normalized to 18 px. You may choose a coherent typeface, size or restrained readable color when the content benefits: put a separate line :::style font=serif size=32 color=blue immediately before the block it styles. Allowed optional keys: font=sans|serif|mono, size=14|16|18|20|22|24|28|32|38, color=default|green|blue|burgundy|muted. The directive applies only to the next paragraph, heading or list item. Use one consistent body typeface, larger headings, **bold** for key concepts and *italic* for appropriate emphasis. Avoid decorative colors or changing font on every paragraph. Never put these directives inside sentences, add explanations, or add words to create titles.';

export function typographyDirective(line: string): Typography | null {
  const match = /^:::style[ \t]+(.+?)[ \t]*$/.exec(line);
  if (!match) return null;
  const style: Typography = {}, seen = new Set<string>();
  for (const part of match[1].split(/[ \t]+/)) {
    const [key, value, extra] = part.split('=');
    if (!value || extra !== undefined || seen.has(key)) return null;
    seen.add(key);
    if (key === 'font' && Object.hasOwn(FONTS, value)) style.fontFamily = FONTS[value];
    else if (key === 'size' && SIZES.includes(Number(value)) && /^\d+$/.test(value)) style.fontSize = value + 'px';
    else if (key === 'color' && Object.hasOwn(COLORS, value)) style.color = COLORS[value];
    else return null;
  }
  return style;
}

export function applyTypography(node: JSONContent, style: Typography): JSONContent {
  if (node.type === 'text') {
    const marks = node.marks || [], existing = marks.find(m => m.type === 'textStyle')?.attrs;
    return { ...node, marks: [...marks.filter(m => m.type !== 'textStyle'), { type: 'textStyle', attrs: { ...existing, ...style } }] };
  }
  return { ...node, ...(node.content ? { content: node.content.map(child => applyTypography(child, style)) } : {}) };
}

export function headingTypography(level: number): Typography {
  return { fontSize: [38, 28, 22][Math.max(0, Math.min(2, level - 1))] + 'px', color: null };
}
