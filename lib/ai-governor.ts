// Client-side control of AI calls: caches answers, spaces out automatic requests,
// backs off after provider errors and skips requests that cannot add anything new.

export type DiffPart = { type: 'same' | 'add' | 'del'; text: string };

// Word-level diff (LCS) used to highlight what a rewrite changes. Words and
// punctuation are separate tokens, so "silenzio." → "silenzio, e…" changes only
// the punctuation. Nearby changes separated by a space form one replacement
// (deleted words, then the new ones), and joining the parts rebuilds both texts.
export function wordDiff(before: string, after: string): DiffPart[] {
  const tokens = (t: string) => t.match(/\s+|[\p{L}\p{M}\p{N}'’]+|[^\s\p{L}\p{M}\p{N}]/gu) || [];
  const a = tokens(before), b = tokens(after);
  if (a.length * b.length > 400_000) return [{ type: 'del', text: before }, { type: 'add', text: after }].filter(p => p.text) as DiffPart[];
  const n = a.length, m = b.length, lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const raw: DiffPart[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { raw.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) raw.push({ type: 'del', text: a[i++] });
    else raw.push({ type: 'add', text: b[j++] });
  }
  while (i < n) raw.push({ type: 'del', text: a[i++] });
  while (j < m) raw.push({ type: 'add', text: b[j++] });
  const parts: DiffPart[] = []; let del = '', add = '';
  const flush = () => { if (del) parts.push({ type: 'del', text: del }); if (add) parts.push({ type: 'add', text: add }); del = add = ''; };
  raw.forEach((part, k) => {
    if (part.type === 'del') { del += part.text; return; }
    if (part.type === 'add') { add += part.text; return; }
    // A space between two changes belongs to the replacement, not to unchanged text.
    if ((del || add) && /^\s+$/.test(part.text) && raw[k + 1] && raw[k + 1].type !== 'same') { del += part.text; add += part.text; return; }
    flush();
    const last = parts.at(-1);
    if (last?.type === 'same') last.text += part.text; else parts.push({ type: 'same', text: part.text });
  });
  flush();
  return parts;
}

// The part of a paragraph an automatic "improve sentence" works on: the last sentence
// before the cursor, never text the writer already accepted (`settled`, a prefix of
// the paragraph). Offsets into `text`; trailing whitespace stays out of the range.
export function sentenceTarget(text: string, settled = ''): { start: number; end: number } {
  const end = text.trimEnd().length;
  let start = settled && text.startsWith(settled) ? Math.min(settled.length, end) : 0;
  const boundary = /[.!?…]+["»”’)\]]*\s+/g; boundary.lastIndex = start;
  for (let m = boundary.exec(text); m && m.index + m[0].length <= end; m = boundary.exec(text)) start = m.index + m[0].length;
  while (start < end && /\s/.test(text[start])) start++;
  return { start, end };
}

// A rewrite that only changes spacing is not worth proposing.
export function sameText(a: string, b: string): boolean { return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim(); }

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
  // A newly selected or reconfigured profile can be tested immediately.
  resetBackoff() { this.failures = 0; this.blockedUntil = 0; }

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

  // Call only once a request produced an answer (or failed): a request cancelled because
  // the writer kept typing must not stop the same text from being asked again later.
  asked(mode: string, scope: string, text: string) {
    this.lastAuto.set(mode + '\u0000' + scope, text.trim());
    if (this.lastAuto.size > 200) this.lastAuto.delete(this.lastAuto.keys().next().value!);
  }
}
