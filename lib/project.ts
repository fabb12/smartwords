// The creative project attached to a document: what the author wants to write, the chosen voice
// and the story memory (facts with evidence). Shared by the server route and the static build.
import type { Fact } from './narrative';

export type Brief = { genre: string; premise: string; audience: string; notes: string };
export type VoiceChoice = { id: string; intensity: string; custom: string };
export type Project = { brief: Brief; voice: VoiceChoice; facts: Fact[]; analysed: Record<string, string>; dismissed: string[]; confirmed: string[] };

export const EMPTY_PROJECT: Project = { brief: { genre: '', premise: '', audience: '', notes: '' }, voice: { id: 'mine', intensity: 'medium', custom: '' }, facts: [], analysed: {}, dismissed: [], confirmed: [] };

const s = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : '';
const ids = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(-500) : [];
// Stored JSON is untrusted: every field is checked below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;

// Accepts anything and returns a well-formed, size-bounded project.
export function sanitizeProject(raw: unknown): Project {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Loose>;
  const brief = r.brief || {}, voice = r.voice || {};
  const facts = Array.isArray(r.facts) ? r.facts.slice(0, 800).map((f: Loose): Fact | null => {
    const fact: Fact = { id: s(f?.id, 40), entity: s(f?.entity, 80), kind: s(f?.kind, 30), attribute: s(f?.attribute, 60), value: s(f?.value, 160), quote: s(f?.quote, 300), chapter: s(f?.chapter, 80), from: num(f?.from), to: num(f?.to) };
    return fact.id && fact.entity && fact.attribute && fact.value ? fact : null;
  }).filter((f: Fact | null): f is Fact => f !== null) : [];
  const analysed: Record<string, string> = {};
  if (r.analysed && typeof r.analysed === 'object') for (const [k, v] of Object.entries(r.analysed).slice(0, 300)) if (typeof v === 'string') analysed[k.slice(0, 80)] = v.slice(0, 20);
  return {
    brief: { genre: s(brief.genre, 120), premise: s(brief.premise, 1000), audience: s(brief.audience, 200), notes: s(brief.notes, 1500) },
    voice: { id: s(voice.id, 30) || 'mine', intensity: ['light', 'medium', 'strong'].includes(voice.intensity) ? voice.intensity : 'medium', custom: s(voice.custom, 600) },
    facts, analysed, dismissed: ids(r.dismissed), confirmed: ids(r.confirmed),
  };
}

export function briefText(b: Brief): string {
  return [b.genre && `Genere: ${b.genre}`, b.premise && `Progetto e intenzioni: ${b.premise}`, b.audience && `Lettori: ${b.audience}`, b.notes && `Note dell'autore: ${b.notes}`].filter(Boolean).join('\n');
}
