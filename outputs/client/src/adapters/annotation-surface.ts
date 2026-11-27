import type { TextAnnotation, TextSelector } from '@recogito/text-annotator';
import { reviveQuoteSelector } from './anchors';

export interface AnnotationSurface {
  setAnnotations(annotations: TextAnnotation[], replace: boolean): void;
  setSelected(id?: string): void;
  setEmphasized?(emphasized: boolean): void;
  destroy(): void;
  state: { store: {
    recalculatePositions(): void;
    getAnnotation(id: string): TextAnnotation | undefined;
    getAt(x: number, y: number, all: true): TextAnnotation[] | undefined;
    getAnnotationBounds(id: string): { x: number; y: number; width: number; height: number } | undefined;
  } };
}

export function createAnnotationCountLayer(container: HTMLElement): HTMLDivElement {
  const layer = container.ownerDocument.createElement('div');
  layer.className = 'annotation-count-layer not-annotatable';
  layer.setAttribute('aria-hidden', 'true');
  container.append(layer);
  return layer;
}

export function paintAnnotationCounts(layer: HTMLElement, entries: Iterable<{ annotation: TextAnnotation; ranges: Range[] }>, count: (id: string) => number) {
  const doc = layer.ownerDocument;
  const fragment = doc.createDocumentFragment();
  const bounds = layer.getBoundingClientRect();
  if (bounds.width && bounds.height) for (const { annotation, ranges } of entries) {
    const size = count(annotation.id);
    if (size < 2) continue;
    const rect = ranges.at(-1)?.getClientRects();
    const last = rect && Array.from(rect).filter(item => item.width > 0 && item.height > 0).at(-1);
    if (!last) continue;
    const badge = doc.createElement('span');
    badge.className = 'annotation-highlight-count';
    badge.dataset.count = String(size);
    badge.style.left = `min(calc(${100 * (last.right - bounds.left) / bounds.width}% + 2px), calc(100% - 16px))`;
    badge.style.top = `${100 * (last.top + last.height / 3 - bounds.top) / bounds.height}%`;
    fragment.append(badge);
  }
  if (fragment.childElementCount || layer.childElementCount) layer.replaceChildren(fragment);
}

/** Parent viewport coordinates for menus/cards; source hit testing stays local. */
export function annotationViewportRect(rect: DOMRect, source?: Document): DOMRect {
  let left = rect.left, top = rect.top;
  let current = source;
  while (current && current !== document) {
    const frame = current.defaultView?.frameElement;
    if (!frame) break;
    const bounds = frame.getBoundingClientRect(); left += bounds.left + frame.clientLeft; top += bounds.top + frame.clientTop;
    current = frame.ownerDocument;
  }
  return new DOMRect(left, top, rect.width, rect.height);
}

export function annotationSourceViewport(element: HTMLElement) {
  const scrollport = element.ownerDocument.defaultView?.frameElement || element.closest('.document-reader-viewport, .chat-scroll-region');
  const bounds = scrollport && annotationViewportRect(scrollport.getBoundingClientRect(), scrollport.ownerDocument);
  return {
    left: Math.max(0, bounds?.left ?? 0), top: Math.max(0, bounds?.top ?? 0),
    right: Math.min(window.innerWidth, bounds?.right ?? window.innerWidth), bottom: Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight),
  };
}
export const elementTarget = (value: unknown): Element | null => value && typeof value === 'object' && 'nodeType' in value && value.nodeType === 1 ? value as Element : null;

export function ebookRangeSelector(range: Range, root: HTMLElement): TextSelector {
  const before = root.ownerDocument.createRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length, quote: range.toString() };
}

let nextSurface = 0;

/** Native ranges follow scroll and text reflow without rebuilding a viewport
 * overlay. Keep registry names distinct when several chat answers are mounted. */
export function createNativeAnnotationSurface(root: HTMLElement, color: (id: string) => string, count: (id: string) => number): AnnotationSurface | undefined {
  const view = root.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (!view?.CSS?.highlights || typeof view.Highlight !== 'function') return;
  const registry = view.CSS.highlights, prefix = 'reader-note-' + ++nextSurface + '-';
  const style = root.ownerDocument.createElement('style'); root.ownerDocument.head.append(style);
  const badges = createAnnotationCountLayer(root);
  let selected: string | undefined;
  let emphasized = false;
  const entries = new Map<string, { annotation: TextAnnotation; ranges: Range[]; name: string }>();
  const clear = () => { for (const entry of entries.values()) registry.delete(entry.name); entries.clear(); style.textContent = ''; };
  const paint = () => { style.textContent = [...entries.values()].map(entry => {
    const focused = entry.annotation.id === selected;
    const opacity = focused ? emphasized ? 77 : 65 : 40;
    return `::highlight(${entry.name}){background-color:color-mix(in srgb, ${color(entry.annotation.id)} ${opacity}%, transparent);${focused ? 'text-decoration:underline;' : ''}}`;
  }).join('\n'); };
  const rects = (id: string) => (entries.get(id)?.ranges || []).flatMap(range => [...range.getClientRects()]);
  const recalculatePositions = () => paintAnnotationCounts(badges, entries.values(), count);
  return {
    setAnnotations(annotations) {
      clear();
      for (const annotation of annotations) {
        const selectors = annotation.target.selector.flatMap(selector => reviveQuoteSelector(selector, root));
        const ranges = selectors.map(selector => selector.range);
        const name = prefix + entries.size;
        entries.set(annotation.id, { annotation: { ...annotation, target: { ...annotation.target, selector: selectors } }, ranges, name });
        if (ranges.length) registry.set(name, new view.Highlight(...ranges));
      }
      paint();
      recalculatePositions();
    },
    setSelected(id) { if (selected !== id) { selected = id; paint(); } },
    setEmphasized(value) { if (emphasized !== value) { emphasized = value; paint(); } },
    destroy() { clear(); style.remove(); badges.remove(); },
    state: { store: {
      recalculatePositions,
      getAnnotation(id) { return entries.get(id)?.annotation; },
      getAt(x, y) {
        const bounds = root.getBoundingClientRect(); const px = bounds.left + x, py = bounds.top + y;
        return [...entries.values()].filter(entry => rects(entry.annotation.id).some(rect => px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom)).map(entry => entry.annotation);
      },
      getAnnotationBounds(id) {
        const ranges = rects(id); if (!ranges.length) return;
        const bounds = root.getBoundingClientRect(), area = annotationSourceViewport(root);
        const rect = ranges.find(rect => {
          const projected = annotationViewportRect(rect, root.ownerDocument);
          return projected.bottom > area.top && projected.top < area.bottom;
        }) || ranges[0];
        return { x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height };
      },
    } },
  };
}
