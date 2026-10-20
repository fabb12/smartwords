export const TOOLBAR_IDS = ['primary', 'document', 'view', 'edit', 'emphasis', 'text', 'paragraph', 'insert', 'zoom'] as const;
export type ToolbarId = typeof TOOLBAR_IDS[number];
export const DOCK_SIDES = ['top', 'left', 'right', 'bottom'] as const;
export type DockSide = typeof DOCK_SIDES[number];
export type ToolbarPlace = DockSide | 'floating';
export type ToolbarPosition = { dock: ToolbarPlace; x: number; y: number };
export type ToolbarLayout = { order: ToolbarId[]; positions: Record<ToolbarId, ToolbarPosition> };

export const isToolbarId = (value: unknown): value is ToolbarId => TOOLBAR_IDS.includes(value as ToolbarId);
export const isDockSide = (value: unknown): value is DockSide => DOCK_SIDES.includes(value as DockSide);
const fraction = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
export function defaultToolbarLayout(): ToolbarLayout {
  return { order: [...TOOLBAR_IDS], positions: Object.fromEntries(TOOLBAR_IDS.map(id => [id, { dock: 'top', x: .2, y: .15 }])) as ToolbarLayout['positions'] };
}
export function sanitizeToolbarLayout(raw: unknown): ToolbarLayout {
  const layout = defaultToolbarLayout();
  if (!raw || typeof raw !== 'object') return layout;
  const value = raw as Partial<ToolbarLayout>;
  if (Array.isArray(value.order)) layout.order = [...new Set([...value.order.filter(isToolbarId), ...TOOLBAR_IDS])];
  for (const id of TOOLBAR_IDS) {
    const position = value.positions?.[id];
    if (position && (isDockSide(position.dock) || position.dock === 'floating'))
      layout.positions[id] = { dock: position.dock, x: fraction(position.x, .2), y: fraction(position.y, .15) };
  }
  return layout;
}
export function moveToolbarGroup(layout: ToolbarLayout, id: ToolbarId, dock: ToolbarPlace, over?: ToolbarId, after = false, point?: { x: number; y: number }): ToolbarLayout {
  if (over === id && layout.positions[id].dock === dock && !point) return layout;
  const order = layout.order.filter(other => other !== id);
  let index = over ? order.indexOf(over) + (after ? 1 : 0) : -1;
  if (index < 0) { const last = order.findLastIndex(other => layout.positions[other].dock === dock); index = last < 0 ? order.length : last + 1; }
  order.splice(index, 0, id);
  const before = layout.positions[id];
  return { order, positions: { ...layout.positions, [id]: { dock, x: fraction(point?.x, before.x), y: fraction(point?.y, before.y) } } };
}
export const toolbarLayoutKey = (owner: string, fullscreen: boolean) => `scrivia:toolbars:v1:${encodeURIComponent(owner)}:${fullscreen ? 'fullscreen' : 'normal'}`;
export function readToolbarLayout(key: string): ToolbarLayout {
  try { return sanitizeToolbarLayout(JSON.parse(localStorage.getItem(key) || 'null')); } catch { return defaultToolbarLayout(); }
}
export function storeToolbarLayout(key: string, layout: ToolbarLayout) {
  try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* Rearrangement still works when storage is unavailable. */ }
}
