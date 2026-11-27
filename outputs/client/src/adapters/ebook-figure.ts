import { coordinate, type EbookFigureCapture } from '../domain/figure';

const selector = 'img,svg,math,figure,table,p,h1,h2,h3,h4,h5,h6,li,pre,blockquote';

export function ebookFigureLocation(doc: Document, x: number, y: number): Omit<EbookFigureCapture, 'image'> {
  const root = doc.querySelector('.ebook-text');
  const hit = doc.elementFromPoint(x, y)?.closest(selector);
  const element = hit && root?.contains(hit) ? hit : root;
  const block = root && element !== root ? [...root.querySelectorAll(selector)].indexOf(element!) : -1;
  const rect = element?.getBoundingClientRect();
  return { block, x: rect ? coordinate((x - rect.left) / Math.max(1, rect.width)) : .5, y: rect ? coordinate((y - rect.top) / Math.max(1, rect.height)) : .5 };
}

export function locateEbookFigure(doc: Document, capture: EbookFigureCapture) {
  const root = doc.querySelector('.ebook-text'), scroll = doc.scrollingElement;
  if (!root || !scroll) return;
  const element = root.querySelectorAll(selector).item(capture.block) || root;
  const rect = element.getBoundingClientRect();
  scroll.scrollTop += rect.top + capture.y * rect.height - scroll.clientHeight / 2;
  scroll.scrollLeft += rect.left + capture.x * rect.width - scroll.clientWidth / 2;
}
