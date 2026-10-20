export type AiPreferences = { trigger: 'pause' | 'tab'; formatting: boolean };
export const DEFAULT_AI_PREFERENCES: AiPreferences = { trigger: 'pause', formatting: true };
export const aiPreferencesKey = (owner = 'local') => 'scrivia:ai-preferences:' + encodeURIComponent(owner);
export function sanitizeAiPreferences(raw: unknown): AiPreferences {
  const p = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { trigger: p.trigger === 'tab' ? 'tab' : 'pause', formatting: p.formatting !== false };
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
