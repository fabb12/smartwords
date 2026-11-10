// Sync of the user's settings and preferences with the cloud (Supabase table user_settings).
//
// Every module of the app keeps its preferences in localStorage, per account (`scrivia:<name>:<owner>`).
// Instead of changing each of them, this engine mirrors the allowed keys: at sign-in the cloud copy is
// applied to this device, then local changes are noticed and sent to the cloud. Documents, AI profiles
// and their API keys have their own cloud routes (lib/cloud-store.ts).

// Settings that are not tied to an account on this device.
const GLOBAL_KEYS = ['scrivia:theme', 'scrivia:mode', 'scrivia:pages', 'scrivia:zoom', 'scrivia:read-aloud'];
// Settings stored per account: the key is `<prefix><owner>` optionally followed by `:<detail>`.
const OWNER_PREFIXES = [
  'scrivia:ai-preferences:', 'scrivia:writing-rules:', 'scrivia:writing-memory:', 'scrivia:token-usage:',
  'scrivia:toolbars:v1:', 'scrivia:workspace-presets:v1:', 'scrivia:workspace-frame:v1:', 'scrivia:doc-groups:',
  'scrivia:usage:',
];
// Never synced, on purpose: GitHub tokens, local-model profiles (they point at this computer) and the
// phone/tablet layout flag. API keys travel through the encrypted secret routes only.
const READ_ALOUD = 'scrivia:read-aloud';
export const ELEVENLABS_SECRET = 'elevenlabs';

export function isSyncedKey(key: string, owner: string): boolean {
  if (GLOBAL_KEYS.includes(key)) return true;
  const who = encodeURIComponent(owner);
  return OWNER_PREFIXES.some(prefix => {
    if (!key.startsWith(prefix)) return false;
    const rest = key.slice(prefix.length);
    return rest === owner || rest.startsWith(owner + ':') || rest === who || rest.startsWith(who + ':');
  });
}

// The ElevenLabs key lives inside the read-aloud settings: it is sent as an encrypted secret, never as a setting.
export function splitReadAloud(raw: string): { value: string; secret: string } {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: raw, secret: '' };
    const { elevenKey, ...rest } = parsed as Record<string, unknown>;
    return { value: JSON.stringify(rest), secret: typeof elevenKey === 'string' ? elevenKey : '' };
  } catch { return { value: raw, secret: '' }; }
}
export function joinReadAloud(value: string, secret: string | null): string {
  if (!secret) return value;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value;
    return JSON.stringify({ ...parsed, elevenKey: secret });
  } catch { return value; }
}

export type SettingRow = { key: string; value: string };
export interface SyncBackend {
  list(): Promise<SettingRow[]>;
  put(rows: SettingRow[]): Promise<void>;
  remove(keys: string[]): Promise<void>;
  getSecret(name: string): Promise<string | null>;
  setSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
}
export interface SyncStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SettingsSync = {
  pull(): Promise<void>;       // applies the cloud copy to this device (cloud wins), then watches for changes
  push(): Promise<void>;       // sends pending local changes now
  stop(): void;
};

// `known` is what the cloud is believed to hold; a difference with localStorage means "to be sent".
export function createSettingsSync(options: { owner: string; storage: SyncStorage; backend: SyncBackend; intervalMs?: number; onError?: (error: Error) => void }): SettingsSync {
  const { owner, storage, backend, intervalMs = 2500, onError } = options;
  const known = new Map<string, string>();
  let knownSecret = '', timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | null = null, stopped = false;

  const localKeys = () => { const keys: string[] = []; for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && isSyncedKey(k, owner)) keys.push(k); } return keys; };

  async function sendChanges() {
    const rows: SettingRow[] = [], gone: string[] = [], current = new Set(localKeys());
    let secret: string | null = null;
    for (const key of current) {
      const raw = storage.getItem(key); if (raw === null || known.get(key) === raw) continue;
      if (key === READ_ALOUD) { const parts = splitReadAloud(raw); secret = parts.secret; rows.push({ key, value: parts.value }); }
      else rows.push({ key, value: raw });
    }
    for (const key of known.keys()) if (!current.has(key)) gone.push(key);
    // The secret is compared on its own, so editing another read-aloud option does not resend it.
    const sentSecret = secret !== null ? secret : knownSecret;
    if (rows.length) await backend.put(rows);
    if (gone.length) await backend.remove(gone);
    if (secret !== null && secret !== knownSecret) { if (secret) await backend.setSecret(ELEVENLABS_SECRET, secret); else await backend.deleteSecret(ELEVENLABS_SECRET); }
    for (const row of rows) { const raw = storage.getItem(row.key); if (raw !== null) known.set(row.key, raw); }
    for (const key of gone) known.delete(key);
    knownSecret = sentSecret;
  }
  function guarded(work: () => Promise<void>): Promise<void> {
    const next = (running ?? Promise.resolve()).then(work).catch(error => { onError?.(error instanceof Error ? error : new Error(String(error))); });
    running = next; return next;
  }

  return {
    async pull() {
      const rows = (await backend.list()).filter(r => isSyncedKey(r.key, owner));
      const secret = rows.some(r => r.key === READ_ALOUD) ? await backend.getSecret(ELEVENLABS_SECRET) : null;
      for (const row of rows) {
        const value = row.key === READ_ALOUD ? joinReadAloud(row.value, secret) : row.value;
        try { if (storage.getItem(row.key) !== value) storage.setItem(row.key, value); } catch { /* storage full: the cloud copy stays */ }
        known.set(row.key, storage.getItem(row.key) ?? value);
      }
      if (secret) knownSecret = secret;
      // Settings that exist only on this device (set before the first sign-in) go up with the first push.
      await guarded(sendChanges);
      if (!stopped && !timer) timer = setInterval(() => { void guarded(sendChanges); }, intervalMs);
    },
    push: () => guarded(sendChanges),
    stop() { stopped = true; if (timer) clearInterval(timer); timer = undefined; },
  };
}

// Removes the synced settings of an account from this device (sign-out on a shared computer).
export function clearSyncedSettings(storage: SyncStorage, owner: string) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && isSyncedKey(k, owner)) keys.push(k); }
  for (const key of keys) { try { storage.removeItem(key); } catch { /* nothing else to do */ } }
}

// Settings saved while nobody was signed in use the owner "local": adopt them for a new account.
export function adoptLocalSettings(storage: SyncStorage, owner: string): number {
  let moved = 0;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k) keys.push(k); }
  for (const key of keys) {
    const prefix = OWNER_PREFIXES.find(p => key.startsWith(p));
    if (!prefix) continue;
    const rest = key.slice(prefix.length);
    if (rest !== 'local' && !rest.startsWith('local:')) continue;
    const target = prefix + owner + rest.slice('local'.length);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(target) === null) { try { storage.setItem(target, value); moved++; } catch { /* storage full */ } }
  }
  return moved;
}
