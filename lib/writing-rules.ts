// General writing rules chosen by the author in Settings. They are added to the system
// prompt of every AI request and, where a rule bans a character, enforced on the answer too.
export type QuoteStyle = 'auto' | 'caporali' | 'curve' | 'dritte';
export type WritingRules = {
  noEmDash: boolean;
  noEnDash: boolean;
  noEllipsisChar: boolean;
  noEmoji: boolean;
  quotes: QuoteStyle;
  // Words or characters to avoid, one per line.
  avoid: string;
  // Free instructions from the author: a personal system prompt.
  custom: string;
};
export const QUOTE_STYLES: { id: QuoteStyle; label: string }[] = [
  { id: 'auto', label: 'Come nel testo' },
  { id: 'caporali', label: 'Caporali « »' },
  { id: 'curve', label: 'Alte curve “ ”' },
  { id: 'dritte', label: 'Alte dritte " "' },
];
export const DEFAULT_WRITING_RULES: WritingRules = { noEmDash: true, noEnDash: false, noEllipsisChar: false, noEmoji: true, quotes: 'auto', avoid: '', custom: '' };
export const RULES_MAX = { avoid: 600, custom: 2000 };

export function sanitizeWritingRules(value: unknown): WritingRules {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const flag = (k: keyof WritingRules) => typeof v[k] === 'boolean' ? v[k] as boolean : DEFAULT_WRITING_RULES[k] as boolean;
  const text = (k: 'avoid' | 'custom') => typeof v[k] === 'string' ? (v[k] as string).slice(0, RULES_MAX[k]) : '';
  return { noEmDash: flag('noEmDash'), noEnDash: flag('noEnDash'), noEllipsisChar: flag('noEllipsisChar'), noEmoji: flag('noEmoji'),
    quotes: QUOTE_STYLES.some(q => q.id === v.quotes) ? v.quotes as QuoteStyle : 'auto', avoid: text('avoid'), custom: text('custom') };
}
export function writingRulesKey(owner = 'local') { return 'scrivia:writing-rules:' + encodeURIComponent(owner); }
export function readWritingRules(owner = 'local'): WritingRules {
  try { const raw = localStorage.getItem(writingRulesKey(owner)); return raw ? sanitizeWritingRules(JSON.parse(raw)) : { ...DEFAULT_WRITING_RULES }; }
  catch { return { ...DEFAULT_WRITING_RULES }; }
}
export function storeWritingRules(rules: WritingRules, owner = 'local') {
  try { localStorage.setItem(writingRulesKey(owner), JSON.stringify(sanitizeWritingRules(rules))); return true; } catch { return false; }
}
const avoidList = (rules: WritingRules) => [...new Set(rules.avoid.split('\n').map(s => s.trim()).filter(Boolean))].slice(0, 40);

// The instruction sent with each request (empty when no rule is active).
export function writingRulesInstruction(rules: WritingRules): string {
  const out: string[] = [];
  if (rules.noEmDash) out.push('Never use the em dash (—): use commas, colons, parentheses or separate sentences instead.');
  if (rules.noEnDash) out.push('Never use the en dash (–) as punctuation; use a hyphen only inside number ranges.');
  if (rules.noEllipsisChar) out.push('Never use the single ellipsis character (…): write three periods (...) instead.');
  if (rules.noEmoji) out.push('Never use emoji.');
  if (rules.quotes === 'caporali') out.push('For dialogue and quotations use only guillemets « ».');
  if (rules.quotes === 'curve') out.push('For dialogue and quotations use only curly quotes “ ”.');
  if (rules.quotes === 'dritte') out.push('For dialogue and quotations use only straight quotes " ".');
  const avoid = avoidList(rules);
  if (avoid.length) out.push('Never use these words or characters: ' + avoid.map(a => JSON.stringify(a)).join(', ') + '.');
  const custom = rules.custom.trim();
  if (custom) out.push('Author preferences: ' + custom);
  return out.join(' ');
}

// Emoji shown as pictures (not © or ™ in text style), with joined sequences, skin tones and flags.
const EMOJI = /[ \t]?(?:(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)[\u{1F3FB}-\u{1F3FF}]?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F?)[\u{1F3FB}-\u{1F3FF}]?)*|[\u{1F1E6}-\u{1F1FF}]{2})/gu;
// Replaces a dash used as punctuation: dialogue dashes at line start are dropped,
// a dash between words becomes a comma.
function replaceDash(text: string, dash: string) {
  const re = new RegExp(`[ \\t]*${dash}[ \\t]*`, 'g');
  return text.replace(re, (match, offset: number, whole: string) => {
    const before = whole.slice(0, offset), after = whole.slice(offset + match.length);
    if (!before || /\n$/.test(before)) return '';
    if (!after || /^\n/.test(after) || /^[,.;:!?)»”"]/.test(after)) return '';
    return /[,;:(«“"]$/.test(before) ? ' ' : ', ';
  });
}
// Applies the character bans to an AI answer, so a banned character never reaches the page.
export function applyWritingRules(text: string, rules: WritingRules): string {
  let out = text;
  if (rules.noEnDash) out = replaceDash(out.replace(/(\d)\s*–\s*(\d)/g, '$1-$2'), '–');
  if (rules.noEmDash) out = replaceDash(out, '—');
  if (rules.noEllipsisChar) out = out.replace(/…/g, '...');
  if (rules.noEmoji) out = out.replace(EMOJI, '');
  for (const item of avoidList(rules)) if ([...item].length === 1 && !/[\p{L}\p{N}\s]/u.test(item)) out = out.split(item).join('');
  return out;
}
