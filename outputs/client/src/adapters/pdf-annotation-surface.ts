import type { TextAnnotation } from '@recogito/text-annotator';
import { pdfHighlightBoxes, type PdfTextBox } from '../domain/pdf-selection';
import { reviveQuoteSelector } from './anchors';
import { createAnnotationCountLayer, paintAnnotationCounts, type AnnotationSurface } from './annotation-surface';

interface PdfAnnotationEntry {
  annotation: TextAnnotation;
  ranges: Range[];
  boxes: PdfTextBox[];
}

/** Paint one composite behind the native selection controls. Overlapping bands
 * keep their individual hit targets without accumulating translucent fills. */
export function createPdfAnnotationSurface(root: HTMLElement, stage: HTMLElement, color: (id: string) => string, count: (id: string) => number): AnnotationSurface {
  const doc = root.ownerDocument;
  const view = doc.defaultView!;
  const layer = doc.createElement('div');
  layer.className = 'pdf-highlight-layer not-annotatable';
  layer.setAttribute('aria-hidden', 'true');
  const notes = doc.createElement('div'), selectionPaint = doc.createElement('div');
  selectionPaint.className = 'pdf-selection-highlight';
  layer.append(notes, selectionPaint);
  stage.append(layer);
  const badges = createAnnotationCountLayer(stage);
  const entries = new Map<string, PdfAnnotationEntry>();
  let selected: string | undefined;
  let selectionFrame = 0;

  const measure = (ranges: readonly Range[], bounds: DOMRect) => {
    const rotation = stage.querySelector<HTMLElement>('.document-text-layer')?.dataset.mainRotation;
    return pdfHighlightBoxes(ranges.flatMap(range => [...range.getClientRects()]), bounds, rotation === '90' || rotation === '270');
  };
  const mark = (box: PdfTextBox, fill?: string, focused = false) => {
    const rect = doc.createElement('span');
    rect.className = 'pdf-highlight-box';
    if (focused) rect.dataset.selected = 'true';
    Object.assign(rect.style, {
      left: box.left * 100 + '%', top: box.top * 100 + '%',
      width: (box.right - box.left) * 100 + '%', height: (box.bottom - box.top) * 100 + '%',
      backgroundColor: fill || '',
    });
    return rect;
  };
  const paintNotes = () => {
    const fragment = doc.createDocumentFragment();
    for (const [id, entry] of entries) {
      if (id !== selected) for (const box of entry.boxes) fragment.append(mark(box, color(id)));
    }
    if (selected) for (const box of entries.get(selected)?.boxes || []) fragment.append(mark(box, color(selected), true));
    notes.replaceChildren(fragment);
  };
  const selectedRange = () => {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return stage.contains(range.startContainer) && stage.contains(range.endContainer) ? range : null;
  };
  const paintSelection = () => {
    const range = selectedRange();
    const boxes = range ? measure([range], stage.getBoundingClientRect()) : [];
    if (boxes.length || selectionPaint.childElementCount) selectionPaint.replaceChildren(...boxes.map(box => mark(box)));
    stage.toggleAttribute('data-pdf-selection-painted', boxes.length > 0);
  };
  const queueSelection = () => {
    if (selectionFrame || !selectionPaint.childElementCount && !selectedRange()) return;
    selectionFrame = view.requestAnimationFrame(() => { selectionFrame = 0; paintSelection(); });
  };
  doc.addEventListener('selectionchange', queueSelection);

  const recalculatePositions = () => {
    const bounds = stage.getBoundingClientRect();
    for (const entry of entries.values()) entry.boxes = measure(entry.ranges, bounds);
    paintNotes();
    paintAnnotationCounts(badges, entries.values(), count);
    paintSelection();
  };
  return {
    setAnnotations(annotations) {
      entries.clear();
      for (const annotation of annotations) {
        const selectors = annotation.target.selector.flatMap(selector => reviveQuoteSelector(selector, root));
        entries.set(annotation.id, { annotation: { ...annotation, target: { ...annotation.target, selector: selectors } },
          ranges: selectors.map(selector => selector.range), boxes: [] });
      }
      recalculatePositions();
    },
    setSelected(id) { if (selected !== id) { selected = id; paintNotes(); } },
    setEmphasized(emphasized) { layer.toggleAttribute('data-companion-hovered', emphasized); },
    destroy() {
      doc.removeEventListener('selectionchange', queueSelection);
      view.cancelAnimationFrame(selectionFrame);
      stage.removeAttribute('data-pdf-selection-painted');
      layer.remove();
      badges.remove();
      entries.clear();
    },
    state: { store: {
      recalculatePositions,
      getAnnotation(id) { return entries.get(id)?.annotation; },
      getAt(x, y) {
        const bounds = stage.getBoundingClientRect(), origin = root.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return [];
        const px = (origin.left + x - bounds.left) / bounds.width, py = (origin.top + y - bounds.top) / bounds.height;
        return [...entries.values()].filter(entry => entry.boxes.some(box =>
          px >= box.left && px <= box.right && py >= box.top && py <= box.bottom)).map(entry => entry.annotation);
      },
      getAnnotationBounds(id) {
        const boxes = entries.get(id)?.boxes;
        if (!boxes?.length) return;
        const bounds = stage.getBoundingClientRect(), origin = root.getBoundingClientRect();
        const clip = root.closest('.document-reader-viewport')?.getBoundingClientRect();
        const box = boxes.find(box => !clip || bounds.top + box.bottom * bounds.height > clip.top
          && bounds.top + box.top * bounds.height < clip.bottom) || boxes[0];
        return { x: bounds.left - origin.left + box.left * bounds.width, y: bounds.top - origin.top + box.top * bounds.height,
          width: (box.right - box.left) * bounds.width, height: (box.bottom - box.top) * bounds.height };
      },
    } },
  };
}
