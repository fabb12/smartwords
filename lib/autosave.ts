// Automatic saving every 5 minutes. Changes are always saved shortly after typing; this adds a regular check of
// document and creative project (also during continuous writing) and, when GitHub is connected, an optional commit.

export const AUTOSAVE_MS = 5 * 60 * 1000;
export type AutoSavePrefs = { enabled: boolean; github: boolean };
export const DEFAULT_AUTOSAVE: AutoSavePrefs = { enabled: true, github: false };
export const autoSaveKey = (owner = 'local') => 'scrivia:autosave:' + encodeURIComponent(owner);

export function sanitizeAutoSave(raw: unknown): AutoSavePrefs {
  const p = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { enabled: p.enabled !== false, github: p.github === true };
}
export function readAutoSave(owner = 'local'): AutoSavePrefs {
  try { return sanitizeAutoSave(JSON.parse(localStorage.getItem(autoSaveKey(owner)) || 'null')); } catch { return { ...DEFAULT_AUTOSAVE }; }
}
export function storeAutoSave(value: AutoSavePrefs, owner = 'local'): boolean {
  try { localStorage.setItem(autoSaveKey(owner), JSON.stringify(sanitizeAutoSave(value))); return true; } catch { return false; }
}

// Whether a scheduled save should also commit to GitHub: only when asked for, connected, without a cloud account,
// not while another GitHub operation runs, and only if the document changed since the last commit.
export function shouldAutoSaveToGithub(p: { prefs: AutoSavePrefs; connected: boolean; cloud: boolean; busy: boolean; hasText: boolean; version: string; committed: string }): boolean {
  return p.prefs.enabled && p.prefs.github && p.connected && !p.cloud && !p.busy && p.hasText && p.version !== p.committed;
}
