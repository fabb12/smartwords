// Automatic chart for a concept (right-click → «Genera grafico»). The model only describes the figure as a small JSON:
// data taken from the text, or a diagram (process, concept map) when the text has no numbers. The browser draws it as SVG,
// so what ends up in the document is always a clean, consistent figure and never a picture invented by the model.

export type ChartType = 'bar' | 'line' | 'pie' | 'flow' | 'map';
export type ChartSeries = { name: string; values: number[] };
export type ChartSpec = { type: ChartType; title: string; caption: string; alt: string; unit: string; labels: string[]; series: ChartSeries[]; steps: string[]; center: string; branches: string[] };

export const CHART_WIDTH = 800;
export const CHART_HEIGHT = 500;

const clip = (value: unknown, max: number) => { const t = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…'; };
const strings = (value: unknown, min: number, max: number, length: number): string[] | null => {
  if (!Array.isArray(value)) return null;
  const list = value.map(v => clip(typeof v === 'number' ? String(v) : v, length)).filter(Boolean);
  return list.length >= min && list.length <= max ? list : null;
};

// The model's JSON, however it is wrapped. Anything unusable (or {"type":"none"}) yields null.
export function parseChartAnswer(answer: string): ChartSpec | null {
  const start = answer.indexOf('{'), end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(answer.slice(start, end + 1)); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as ChartType;
  if (!['bar', 'line', 'pie', 'flow', 'map'].includes(type)) return null;
  const caption = clip(r.caption, 300).replace(/^["“«]+|["”»]+$/g, '').trim();
  if (caption.length < 3) return null;
  const spec: ChartSpec = { type, title: clip(r.title, 70), caption, alt: clip(r.alt, 200), unit: clip(r.unit, 16), labels: [], series: [], steps: [], center: '', branches: [] };
  if (type === 'flow') { const steps = strings(r.steps, 2, 7, 44); if (!steps) return null; spec.steps = steps; return spec; }
  if (type === 'map') {
    const branches = strings(r.branches, 3, 7, 36), center = clip(r.center, 48);
    if (!branches || !center) return null;
    spec.center = center; spec.branches = branches; return spec;
  }
  const labels = strings(r.labels, 2, type === 'pie' ? 6 : 8, 26);
  if (!labels || !Array.isArray(r.series)) return null;
  const series: ChartSeries[] = [];
  for (const s of r.series.slice(0, type === 'pie' ? 1 : 3)) {
    if (!s || typeof s !== 'object') return null;
    const values = (s as Record<string, unknown>).values;
    if (!Array.isArray(values) || values.length !== labels.length || values.some(v => typeof v !== 'number' || !Number.isFinite(v))) return null;
    if (type !== 'line' && values.some(v => (v as number) < 0)) return null;
    series.push({ name: clip((s as Record<string, unknown>).name, 28) || 'Serie ' + (series.length + 1), values: values as number[] });
  }
  if (!series.length) return null;
  if (type === 'pie' && !(series[0].values.reduce((a, b) => a + b, 0) > 0)) return null;
  if (type !== 'pie' && series.every(s => s.values.every(v => v === 0))) return null;
  spec.labels = labels; spec.series = series;
  return spec;
}

// ---- drawing -------------------------------------------------------------------------------------------------------

const INK = '#0b0b0b', MUTED = '#52514e', GRID = '#e4e4e0', AXIS = '#8a8a85', SURFACE = '#ffffff';
// Categorical colours in fixed order (the first three are validated together for colour-blind readers).
export const CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
const FONT = 'Arial, Helvetica, sans-serif';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const formatNumber = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 });
const fmt = (n: number, unit: string) => formatNumber(n) + (unit ? (unit === '%' ? '' : ' ') + unit : '');

// Greedy word wrap; the last line is shortened with an ellipsis when the text does not fit.
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = [];
  let line = '';
  for (const raw of words) {
    const word = raw.length > maxChars ? raw.slice(0, maxChars - 1) + '…' : raw;
    if (line && (line + ' ' + word).length > maxChars) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); const last = kept[maxLines - 1]; kept[maxLines - 1] = (last.length >= maxChars ? last.slice(0, maxChars - 1) : last) + '…'; return kept; }
  return lines;
}

// "Nice" axis ticks covering [lo, hi].
export function niceTicks(lo: number, hi: number, count = 5): { ticks: number[]; min: number; max: number } {
  if (hi === lo) { hi = lo + (lo === 0 ? 1 : Math.abs(lo) * 0.1); }
  const rough = (hi - lo) / count, power = Math.pow(10, Math.floor(Math.log10(rough))), base = rough / power;
  const step = (base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10) * power;
  const min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step, ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, min: ticks[0], max: ticks[ticks.length - 1] };
}

const text = (x: number, y: number, content: string, o: { size?: number; weight?: string; fill?: string; anchor?: string } = {}) =>
  `<text x="${r(x)}" y="${r(y)}" font-size="${o.size ?? 13}" font-weight="${o.weight ?? 'normal'}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? 'start'}">${esc(content)}</text>`;
const r = (n: number) => Math.round(n * 10) / 10;
const lines = (x: number, y: number, rows: string[], lineHeight: number, o: Parameters<typeof text>[3] = {}) => rows.map((row, i) => text(x, y + i * lineHeight, row, o)).join('');
// A bar whose far end is rounded (4 px); the end on the axis stays square.
function barPath(x: number, base: number, w: number, top: number) {
  const h = Math.abs(top - base), rad = Math.min(4, w / 2, h), up = top < base;
  if (h < 0.5) return '';
  return up
    ? `M${r(x)} ${r(base)}V${r(top + rad)}Q${r(x)} ${r(top)} ${r(x + rad)} ${r(top)}H${r(x + w - rad)}Q${r(x + w)} ${r(top)} ${r(x + w)} ${r(top + rad)}V${r(base)}Z`
    : `M${r(x)} ${r(base)}V${r(top - rad)}Q${r(x)} ${r(top)} ${r(x + rad)} ${r(top)}H${r(x + w - rad)}Q${r(x + w)} ${r(top)} ${r(x + w)} ${r(top - rad)}V${r(base)}Z`;
}

function frame(spec: ChartSpec, body: string) {
  const title = spec.title ? text(40, 44, spec.title, { size: 20, weight: 'bold' }) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" font-family="${FONT}" role="img" aria-label="${esc(spec.alt || spec.title || spec.caption)}"><rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="${SURFACE}"/>${title}${body}</svg>`;
}

function legend(series: ChartSeries[], y: number) {
  let x = 40; const items: string[] = [];
  for (const [i, s] of series.entries()) {
    items.push(`<rect x="${x}" y="${y - 10}" width="12" height="12" rx="2" fill="${CHART_COLORS[i]}"/>` + text(x + 18, y, s.name, { size: 13, fill: MUTED }));
    x += 18 + s.name.length * 7.2 + 26;
  }
  return items.join('');
}

function cartesian(spec: ChartSpec): string {
  const left = 76, right = CHART_WIDTH - 36, top = spec.series.length > 1 ? 108 : 96, bottom = 412, n = spec.labels.length, k = spec.series.length;
  const all = spec.series.flatMap(s => s.values), bar = spec.type === 'bar';
  const { ticks, min, max } = niceTicks(bar ? Math.min(0, ...all) : Math.min(...all), bar ? Math.max(0, ...all) : Math.max(...all));
  const y = (v: number) => bottom - (v - min) / (max - min) * (bottom - top), zero = y(Math.max(min, Math.min(0, max)));
  const band = (right - left) / n;
  let out = spec.series.length > 1 ? legend(spec.series, 80) : '';
  if (spec.unit) out += text(left - 10, top - 14, spec.unit, { size: 12, fill: MUTED, anchor: 'end' });
  for (const t of ticks) out += `<line x1="${left}" x2="${right}" y1="${r(y(t))}" y2="${r(y(t))}" stroke="${GRID}" stroke-width="1"/>` + text(left - 10, y(t) + 4, formatNumber(t), { size: 12, fill: MUTED, anchor: 'end' });
  out += `<line x1="${left}" x2="${right}" y1="${r(zero)}" y2="${r(zero)}" stroke="${AXIS}" stroke-width="1.5"/>`;
  const chars = Math.max(6, Math.floor(band / 6.8));
  spec.labels.forEach((label, i) => { out += lines(left + band * (i + 0.5), bottom + 26, wrapText(label, chars, 2), 15, { size: 12.5, fill: MUTED, anchor: 'middle' }); });
  if (bar) {
    const groupWidth = band * 0.72, gap = 2, width = Math.min(72, (groupWidth - gap * (k - 1)) / k);
    spec.series.forEach((s, j) => s.values.forEach((v, i) => {
      const x = left + band * (i + 0.5) - (width * k + gap * (k - 1)) / 2 + j * (width + gap);
      out += `<path d="${barPath(x, zero, width, y(v))}" fill="${CHART_COLORS[j]}"/>`;
      if (k === 1) out += text(x + width / 2, v >= 0 ? y(v) - 8 : y(v) + 16, fmt(v, spec.unit), { size: 12.5, weight: 'bold', anchor: 'middle' });
    }));
  } else {
    spec.series.forEach((s, j) => {
      const points = s.values.map((v, i) => [left + band * (i + 0.5), y(v)] as const);
      out += `<polyline points="${points.map(p => r(p[0]) + ',' + r(p[1])).join(' ')}" fill="none" stroke="${CHART_COLORS[j]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      points.forEach((p, i) => {
        out += `<circle cx="${r(p[0])}" cy="${r(p[1])}" r="4.5" fill="${CHART_COLORS[j]}" stroke="${SURFACE}" stroke-width="2"/>`;
        if (k === 1 && (i === 0 || i === n - 1 || s.values[i] === Math.max(...s.values))) out += text(p[0], p[1] - 12, fmt(s.values[i], spec.unit), { size: 12.5, weight: 'bold', anchor: 'middle' });
      });
    });
  }
  return out;
}

function pie(spec: ChartSpec): string {
  const values = spec.series[0].values, total = values.reduce((a, b) => a + b, 0), cx = 250, cy = 270, radius = 165;
  let out = '', angle = -Math.PI / 2;
  const slices = values.map((v, i) => ({ v, i })).filter(s => s.v > 0);
  for (const { v, i } of slices) {
    const share = v / total, next = angle + share * Math.PI * 2;
    if (slices.length === 1) out += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${CHART_COLORS[i]}"/>`;
    else {
      const x1 = cx + radius * Math.cos(angle), y1 = cy + radius * Math.sin(angle), x2 = cx + radius * Math.cos(next), y2 = cy + radius * Math.sin(next);
      out += `<path d="M${cx} ${cy}L${r(x1)} ${r(y1)}A${radius} ${radius} 0 ${share > 0.5 ? 1 : 0} 1 ${r(x2)} ${r(y2)}Z" fill="${CHART_COLORS[i]}" stroke="${SURFACE}" stroke-width="2"/>`;
    }
    angle = next;
  }
  const rows = spec.labels.length, startY = 270 - (rows - 1) * 21;
  spec.labels.forEach((label, i) => {
    const y = startY + i * 42, pct = Math.round(values[i] / total * 1000) / 10;
    out += `<rect x="470" y="${r(y - 12)}" width="14" height="14" rx="2" fill="${CHART_COLORS[i]}"/>` + text(494, y, label, { size: 15 }) + text(494, y + 17, `${fmt(values[i], spec.unit)} · ${formatNumber(pct)}%`, { size: 12.5, fill: MUTED });
  });
  return out;
}

const arrowHead = (x: number, y: number, dx: number, dy: number) => {
  const px = -dy, py = dx;
  return `<polygon points="${r(x)},${r(y)} ${r(x - dx * 10 + px * 5)},${r(y - dy * 10 + py * 5)} ${r(x - dx * 10 - px * 5)},${r(y - dy * 10 - py * 5)}" fill="${MUTED}"/>`;
};
const arrow = (x1: number, y1: number, x2: number, y2: number) => {
  const length = Math.hypot(x2 - x1, y2 - y1), dx = (x2 - x1) / length, dy = (y2 - y1) / length;
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2 - dx * 9)}" y2="${r(y2 - dy * 9)}" stroke="${MUTED}" stroke-width="2"/>` + arrowHead(x2, y2, dx, dy);
};

// Steps in rows of four; a second row runs right to left under the first (a snake), so the order is always readable.
function flow(spec: ChartSpec): string {
  const n = spec.steps.length, perRow = 4, boxW = 150, boxH = 92, gap = 44, rowsCount = n > perRow ? 2 : 1;
  const rowWidth = (count: number) => count * boxW + (count - 1) * gap, firstX = (CHART_WIDTH - rowWidth(Math.min(n, perRow))) / 2;
  const rowY = rowsCount === 1 ? 200 : 128, step = 156;
  const place = (i: number) => {
    const row = Math.floor(i / perRow), col = i % perRow, lastRow = rowsCount === 2 && row === 1;
    const x = row === 0 ? firstX + col * (boxW + gap) : firstX + (Math.min(n, perRow) - 1 - col) * (boxW + gap);
    return { x, y: rowY + row * step, row, lastRow };
  };
  let out = '';
  for (let i = 0; i < n - 1; i++) {
    const a = place(i), b = place(i + 1);
    if (a.row === b.row) out += a.x < b.x ? arrow(a.x + boxW + 4, a.y + boxH / 2, b.x - 4, b.y + boxH / 2) : arrow(a.x - 4, a.y + boxH / 2, b.x + boxW + 4, b.y + boxH / 2);
    else out += arrow(a.x + boxW / 2, a.y + boxH + 4, b.x + boxW / 2, b.y - 4);
  }
  spec.steps.forEach((label, i) => {
    const p = place(i), rows = wrapText(label, 17, 3), top = p.y + boxH / 2 - (rows.length - 1) * 9 + 5;
    out += `<rect x="${r(p.x)}" y="${r(p.y)}" width="${boxW}" height="${boxH}" rx="10" fill="#eaf2fc" stroke="${CHART_COLORS[0]}" stroke-width="1.5"/>`
      + `<circle cx="${r(p.x + 4)}" cy="${r(p.y + 4)}" r="13" fill="${CHART_COLORS[0]}"/>` + text(p.x + 4, p.y + 9, String(i + 1), { size: 13, weight: 'bold', fill: '#ffffff', anchor: 'middle' })
      + lines(p.x + boxW / 2, top, rows, 18, { size: 14, anchor: 'middle' });
  });
  return out;
}

// A concept in the middle and its parts around it.
function conceptMap(spec: ChartSpec): string {
  const n = spec.branches.length, cx = CHART_WIDTH / 2, cy = 272, rx = 285, ry = 160, boxW = 156, boxH = 54;
  let out = '';
  const spots = spec.branches.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });
  for (const s of spots) out += `<line x1="${cx}" y1="${cy}" x2="${r(s.x)}" y2="${r(s.y)}" stroke="${AXIS}" stroke-width="1.5"/>`;
  spec.branches.forEach((label, i) => {
    const s = spots[i], rows = wrapText(label, 21, 2);
    out += `<rect x="${r(s.x - boxW / 2)}" y="${r(s.y - boxH / 2)}" width="${boxW}" height="${boxH}" rx="10" fill="${SURFACE}" stroke="${CHART_COLORS[0]}" stroke-width="1.5"/>` + lines(s.x, s.y - (rows.length - 1) * 8 + 5, rows, 17, { size: 13.5, anchor: 'middle' });
  });
  const centre = wrapText(spec.center, 24, 3);
  out += `<rect x="${cx - 115}" y="${cy - 46}" width="230" height="92" rx="14" fill="${CHART_COLORS[0]}"/>` + lines(cx, cy - (centre.length - 1) * 10 + 6, centre, 20, { size: 16.5, weight: 'bold', fill: '#ffffff', anchor: 'middle' });
  return out;
}

export function chartSvg(spec: ChartSpec): { svg: string; width: number; height: number } {
  const body = spec.type === 'pie' ? pie(spec) : spec.type === 'flow' ? flow(spec) : spec.type === 'map' ? conceptMap(spec) : cartesian(spec);
  return { svg: frame(spec, body), width: CHART_WIDTH, height: CHART_HEIGHT };
}

// Browser only: the SVG as a PNG (twice the size, on white) that can be embedded like any other image.
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  try { await image.decode(); } catch { throw new Error('Impossibile disegnare il grafico in questo browser.'); }
  const canvas = document.createElement('canvas'); canvas.width = width * scale; canvas.height = height * scale;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Impossibile preparare il grafico in questo browser.');
  context.fillStyle = SURFACE; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Impossibile preparare il grafico.');
  return blob;
}
