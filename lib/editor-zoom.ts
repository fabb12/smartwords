export type EditorZoom = 'page' | 'width' | number;
export const ZOOM_MIN = 15, ZOOM_MAX = 250;
export function sanitizeZoom(value: unknown): EditorZoom {
  if (value === 'page' || value === 'width') return value;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value))) : 'page';
}
export function readEditorZoom(): EditorZoom {
  try { return sanitizeZoom(JSON.parse(localStorage.getItem('scrivia:zoom') || '"page"')); } catch { return 'page'; }
}
export function storeEditorZoom(value: EditorZoom) {
  try { localStorage.setItem('scrivia:zoom', JSON.stringify(sanitizeZoom(value))); } catch { /* The current view still works if storage is full. */ }
}
