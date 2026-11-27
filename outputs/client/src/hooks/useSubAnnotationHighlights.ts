import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  answerScopeSelector, indexAnnotationAnswer, resolveSubAnnotationPassages, type SubAnnotationPassage, type SubAnnotationQuote,
} from '../adapters/sub-annotation-selection';

export type SubAnnotationMarker = SubAnnotationQuote & { id: string; question?: string; note?: string; missingSourceTurn?: boolean };
export type SubAnnotationHit = { id: string; start: number };

interface AnswerPassages {
  byMarker: Map<string, SubAnnotationPassage[]>;
  byPassage: Map<SubAnnotationPassage, string[]>;
  preferred: Map<string, number>;
}

export const SUB_ANNOTATION_ANCHORS_CHANGED = 'learn:sub-annotation-anchors';
const highlightNames = ['sub-annotation-quote', 'sub-annotation-quote-open', 'sub-annotation-quote-focused'] as const;
const passagesByAnswer = new WeakMap<Element, AnswerPassages>();

export function subAnnotationSourceRects(marker: HTMLButtonElement, id: string): DOMRect[] | undefined {
  const answer = marker.closest(answerScopeSelector);
  const index = answer && passagesByAnswer.get(answer);
  const passages = index && index.byMarker.get(id);
  if (!passages || !index) return;
  const preferred = passages.find(passage => passage.start === index.preferred.get(id));
  return (preferred ? [preferred] : passages).flatMap(passage => [
    ...passage.ranges.flatMap(range => Array.from(range.getClientRects())),
    ...passage.formulas.flatMap(formula => Array.from(formula.getClientRects())),
  ]);
}

export function rememberSubAnnotationHit(answer: HTMLElement, hit: SubAnnotationHit) {
  const preferred = passagesByAnswer.get(answer)?.preferred;
  if (!preferred || preferred.get(hit.id) === hit.start) return;
  preferred.set(hit.id, hit.start);
  answer.dispatchEvent(new Event(SUB_ANNOTATION_ANCHORS_CHANGED, { bubbles: true }));
}

export function subAnnotationsAtPoint(answer: HTMLElement, target: EventTarget | null, x: number, y: number): SubAnnotationHit[] | undefined {
  const index = passagesByAnswer.get(answer);
  if (!index || !(target instanceof Element) || !target.closest('[data-parent-answer-block]')) return;
  const between = (rect: DOMRect) => rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  const hits = new Map<string, SubAnnotationHit>();
  for (const [passage, ids] of index.byPassage) {
    const formulaHit = passage.formulas.some(formula => (formula.contains(target) || target.contains(formula))
      && Array.from(formula.getClientRects()).some(between));
    const textHit = !formulaHit && passage.ranges.some(range => range.startContainer.parentElement && target.contains(range.startContainer.parentElement)
      && Array.from(range.getClientRects()).some(between));
    if (formulaHit || textHit) for (const id of ids) if (!hits.has(id)) hits.set(id, { id, start: passage.start });
  }
  if (hits.size) return [...hits.values()];
}

function sameAnchors(left: readonly SubAnnotationMarker[], right: readonly SubAnnotationMarker[]) {
  return left.length === right.length && left.every((marker, i) => {
    const other = right[i];
    return marker.id === other.id && marker.quotedText === other.quotedText && marker.blockIndex === other.blockIndex
      && marker.quoteOffset === other.quoteOffset && marker.parentAnswerHash === other.parentAnswerHash
      && marker.missingSourceTurn === other.missingSourceTurn;
  });
}

/** Resolve live ranges only as source text or selections change. Recoloring an
 * open or hovered branch reuses those ranges, including shared occurrences. */
export function useSubAnnotationHighlights(root: RefObject<HTMLDivElement | null>, markers: readonly SubAnnotationMarker[],
  answerHash: string, openMarkers?: ReadonlySet<string>, emphasizedMarker?: string) {
  const [inline, setInline] = useState<ReadonlySet<string>>(() => new Set());
  const stableAnchors = useRef<readonly SubAnnotationMarker[]>([]);
  if (!sameAnchors(stableAnchors.current, markers)) {
    stableAnchors.current = markers.map(({ id, quotedText, blockIndex, quoteOffset, parentAnswerHash, missingSourceTurn }) => ({
      id, quotedText, blockIndex, quoteOffset, parentAnswerHash, missingSourceTurn,
    }));
  }
  const anchors = stableAnchors.current;
  const emphasized = markers.some(marker => marker.id === emphasizedMarker) ? emphasizedMarker : undefined;
  const palette = useRef({ openMarkers, emphasized });
  palette.current = { openMarkers, emphasized };
  const recolor = useRef<() => void>(() => {});
  const preferred = useRef(new Map<string, number>());
  useLayoutEffect(() => { recolor.current(); }, [openMarkers, emphasized]);
  useLayoutEffect(() => {
    const answer = root.current;
    const view = answer?.ownerDocument.defaultView as (Window & typeof globalThis) | null | undefined;
    if (!answer || !anchors.length || !view?.CSS?.highlights || typeof view.Highlight !== 'function') {
      preferred.current.clear();
      setInline(previous => previous.size ? new Set() : previous);
      return;
    }
    const registry = view.CSS.highlights;
    let frame = 0;
    let groups = new Map<Highlight, Range[]>();
    let formulas = new Map<Element, number>();
    const clearPaint = () => {
      for (const [highlight, ranges] of groups) for (const range of ranges) highlight.delete(range);
      for (const name of highlightNames) if (registry.get(name)?.size === 0) registry.delete(name);
      for (const formula of formulas.keys()) formula.removeAttribute('data-sub-annotation-formula');
      groups = new Map(); formulas = new Map();
    };
    recolor.current = () => {
      clearPaint();
      const index = passagesByAnswer.get(answer);
      if (!index) return;
      for (const [passage, ids] of index.byPassage) {
        const level = ids.some(id => id === palette.current.emphasized) ? 2 : ids.some(id => palette.current.openMarkers?.has(id)) ? 1 : 0;
        if (passage.ranges.length) {
          const name = highlightNames[level];
          const highlight = registry.get(name) ?? new view.Highlight();
          highlight.priority = level;
          registry.set(name, highlight);
          const registered = groups.get(highlight) ?? [];
          for (const range of passage.ranges) { highlight.add(range); registered.push(range); }
          groups.set(highlight, registered);
        }
        for (const formula of passage.formulas) formulas.set(formula, Math.max(formulas.get(formula) ?? 0, level));
      }
      for (const [formula, level] of formulas) formula.setAttribute('data-sub-annotation-formula', String(level));
    };
    const resolve = () => {
      frame = 0;
      const findPassages = resolveSubAnnotationPassages(indexAnnotationAnswer(answer), answerHash);
      const byMarker = new Map<string, SubAnnotationPassage[]>(), byPassage = new Map<SubAnnotationPassage, string[]>();
      for (const marker of anchors) {
        if (marker.missingSourceTurn) continue;
        const passages = findPassages(marker);
        if (!passages.length) continue;
        byMarker.set(marker.id, passages);
        for (const passage of passages) {
          const ids = byPassage.get(passage);
          if (ids) ids.push(marker.id);
          else byPassage.set(passage, [marker.id]);
        }
      }
      for (const [id, start] of preferred.current) {
        if (!byMarker.get(id)?.some(passage => passage.start === start)) preferred.current.delete(id);
      }
      passagesByAnswer.set(answer, { byMarker, byPassage, preferred: preferred.current });
      recolor.current();
      const next = new Set(byMarker.keys());
      setInline(previous => previous.size === next.size && [...next].every(id => previous.has(id)) ? previous : next);
      answer.dispatchEvent(new Event(SUB_ANNOTATION_ANCHORS_CHANGED, { bubbles: true }));
    };
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(resolve); });
    observer.observe(answer, { childList: true, subtree: true, characterData: true });
    resolve();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); clearPaint();
      recolor.current = () => {};
      passagesByAnswer.delete(answer);
      answer.removeAttribute('data-sub-annotation-hit');
    };
  }, [root, anchors, answerHash]);
  return inline;
}
