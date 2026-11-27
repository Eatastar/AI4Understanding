import { textPreview } from './text-preview';
import type { SubAnnotation } from './types';

export const subAnnotationLabel = (quote: string, length = 64) =>
  textPreview(quote.trim().replace(/\s+/gu, ' '), length);

export function groupSubAnnotations(nodes: readonly SubAnnotation[]) {
  const groups = new Map<string | undefined, SubAnnotation[]>();
  for (const node of nodes) {
    const siblings = groups.get(node.parentSubId);
    if (siblings) siblings.push(node);
    else groups.set(node.parentSubId, [node]);
  }
  return groups;
}

export function subAnnotationPath(nodes: readonly SubAnnotation[], id: string): SubAnnotation[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const path: SubAnnotation[] = [], visited = new Set<string>();
  let node = byId.get(id);
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    path.push(node);
    node = node.parentSubId ? byId.get(node.parentSubId) : undefined;
  }
  return path.reverse();
}

export function subAnnotationSubtree(nodes: readonly SubAnnotation[], rootId: string) {
  const groups = groupSubAnnotations(nodes);
  const result = new Set<string>(), queue = [rootId];
  while (queue.length) {
    const id = queue.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const child of groups.get(id) ?? []) queue.push(child.id);
  }
  return result;
}

/** Treat a broken edge in an imported tree as a root, preserving the note itself. */
export function repairSubAnnotationLinks(nodes: SubAnnotation[]): SubAnnotation[] {
  if (!nodes.some(node => node.parentSubId)) return nodes;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const checked = new Set<string>(), broken = new Set<string>();
  for (const start of nodes) {
    const path = new Set<string>();
    let node: SubAnnotation | undefined = start;
    while (node && !checked.has(node.id)) {
      path.add(node.id);
      if (!node.parentSubId) break;
      const next: SubAnnotation | undefined = byId.get(node.parentSubId);
      if (!next || path.has(next.id)) { broken.add(node.id); break; }
      node = next;
    }
    for (const id of path) checked.add(id);
  }
  return broken.size ? nodes.map(node => {
    if (!broken.has(node.id)) return node;
    const { parentSubId: _parent, turnIndex: _turn, ...root } = node;
    return root;
  }) : nodes;
}
