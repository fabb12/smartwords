// Token accounting stores only daily counters and model names, never text or keys.
export type ProviderUsage = { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number };
export type TokenUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; totalTokens: number; estimated: boolean };
export type UsageEvent = TokenUsage & { provider: string; model: string };
export type UsageBucket = Omit<TokenUsage, 'totalTokens' | 'estimated'> & {
  day: string; provider: string; model: string; requests: number; estimatedRequests: number; interruptedRequests: number;
};
export const TOKEN_USAGE_EVENT = 'scrivia:token-usage-changed';
export const tokenUsageKey = (owner = 'local') => 'scrivia:token-usage:' + encodeURIComponent(owner);
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
export const tokenCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

export function finalizeUsage(usage: ProviderUsage, system: string, prompt: string, answer: string): TokenUsage {
  const inputTokens = tokenCount(usage.inputTokens) ? usage.inputTokens : estimateTokens(system + '\n' + prompt);
  const outputTokens = tokenCount(usage.outputTokens) ? usage.outputTokens : estimateTokens(answer);
  return { inputTokens, outputTokens, cachedInputTokens: Math.min(inputTokens, tokenCount(usage.cachedInputTokens) ? usage.cachedInputTokens : 0),
    totalTokens: inputTokens + outputTokens, estimated: !tokenCount(usage.inputTokens) || !tokenCount(usage.outputTokens) };
}

export function parseUsageEvent(raw: unknown): UsageEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.provider !== 'string' || !/^[a-z][a-z0-9_-]{0,30}$/.test(r.provider)
    || typeof r.model !== 'string' || !r.model.trim() || r.model.length > 150
    || !tokenCount(r.inputTokens) || !tokenCount(r.outputTokens) || !tokenCount(r.cachedInputTokens)
    || !Number.isSafeInteger(r.inputTokens + r.outputTokens)) return null;
  return { provider: r.provider, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
    cachedInputTokens: Math.min(r.cachedInputTokens, r.inputTokens), totalTokens: r.inputTokens + r.outputTokens, estimated: r.estimated !== false };
}

const DAY = 86_400_000;
export function sanitizeTokenHistory(raw: unknown, now = Date.now()): UsageBucket[] {
  if (!Array.isArray(raw)) return [];
  const today = new Date(now).toISOString().slice(0, 10), oldest = new Date(now - 89 * DAY).toISOString().slice(0, 10);
  const result: UsageBucket[] = [];
  for (const row of raw.slice(-4000)) {
    const event = parseUsageEvent(row);
    if (!event || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
      || !Number.isFinite(Date.parse(row.day)) || new Date(row.day).toISOString().slice(0, 10) !== row.day
      || row.day < oldest || row.day > today || !tokenCount(row.requests) || !row.requests
      || !tokenCount(row.estimatedRequests) || !tokenCount(row.interruptedRequests)) continue;
    result.push({ day: row.day, provider: event.provider, model: event.model, inputTokens: event.inputTokens,
      outputTokens: event.outputTokens, cachedInputTokens: event.cachedInputTokens, requests: row.requests,
      estimatedRequests: Math.min(row.requests, row.estimatedRequests), interruptedRequests: Math.min(row.requests, row.interruptedRequests) });
  }
  return result;
}

export function readTokenHistory(owner = 'local', now = Date.now()): UsageBucket[] {
  try { return sanitizeTokenHistory(JSON.parse(localStorage.getItem(tokenUsageKey(owner)) || '[]'), now); } catch { return []; }
}
export function addTokenUsage(history: UsageBucket[], event: UsageEvent, interrupted = false, now = Date.now()): UsageBucket[] {
  const rows = sanitizeTokenHistory(history, now), day = new Date(now).toISOString().slice(0, 10);
  const row = rows.find(r => r.day === day && r.provider === event.provider && r.model === event.model);
  const delta = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedInputTokens: event.cachedInputTokens,
    requests: 1, estimatedRequests: Number(event.estimated), interruptedRequests: Number(interrupted) };
  if (row) for (const k of Object.keys(delta) as (keyof typeof delta)[]) row[k] += delta[k];
  else rows.push({ day, provider: event.provider, model: event.model, ...delta });
  return rows.sort((a, b) => a.day.localeCompare(b.day)).slice(-4000);
}
export function recordTokenUsage(owner: string, event: UsageEvent, interrupted = false): boolean {
  if (!parseUsageEvent(event)) return false;
  try {
    localStorage.setItem(tokenUsageKey(owner), JSON.stringify(addTokenUsage(readTokenHistory(owner), event, interrupted)));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(TOKEN_USAGE_EVENT));
    return true;
  } catch { return false; } // Accounting must never interrupt writing or a provider response.
}

export function summarizeTokenUsage(history: UsageBucket[], days = 30, now = Date.now()) {
  const oldest = new Date(now - (Math.max(1, Math.min(90, days)) - 1) * DAY).toISOString().slice(0, 10);
  const rows = sanitizeTokenHistory(history, now).filter(r => r.day >= oldest);
  const totals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, requests: 0, estimatedRequests: 0, interruptedRequests: 0 };
  const models = new Map<string, typeof totals & { provider: string; model: string }>();
  for (const row of rows) {
    const key = JSON.stringify([row.provider, row.model]), model = models.get(key) || { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
      requests: 0, estimatedRequests: 0, interruptedRequests: 0, provider: row.provider, model: row.model };
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) { totals[k] += row[k]; model[k] += row[k]; }
    models.set(key, model);
  }
  return { ...totals, totalTokens: totals.inputTokens + totals.outputTokens,
    models: [...models.values()].sort((a, b) => b.inputTokens + b.outputTokens - a.inputTokens - a.outputTokens) };
}
