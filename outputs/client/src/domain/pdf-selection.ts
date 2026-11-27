export interface PdfTextBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Use page-relative positions so a completed highlight follows scroll and zoom. */
export function pdfHighlightBoxes(rects: readonly PdfTextBox[], page: PdfTextBox, rotated = false): PdfTextBox[] {
  const width = page.right - page.left, height = page.bottom - page.top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const boxes = new Map<string, PdfTextBox>();
  for (const rect of rects) {
    if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) continue;
    // Native range boxes include extra leading. Keep that leading out of the
    // painted band, even where consecutive PDF lines use tight spacing.
    const inset = .12 * (rotated ? rect.right - rect.left : rect.bottom - rect.top);
    const left = Math.max(page.left, rect.left + (rotated ? inset : 0));
    const right = Math.min(page.right, rect.right - (rotated ? inset : 0));
    const top = Math.max(page.top, rect.top + (rotated ? 0 : inset));
    const bottom = Math.min(page.bottom, rect.bottom - (rotated ? 0 : inset));
    if (!(right > left && bottom > top)) continue;
    const box = { left: (left - page.left) / width, top: (top - page.top) / height,
      right: (right - page.left) / width, bottom: (bottom - page.top) / height };
    boxes.set(Object.values(box).map(value => value.toFixed(5)).join(','), box);
  }
  return [...boxes.values()];
}

/** PDF text runs are absolutely positioned. DOM order is not a hit-test. */
export function nearestPdfTextBox(boxes: readonly PdfTextBox[], x: number, y: number): number | null {
  let nearest: number | null = null;
  let best = Infinity;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (![box.left, box.top, box.right, box.bottom].every(Number.isFinite)
      || box.right < box.left || box.bottom < box.top) continue;
    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    // Prefer the line under the pointer, including its short-line trailing gap.
    // The tiny tie-breaker handles overlapping superscripts and base text.
    const score = dx * dx + 4 * dy * dy + .001 * (y - (box.top + box.bottom) / 2) ** 2;
    if (score < best) { best = score; nearest = index; }
  }
  return nearest;
}

/** DOM ranges use UTF-16 offsets; never place a caret inside a grapheme. */
export function pdfCaretOffsets(text: string): number[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [0, ...Array.from(segmenter.segment(text), part => part.index + part.segment.length)];
}
