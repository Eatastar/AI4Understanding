import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { constrainPopup, firstPopupTop, POPUP_MARGIN, resizePopup } from './popup-position';
import type { PopupPosition, PopupRect, PopupViewport, ResizeEdge } from './popup-position';
import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';

interface Props {
  popupRef: RefObject<HTMLDivElement | null>;
  id?: string;
  style: PopupPosition & { width: number; maxHeight: number; zIndex?: number };
  children: ReactNode;
  onUserMoveOrResize?: () => void;
  onActivate?: () => void;
  onMove?: (position: PopupPosition, stage: 'drag' | 'release' | 'keyboard') => void;
  renderAttached?: (rect: PopupRect) => ReactNode;
  isolateKeys?: boolean;
  resetLayoutKey?: number;
  keepBelowToolbar?: boolean;
  resizable?: boolean;
  className?: string;
}

const TOOLBARS = '.topbar, .reader-toolbar-region';

export function readPopupViewport(): PopupViewport {
  let top = POPUP_MARGIN;
  for (const toolbar of document.querySelectorAll(TOOLBARS)) {
    const bounds = toolbar.getBoundingClientRect();
    if (bounds.height && bounds.bottom > 0 && bounds.top < innerHeight) top = Math.max(top, bounds.bottom + 8);
  }
  return { width: innerWidth, height: innerHeight, top };
}

/** Only the title bar moves the card; its contents remain normal selectable text. */
export function MovableAnnotationPopup({ popupRef, id, style, children, onUserMoveOrResize, onActivate, onMove, renderAttached, isolateKeys, resetLayoutKey, keepBelowToolbar, resizable = true, className = '' }: Props) {
  useLocale();
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const [viewport, setViewport] = useState(readPopupViewport);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [resized, setResized] = useState<PopupRect | null>(null), [resizing, setResizing] = useState<ResizeEdge | null>(null);
  const resizeRef = useRef<{ edge: ResizeEdge; startX: number; startY: number; rect: PopupRect; announced: boolean } | null>(null);
  const positionRef = useRef<PopupPosition | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number; announced: boolean; last?: PopupPosition } | null>(null);
  const moveBounds = keepBelowToolbar ? viewport : { width: viewport.width, height: viewport.height };
  useLayoutEffect(() => {
    if (resetLayoutKey === undefined) return;
    positionRef.current = null; dragRef.current = null; resizeRef.current = null;
    setPosition(null); setResized(null); setDragging(false); setResizing(null);
  }, [resetLayoutKey]);

  const moveTo = (next: PopupPosition, stage: 'drag' | 'keyboard' = 'drag') => {
    const element = popupRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const limited = constrainPopup(next, bounds, moveBounds);
    if (onMove) { onMove(limited, stage); return limited; }
    const previous = positionRef.current;
    if (previous?.left === limited.left && previous.top === limited.top) return limited;
    positionRef.current = limited;
    setPosition(limited);
    return limited;
  };
  useLayoutEffect(() => {
    const fitWindow = () => {
      const next = readPopupViewport();
      setViewport(previous => previous.width === next.width && previous.height === next.height && previous.top === next.top ? previous : next);
    };
    const observer = new ResizeObserver(fitWindow);
    document.querySelectorAll(TOOLBARS).forEach(toolbar => observer.observe(toolbar));
    window.addEventListener('resize', fitWindow);
    fitWindow();
    return () => { observer.disconnect(); window.removeEventListener('resize', fitWindow); };
  }, []);

  useLayoutEffect(() => {
    const element = popupRef.current;
    if (!element) return;
    const measure = () => setMeasuredHeight(element.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [popupRef]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
    if (!event.target.closest('.annotation-card-header') || event.target.closest('button, a, input, textarea, select, summary, .highlight-color-picker, [contenteditable="true"]')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, startX: event.clientX, startY: event.clientY, announced: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (!onMove) {
      moveTo({ left: bounds.left, top: bounds.top });
      setDragging(true);
    }
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.last) onMove?.(drag.last, 'release');
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const requestedWidth = resized?.width ?? style.width;
  const width = Math.max(1, Math.min(requestedWidth, viewport.width - 2 * POPUP_MARGIN));
  // Opening clears the toolbar. Manual movement uses the window and keeps the opening height budget.
  const placementBounds = position || resized || onMove ? moveBounds : viewport;
  const heightBounds = resized || onMove ? moveBounds : viewport;
  const maxHeight = Math.max(1, Math.min(resized?.height ?? style.maxHeight, viewport.height - firstPopupTop(heightBounds) - POPUP_MARGIN));
  const height = resized ? maxHeight : Math.min(measuredHeight, maxHeight);
  const placed = constrainPopup(position ?? resized ?? style, { width, height }, placementBounds);
  const popupStyle = { ...placed, width, maxHeight, height: resized ? height : undefined, zIndex: style.zIndex, '--annotation-top': `${placed.top}px` };

  return <><div
    ref={popupRef}
    id={id}
    className={`annotation-popup ${className}${dragging ? ' annotation-popup-dragging' : ''}${resized ? ' annotation-popup-resized' : ''}${resizing ? ' annotation-popup-resizing resize-' + resizing : ''}`}
    style={popupStyle}
    onPointerDownCapture={onActivate}
    onPointerDown={startDrag}
    onPointerMove={(event) => {
      const drag = dragRef.current;
      if (drag?.pointerId === event.pointerId) {
        const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 3;
        if (onMove && !drag.announced && !moved) return;
        if (!drag.announced && moved) { drag.announced = true; setDragging(true); onUserMoveOrResize?.(); }
        drag.last = moveTo({ left: event.clientX - drag.offsetX, top: event.clientY - drag.offsetY });
      }
    }}
    onPointerUp={finishDrag}
    onPointerCancel={finishDrag}
    onLostPointerCapture={finishDrag}
    onKeyDown={(event) => {
      if (isolateKeys && event.key !== 'Escape') event.stopPropagation();
      if (!(event.target instanceof Element) || !event.target.matches('.annotation-card-header')) return;
      const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      onActivate?.();
      onUserMoveOrResize?.();
      const bounds = event.currentTarget.getBoundingClientRect();
      const step = event.shiftKey ? 30 : 10;
      moveTo({ left: bounds.left + direction[0] * step, top: bounds.top + direction[1] * step }, 'keyboard');
    }}
    onKeyUp={isolateKeys ? event => event.stopPropagation() : undefined}
  >{children}{resizable && (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map(edge => <button key={edge} type="button" className={`annotation-resize-handle resize-${edge}`} aria-label={t('调整批注框大小：{0}', [edge])} title={t('拖动调整大小，双击恢复')} onPointerDown={event => {
    if (event.button !== 0) return; event.preventDefault(); event.stopPropagation();
    const r = popupRef.current!.getBoundingClientRect(); resizeRef.current = { edge, startX: event.clientX, startY: event.clientY, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, announced: false };
    setResizing(edge); event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={event => {
    const start = resizeRef.current; if (!start || start.edge !== edge) return;
    if (!start.announced && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) >= 3) { start.announced = true; onUserMoveOrResize?.(); }
    const next = resizePopup(start.rect, edge, { left: event.clientX - start.startX, top: event.clientY - start.startY }, moveBounds);
    positionRef.current = { left: next.left, top: next.top }; setPosition(positionRef.current); setResized(next);
  }} onPointerUp={event => { resizeRef.current = null; setResizing(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { resizeRef.current = null; setResizing(null); }} onLostPointerCapture={() => { resizeRef.current = null; setResizing(null); }} onDoubleClick={event => { event.preventDefault(); setResized(null); }} onKeyDown={event => {
    const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
    if (!delta) return; event.preventDefault(); event.stopPropagation(); const r = popupRef.current!.getBoundingClientRect(), step = event.shiftKey ? 30 : 10;
    onUserMoveOrResize?.();
    const next = resizePopup({ left: r.left, top: r.top, width: r.width, height: r.height }, edge, { left: delta[0] * step, top: delta[1] * step }, moveBounds);
    positionRef.current = { left: next.left, top: next.top }; setPosition(positionRef.current); setResized(next);
  }} />)}</div>{renderAttached?.({ ...placed, width, height })}</>;
}
