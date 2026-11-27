import type { SubAnnotationDraft } from './sub-annotations';

export interface ParentAnnotationWindow {
  kind: 'parent';
  id: string;
  groupId: string;
}

export interface ChildAnnotationWindow {
  kind: 'child';
  id: string;
  key: string;
  ownerId: string;
  parentId: string;
  draft?: SubAnnotationDraft;
}

export type AnnotationWindow = ParentAnnotationWindow | ChildAnnotationWindow;
export type AnnotationWindowAction =
  | { type: 'open-parent'; id: string; groupId: string }
  | { type: 'open-child'; id: string; ownerId: string; parentId: string; draft?: SubAnnotationDraft }
  | { type: 'commit'; draftId: string; savedId: string }
  | { type: 'raise'; id: string }
  | { type: 'close'; ids: readonly string[] }
  | { type: 'clear' };

export function windowBranch(windows: readonly AnnotationWindow[], roots: readonly string[]): ReadonlySet<string> {
  const children = new Map<string, string[]>();
  for (const window of windows) {
    if (window.kind !== 'child') continue;
    const siblings = children.get(window.parentId);
    if (siblings) siblings.push(window.id);
    else children.set(window.parentId, [window.id]);
  }
  const ids = new Set(roots);
  for (const id of ids) for (const child of children.get(id) ?? []) ids.add(child);
  return ids;
}

function closeWindows(windows: readonly AnnotationWindow[], ids: readonly string[]): readonly AnnotationWindow[] {
  const removed = windowBranch(windows, ids);
  const next = windows.filter(window => !removed.has(window.id));
  return next.length === windows.length ? windows : next;
}

export function annotationWindows(windows: readonly AnnotationWindow[], action: AnnotationWindowAction): readonly AnnotationWindow[] {
  switch (action.type) {
    case 'open-parent': {
      const previous = windows.find(window => window.kind === 'parent' && window.groupId === action.groupId);
      if (previous?.id === action.id) return annotationWindows(windows, { type: 'raise', id: action.id });
      const remaining = previous ? closeWindows(windows, [previous.id]) : windows;
      return [...remaining, { kind: 'parent', id: action.id, groupId: action.groupId }];
    }
    case 'open-child':
      if (windows.some(window => window.id === action.id)) return annotationWindows(windows, { type: 'raise', id: action.id });
      if (!windows.some(window => window.id === action.parentId && (window.kind === 'parent' ? window.id === action.ownerId : window.ownerId === action.ownerId))) return windows;
      return [...windows, { kind: 'child', id: action.id, key: action.id, ownerId: action.ownerId, parentId: action.parentId, draft: action.draft }];
    case 'commit':
      if (!windows.some(window => window.kind === 'child' && window.id === action.draftId && window.draft)) return windows;
      return windows.map(window => window.kind === 'child' && window.id === action.draftId
        ? { ...window, id: action.savedId, draft: undefined } : window);
    case 'raise': {
      const target = windows.find(window => window.id === action.id);
      if (!target) return windows;
      const ownerId = target.kind === 'child' ? target.ownerId : target.id;
      const inFamily = (window: AnnotationWindow) => window.id === ownerId || window.kind === 'child' && window.ownerId === ownerId;
      const next = [...windows.filter(window => !inFamily(window)),
        ...windows.filter(window => inFamily(window) && window !== target), target];
      return next.every((window, index) => window === windows[index]) ? windows : next;
    }
    case 'close':
      return closeWindows(windows, action.ids);
    case 'clear':
      return [];
  }
}
