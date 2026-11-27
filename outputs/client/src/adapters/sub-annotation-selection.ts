import type { SubAnnotation } from '../domain/types';

const blockSelector = '[data-parent-answer-block]';
export const answerScopeSelector = '[data-annotation-answer-scope]';
const MAX_LEGACY_OCCURRENCES_PER_BLOCK = 32;

const elementOf = (node: Node) => node.nodeType === 1 ? node as Element : node.parentElement;

export type QuoteLocation = { start: number; end: number };
type AnswerBlock = QuoteLocation & { index: number };
type AnswerPiece = QuoteLocation & ({ text: Text } | { formula: Element });
interface AnswerIndex { text: string; blocks: AnswerBlock[]; pieces: AnswerPiece[] }

export type SubAnnotationQuote = Pick<SubAnnotation, 'quotedText' | 'blockIndex' | 'quoteOffset' | 'parentAnswerHash'>;
export type SubAnnotationPassage = QuoteLocation & { ranges: Range[]; formulas: Element[] };

export function parentAnswerRange(root: HTMLElement, selection: Selection | null): Range | undefined {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const start = elementOf(range.startContainer)?.closest(blockSelector);
  const end = elementOf(range.endContainer)?.closest(blockSelector);
  if (!start || !end || start.closest(answerScopeSelector) !== root || end.closest(answerScopeSelector) !== root) return;
  return range;
}

function latexSource(formula: Element): string {
  const latex = formula.querySelector('.katex-mathml annotation[encoding="application/x-tex"]')?.textContent?.trim();
  if (!latex) return formula.querySelector('.katex-html')?.textContent ?? '';
  const delimiter = formula.closest('.katex-display') ? '$$' : '$';
  return delimiter + latex + delimiter;
}

/** Index displayed words and treat each KaTeX formula as one selectable span. */
export function indexAnnotationAnswer(root: HTMLElement): AnswerIndex {
  const blocks: AnswerBlock[] = [], pieces: AnswerPiece[] = [], parts: string[] = [];
  let offset = 0;
  const collect = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (!text.length) return;
      pieces.push({ text, start: offset, end: offset + text.length });
      parts.push(text.data);
      offset += text.length;
    } else if (node.nodeType === 1) {
      const element = node as Element;
      if (element.matches('.katex')) {
        const source = latexSource(element);
        if (!source) return;
        pieces.push({ formula: element, start: offset, end: offset + source.length });
        parts.push(source);
        offset += source.length;
      } else if (element.matches('br')) {
        parts.push('\n');
        offset++;
      } else if (!element.matches('button, svg, [aria-hidden="true"]')) {
        element.childNodes.forEach(collect);
      }
    }
  };
  for (const block of root.querySelectorAll(blockSelector)) {
    if (block.closest(answerScopeSelector) !== root) continue;
    if (blocks.length) { parts.push('\n'); offset++; }
    const start = offset;
    collect(block);
    blocks.push({ index: Number(block.getAttribute('data-parent-answer-block')), start, end: offset });
  }
  return { text: parts.join(''), blocks, pieces };
}

export function subAnnotationSelection(root: HTMLElement, selection: Selection | null) {
  const range = parentAnswerRange(root, selection);
  if (!range) return;
  const index = indexAnnotationAnswer(root);
  let start: number | undefined, end = 0;
  for (const piece of index.pieces) {
    const node = 'text' in piece ? piece.text : piece.formula;
    if (!range.intersectsNode(node)) continue;
    const from = piece.start + ('text' in piece && node === range.startContainer ? range.startOffset : 0);
    const to = 'text' in piece && node === range.endContainer ? piece.start + range.endOffset : piece.end;
    if (from >= to) continue;
    start ??= from;
    end = to;
  }
  if (start === undefined) return;
  const raw = index.text.slice(start, end);
  const quotedText = raw.trim();
  if (!quotedText) return;
  const quoteOffset = start + raw.length - raw.trimStart().length;
  const lastOffset = quoteOffset + quotedText.length - 1;
  const blockIndex = index.blocks.find(block => block.start <= lastOffset && lastOffset < block.end)?.index;
  return { quotedText, blockIndex, quoteOffset, range };
}

function* matchingQuotes(text: string, quote: string): Generator<QuoteLocation> {
  if (!/\s/u.test(quote)) {
    let start = text.indexOf(quote);
    while (start >= 0) {
      yield { start, end: start + quote.length };
      start = text.indexOf(quote, start + 1);
    }
    return;
  }
  const tokens = quote.split(/\s+/u).map(token => token.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, '\\$&'));
  // Look ahead so overlapping copies also count as ambiguous.
  const expression = new RegExp('(?=(' + tokens.join('\\s+') + '))', 'gu');
  for (const match of text.matchAll(expression)) {
    yield { start: match.index, end: match.index + match[1].length };
  }
}

/** Older records can identify a paragraph but not an occurrence within it.
 * Keep all plausible locations there, or use the saved excerpt for a very
 * common word that would otherwise mark too much of the paragraph. */
export function locateSubAnnotationQuotes(index: Pick<AnswerIndex, 'text' | 'blocks'>, marker: SubAnnotationQuote, answerHash: string,
  canMark = (_position: QuoteLocation) => true): QuoteLocation[] {
  const quote = marker.quotedText.trim();
  if (!quote) return [];
  const sameAnswer = marker.parentAnswerHash === answerHash;
  const start = marker.quoteOffset;
  if (sameAnswer && start !== undefined && Number.isSafeInteger(start) && start >= 0 && index.text.startsWith(quote, start)) {
    const exact = { start, end: start + quote.length };
    if (canMark(exact)) return [exact];
  }
  const block = sameAnswer && index.blocks.find(item => item.index === marker.blockIndex);
  const withinBlock: QuoteLocation[] = [];
  let withinAnswer: QuoteLocation | null | undefined;
  for (const match of matchingQuotes(index.text, quote)) {
    if (block && withinBlock.length && match.start >= block.end) break;
    if (!canMark(match)) continue;
    withinAnswer = withinAnswer === undefined ? match : null;
    if (block && match.end > block.start && match.end <= block.end) {
      if (withinBlock.length === MAX_LEGACY_OCCURRENCES_PER_BLOCK) return [];
      withinBlock.push(match);
    } else if (!block && withinAnswer === null) return [];
  }
  return withinBlock.length ? withinBlock : withinAnswer ? [withinAnswer] : [];
}

/** Resolve each span once per displayed answer, even when several saved
 * notes point to it. Only the ranges and formula nodes outlive the index. */
export function resolveSubAnnotationPassages(index: AnswerIndex, answerHash: string) {
  const bySpan = new Map<string, SubAnnotationPassage>();
  const byQuote = new Map<string, SubAnnotationPassage[]>();
  const formulas = index.pieces.filter(piece => 'formula' in piece);
  const canMark = ({ start, end }: QuoteLocation) => !formulas.some(piece =>
    piece.start < start && start < piece.end || piece.start < end && end < piece.end);
  return (marker: SubAnnotationQuote): SubAnnotationPassage[] => {
    const key = JSON.stringify([marker.quotedText, marker.quoteOffset, marker.blockIndex, marker.parentAnswerHash === answerHash]);
    const saved = byQuote.get(key);
    if (saved) return saved;
    const passages: SubAnnotationPassage[] = [];
    for (const location of locateSubAnnotationQuotes(index, marker, answerHash, canMark)) {
      const span = `${location.start}:${location.end}`;
      let passage = bySpan.get(span);
      if (!passage) {
        passage = { ...location, ranges: [], formulas: [] };
        for (const piece of index.pieces) {
          if (piece.end <= location.start) continue;
          if (piece.start >= location.end) break;
          if ('formula' in piece) {
            passage.formulas.push(piece.formula);
          } else {
            const range = piece.text.ownerDocument.createRange();
            range.setStart(piece.text, Math.max(piece.start, location.start) - piece.start);
            range.setEnd(piece.text, Math.min(piece.end, location.end) - piece.start);
            passage.ranges.push(range);
          }
        }
        if (!passage.ranges.length && !passage.formulas.length) continue;
        bySpan.set(span, passage);
      }
      passages.push(passage);
    }
    byQuote.set(key, passages);
    return passages;
  };
}
