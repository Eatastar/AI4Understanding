import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { FigureRect } from '../domain/figure';
import type { Annotation, DocumentPage } from '../domain/types';
import { hasSelectionBar, selectionLayout } from './pdf-selection-layout';
import { loadPdfJs } from './documents';
import { sourceFormulas } from './source-math';
import { pdfTextBounds } from './pdf-frame';
import { getFigureBase } from './figure';
import { acquirePdfPage } from './pdf-resources';

type Content = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
type Item = Extract<Content['items'][number], { str: string }>;
type Viewport = ReturnType<PDFPageProxy['getViewport']>;
export type ExcerptMark = readonly [number, number];
export interface OpenReaderPdf { documentId: string; pdf: PDFDocumentProxy }
const compact = (text: string) => text.replace(/[\s\0]/gu, '');
export function selectionSourceStart(annotation: Annotation, page: DocumentPage | undefined) {
  const anchor = annotation.anchor as { sourceStart?: number; selectors?: { start: number }[] } | null;
  const first = anchor?.selectors?.[0];
  return anchor?.sourceStart ?? (first && page?.text.startsWith(annotation.quote, first.start) ? first.start : undefined);
}

function rawOffset(text: string, count: number) {
  let at = 0;
  while (count > 0 && at < text.length) if (compact(text[at++])) count--;
  return at;
}

/** A partial first or last text run can share a line with unselected words. */
function sliceRun(item: Item, from: number, to: number, measure: (text: string, font: string) => number, font: string): Item {
  if (from === 0 && to === compact(item.str).length || item.dir === 'ttb') return item;
  let start = rawOffset(item.str, from);
  while (start < item.str.length && !compact(item.str[start])) start++;
  const end = rawOffset(item.str, to);
  const width = measure(item.str, font);
  if (!width) return item;
  const before = measure(item.str.slice(0, start), font) / width;
  const after = Math.min(1, measure(item.str.slice(0, end), font) / width);
  const [a, b, c, d, e, f] = item.transform, length = Math.hypot(a, b);
  if (!length) return item;
  const advance = item.width * (item.dir === 'rtl' ? 1 - after : before);
  return { ...item, str:item.str.slice(start,end), width: item.width * Math.max(0, after - before), transform: [a, b, c, d, e + advance * a / length, f + advance * b / length] };
}

/** Join only by layout whitespace. Different glyphs or an ambiguous old anchor
 * cannot identify a PDF excerpt, even if a similar passage exists elsewhere. */
export function pdfExcerptGeometry(content: Content, viewport: Viewport, pageText: string, quote: string, start: number | undefined,
  mark: ExcerptMark | undefined, measure: (text: string, font: string) => number, protectSurrounding = false) {
  const items = content.items.filter((item): item is Item => 'str' in item);
  const source = compact(pageText), needle = compact(quote);
  if (!needle || items.map(item => compact(item.str)).join('') !== source) return;
  let offset = start !== undefined && Number.isInteger(start) && start >= 0 && start < pageText.length ? compact(pageText.slice(0, start)).length : -1;
  if (offset < 0 || !source.startsWith(needle, offset)) {
    offset = source.indexOf(needle);
    if (offset < 0 || source.indexOf(needle, offset + 1) >= 0) return;
  }
  const marked = mark && [offset + compact(quote.slice(0, mark[0])).length, offset + compact(quote.slice(0, mark[1])).length];
  const runs: Item[] = [], highlights: Item[] = [], outside: Item[] = [];
  let at = 0;
  for (const item of items) {
    const next = at + compact(item.str).length;
    const intersect = (from: number, to: number, target: Item[]) => {
      if (Math.max(from, at) >= Math.min(to, next)) return;
      target.push(sliceRun(item, Math.max(0, from - at), Math.min(to, next) - at, measure, content.styles[item.fontName]?.fontFamily ?? 'sans-serif'));
    };
    intersect(offset, offset + needle.length, runs);
    if (protectSurrounding) { intersect(0,offset,outside); intersect(offset+needle.length,source.length,outside); }
    if (marked) intersect(marked[0], marked[1], highlights);
    at = next;
    if (!protectSurrounding && at >= offset + needle.length) break;
  }
  const bounds = pdfTextBounds({ ...content, items: runs }, viewport);
  if (!bounds.length) return;
  // Leave room for PDF drawing operators such as an overbar or matrix brackets.
  const pad = Math.max(3, Math.min(7, bounds[0].height * .45));
  let left = viewport.width, top = viewport.height, right = 0, bottom = 0;
  for (const box of bounds) {
    left = Math.min(left, box.left); top = Math.min(top, box.top);
    right = Math.max(right, box.left + box.width); bottom = Math.max(bottom, box.top + box.height);
  }
  if (protectSurrounding && pdfTextBounds({...content,items:outside},viewport).some(b =>
    b.left+b.width/2 > left && b.left+b.width/2 < right && b.top+b.height/2 > top && b.top+b.height/2 < bottom)) return;
  left = Math.max(0, left - pad); top = Math.max(0, top - pad);
  const width = Math.min(viewport.width, right + pad) - left;
  const height = Math.min(viewport.height, bottom + pad) - top;
  if (!(width > 0 && height > 0)) return;
  const rect: FigureRect = { x: left / viewport.width, y: top / viewport.height, width: width / viewport.width, height: height / viewport.height };
  const marks = pdfTextBounds({ ...content, items: highlights }, viewport).map(b => ({
    x: (b.left - left) / width, y: (b.top - top) / height, width: b.width / width, height: b.height / height,
  }));
  return { rect, width, marks, runs };
}

export async function readPdfExcerpt(reader: OpenReaderPdf, page: DocumentPage, text: string, start: number | undefined, mark: ExcerptMark | undefined, signal: AbortSignal, purpose: 'preview' | 'question' = 'preview') {
  if (purpose === 'question') {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2400 || sourceFormulas(trimmed).some(f => f.start===0 && f.end===trimmed.length)) return;
  }
  const lease = await acquirePdfPage(reader.pdf, page.pageNumber, signal);
  try {
    const content = await lease.page.getTextContent();
    signal.throwIfAborted();
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    const geometry = pdfExcerptGeometry(content, lease.page.getViewport({ scale: 1 }), page.text, text, start, mark, (str, font) => {
      context.font = '100px ' + font;
      return context.measureText(str).width;
    },purpose==='question');
    if (!geometry) return;
    if (purpose === 'question') {
      const { rect, runs }=geometry;
      if (rect.width*rect.height > .32 || runs.length > 180) return;
      const layout=selectionLayout(runs);
      if (!layout.stacked && !/[\p{Co}\uFFFD]/u.test(text)) {
        if (!layout.boxes.some(b=>b.short)) return;
        const [{ OPS }, operators] = await Promise.all([loadPdfJs(), lease.page.getOperatorList()]);
        signal.throwIfAborted();
        if (!hasSelectionBar(layout,operators,OPS)) return;
      }
    }
    const image = await getFigureBase(reader.pdf, { documentId: reader.documentId, pageNumber: page.pageNumber, rect: geometry.rect, strokes: [] }, signal);
    return { image, width: geometry.width, marks: geometry.marks };
  } finally { lease.release(); }
}
