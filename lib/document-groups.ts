// Groups for the document list ("Recenti"): named folders that hold documents.
// They are kept on this device, per account; a document belongs to at most one group.

export type DocGroup = { id: string; name: string; collapsed?: boolean };
export type GroupState = { groups: DocGroup[]; assign: Record<string, string> };
export const EMPTY_GROUPS: GroupState = { groups: [], assign: {} };
const MAX_GROUPS = 50, MAX_NAME = 60;

export const groupsKey = (owner: string) => 'scrivia:doc-groups:' + owner;
const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

export function sanitizeGroups(value: unknown): GroupState {
  if (!value || typeof value !== 'object') return EMPTY_GROUPS;
  const raw = value as { groups?: unknown; assign?: unknown };
  const seen = new Set<string>();
  const groups = (Array.isArray(raw.groups) ? raw.groups : []).flatMap((g): DocGroup[] => {
    if (!g || typeof g !== 'object') return [];
    const { id, name, collapsed } = g as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string' || !cleanName(name)) return [];
    seen.add(id);
    return [{ id, name: cleanName(name), ...(collapsed === true ? { collapsed: true } : {}) }];
  }).slice(0, MAX_GROUPS);
  const assign: Record<string, string> = {};
  if (raw.assign && typeof raw.assign === 'object')
    for (const [doc, group] of Object.entries(raw.assign as Record<string, unknown>))
      if (typeof group === 'string' && seen.has(group)) assign[doc] = group;
  return { groups, assign };
}

export function readGroups(owner: string): GroupState {
  try { return sanitizeGroups(JSON.parse(localStorage.getItem(groupsKey(owner)) || 'null')); } catch { return EMPTY_GROUPS; }
}
export function storeGroups(owner: string, state: GroupState): boolean {
  try { localStorage.setItem(groupsKey(owner), JSON.stringify(state)); return true; } catch { return false; }
}

export function addGroup(state: GroupState, name: string, id: string): GroupState {
  const n = cleanName(name);
  if (!n || state.groups.length >= MAX_GROUPS) return state;
  return { ...state, groups: [...state.groups, { id, name: n }] };
}
export function renameGroup(state: GroupState, id: string, name: string): GroupState {
  const n = cleanName(name);
  return n ? { ...state, groups: state.groups.map(g => g.id === id ? { ...g, name: n } : g) } : state;
}
export function toggleGroup(state: GroupState, id: string): GroupState {
  return { ...state, groups: state.groups.map(g => g.id === id ? (g.collapsed ? { id: g.id, name: g.name } : { ...g, collapsed: true }) : g) };
}
// Removing a group keeps its documents: they go back to "Senza gruppo".
export function removeGroup(state: GroupState, id: string): GroupState {
  return { groups: state.groups.filter(g => g.id !== id), assign: Object.fromEntries(Object.entries(state.assign).filter(([, g]) => g !== id)) };
}
// An empty or unknown group id takes the document out of any group.
export function assignDoc(state: GroupState, doc: string, group: string): GroupState {
  const assign = { ...state.assign };
  if (group && state.groups.some(g => g.id === group)) assign[doc] = group; else delete assign[doc];
  return { ...state, assign };
}
export function forgetDoc(state: GroupState, doc: string): GroupState {
  if (!(doc in state.assign)) return state;
  const assign = { ...state.assign }; delete assign[doc];
  return { ...state, assign };
}

// Groups in their order (empty ones too), then the documents without a group.
// Documents keep the order they arrive in (most recent first).
export function groupDocs<T extends { id: string }>(docs: T[], state: GroupState): { group: DocGroup | null; docs: T[] }[] {
  const byGroup = new Map<string, T[]>(state.groups.map(g => [g.id, []]));
  const loose: T[] = [];
  for (const d of docs) { const list = byGroup.get(state.assign[d.id] || ''); if (list) list.push(d); else loose.push(d); }
  return [...state.groups.map(g => ({ group: g, docs: byGroup.get(g.id)! })), { group: null, docs: loose }];
}
