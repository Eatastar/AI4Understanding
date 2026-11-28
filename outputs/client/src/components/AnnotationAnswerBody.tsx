import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus } from 'lucide-react';
import { parentAnswerRange, subAnnotationSelection } from '../adapters/sub-annotation-selection';
import { contentHash } from '../domain/context-pool';
import { subAnnotationLabel } from '../domain/sub-annotation-tree';
import { subAnnotationBlock, type SubAnnotationAnchor } from '../domain/sub-annotations';
import type { SubAnnotation } from '../domain/types';
import { rememberSubAnnotationHit, subAnnotationsAtPoint, useSubAnnotationHighlights, type SubAnnotationHit, type SubAnnotationMarker } from '../hooks/useSubAnnotationHighlights';
import { t } from '../i18n/locale';
import { MathMarkdown } from './MathMarkdown';
import { selectionToolbarPosition } from './popup-position';

interface SelectionAction extends Pick<SubAnnotation, 'quotedText' | 'blockIndex' | 'quoteOffset'> { left: number; top: number }
interface PassageChoices { hits: SubAnnotationHit[]; x: number; y: number }
interface MarkerPoint extends PassageChoices { target: EventTarget }
const noMarkers: readonly SubAnnotationMarker[] = [];

export function AnnotationAnswerBody({ answer, color, markers = noMarkers, openMarkers, emphasizedMarker, onOpenMarker, onSelect, streaming = false, plainText = false }: {
  answer: string;
  color: string;
  markers?: readonly SubAnnotationMarker[];
  openMarkers?: ReadonlySet<string>;
  emphasizedMarker?: string;
  onOpenMarker?: (id: string) => void;
  onSelect?: (anchor: SubAnnotationAnchor) => void;
  streaming?: boolean;
  plainText?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hoveredMarker = useRef<MarkerPoint | undefined>(undefined);
  const pressedMarker = useRef<MarkerPoint | undefined>(undefined);
  const [selection, setSelection] = useState<SelectionAction | null>(null);
  const [choices, setChoices] = useState<PassageChoices | null>(null);
  const closeChoices = useCallback(() => setChoices(null), []);
  const answerHash = useMemo(() => streaming ? '' : contentHash(answer), [answer, streaming]);
  const enabled = !!onSelect && !streaming;
  const inlineMarkers = useSubAnnotationHighlights(rootRef, onOpenMarker && !streaming ? markers : noMarkers, answerHash, openMarkers, emphasizedMarker);

  useEffect(() => {
    setSelection(null);
    const root = rootRef.current;
    if (!enabled || !root) return;
    const doc = root.ownerDocument;
    const clearStaleSelection = () => {
      if (!parentAnswerRange(root, doc.getSelection())) setSelection(null);
    };
    doc.addEventListener('selectionchange', clearStaleSelection);
    return () => doc.removeEventListener('selectionchange', clearStaleSelection);
  }, [enabled, answerHash]);

  const readSelection = () => {
    const root = rootRef.current;
    const selected = enabled && root && subAnnotationSelection(root, root.ownerDocument.getSelection());
    if (!selected || !root) { setSelection(null); return; }
    const rect = selected.range.getClientRects()[0] ?? selected.range.getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    const scrollTop = root.closest('.annotation-card-scroll, .sub-annotation-scroll')?.getBoundingClientRect().top ?? bounds.top;
    setSelection({
      quotedText: selected.quotedText, blockIndex: selected.blockIndex, quoteOffset: selected.quoteOffset,
      left: Math.max(0, Math.min(rect.left - bounds.left, bounds.width - 108)),
      top: (rect.top - 30 >= scrollTop ? rect.top - 30 : rect.bottom + 3) - bounds.top,
    });
  };

  const addChild = () => {
    if (!selection || !onSelect || !enabled) return;
    const { quotedText, blockIndex, quoteOffset } = selection;
    setSelection(null);
    rootRef.current?.ownerDocument.getSelection()?.removeAllRanges();
    onSelect({ quotedText, blockIndex, quoteOffset, parentAnswerHash: answerHash });
  };

  const renderMarkers = (index: number | undefined, count: number) => {
    const items = markers.filter(child => subAnnotationBlock(child, answerHash, count) === index);
    if (!items.length || !onOpenMarker) return null;
    return <span className="sub-annotation-markers">
      {items.map(child => <button key={child.id} type="button" className="sub-annotation-marker" data-sub-annotation-marker={child.id}
        data-inline-marker={inlineMarkers.has(child.id) || undefined}
        data-emphasized={child.id === emphasizedMarker || undefined}
        aria-pressed={openMarkers?.has(child.id) ?? false} aria-label={t('打开子批注：{0}', [subAnnotationLabel(child.quotedText)])}
        title={inlineMarkers.has(child.id) ? child.quotedText : `${t('原选段位置无法确认')}\n${child.quotedText}`}
        onClick={() => onOpenMarker(child.id)}>{subAnnotationLabel(child.quotedText, 72)}</button>)}
    </span>;
  };

  const markerAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const hits = subAnnotationsAtPoint(event.currentTarget, event.target, event.clientX, event.clientY);
    return hits ? { hits, x: event.clientX, y: event.clientY, target: event.target } : undefined;
  };
  const openHit = (hit: SubAnnotationHit) => {
    if (rootRef.current) rememberSubAnnotationHit(rootRef.current, hit);
    closeChoices();
    onOpenMarker?.(hit.id);
  };
  const trackPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    hoveredMarker.current = !event.buttons ? markerAt(event) : undefined;
    event.currentTarget.toggleAttribute('data-sub-annotation-hit', Boolean(hoveredMarker.current));
  };

  return <div ref={rootRef} className="parent-annotation-answer" data-annotation-answer-scope style={{ '--sub-annotation-color': color } as CSSProperties}
    onPointerDown={event => {
      event.stopPropagation();
      setSelection(null);
      const hovered = hoveredMarker.current;
      const stillOverMarker = hovered && hovered.target === event.target
        && Math.hypot(event.clientX - hovered.x, event.clientY - hovered.y) <= 1
        && markers.some(marker => hovered.hits.some(hit => hit.id === marker.id));
      pressedMarker.current = event.button === 0 ? markerAt(event) ?? (stillOverMarker ? hovered : undefined) : undefined;
    }}
    onPointerUp={event => { event.stopPropagation(); if (event.button === 0) readSelection(); }}
    onPointerMove={trackPointer}
    onPointerOver={trackPointer}
    onPointerLeave={event => {
      hoveredMarker.current = undefined;
      event.currentTarget.removeAttribute('data-sub-annotation-hit');
    }}
    onPointerCancel={() => { pressedMarker.current = undefined; }}
    onMouseUp={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      const answer = event.currentTarget;
      const press = pressedMarker.current;
      pressedMarker.current = undefined;
      if (!onOpenMarker || event.defaultPrevented || !event.detail || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
        || parentAnswerRange(answer, answer.ownerDocument.getSelection())) return;
      // Raising a card or leaving a focused control can move the answer between press and release.
      const hits = press && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5
        ? press.hits : subAnnotationsAtPoint(answer, event.target, event.clientX, event.clientY);
      const current = hits?.filter(hit => markers.some(marker => marker.id === hit.id));
      if (!current?.length) return;
      event.preventDefault();
      if (current.length === 1) openHit(current[0]);
      else setChoices({ hits: current, x: event.clientX, y: event.clientY });
    }}
    onContextMenu={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}
    onKeyUp={event => { event.stopPropagation(); if (event.shiftKey || event.key === 'Shift') readSelection(); }}>
    {plainText ? <>
      <p className="annotation-plain-text" data-parent-answer-block={0}>{answer}</p>
      {renderMarkers(0, 1)}
      {renderMarkers(undefined, 1)}
    </> : <MathMarkdown streaming={streaming} slots={!streaming && (enabled || markers.length) ? {
      afterBlock: renderMarkers, afterAnswer: count => renderMarkers(undefined, count),
    } : undefined}>{answer}</MathMarkdown>}
    {enabled && selection && <button type="button" className="annotation-sub-selection" style={{ left: selection.left, top: selection.top }}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onClick={addChild}>
      <MessageSquarePlus size={13} />{t('追问这句话')}
    </button>}
    {choices && <SubAnnotationChoices choices={choices} markers={markers} onOpen={openHit} onClose={closeChoices} />}
  </div>;
}

function SubAnnotationChoices({ choices, markers, onOpen, onClose }: {
  choices: PassageChoices;
  markers: readonly SubAnnotationMarker[];
  onOpen: (hit: SubAnnotationHit) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { x, y } = choices;
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const point = new DOMRect(x, y, 1, 1);
    const bounds = new DOMRect(0, 0, innerWidth, innerHeight);
    const { left, top } = selectionToolbarPosition(point, bounds, { width: element.offsetWidth, height: element.offsetHeight });
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.querySelector('button')?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return createPortal(<div ref={panel} className="annotation-choice-popup sub-annotation-choices" role="dialog" aria-label={t('选择子批注')}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onClose(); }}>
    <div className="annotation-choice-list">
      {choices.hits.map(hit => {
        const marker = markers.find(item => item.id === hit.id);
        if (!marker) return null;
        const label = subAnnotationLabel(marker.note?.trim() || marker.question?.trim() || marker.quotedText, 120);
        return <button type="button" className="annotation-choice-button" key={marker.id} title={label}
          onClick={() => onOpen(hit)}><span className="annotation-choice-preview">{label}</span></button>;
      })}
    </div>
  </div>, document.body);
}
