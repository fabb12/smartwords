export type EditorShortcut = 'format' | 'format-document' | 'format-page' | 'rewrite' | 'complete' | 'save' | 'find' | 'shortcuts';
export function editorShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'repeat'>): EditorShortcut | null {
  if (event.isComposing || event.repeat) return null;
  const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
  if (key === 'tab' && event.shiftKey && !mod && !event.altKey) return 'format';
  if (key === 'f1' && !mod && !event.altKey && !event.shiftKey) return 'shortcuts';
  if (!mod) return null;
  if (key === 'p' && event.altKey && !event.shiftKey) return 'format-page';
  if (event.altKey) return null;
  if (key === 'enter') return event.shiftKey ? 'rewrite' : 'complete';
  if (key === 'f') return event.shiftKey ? 'format-document' : 'find';
  if (key === 's' && !event.shiftKey) return 'save';
  return null;
}
