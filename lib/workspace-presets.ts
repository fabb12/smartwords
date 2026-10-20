import { defaultToolbarLayout, sanitizeToolbarLayout, type ToolbarLayout } from './toolbar-layout.ts';
import { sanitizeZoom, type EditorZoom } from './editor-zoom.ts';

export type WorkspaceFrame = { tools: { document: boolean; text: boolean; paragraph: boolean; insert: boolean }; library: boolean; assistant: boolean; navigation: boolean; info: boolean; focus: boolean; pages: number; zoom: EditorZoom };
export type WorkspacePreset = { id: string; name: string; description?: string; frame: WorkspaceFrame; layout: ToolbarLayout };
const all = { document: true, text: true, paragraph: true, insert: true };
export const DEFAULT_WORKSPACE_FRAME: WorkspaceFrame = { tools: all, library: true, assistant: true, navigation: false, info: true, focus: false, pages: 1, zoom: 'page' };
export const BUILTIN_WORKSPACES: WorkspacePreset[] = [
  { id: 'writing', name: 'Scrittura', description: 'Capitoli a sinistra e spazio al testo, con i comandi essenziali.', frame: { ...DEFAULT_WORKSPACE_FRAME, tools: { document: false, text: false, paragraph: false, insert: false }, library: false, assistant: false, navigation: true }, layout: defaultToolbarLayout() },
  { id: 'review', name: 'Revisione', description: 'Struttura e assistente affiancati per rileggere e correggere.', frame: { ...DEFAULT_WORKSPACE_FRAME, tools: { ...all, insert: false }, library: false, navigation: true }, layout: defaultToolbarLayout() },
  { id: 'layout', name: 'Impaginazione', description: 'Foglio alla larghezza disponibile e strumenti di testo e inserimento.', frame: { ...DEFAULT_WORKSPACE_FRAME, library: false, assistant: false, navigation: false, zoom: 'width' }, layout: defaultToolbarLayout() },
  { id: 'complete', name: 'Completo', description: 'Tutti i gruppi, l’elenco documenti e l’assistente.', frame: DEFAULT_WORKSPACE_FRAME, layout: defaultToolbarLayout() },
];
export function sanitizeWorkspaceFrame(raw: unknown): WorkspaceFrame {
  const fallback = DEFAULT_WORKSPACE_FRAME;
  if (!raw || typeof raw !== 'object') return { ...fallback, tools: { ...all } };
  const value = raw as Partial<WorkspaceFrame>;
  const flag = (key: 'library' | 'assistant' | 'navigation' | 'info' | 'focus') => typeof value[key] === 'boolean' ? value[key] : fallback[key];
  return { tools: Object.fromEntries(Object.entries(all).map(([key, on]) => [key, typeof value.tools?.[key as keyof typeof all] === 'boolean' ? value.tools[key as keyof typeof all] : on])) as WorkspaceFrame['tools'], library: flag('library'), assistant: flag('assistant'), navigation: flag('navigation'), info: flag('info'), focus: flag('focus'), pages: [0,1,2,3,4,6].includes(value.pages!) ? value.pages! : 1, zoom: sanitizeZoom(value.zoom) };
}
export const workspacePresetsKey = (owner: string) => `scrivia:workspace-presets:v1:${encodeURIComponent(owner)}`;
export const workspaceFrameKey = (owner: string, fullscreen: boolean) => `scrivia:workspace-frame:v1:${encodeURIComponent(owner)}:${fullscreen ? 'fullscreen' : 'normal'}`;
export function readWorkspacePresets(owner: string): WorkspacePreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(workspacePresetsKey(owner)) || '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.slice(0,20).flatMap(value => {
      if (!value || typeof value.id !== 'string' || value.id.length > 100 || !value.id.startsWith('custom:') || seen.has(value.id) || typeof value.name !== 'string' || !value.name.trim()) return [];
      seen.add(value.id); return [{ id: value.id.slice(0,100), name: value.name.trim().slice(0,60), frame: sanitizeWorkspaceFrame(value.frame), layout: sanitizeToolbarLayout(value.layout) }];
    });
  } catch { return []; }
}
export function storeWorkspacePresets(owner: string, presets: WorkspacePreset[]): boolean {
  try { localStorage.setItem(workspacePresetsKey(owner), JSON.stringify(presets)); return true; } catch { return false; }
}
export function readWorkspaceFrame(key: string): WorkspaceFrame | null {
  try { const raw = localStorage.getItem(key); return raw ? sanitizeWorkspaceFrame(JSON.parse(raw)) : null; } catch { return null; }
}
export function storeWorkspaceFrame(key: string, frame: WorkspaceFrame) {
  try { localStorage.setItem(key, JSON.stringify(frame)); } catch { /* The current workspace still works without storage. */ }
}
