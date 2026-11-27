import { useLayoutEffect, useState, type RefObject } from 'react';
import { readPopupViewport } from '../components/MovableAnnotationPopup';
import { SUB_ANNOTATION_ANCHORS_CHANGED, subAnnotationSourceRects } from './useSubAnnotationHighlights';
import {
  COMPANION_GAP, POPUP_MARGIN, companionArrowTop, companionAttachment, findCompanionOpening, placeCompanion, snapCompanion,
  type CompanionAttachment, type PopupPosition, type PopupRect,
} from '../components/popup-position';

export function subAnnotationMarker(card: HTMLElement | null, id: string) {
  return card?.querySelector<HTMLButtonElement>(`[data-sub-annotation-marker="${CSS.escape(id)}"]`);
}

interface MarkerGeometry {
  center: number;
  visibleTop: number;
  visibleBottom: number;
}

export function useCompanionPosition(parent: PopupRect, parentCard: RefObject<HTMLElement | null>, popup: RefObject<HTMLDivElement | null>, id: string) {
  const [attachment, setAttachment] = useState<CompanionAttachment>();
  const [dragPosition, setDragPosition] = useState<PopupPosition>();
  const [viewport, setViewport] = useState(readPopupViewport);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [marker, setMarker] = useState<MarkerGeometry>();
  const moveBounds = { width: viewport.width, height: viewport.height };
  const width = Math.max(1, Math.min(316, viewport.width - 2 * POPUP_MARGIN));
  const maxHeight = Math.max(1, viewport.height - 2 * POPUP_MARGIN);
  const size = { width, height: Math.min(measuredHeight || 112, maxHeight) };

  useLayoutEffect(() => {
    const card = parentCard.current, element = popup.current;
    if (!card || !element) return;
    const body = card.querySelector<HTMLElement>('.annotation-card-scroll, .sub-annotation-scroll');
    let frame = 0;
    const readMarker = () => {
      const base = card.getBoundingClientRect();
      const control = subAnnotationMarker(card, id);
      if (!control) return undefined;
      const view = body?.getBoundingClientRect() ?? base;
      const rects = subAnnotationSourceRects(control, id) ?? [control.getBoundingClientRect()];
      const markerBounds = rects.find(rect => rect.height > 0 && rect.width > 0 && rect.bottom > view.top && rect.top < view.bottom
        && rect.right > view.left && rect.left < view.right);
      if (!markerBounds) return undefined;
      return {
        center: (markerBounds.top + markerBounds.bottom) / 2 - base.top,
        visibleTop: view.top - base.top,
        visibleBottom: view.bottom - base.top,
      };
    };
    const measure = () => {
      frame = 0;
      const nextViewport = readPopupViewport();
      setViewport(previous => previous.width === nextViewport.width && previous.height === nextViewport.height && previous.top === nextViewport.top ? previous : nextViewport);
      setMeasuredHeight(element.offsetHeight);
      const next = readMarker();
      setMarker(previous => previous?.center === next?.center && previous?.visibleTop === next?.visibleTop && previous?.visibleBottom === next?.visibleBottom ? previous : next);
    };
    if (!attachment) {
      const start = { ...parent, height: card.offsetHeight };
      const anchor = readMarker();
      const existing = Array.from(element.closest('.annotation-windows-layer')?.querySelectorAll<HTMLElement>('.annotation-popup') ?? [])
        .filter(window => window !== element).map(window => window.getBoundingClientRect());
      const preferred = { left: start.left + start.width + COMPANION_GAP, top: start.top + (anchor?.center ?? 48) - 23 };
      setAttachment(findCompanionOpening(start, { width: element.offsetWidth, height: element.offsetHeight }, preferred, readPopupViewport(), existing));
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(card);
    resize.observe(element);
    if (body) resize.observe(body);
    const mutations = new MutationObserver(schedule);
    if (body) mutations.observe(body, { childList: true, subtree: true });
    body?.addEventListener('scroll', schedule, { passive: true });
    body?.addEventListener(SUB_ANNOTATION_ANCHORS_CHANGED, schedule);
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect();
      body?.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      body?.removeEventListener(SUB_ANNOTATION_ANCHORS_CHANGED, schedule);
    };
    // Moving a card changes the geometry prop, while these observers only
    // measure its size and the marker's position inside that card.
  }, [parentCard, popup, id]);

  const side = dragPosition ? 'free' : attachment?.side ?? 'right';
  const position = dragPosition ?? placeCompanion(parent, size, attachment ?? { side: 'right', offset: 24 }, moveBounds);
  const arrowTop = companionArrowTop(parent, { ...position, ...size }, side, marker);
  const move = (next: PopupPosition, stage: 'drag' | 'release' | 'keyboard') => {
    if (stage === 'drag') { setDragPosition(next); return; }
    // Store manual coordinates relative to the direct parent too. The entire
    // branch can therefore move together even after a card was repositioned.
    setAttachment(stage === 'release'
      ? snapCompanion(parent, { ...next, ...size }, moveBounds)
      : companionAttachment(parent, next, 'free'));
    setDragPosition(undefined);
  };
  return { position: { ...position, width, maxHeight }, side, arrowTop, move };
}
