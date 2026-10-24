import { wordDiff } from './ai-governor.ts';

// Augmented writing: the writer chooses how much the AI may change. At the
// lowest level it is a careful proofreader that suggests a few words; at the
// highest it may rewrite freely. Facts, meaning and voice always stay the author's.

export type Intervention = 1 | 2 | 3 | 4;
export const DEFAULT_INTERVENTION: Intervention = 2;
export const INTERVENTION_LEVELS: { level: Intervention; name: string; short: string; tip: string }[] = [
  { level: 1, name: 'Minimo', short: 'Correzioni e poche parole', tip: 'Corregge refusi ed errori e suggerisce solo qualche parola: il testo resta quasi tutto tuo.' },
  { level: 2, name: 'Leggero', short: 'Ritocchi di stile', tip: 'Correzioni più qualche ritocco di parole e scorrevolezza, mantenendo le tue frasi.' },
  { level: 3, name: 'Moderato', short: 'Revisione delle frasi', tip: 'Può ristrutturare le frasi per chiarezza e ritmo, mantenendo contenuto e voce.' },
  { level: 4, name: 'Ampio', short: 'Riscrittura libera', tip: 'Può riscrivere e riorganizzare liberamente il brano, senza cambiare fatti e intenzione.' },
];
export const isIntervention = (v: unknown): v is Intervention => v === 1 || v === 2 || v === 3 || v === 4;
export const interventionName = (level: Intervention) => INTERVENTION_LEVELS[level - 1].name;

// Modes in which the level changes how much of the original text survives.
export const INTERVENTION_MODES: readonly string[] = ['complete', 'rewrite', 'shorten', 'formal', 'voice', 'continue'];

const EDIT: Record<Intervention, string> = {
  1: 'Intervention level 1 of 4 (minimal): act as a careful proofreader. Fix only clear spelling mistakes, typos, wrong accents, agreement errors and accidentally repeated words, and replace at most one or two clearly weak or wrong words. Keep every other word, the sentence structure, order and punctuation exactly as written. Never rephrase, never add or remove ideas. If nothing needs fixing, return the text unchanged.',
  2: 'Intervention level 2 of 4 (light): fix errors and make small word-level improvements (a more precise word, a removed redundancy, smoother connectives). Keep the author\'s sentences, their order and structure; most of the original wording must remain.',
  3: 'Intervention level 3 of 4 (moderate): you may restructure sentences, merge or split them and change wording for clarity, rhythm and precision, keeping meaning, facts, register and the author\'s voice.',
  4: 'Intervention level 4 of 4 (extensive): you may rewrite and reorganize the passage freely to make it as strong as possible, keeping facts, intent, point of view and language. Do not invent new facts.',
};
const COMPLETE: Record<Intervention, string> = {
  1: 'Intervention level 1 of 4 (minimal): correct only clear errors in the existing words and add only the few words (at most about eight) needed to finish the current sentence, in the most predictable way.',
  2: 'Intervention level 2 of 4 (light): correct clear errors and complete the current sentence briefly and naturally.',
  3: 'Intervention level 3 of 4 (moderate): complete the current sentence and you may add one short following sentence that develops the idea.',
  4: 'Intervention level 4 of 4 (extensive): complete the sentence and you may add up to two following sentences that develop the idea in the author\'s voice.',
};
const CONTINUE: Record<Intervention, string> = {
  1: 'Intervention level 1 of 4 (minimal): write only one or two short sentences (at most 30 words) that follow most naturally; no new events or characters.',
  2: 'Intervention level 2 of 4 (light): write a short passage of about 40 to 70 words that follows naturally, without major new events.',
  3: 'Intervention level 3 of 4 (moderate): write the passage at the usual length.',
  4: 'Intervention level 4 of 4 (extensive): write the passage at the usual length and you may introduce a meaningful new development consistent with the project.',
};

export function interventionInstruction(level: unknown, mode: string): string {
  if (!isIntervention(level) || !INTERVENTION_MODES.includes(mode)) return '';
  if (mode === 'complete') return COMPLETE[level];
  if (mode === 'continue') return CONTINUE[level];
  // Shortening, tone and voice changes are rewrites by nature: the level tempers how far they go.
  if (mode !== 'rewrite') return level <= 2 ? 'Keep as much of the original wording as the task allows; change only what the task requires.' : level === 4 ? 'You may change wording and structure freely to fulfil the task.' : '';
  return EDIT[level];
}

// Share of the original words still present, in order, in the proposal.
export function keptShare(original: string, proposal: string): number {
  const words = original.match(/[^\s]+/g)?.length || 0;
  if (!words) return 1;
  const kept = wordDiff(original, proposal).filter(p => p.type === 'same').map(p => p.text.match(/[^\s]+/g)?.length || 0).reduce((a, b) => a + b, 0);
  return Math.min(1, kept / words);
}
// Minimum share of original words a "Migliora frase" proposal should keep at each level.
const MIN_KEPT: Record<Intervention, number> = { 1: 0.8, 2: 0.55, 3: 0.25, 4: 0 };
export function exceedsIntervention(level: Intervention, original: string, proposal: string): boolean {
  return original.trim().split(/\s+/).length >= 4 && keptShare(original, proposal) < MIN_KEPT[level];
}
