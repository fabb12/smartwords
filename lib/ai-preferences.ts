import { DEFAULT_INTERVENTION, isIntervention, type Intervention } from './intervention.ts';

// intervention: how much the AI may change the writer's text (1 minimal … 4 extensive).
export type AiPreferences = { trigger: 'pause' | 'tab'; formatting: boolean; intervention: Intervention };
export const DEFAULT_AI_PREFERENCES: AiPreferences = { trigger: 'pause', formatting: true, intervention: DEFAULT_INTERVENTION };
export const aiPreferencesKey = (owner = 'local') => 'scrivia:ai-preferences:' + encodeURIComponent(owner);
export function sanitizeAiPreferences(raw: unknown): AiPreferences {
  const p = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { trigger: p.trigger === 'tab' ? 'tab' : 'pause', formatting: p.formatting !== false, intervention: isIntervention(p.intervention) ? p.intervention : DEFAULT_INTERVENTION };
}
export function readAiPreferences(owner = 'local'): AiPreferences {
  try { return sanitizeAiPreferences(JSON.parse(localStorage.getItem(aiPreferencesKey(owner)) || 'null')); } catch { return { ...DEFAULT_AI_PREFERENCES }; }
}
export function storeAiPreferences(value: AiPreferences, owner = 'local'): boolean {
  try { localStorage.setItem(aiPreferencesKey(owner), JSON.stringify(sanitizeAiPreferences(value))); return true; } catch { return false; }
}
export function aiTabAction(p: { modified: boolean; composing: boolean; repeat: boolean; busy: boolean; proposal: 'none' | 'pending' | 'ready'; trigger: AiPreferences['trigger']; mode: string }): 'native' | 'accept' | 'request' | 'wait' {
  if (p.modified || p.composing) return 'native';
  if (p.proposal === 'ready' && !p.repeat) return 'accept';
  if (p.trigger !== 'tab' || p.mode !== 'assistita') return 'native';
  if (p.busy || p.proposal === 'pending' || p.repeat) return 'wait';
  return 'request';
}
