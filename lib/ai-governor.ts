// Client-side control of AI calls: caches answers, spaces out automatic requests,
// backs off after provider errors and skips requests that cannot add anything new.

export type DiffPart = { type: 'same' | 'add' | 'del'; text: string };

// Word-level diff (LCS) used to highlight what a rewrite changes. Whitespace is kept
// attached to tokens so joining the parts rebuilds both texts exactly.
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.match(/\s+|[^\s]+/g) || [], b = after.match(/\s+|[^\s]+/g) || [];
  if (a.length * b.length > 400_000) return [{ type: 'del', text: before }, { type: 'add', text: after }];
  const n = a.length, m = b.length, lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => { const last = parts[parts.length - 1]; if (last?.type === type) last.text += text; else parts.push({ type, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('del', a[i++]);
    else push('add', b[j++]);
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('add', b[j++]);
  return parts;
}

export type GovernorOptions = {
  minGap?: number;      // ms between two automatic requests
  perMinute?: number;   // automatic requests allowed in a rolling minute
  cacheSize?: number;
  cacheTtl?: number;    // ms
  now?: () => number;
};

export class AiGovernor {
  private cache = new Map<string, { text: string; at: number }>();
  private starts: number[] = [];
  private blockedUntil = 0;
  private failures = 0;
  private lastAuto = new Map<string, string>();
  private readonly minGap: number; private readonly perMinute: number; private readonly cacheSize: number; private readonly cacheTtl: number; private readonly now: () => number;

  constructor(o: GovernorOptions = {}) {
    this.minGap = o.minGap ?? 2500; this.perMinute = o.perMinute ?? 12; this.cacheSize = o.cacheSize ?? 60; this.cacheTtl = o.cacheTtl ?? 15 * 60_000; this.now = o.now ?? Date.now;
  }

  static key(parts: unknown[]): string { return JSON.stringify(parts); }

  cached(key: string): string | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.cacheTtl) { this.cache.delete(key); return undefined; }
    this.cache.delete(key); this.cache.set(key, hit); // refresh LRU position
    return hit.text;
  }

  remember(key: string, text: string) {
    this.cache.delete(key); this.cache.set(key, { text, at: this.now() });
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
  }

  // Milliseconds to wait before a request may start (0 = now). Manual requests ignore
  // spacing and the per-minute budget, but still respect a provider-imposed pause.
  wait(automatic: boolean): number {
    const now = this.now();
    this.starts = this.starts.filter(t => now - t < 60_000);
    let until = this.blockedUntil;
    if (automatic) {
      const last = this.starts[this.starts.length - 1];
      if (last !== undefined) until = Math.max(until, last + this.minGap);
      if (this.starts.length >= this.perMinute) until = Math.max(until, this.starts[this.starts.length - this.perMinute] + 60_000);
    }
    return Math.max(0, until - now);
  }

  started() { this.starts.push(this.now()); }

  succeeded() { this.failures = 0; }

  // Exponential pause after errors: 5s, 10s, 20s… up to 2 minutes; rate limits start at 20s.
  failed(rateLimited: boolean): number {
    this.failures++;
    const pause = Math.min(120_000, (rateLimited ? 20_000 : 5_000) * 2 ** (this.failures - 1));
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + pause);
    return pause;
  }

  // Automatic requests only fire when the text gives the model something new:
  // rewrites wait for a finished sentence or a few new words, nothing repeats twice.
  worthAsking(mode: string, scope: string, text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    const previous = this.lastAuto.get(mode + '\u0000' + scope);
    if (previous === trimmed) return false;
    if (mode === 'rewrite') {
      if (trimmed.split(/\s+/).length < 4) return false;
      const sentenceEnd = /[.!?…;:]["»”’)]?$/.test(trimmed);
      const newWords = previous && trimmed.startsWith(previous) ? trimmed.slice(previous.length).trim().split(/\s+/).filter(Boolean).length : Infinity;
      if (!sentenceEnd && newWords < 5) return false;
    }
    return true;
  }

  asked(mode: string, scope: string, text: string) {
    this.lastAuto.set(mode + '\u0000' + scope, text.trim());
    if (this.lastAuto.size > 200) this.lastAuto.delete(this.lastAuto.keys().next().value!);
  }
}
