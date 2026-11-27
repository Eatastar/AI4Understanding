import { foldSearchText, normalizeSearchText } from '../domain/reader-navigation';

type TextBox = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>;

/** Text runs can split at each font change or math glyph. Keep adjacent runs on
 * one line together, and leave whitespace between lines and columns unpainted. */
export function referenceLineBoxes(rects: Iterable<TextBox>): TextBox[] {
  const lines: TextBox[] = [];
  for (const rect of rects) {
    if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
    let box: TextBox = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    let index = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      const other = lines[i];
      const height = box.bottom - box.top, otherHeight = other.bottom - other.top;
      const overlap = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
      const centerDelta = Math.abs((box.top + box.bottom - other.top - other.bottom) / 2);
      const gap = Math.max(box.left - other.right, other.left - box.right);
      if (overlap < .55 * Math.min(height, otherHeight) || centerDelta > .45 * Math.max(height, otherHeight) || gap > .4 * Math.min(height, otherHeight)) continue;
      box = { left: Math.min(box.left, other.left), right: Math.max(box.right, other.right), top: Math.min(box.top, other.top), bottom: Math.max(box.bottom, other.bottom) };
      lines.splice(i, 1);
      index = i;
    }
    lines.splice(index, 0, box);
  }
  return lines;
}

/** Draw without changing the text nodes used for selections and annotations. */
export function markReaderSearch(container: HTMLElement, textRoot: HTMLElement, query: string, ordinal: number, reference = false): { marker: HTMLElement | null; clear: () => void } {
  const doc = container.ownerDocument, walker = doc.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; end: number }[] = []; let text = '', node: Node | null;
  while ((node = walker.nextNode())) { const start = text.length; text += node.textContent || ''; nodes.push({ node: node as Text, start, end: text.length }); }
  const normalized = normalizeSearchText(text), term = foldSearchText(query);
  let at = -1, from = 0;
  if (term) for (let i = 0; i <= ordinal; i++) { at = normalized.text.indexOf(term, from); if (at < 0) break; from = at + term.length; }
  const layer = doc.createElement('div'); layer.className = 'reader-search-layer'; layer.setAttribute('aria-hidden', 'true');
  if (reference) layer.classList.add('reader-reference-layer');
  const clear = () => layer.remove();
  if (at < 0 || !term) return { marker: null, clear };
  const start = normalized.starts[at], end = normalized.ends[at + term.length - 1];
  const first = nodes.find(n => n.start <= start && n.end > start), last = nodes.find(n => n.start < end && n.end >= end);
  if (!first || !last) return { marker: null, clear };
  const range = doc.createRange();
  let boxes: Iterable<TextBox>;
  if (reference) {
    // A range spanning elements also reports their enclosing boxes. Measure
    // only selected text, including partial runs at either end of the quote.
    const fragments: DOMRect[] = [];
    for (const run of nodes) {
      if (run.start >= end) break;
      if (run.end <= start || run.start === run.end) continue;
      range.setStart(run.node, Math.max(0, start - run.start));
      range.setEnd(run.node, Math.min(end, run.end) - run.start);
      fragments.push(...range.getClientRects());
    }
    boxes = referenceLineBoxes(fragments);
  } else {
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    boxes = range.getClientRects();
  }
  const bounds = container.getBoundingClientRect(), scaleX = bounds.width / Math.max(1, container.offsetWidth), scaleY = bounds.height / Math.max(1, container.offsetHeight);
  for (const rect of boxes) {
    const width = rect.right - rect.left, height = rect.bottom - rect.top;
    if (width <= 0 || height <= 0) continue;
    const mark = doc.createElement('span'); mark.className = 'reader-search-marker';
    Object.assign(mark.style, { left: `${(rect.left - bounds.left) / scaleX}px`, top: `${(rect.top - bounds.top) / scaleY}px`, width: `${width / scaleX}px`, height: `${height / scaleY}px` }); layer.append(mark);
  }
  container.append(layer);
  return { marker: layer.firstElementChild as HTMLElement | null, clear };
}
