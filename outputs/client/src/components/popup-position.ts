export interface PopupPosition { left: number; top: number }
export interface PopupSize { width: number; height: number }
export interface PopupViewport extends PopupSize { top?: number }
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface PopupRect extends PopupPosition, PopupSize {}
export type PopupEdges = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;
export const ANNOTATION_POPUP_WIDTH = 438;
export const POPUP_MARGIN = 12;
export const COMPANION_GAP = 9;
export type CompanionSide = 'right' | 'left' | 'above' | 'below';
export type CompanionAttachment = { side: CompanionSide; offset: number } | ({ side: 'free' } & PopupPosition);

export function annotationPopupPosition(rect: PopupEdges | null, viewport: PopupSize, height = 440, preferredWidth = ANNOTATION_POPUP_WIDTH) {
  const width = Math.max(1, Math.min(preferredWidth, viewport.width - 24));
  const maxHeight = Math.max(1, viewport.height - 32);
  if (!rect) return { width, maxHeight, left: Math.max(12, (viewport.width - width) / 2), top: 32 };
  const right = rect.right + width + 28 < viewport.width;
  const left = right ? rect.right + 18 : Math.max(12, Math.min(viewport.width - width - 12, rect.left));
  const idealTop = right ? rect.top - 24 : rect.bottom + 12;
  return { width, maxHeight, left, top: Math.max(16, Math.min(idealTop, viewport.height - Math.min(height, maxHeight) - 16)) };
}

export function selectionToolbarPosition(selection: PopupEdges, area: PopupEdges, size: PopupSize): PopupPosition {
  const margin = 6, gap = 8;
  const lowX = area.left + margin, highX = area.right - margin - size.width;
  const lowY = area.top + margin, highY = area.bottom - margin - size.height;
  const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(value, hi));
  const left = clamp((selection.left + selection.right - size.width) / 2, lowX, highX);
  const above = selection.top - size.height - gap, below = selection.bottom + gap;
  if (above >= lowY) return { left, top: clamp(above, lowY, highY) };
  if (below <= highY) return { left, top: clamp(below, lowY, highY) };
  const top = clamp((selection.top + selection.bottom - size.height) / 2, lowY, highY);
  if (selection.right + gap <= highX) return { left: selection.right + gap, top };
  if (selection.left - size.width - gap >= lowX) return { left: selection.left - size.width - gap, top };
  // A selection filling the whole viewport still needs a reachable action.
  return { left, top: clamp(below, lowY, highY) };
}

export function firstPopupTop(viewport: PopupViewport): number {
  return Math.max(POPUP_MARGIN, Math.min(viewport.top ?? POPUP_MARGIN, viewport.height - POPUP_MARGIN - 1));
}

/** Physical edges stay aligned with the source, including in RTL interfaces. */
export function resizePopup(rect: PopupRect, edge: ResizeEdge, delta: PopupPosition, viewport: PopupViewport): PopupRect {
  const margin = POPUP_MARGIN;
  const firstTop = firstPopupTop(viewport);
  const maxWidth = Math.max(1, viewport.width - margin * 2);
  const maxHeight = Math.max(1, viewport.height - firstTop - margin);
  const minWidth = Math.min(260, maxWidth);
  const minHeight = Math.min(180, maxHeight);
  let left = rect.left, top = rect.top, right = rect.left + rect.width, bottom = rect.top + rect.height;
  if (edge.includes('w')) left = Math.max(margin, Math.min(right - minWidth, left + delta.left));
  if (edge.includes('e')) right = Math.min(viewport.width - margin, Math.max(left + minWidth, right + delta.left));
  if (edge.includes('n')) top = Math.max(firstTop, Math.min(bottom - minHeight, top + delta.top));
  if (edge.includes('s')) bottom = Math.min(viewport.height - margin, Math.max(top + minHeight, bottom + delta.top));
  const width = Math.min(Math.max(minWidth, right - left), maxWidth);
  const height = Math.min(Math.max(minHeight, bottom - top), maxHeight);
  return { ...constrainPopup({ left, top }, { width, height }, viewport), width, height };
}

/** Keep the draggable header reachable after moving or resizing a card. */
export function constrainPopup(position: PopupPosition, size: PopupSize, viewport: PopupViewport): PopupPosition {
  const margin = POPUP_MARGIN;
  return {
    left: Math.max(margin, Math.min(position.left, viewport.width - size.width - margin)),
    top: Math.max(firstPopupTop(viewport), Math.min(position.top, viewport.height - size.height - margin)),
  };
}

export function companionArrowTop(parent: PopupRect, child: PopupRect, side: CompanionAttachment['side'],
  content: { center: number; visibleTop: number; visibleBottom: number } | undefined) {
  if (!content || side !== 'right' && side !== 'left') return undefined;
  const gap = side === 'right' ? child.left - parent.left - parent.width : parent.left - child.left - child.width;
  if (Math.abs(gap - COMPANION_GAP) >= 1) return undefined;
  const min = Math.max(10, parent.top + content.visibleTop - child.top);
  const max = Math.min(child.height - 10, parent.top + content.visibleBottom - child.top);
  return min <= max ? Math.max(min, Math.min(max, parent.top + content.center - child.top)) : undefined;
}

export function companionAttachment(parent: PopupRect, child: PopupPosition, side: CompanionSide | 'free'): CompanionAttachment {
  if (side === 'free') return { side, left: child.left - parent.left, top: child.top - parent.top };
  return { side, offset: side === 'left' || side === 'right' ? child.top - parent.top : child.left - parent.left };
}

function attachedPosition(parent: PopupRect, child: PopupSize, attachment: CompanionAttachment): PopupPosition {
  switch (attachment.side) {
    case 'right': return { left: parent.left + parent.width + COMPANION_GAP, top: parent.top + attachment.offset };
    case 'left': return { left: parent.left - child.width - COMPANION_GAP, top: parent.top + attachment.offset };
    case 'below': return { left: parent.left + attachment.offset, top: parent.top + parent.height + COMPANION_GAP };
    case 'above': return { left: parent.left + attachment.offset, top: parent.top - child.height - COMPANION_GAP };
    case 'free': return { left: parent.left + attachment.left, top: parent.top + attachment.top };
  }
}

export function placeCompanion(parent: PopupRect, child: PopupSize, attachment: CompanionAttachment, viewport: PopupViewport): PopupPosition {
  return constrainPopup(attachedPosition(parent, child, attachment), child, viewport);
}

function overlap(first: number, firstEnd: number, second: number, secondEnd: number) {
  return Math.max(0, Math.min(firstEnd, secondEnd) - Math.max(first, second));
}

/** Compare the actual release position to the four seams of the direct parent. */
export function snapCompanion(parent: PopupRect, child: PopupRect, viewport: PopupViewport): CompanionAttachment {
  const alongSide = overlap(parent.top, parent.top + parent.height, child.top, child.top + child.height);
  const alongEnd = overlap(parent.left, parent.left + parent.width, child.left, child.left + child.width);
  let closest: CompanionAttachment = companionAttachment(parent, child, 'free');
  let distance = 25;
  for (const side of ['right', 'left', 'below', 'above'] as const) {
    const vertical = side === 'right' || side === 'left';
    if ((vertical ? alongSide : alongEnd) < 24) continue;
    const attachment = companionAttachment(parent, child, side);
    const target = attachedPosition(parent, child, attachment);
    const clamped = constrainPopup(target, child, viewport);
    if (clamped.left !== target.left || clamped.top !== target.top) continue;
    const nextDistance = vertical ? Math.abs(target.left - child.left) : Math.abs(target.top - child.top);
    if (nextDistance < distance) { closest = attachment; distance = nextDistance; }
  }
  return closest;
}

/** Preserve a reachable title bar when a branch occupies both sides of the parent. */
export function findCompanionOpening(parent: PopupRect, child: PopupSize, preferred: PopupPosition, viewport: PopupViewport, windows: readonly PopupRect[]): CompanionAttachment {
  let best: CompanionAttachment = companionAttachment(parent, constrainPopup(preferred, child, viewport), 'free');
  let lowestCost = Infinity;
  const consider = (position: PopupPosition, side: CompanionSide | 'free', penalty: number) => {
    const placed = constrainPopup(position, child, viewport);
    const rect = { ...placed, ...child };
    const cost = windows.reduce((sum, other) => {
      const width = overlap(rect.left, rect.left + rect.width, other.left, other.left + other.width);
      const height = overlap(rect.top, rect.top + rect.height, other.top, other.top + other.height);
      const headerOverlap = overlap(rect.top, rect.top + rect.height, other.top, other.top + Math.min(40, other.height));
      return sum + width * (height + headerOverlap * 3);
    }, penalty);
    if (cost < lowestCost) { lowestCost = cost; best = companionAttachment(parent, placed, side); }
  };
  for (const [index, side] of (['right', 'left', 'below', 'above'] as const).entries()) {
    const vertical = side === 'right' || side === 'left';
    const coordinate = vertical ? 'top' : 'left';
    const dimension = vertical ? 'height' : 'width';
    const candidates = [preferred[coordinate], parent[coordinate], ...windows.flatMap(window => [
      window[coordinate] - child[dimension] - COMPANION_GAP,
      window[coordinate] + window[dimension] + COMPANION_GAP,
    ])];
    for (const value of candidates) {
      const target = attachedPosition(parent, child, companionAttachment(parent, { ...preferred, [coordinate]: value }, side));
      const placed = constrainPopup(target, child, viewport);
      if (vertical ? placed.left !== target.left : placed.top !== target.top) continue;
      consider(placed, side, index * 1000 + Math.abs(placed[coordinate] - preferred[coordinate]));
    }
  }
  // On a narrow screen, use the least obstructed partial overlap.
  consider(preferred, 'free', 4000);
  for (const window of windows) {
    consider({ left: window.left + 30, top: window.top + 44 }, 'free', 4000);
    consider({ left: window.left - 30, top: window.top - 44 }, 'free', 4000);
  }
  return best;
}
