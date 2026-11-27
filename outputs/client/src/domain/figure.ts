import { contentHash } from './context-pool';
export type FigureRect = { x: number; y: number; width: number; height: number };
export interface EbookFigureCapture { block: number; x: number; y: number; image: string }
export interface FigureSelection { documentId: string; pageNumber: number; rect: FigureRect; strokes: FigureStroke[]; ebook?: EbookFigureCapture }
export const FIGURE_LIMITS = Object.freeze({ edge: 1800, pixels: 2_000_000, imageBytes: 1024 * 1024, cacheBytes: 32 * 1024 * 1024, cacheEntries: 24 });
export type FigurePoint = { x: number; y: number };
export type FigureStroke = { tool: 'pen' | 'ellipse'; color: string; width: number; points: FigurePoint[] };
export const STROKE_COLORS = ['#d64a3a', '#2876cc', '#9b4dc4'];
export const MAX_STROKES = 40;
export const MAX_POINTS = 256;
export const MAX_STROKE_BYTES = 64 * 1024;
const object = (value: unknown, names: string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !names.includes(key))) throw Error('图片批注数据格式无效。');
  return value as Record<string, unknown>;
};
export function readFigureRect(value: unknown): FigureRect {
  const r = object(value, ['x', 'y', 'width', 'height']);
  if (Object.values(r).length !== 4 || Object.values(r).some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) || Number(r.width) <= 0 || Number(r.height) <= 0 || Number(r.x) + Number(r.width) > 1.000001 || Number(r.y) + Number(r.height) > 1.000001) throw Error('图片选区超出页面范围。');
  return { x: Number(r.x), y: Number(r.y), width: Number(r.width), height: Number(r.height) };
}
export function readFigureStrokes(value: unknown): FigureStroke[] {
  if (!Array.isArray(value) || value.length > MAX_STROKES) throw Error('图片圈画数据无效。');
  const strokes = value.map(raw => {
    const s = object(raw, ['tool', 'color', 'width', 'points']);
    if (!Array.isArray(s.points) || s.points.length < 2 || s.points.length > MAX_POINTS) throw Error('图片圈画采样点无效。');
    const points = s.points.map(rawPoint => { const p = object(rawPoint, ['x', 'y']); if (typeof p.x !== 'number' || typeof p.y !== 'number') throw Error('图片圈画坐标无效。'); return { x: p.x, y: p.y }; });
    return { tool: s.tool, color: s.color, width: s.width, points } as FigureStroke;
  });
  validateFigureStrokes(strokes); return strokes;
}
const pngPrefix = 'data:image/png;base64,';
export function ebookFigurePNG(image: string) {
  const invalid = () => new Error('电子书选图无效，请重新框选。');
  if (!image.startsWith(pngPrefix) || image.length > pngPrefix.length + Math.ceil(FIGURE_LIMITS.imageBytes / 3) * 4) throw invalid();
  const encoded = image.slice(pngPrefix.length);
  if (encoded.length < 44 || encoded.length % 4 || /[^A-Za-z0-9+/]/.test(encoded.replace(/={1,2}$/, ''))) throw invalid();
  const padding = encoded.endsWith('==') ? 2 : Number(encoded.endsWith('='));
  if (encoded.length / 4 * 3 - padding > FIGURE_LIMITS.imageBytes) throw invalid();
  const header = atob(encoded.slice(0, 32));
  if (header.slice(0, 16) !== '\x89PNG\r\n\x1a\n\0\0\0\rIHDR') throw invalid();
  const view = new DataView(Uint8Array.from(header, c => c.charCodeAt(0)).buffer);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > FIGURE_LIMITS.edge || height > FIGURE_LIMITS.edge || width * height > FIGURE_LIMITS.pixels) throw invalid();
  return { encoded, width, height };
}
export function readEbookFigureCapture(value: unknown): EbookFigureCapture {
  const capture = object(value, ['block', 'x', 'y', 'image']);
  const { block, x, y, image } = capture;
  if (typeof block !== 'number' || !Number.isSafeInteger(block) || block < -1 || block > 1_000_000 ||
      typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1 ||
      typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1 || typeof image !== 'string') throw Error('电子书选图无效，请重新框选。');
  ebookFigurePNG(image);
  return { block, x, y, image };
}
const captureKeys = new WeakMap<EbookFigureCapture, string>();
export function ebookFigureKey(capture: EbookFigureCapture) {
  let key = captureKeys.get(capture);
  if (!key) {
    key = contentHash(JSON.stringify([capture.block, capture.x, capture.y, capture.image]));
    captureKeys.set(capture, key);
  }
  return key;
}
export function readFigure(value: unknown): FigureSelection {
  const f = object(value, ['documentId', 'pageNumber', 'rect', 'strokes', 'ebook']);
  if (typeof f.documentId !== 'string' || !f.documentId.trim() || f.documentId.length > 200 || typeof f.pageNumber !== 'number' || !Number.isSafeInteger(f.pageNumber) || f.pageNumber < 1 || f.pageNumber > 5000) throw Error('图片批注来源无效。');
  return { documentId: f.documentId, pageNumber: f.pageNumber, rect: readFigureRect(f.rect), strokes: readFigureStrokes(f.strokes), ...(f.ebook === undefined ? {} : { ebook: readEbookFigureCapture(f.ebook) }) };
}
export function figureSourceKey(figure: FigureSelection) { return `${figure.documentId}:${figure.pageNumber}:` + (figure.ebook ? ebookFigureKey(figure.ebook) : contentHash(JSON.stringify(figure.rect))); }
export function figureImageKey(figure: FigureSelection, strokes = figure.strokes) { return figureSourceKey(figure) + ':' + contentHash(JSON.stringify(strokes)); }
export const coordinate = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000;
export const figureStrokeBytes = (strokes: readonly FigureStroke[]) => new TextEncoder().encode(JSON.stringify(strokes)).byteLength;
export function compactFigureStroke(stroke: FigureStroke): FigureStroke {
  const points = stroke.tool === 'ellipse' ? [stroke.points[0], stroke.points.at(-1)!] : stroke.points;
  const count = Math.min(points.length, MAX_POINTS);
  return { ...stroke, points: Array.from({ length: count }, (_, i) => points[Math.round(i * (points.length - 1) / Math.max(1, count - 1))]).map(point => ({ x: coordinate(point.x), y: coordinate(point.y) })) };
}
export function validateFigureStrokes(strokes: readonly FigureStroke[]) {
  if (strokes.length > MAX_STROKES || figureStrokeBytes(strokes) > MAX_STROKE_BYTES) throw Error('圈画较多，请先撤销或清除一些笔迹。每张图最多保留 40 笔、64 KB 笔迹。');
  for (const stroke of strokes) {
    if (!['pen', 'ellipse'].includes(stroke.tool) || !STROKE_COLORS.includes(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < .001 || stroke.width > .02 || stroke.points.length < 2 || stroke.points.length > MAX_POINTS || stroke.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) throw Error('笔迹数据无效，请重新圈画。');
  }
}
export function paintFigureStrokes(context: CanvasRenderingContext2D, strokes: readonly FigureStroke[], width: number, height: number) {
  validateFigureStrokes(strokes);
  context.save();
  for (const stroke of strokes) {
    context.strokeStyle = stroke.color; context.lineWidth = stroke.width * width; context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath();
    if (stroke.tool === 'ellipse') {
      const a = stroke.points[0], b = stroke.points.at(-1)!;
      context.ellipse((a.x + b.x) * width / 2, (a.y + b.y) * height / 2, Math.max(.5, Math.abs(b.x - a.x) * width / 2), Math.max(.5, Math.abs(b.y - a.y) * height / 2), 0, 0, Math.PI * 2);
    } else stroke.points.forEach((point, i) => { if (i) context.lineTo(point.x * width, point.y * height); else context.moveTo(point.x * width, point.y * height); });
    context.stroke();
  }
  context.restore();
}
