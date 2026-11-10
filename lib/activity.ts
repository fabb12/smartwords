// Working time and statistics of the documents.
//
// Working time is the time spent actually writing: the clock runs only while the page is visible and the
// writer touched the keyboard, mouse or screen within the last minute. Pure helpers, shared by the
// browser store and the cloud store.

export const IDLE_MS = 60_000;
const MAX_STEP_MS = 5_000; // a throttled or suspended timer never adds more than this per tick

export class WorkClock {
  private last: number | null = null;
  private touched = 0;
  private pendingMs = 0;
  private readonly idleMs: number;
  constructor(idleMs = IDLE_MS) { this.idleMs = idleMs; }
  touch(now: number) { this.touched = now; }
  tick(now: number, visible: boolean) {
    const step = this.last === null ? 0 : Math.min(Math.max(0, now - this.last), MAX_STEP_MS);
    this.last = now;
    if (visible && step > 0 && now - this.touched <= this.idleMs) this.pendingMs += step;
  }
  // Whole seconds to send; the remainder is kept for the next delivery.
  take(): number { const seconds = Math.floor(this.pendingMs / 1000); this.pendingMs -= seconds * 1000; return seconds; }
  peek(): number { return Math.floor(this.pendingMs / 1000); }
  // Gives back seconds that could not be delivered.
  restore(seconds: number) { this.pendingMs += Math.max(0, seconds) * 1000; }
}

export const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function wordCount(text: string): number { return text.trim().split(/\s+/).filter(Boolean).length; }

export type ActivityDay = { day: string; seconds: number; words: number };
export type UserStats = { documents: number; words: number; characters: number; workSeconds: number; firstDocumentAt: number | null; days: ActivityDay[] };
export const EMPTY_STATS: UserStats = { documents: 0, words: 0, characters: 0, workSeconds: 0, firstDocumentAt: null, days: [] };

const int = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
export function sanitizeStats(raw: unknown): UserStats {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const days = (Array.isArray(r.days) ? r.days : []).flatMap((d): ActivityDay[] => {
    const x = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    return typeof x.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.day) ? [{ day: x.day, seconds: int(x.seconds), words: int(x.words) }] : [];
  }).sort((a, b) => a.day.localeCompare(b.day));
  const first = typeof r.firstDocumentAt === 'string' ? Date.parse(r.firstDocumentAt) : typeof r.firstDocumentAt === 'number' ? r.firstDocumentAt : NaN;
  return { documents: int(r.documents), words: int(r.words), characters: int(r.characters), workSeconds: int(r.workSeconds), firstDocumentAt: Number.isFinite(first) ? first : null, days };
}

const addDays = (day: string, n: number) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); };

// Consecutive days with writing, ending today (or yesterday, if today has not started yet).
export function writingStreak(days: ActivityDay[], today: string): number {
  const active = new Set(days.filter(d => d.seconds > 0 || d.words > 0).map(d => d.day));
  let cursor = active.has(today) ? today : addDays(today, -1), streak = 0;
  while (active.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}

// The last `count` days ending today, with the days without activity filled in.
export function recentDays(days: ActivityDay[], today: string, count = 14): ActivityDay[] {
  const byDay = new Map(days.map(d => [d.day, d]));
  return Array.from({ length: count }, (_, i) => { const day = addDays(today, i - count + 1); return byDay.get(day) || { day, seconds: 0, words: 0 }; });
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return s + ' s';
  const minutes = Math.round(s / 60);
  if (minutes < 60) return minutes + ' min';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
// Average reading speed for adults: about 230 words per minute.
export const readingMinutes = (words: number) => words ? Math.max(1, Math.round(words / 230)) : 0;
export const wordsPerHour = (words: number, seconds: number) => seconds >= 60 ? Math.round(words / (seconds / 3600)) : 0;

export type DocStats = { created: number; updated: number; words: number; chars: number; workSeconds: number; edits: number; opens: number; lastOpened: number | null };
export const EMPTY_DOC_STATS: DocStats = { created: 0, updated: 0, words: 0, chars: 0, workSeconds: 0, edits: 0, opens: 0, lastOpened: null };

// Plain text of a Tiptap/ProseMirror document, one line per block: used to count words of stored documents.
type DocNode = { type?: string; text?: string; content?: DocNode[] };
const isInline = (n: DocNode) => n.type === 'text' || n.type === 'hardBreak';
function blockLines(node: DocNode): string[] {
  const children = (Array.isArray(node.content) ? node.content : []).filter(c => c && typeof c === 'object');
  if (children.every(isInline)) return [children.map(c => c.type === 'hardBreak' ? '\n' : typeof c.text === 'string' ? c.text : '').join('')];
  return children.flatMap(blockLines);
}
export function docText(doc: unknown): string {
  return doc && typeof doc === 'object' ? blockLines(doc as DocNode).join('\n') : '';
}
