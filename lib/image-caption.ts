import type { Node } from '@tiptap/pm/model';
import { CONTENT_HEIGHT, CONTENT_WIDTH, type ImageLayoutOp, type ImageLayoutPlan } from './image-layout.ts';
import { promptImages } from './providers.ts';

// "Sistema formattazione" on images: the AI looks at each image that has no caption, reads the text around it
// and proposes a caption consistent with that text, a short description for screen readers and a page size.
// The model answers in the "caption" mode (lib/providers.ts); this file prepares the request and applies the answer.

export type CaptionSize = 'small' | 'medium' | 'large' | 'full';
export type CaptionJob = { pos: number; grouped: boolean; src: string; width: number; height: number; text: string };
export type CaptionAnswer = { caption: string; alt: string; size: CaptionSize };

export const MAX_CAPTION_IMAGES = 8;
const FRACTION: Record<CaptionSize, number> = { small: 0.4, medium: 0.6, large: 0.8, full: 1 };
const SIZES = Object.keys(FRACTION) as CaptionSize[];
const clip = (text: string, max: number, end = false) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length <= max ? t : end ? '…' + t.slice(-max) : t.slice(0, max) + '…'; };

// What the model needs to tie the image to the text: the heading above and the passages on both sides.
export function imageContext(doc: Node, pos: number): string {
  const blocks: Node[] = []; let index = -1;
  doc.forEach((node, offset) => { if (offset === pos) index = blocks.length; blocks.push(node); });
  if (index < 0) return '';
  const readable = (n: Node) => n.type.name !== 'image' && n.textContent.trim().length > 0;
  let before = '', after = '', heading = '';
  for (let i = index - 1; i >= 0; i--) {
    if (!readable(blocks[i])) continue;
    if (!before) before = blocks[i].textContent;
    if (blocks[i].type.name === 'heading') { heading = blocks[i].textContent; break; }
    if (before && heading) break;
  }
  for (let i = index + 1; i < blocks.length; i++) { if (readable(blocks[i])) { after = blocks[i].textContent; break; } }
  const lines = [heading && `Heading above: ${clip(heading, 160)}`, before && `Passage before the image: ${clip(before, 700, true)}`, after && `Passage after the image: ${clip(after, 700)}`].filter(Boolean);
  return lines.join('\n') || '(the image has no text around it)';
}

// Images the AI can read: embedded PNG, JPEG or WebP; others (links, other formats, too large) keep their size and layout only.
export function captionJobs(doc: Node, plan: Pick<ImageLayoutPlan, 'uncaptioned'>, limit = MAX_CAPTION_IMAGES): { jobs: CaptionJob[]; unreadable: number; over: number } {
  const jobs: CaptionJob[] = []; let unreadable = 0, over = 0;
  for (const { pos, grouped } of plan.uncaptioned) {
    const node = doc.nodeAt(pos); if (!node || node.type.name !== 'image') continue;
    const src = String(node.attrs.src || '');
    if (!promptImages([src]).length) { unreadable++; continue; }
    if (jobs.length >= limit) { over++; continue; }
    jobs.push({ pos, grouped, src, width: Number(node.attrs.width) || 0, height: Number(node.attrs.height) || 0, text: imageContext(doc, pos) });
  }
  return { jobs, unreadable, over };
}

// The model's JSON, however it is wrapped (fences, a sentence around it). Anything unusable yields null.
export function parseCaptionAnswer(answer: string): CaptionAnswer | null {
  const start = answer.indexOf('{'), end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(answer.slice(start, end + 1)); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const caption = typeof r.caption === 'string' ? r.caption.replace(/\s+/g, ' ').trim().replace(/^["“«]+|["”»]+$/g, '').trim() : '';
  if (caption.length < 3 || caption.length > 300) return null;
  const alt = typeof r.alt === 'string' ? clip(r.alt, 200) : '';
  const size = SIZES.includes(r.size as CaptionSize) ? r.size as CaptionSize : 'medium';
  return { caption, alt, size };
}

// Display size for the chosen class: a fraction of the page width, never taller than the page.
export function sizeFor(size: CaptionSize, width: number, height: number): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = Math.min(CONTENT_WIDTH * FRACTION[size] / width, CONTENT_HEIGHT / height);
  return { width: Math.max(40, Math.round(width * ratio)), height: Math.max(40, Math.round(height * ratio)) };
}

// Adds the captions and sizes chosen by the AI to the layout plan. A single image takes the size the AI chose;
// images of a sequence keep their common width.
export function withCaptions(ops: ImageLayoutOp[], jobs: CaptionJob[], answers: Map<number, CaptionAnswer>): ImageLayoutOp[] {
  const result = ops.map(op => ({ ...op }));
  for (const job of jobs) {
    const answer = answers.get(job.pos); if (!answer) continue;
    let op = result.find(o => o.image === job.pos && o.kind === 'image');
    if (!op) { op = { kind: 'image', image: job.pos, empties: [], grouped: job.grouped }; result.push(op); }
    op.newCaption = answer.caption;
    if (answer.alt) op.alt = answer.alt;
    if (!job.grouped) { const size = sizeFor(answer.size, job.width, job.height); if (size && (size.width !== job.width || size.height !== job.height)) op.size = size; else delete op.size; }
  }
  return result;
}

// The request for one image (mode "caption").
export function captionPayload(profile: string, job: CaptionJob) {
  return { profile, mode: 'caption', text: job.text, images: [job.src] };
}
