import type { JSONContent } from '@tiptap/core';

// A closed vocabulary lets the model choose typography without accepting CSS.
const FONTS: Record<string, string> = { sans: 'Arial', serif: 'Georgia', mono: 'Courier New' };
const COLORS: Record<string, string | null> = { default: null, green: '#345847', blue: '#285c8e', burgundy: '#7a334c', muted: '#5f6368' };
const SIZES = [14, 16, 18, 20, 22, 24, 28, 32, 38];
export type Typography = { fontFamily?: string; fontSize?: string; color?: string | null };

export const AI_TYPOGRAPHY_INSTRUCTION = 'First read the whole passage and build its outline, then format it. Hierarchy: a standalone line that names the whole text is the main title (#); a line that opens a section is a subtitle (##); a line that opens a sub-section is a minor heading (###). Typical heading lines are short, stand alone, lack final punctuation and introduce the text that follows (for example a chapter name, a numbered section or a topic label); mark every such line as a heading even when the source shows no formatting, and never mark a full sentence of prose as a heading. When the passage has no heading lines, keep it as paragraphs. Paragraphs follow content: start a new paragraph at each change of topic, speaker, time, place or argument; join lines and fragments that develop the same idea into one paragraph; split very long blocks at the point where the idea changes. Importance: mark with **bold** the few key concepts, defined terms and names a reader must retain (about one or two per paragraph, never whole sentences); use *italic* for secondary emphasis, foreign words and titles of works; wrap in ==double equals== at most one decisive sentence or phrase per section, the single idea that matters most. Leave ordinary details plain so that important concepts stand out. Heading sizes and capitalization are applied automatically (38, 28, 22 px; the main title in capitals, other headings with a capital initial), so never change letter case yourself; format-only body text is normalized to 18 px. You may choose a coherent typeface, size or restrained readable color when the content benefits: put a separate line :::style font=serif size=32 color=blue immediately before the block it styles. Allowed optional keys: font=sans|serif|mono, size=14|16|18|20|22|24|28|32|38, color=default|green|blue|burgundy|muted. The directive applies only to the next paragraph, heading or list item. Use one consistent body typeface and avoid decorative colors or changing font on every paragraph. Never put these directives inside sentences, add explanations, or add words to create titles.';

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
