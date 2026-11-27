import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Clipboard, Copy, FlaskConical, Languages, MessageSquare, MessageSquarePlus, MessageSquareQuote, Trash2, X } from 'lucide-react';
import { canTranslateWithShortcut, useTranslation } from './Translation';
import { useChatTextReference } from './ChatTextReference';
import { shortcutLabel } from '../domain/translation';
import { MathMarkdown } from './MathMarkdown';
import { createTextAnnotator, rangeToSelector } from '@recogito/text-annotator';
import type { TextAnnotation, TextSelector } from '@recogito/text-annotator';
import type { Annotation, MessageVersion } from '../domain/types';
import { annotationGroupId, groupAnnotations, preferredAnnotationSlot } from '../domain/annotation-groups';
import { isAnnotationGenerating } from '../domain/annotation-state';
import { annotationSourceViewport, annotationViewportRect, createNativeAnnotationSurface, ebookRangeSelector, elementTarget, type AnnotationSurface } from '../adapters/annotation-surface';
import { createPdfAnnotationSurface } from '../adapters/pdf-annotation-surface';
import { reviveQuoteSelector } from '../adapters/anchors';
import { AnnotationActions } from './AnnotationActions';
import { annotationPopupPosition, selectionToolbarPosition } from './popup-position';
import '@recogito/text-annotator/text-annotator.css';
import './annotation.css';
import './annotation-counts.css';

export interface AnnotatedAnswerProps {
  conversationId: string;
  messageId: string;
  version: MessageVersion;
  annotations: Annotation[];
  reservedColors?: string[];
  openAnnotationId: string | null;
  onOpen: (id: string | null) => void;
  onCreate: (annotation: Annotation) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onAsk: (id: string) => void;
  onStop: (id: string) => void;
  onReask: (id: string, action: 'start' | 'cancel' | 'edit') => void;
  onDelete: (id: string) => void;
  onReferenceToChat?: (id: string, childId?: string) => void;
  onExperimentSelection?: (messageId: string, versionId: string, selector: Pick<TextSelector, 'quote' | 'start' | 'end'>) => void;
  onNotify: (message: string) => void;
  disabled?: boolean;
  plainText?: boolean;
  content?: ReactNode;
  contentReadyKey?: string | number;
  contentClassName?: string;
  readerStyle?: CSSProperties;
  onSourceClick?: (point: { x: number; y: number }) => boolean;
}

interface SavedAnchor { selectors: TextSelector[]; sourceStart?:number }
interface SelectionDraft { selector: TextSelector; rect: DOMRect; range?: Range }
interface AnnotationChoice { ids: string[]; rect: DOMRect }
interface AnswerMenu { x: number; y: number; ids: string[]; selection: SelectionDraft | null; targetId: string | null }
const COLORS = ['#f3cf67', '#a9c6f6', '#b7ddba', '#e6b4d7', '#c9baf1', '#f3ba95', '#94d5d3', '#d7d68d'];

function annotationColor(index: number): string {
  if (index < COLORS.length) return COLORS[index];
  // Golden-angle hues keep later notes distinct; the domain accepts hex colors.
  const hue = (index * 137.508) % 360;
  const saturation = 0.57;
  const lightness = 0.76;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const base = lightness - chroma / 2;
  const channels = hue < 60 ? [chroma, secondary, 0] : hue < 120 ? [secondary, chroma, 0] : hue < 180 ? [0, chroma, secondary] : hue < 240 ? [0, secondary, chroma] : hue < 300 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  return `#${channels.map((channel) => Math.round((channel + base) * 255).toString(16).padStart(2, '0')).join('')}`;
}

import { sourceSelectionStart } from '../domain/reader-selection';

function readAnchor(value: unknown): SavedAnchor | null {
  if (!value || typeof value !== 'object' || !('selectors' in value) || !Array.isArray(value.selectors)) return null;
  const selectors = value.selectors.filter((entry: unknown): entry is TextSelector => Boolean(entry && typeof entry === 'object' && 'start' in entry && typeof entry.start === 'number' && 'end' in entry && typeof entry.end === 'number' && 'quote' in entry && typeof entry.quote === 'string'));
  return selectors.length ? { selectors } : null;
}

function toTextAnnotation(annotation: Annotation): TextAnnotation | null {
  const anchor = readAnchor(annotation.anchor);
  const id = annotationGroupId(annotation);
  return anchor ? { id, bodies: [], target: { annotation: id, selector: anchor.selectors, created: new Date(annotation.createdAt) } } : null;
}

export function AnnotatedAnswer({ conversationId, messageId, version, annotations, reservedColors = [], openAnnotationId, onOpen, onCreate, onUpdate, onAsk, onStop, onReask, onDelete, onReferenceToChat, onExperimentSelection, onNotify, disabled, plainText = false, content, contentReadyKey, contentClassName = '', readerStyle, onSourceClick }: AnnotatedAnswerProps) {
  useLocale();
  const translation = useTranslation();
  const chatText = useChatTextReference();
  const annotationActions = useContext(AnnotationActions);
  const sourceKey = `${conversationId}:${messageId}:${version.id}`;
  const proseRef = useRef<HTMLDivElement>(null);
  const annotatorRef = useRef<AnnotationSurface | null>(null);
  const openingHint = useRef<{ id: string; rect: DOMRect } | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const chooserRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [annotationChoice, setAnnotationChoice] = useState<AnnotationChoice | null>(null);
  const [answerMenu, setAnswerMenu] = useState<AnswerMenu | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [unlocatedAnnotationIds, setUnlocatedAnnotationIds] = useState<string[]>([]);
  // A PDF text layer may arrive after its canvas. Zero explicitly pauses all
  // selection/anchor work until the caller has finished building that layer.
  const isComplete = version.status === 'complete' && contentReadyKey !== 0;
  const visibleAnnotations = useMemo(() => annotations.filter(annotation =>
    annotation.messageId === messageId && annotation.versionId === version.id && annotation.deletedAt === undefined), [annotations, messageId, version.id]);
  const groups = useMemo(() => groupAnnotations(visibleAnnotations), [visibleAnnotations]);
  const hoveredAnnotation = visibleAnnotations.find(annotation => annotation.id === annotationActions?.hoveredChild?.ownerId);
  const openAnnotation = hoveredAnnotation ?? visibleAnnotations.find((annotation) => annotation.id === openAnnotationId);
  const openGroupId = openAnnotation && annotationGroupId(openAnnotation);
  const companionHovered = Boolean(hoveredAnnotation);
  const anchors = annotationActions?.anchors;
  const preferred = (id: string, slots: readonly Annotation[]) => preferredAnnotationSlot(slots, annotationActions?.lastOpenedSlot(id));
  const annotationsAt = (ids: ReadonlySet<string>) => [...groups].flatMap(([id, slots]) => ids.has(id) ? [preferred(id, slots)] : []);
  const unlocatedAnnotations = annotationsAt(new Set(unlocatedAnnotationIds));
  const choices = annotationChoice ? visibleAnnotations.filter((annotation) => annotationChoice.ids.includes(annotation.id)) : [];
  const menuAnnotations = answerMenu ? visibleAnnotations.filter((annotation) => answerMenu.ids.includes(annotation.id)) : [];
  const menuAnnotation = menuAnnotations.find((annotation) => annotation.id === answerMenu?.targetId);
  const surfaceState = useRef({ groups, openGroupId });
  surfaceState.current = { groups, openGroupId };
  // Store changes to question/answer do not recreate native text ranges.
  const anchorSignature = useMemo(() => JSON.stringify([...groups].map(([id, slots]) => ({ id, anchor: slots[0].anchor, color: slots[0].color, count: slots.length }))), [groups]);

  useLayoutEffect(() => {
    const element = proseRef.current;
    if (!element || !isComplete) return;
    const color = (id: string) => surfaceState.current.groups.get(id)?.[0].color || COLORS[0];
    const count = (id: string) => surfaceState.current.groups.get(id)?.length ?? 0;
    const pdfStage = element.ownerDocument === document ? element.querySelector<HTMLElement>('.document-page-stage') : null;
    const annotator = pdfStage ? createPdfAnnotationSurface(element, pdfStage, color, count)
      : createNativeAnnotationSurface(element, color, count) ?? createTextAnnotator<TextAnnotation, TextAnnotation>(element, {
        annotatingEnabled: false,
        renderer: 'SPANS',
        selectorReviveFn: reviveQuoteSelector,
        style: (annotation, state) => ({
          fill: color(annotation.id), underlineThickness: state.selected ? 2 : 1, underlineColor: color(annotation.id),
        }),
      });
    annotatorRef.current = annotator;
    // Recalculate the overlay after a web font, formula or responsive layout changes.
    const observer = new ResizeObserver(() => {
      annotator.state.store.recalculatePositions();
      anchors?.changed(sourceKey);
    });
    observer.observe(element);
    return () => { observer.disconnect(); annotator.destroy(); annotatorRef.current = null; };
  }, [version.id, isComplete, version.content, contentReadyKey, anchors, sourceKey]);

  useLayoutEffect(() => {
    const annotator = annotatorRef.current;
    if (!annotator) { setUnlocatedAnnotationIds([]); return; }
    const { groups, openGroupId } = surfaceState.current;
    const saved = [...groups.values()].map(slots => toTextAnnotation(slots[0])).filter((annotation): annotation is TextAnnotation => annotation !== null);
    annotator.setAnnotations(saved, true);
    setUnlocatedAnnotationIds([...groups].filter(([id, slots]) => {
      const selectorCount = readAnchor(slots[0].anchor)?.selectors.length;
      return !selectorCount || annotator.state.store.getAnnotation(id)?.target.selector.length !== selectorCount;
    }).map(([id]) => id));
    annotator.setSelected(openGroupId);
    anchors?.changed(sourceKey);
  }, [anchorSignature, version.id, isComplete, version.content, contentReadyKey, anchors, sourceKey]);

  useLayoutEffect(() => anchors?.register(sourceKey, groupId => {
    const element = proseRef.current;
    const bounds = annotatorRef.current?.state.store.getAnnotationBounds(groupId);
    if (!element || !bounds) return openingHint.current?.id === groupId ? openingHint.current.rect : null;
    const rect = element.getBoundingClientRect();
    return annotationViewportRect(new DOMRect(rect.left + bounds.x, rect.top + bounds.y, bounds.width, bounds.height), element.ownerDocument);
  }), [anchors, sourceKey]);

  useEffect(() => {
    const annotator = annotatorRef.current;
    if (!annotator) return;
    annotator.setSelected(openGroupId);
  }, [openGroupId]);
  useEffect(() => {
    annotatorRef.current?.setEmphasized?.(companionHovered);
  }, [companionHovered, version.id, version.content, isComplete, contentReadyKey]);

  useEffect(() => {
    setAnnotationChoice(null);
    setSelectionDraft(null);
    setAnswerMenu(null);
    setManualCopy(null);
  }, [version.id, contentReadyKey]);

  useLayoutEffect(() => {
    const toolbar = selectionToolbarRef.current, element = proseRef.current, range = selectionDraft?.range;
    if (!toolbar || !element || !range) return;
    const source = element.ownerDocument;
    let frame = 0;
    const place = () => {
      const area = annotationSourceViewport(element);
      const visible = [...range.getClientRects()].map(rect => {
        const bounds = annotationViewportRect(rect, source);
        return { left: Math.max(area.left, bounds.left), right: Math.min(area.right, bounds.right),
          top: Math.max(area.top, bounds.top), bottom: Math.min(area.bottom, bounds.bottom) };
      }).filter(rect => rect.left < rect.right && rect.top < rect.bottom);
      if (!visible.length) { toolbar.style.visibility = 'hidden'; return; }
      const selection = visible.slice(1).reduce((bounds, rect) => ({
        left: Math.min(bounds.left, rect.left), right: Math.max(bounds.right, rect.right),
        top: Math.min(bounds.top, rect.top), bottom: Math.max(bounds.bottom, rect.bottom),
      }), visible[0]);
      toolbar.style.maxWidth = Math.max(1, area.right - area.left - 12) + 'px';
      const position = selectionToolbarPosition(selection, area, { width: toolbar.offsetWidth, height: toolbar.offsetHeight });
      Object.assign(toolbar.style, { left: position.left + 'px', top: position.top + 'px', visibility: 'visible' });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); });
    };
    const checkSelection = () => {
      const current = source.getSelection();
      const actual = current?.rangeCount ? current.getRangeAt(0) : null;
      if (!actual || actual.compareBoundaryPoints(Range.START_TO_START, range)
        || actual.compareBoundaryPoints(Range.END_TO_END, range)) setSelectionDraft(null);
    };
    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    observer.observe(toolbar);
    source.addEventListener('selectionchange', checkSelection);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      source.removeEventListener('selectionchange', checkSelection);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [selectionDraft]);

  useLayoutEffect(() => {
    if (!answerMenu || !menuRef.current) return;
    const width = menuRef.current.offsetWidth;
    const height = menuRef.current.offsetHeight;
    setMenuStyle({ left: Math.max(8, Math.min(answerMenu.x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(answerMenu.y, window.innerHeight - height - 8)) });
    menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [answerMenu]);

  useEffect(() => {
    if (!answerMenu) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setAnswerMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); };
  }, [answerMenu]);

  useEffect(() => {
    if (!annotationChoice) return;
    chooserRef.current?.querySelector<HTMLButtonElement>('.annotation-choice-button')?.focus({ preventScroll: true });
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && chooserRef.current?.contains(event.target)) return;
      setAnnotationChoice(null);
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, [annotationChoice]);


  useEffect(() => {
    const clearSelection = () => {
      const source = proseRef.current;
      const selection = source?.ownerDocument.getSelection();
      const range = selection?.rangeCount && selection.getRangeAt(0);
      if (!range || selection?.isCollapsed || !source?.contains(range.startContainer) || !source.contains(range.endContainer)) setSelectionDraft(null);
    };
    const dismiss = (event: PointerEvent) => {
      if (!elementTarget(event.target)?.closest('.annotation-selection-button')) setSelectionDraft(null);
      if (!(event.target instanceof Node) || !chooserRef.current?.contains(event.target)) setAnnotationChoice(null);
    };
    const sourceDocument = proseRef.current?.ownerDocument || document;
    sourceDocument.addEventListener('selectionchange', clearSelection);
    document.addEventListener('pointerdown', dismiss);
    if (sourceDocument !== document) sourceDocument.addEventListener('pointerdown', dismiss);
    return () => { sourceDocument.removeEventListener('selectionchange', clearSelection); document.removeEventListener('pointerdown', dismiss); if (sourceDocument !== document) sourceDocument.removeEventListener('pointerdown', dismiss); };
  }, []);

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isComplete || event.button !== 0) return;
    const element = proseRef.current;
    const selection = proseRef.current?.ownerDocument.getSelection();
    if (!element || !selection) return;
    if (!selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (!element.contains(range.startContainer) || !element.contains(range.endContainer) || !range.toString().trim()) return;
      const revived = element.ownerDocument === document ? rangeToSelector(range, element) : ebookRangeSelector(range, element);
      setAnnotationChoice(null);
      setSelectionDraft({ selector: { start: revived.start, end: revived.end, quote: revived.quote },
        rect: annotationViewportRect(range.getBoundingClientRect(), element.ownerDocument), range: range.cloneRange() });
      return;
    }
    setSelectionDraft(null);
    const rect = element.getBoundingClientRect();
    // Recogito's public all=true overload returns every range under the pointer.
    // Deduplicate IDs because a wrapped annotation may have several hit rects.
    const hits = annotatorRef.current?.state.store.getAt(event.clientX - rect.left, event.clientY - rect.top, true) || [];
    const hitIds = new Set(hits.map((annotation) => annotation.id));
    const matching = annotationsAt(hitIds);
    if (matching.length) {
      const point = annotationViewportRect(new DOMRect(event.clientX, event.clientY, 1, 18), element.ownerDocument);
      if (matching.length > 1) {
        setAnnotationChoice({ ids: matching.map((annotation) => annotation.id), rect: point });
      } else {
        setAnnotationChoice(null);
        openingHint.current = { id: annotationGroupId(matching[0]), rect: point };
        onOpen(matching[0].id);
      }
    } else if (onSourceClick?.({ x: event.clientX, y: event.clientY })) {
      event.preventDefault();
    }
  };

  const createAnnotation = (draft = selectionDraft, savedTranslation?: { text: string; model: string }) => {
    if (!draft || !isComplete || !annotatorRef.current || !proseRef.current?.isConnected) return false;
    const now = Date.now();
    const id = crypto.randomUUID();
    openingHint.current = { id, rect: draft.rect };
    const usedColors = new Set([...reservedColors, ...visibleAnnotations.map((annotation) => annotation.color)].map((color) => color.toLowerCase()));
    let colorIndex = 0;
    while (usedColors.has(annotationColor(colorIndex).toLowerCase())) colorIndex += 1;
    const nextColor = annotationColor(colorIndex);
    let sourceStart:number|undefined;
    if (plainText || content!=null) {
      const root=proseRef.current;
      const walker=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement?.closest('.not-annotatable')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
      const parts:string[]=[];let n:Node|null;
      while ((n=walker.nextNode())) parts.push(n.textContent??'');
      sourceStart=sourceSelectionStart(version.content,parts.join(''),draft.selector);
    }
    try { onCreate({ id, conversationId, messageId, versionId: version.id, quote: draft.selector.quote, anchor: { selectors: [draft.selector], ...(sourceStart!==undefined?{sourceStart}:{}) } satisfies SavedAnchor, color: nextColor, mode: savedTranslation ? 'note' : 'ask', ...(savedTranslation ? { note: `${savedTranslation.text}\n\n${t('翻译模型：{0}', [savedTranslation.model])}` } : {}), question: '', answer: '', edited: false, status: savedTranslation ? 'noted' : 'draft', createdAt: now, updatedAt: now }); }
    catch (error) { if (savedTranslation) throw error; onNotify(error instanceof Error ? error.message : t("无法创建批注，请先导出备份。")); return false; }
    onOpen(id);
    setAnnotationChoice(null);
    setSelectionDraft(null);
    setAnswerMenu(null);
    proseRef.current?.ownerDocument.getSelection()?.removeAllRanges();
    return true;
  };

  const translateSelection = (draft: SelectionDraft) => {
    const element = proseRef.current;
    if (!translation?.enabled || !isComplete || !element) return;
    setSelectionDraft(null); setAnswerMenu(null); setAnnotationChoice(null);
    const locate = () => {
      const doc = element.ownerDocument;
      const frame = doc.defaultView?.frameElement;
      if (proseRef.current !== element || !element.isConnected || !element.classList.contains('annotation-answer-ready')
        || (doc !== document && !frame?.isConnected)) return null;
      const anchor = reviveQuoteSelector(draft.selector, element)[0];
      if (!anchor) return null;
      const viewport = annotationSourceViewport(element);
      for (const rect of anchor.range.getClientRects()) {
        const projected = annotationViewportRect(rect, doc);
        if (rect.width > 0 && rect.height > 0
          && projected.right > viewport.left && projected.left < viewport.right
          && projected.bottom > viewport.top && projected.top < viewport.bottom) return projected;
      }
      return null;
    };
    translation.translate({ sourceKey, text: draft.selector.quote, element, rect: draft.rect, locate, save: (text, model) => {
      if (!createAnnotation(draft, { text, model })) throw new Error('原文位置已变化，请重新选词翻译。');
    } });
  };
  const captureExperiment = (draft: SelectionDraft) => {
    onExperimentSelection?.(messageId, version.id, draft.selector);
    setSelectionDraft(null); setAnswerMenu(null);
    proseRef.current?.ownerDocument.getSelection()?.removeAllRanges();
  };
  const quoteSelection = (draft: SelectionDraft) => {
    if (!chatText?.enabled || !isComplete) return;
    chatText.quote({ conversationId, messageId, versionId: version.id, text: draft.selector.quote });
    setSelectionDraft(null); setAnswerMenu(null); setAnnotationChoice(null);
    proseRef.current?.ownerDocument.getSelection()?.removeAllRanges();
  };
  useLayoutEffect(() => () => translation?.releaseSource(sourceKey), [sourceKey, translation?.releaseSource]);
  useEffect(() => {
    if (!translation?.enabled || !isComplete) return;
    const keydown = (event: KeyboardEvent) => {
      if (!canTranslateWithShortcut(event, translation.preferences.shortcut)) return;
      const element = proseRef.current, selection = proseRef.current?.ownerDocument.getSelection();
      if (!element || !selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!element.contains(range.startContainer) || !element.contains(range.endContainer) || !range.toString().trim()) return;
      const selector = element.ownerDocument === document ? rangeToSelector(range, element) : ebookRangeSelector(range, element);
      event.preventDefault(); event.stopPropagation();
      translateSelection({ selector: { start: selector.start, end: selector.end, quote: selector.quote }, rect: annotationViewportRect(range.getBoundingClientRect(), element.ownerDocument) });
    };
    const sourceDocument = proseRef.current?.ownerDocument || document;
    sourceDocument.addEventListener('keydown', keydown);
    return () => sourceDocument.removeEventListener('keydown', keydown);
  });

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isComplete || (elementTarget(event.target)?.closest('input, textarea, [contenteditable="true"]'))) return;
    event.preventDefault();
    const element = proseRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const keyboardTriggered = event.clientX === 0 && event.clientY === 0;
    const x = keyboardTriggered ? bounds.left + 20 : event.clientX;
    const y = keyboardTriggered ? bounds.top + 20 : event.clientY;
    const hits = annotatorRef.current?.state.store.getAt(x - bounds.left, y - bounds.top, true) || [];
    const hitIds = new Set(hits.map((annotation) => annotation.id));
    if (keyboardTriggered && openGroupId) hitIds.add(openGroupId);
    const ids = annotationsAt(hitIds).map(annotation => annotation.id);
    const selection = proseRef.current?.ownerDocument.getSelection();
    let draft: SelectionDraft | null = null;
    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (element.contains(range.startContainer) && element.contains(range.endContainer) && range.toString().trim()) {
        const selector = element.ownerDocument === document ? rangeToSelector(range, element) : ebookRangeSelector(range, element);
        draft = { selector: { start: selector.start, end: selector.end, quote: selector.quote }, rect: annotationViewportRect(range.getBoundingClientRect(), element.ownerDocument) };
      }
    }
    menuReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectionDraft(null);
    setAnnotationChoice(null);
    const point = annotationViewportRect(new DOMRect(x, y, 0, 0), element.ownerDocument);
    setMenuStyle({ left: point.x, top: point.y });
    setAnswerMenu({ x: point.x, y: point.y, ids, selection: draft, targetId: ids.length === 1 ? ids[0] : null });
  };

  const closeMenu = (restoreFocus = false) => {
    setAnswerMenu(null);
    if (restoreFocus) menuReturnFocusRef.current?.focus({ preventScroll: true });
  };

  const copyText = async (text: string) => {
    closeMenu();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      onNotify(t("已复制到剪贴板。"));
    } catch {
      setManualCopy(text);
    }
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
    if (event.key === 'Tab') { closeMenu(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index]?.focus({ preventScroll: true });
  };

  return (
    <>
      <div ref={proseRef} className={`annotation-answer${isComplete ? ' annotation-answer-ready' : ''}${contentClassName ? ` ${contentClassName}` : ''}`} onPointerUp={handlePointerUp} onContextMenu={handleContextMenu} data-testid="annotated-answer" data-version-id={version.id}>
        {content ?? (plainText ? <div className="annotation-plain-text">{version.content}</div> : <MathMarkdown streaming={version.status === 'streaming'}>{version.content}</MathMarkdown>)}
      </div>
      {unlocatedAnnotations.length > 0 && <details className="annotation-footnote" data-testid="unlocated-annotations">
        <summary>{t("有")}{unlocatedAnnotations.length}{t("条批注暂未定位原文")}</summary>
        <p>{t("排版更新后，部分原文位置可能变化。批注已保留，可在这里打开。")}</p>
        {unlocatedAnnotations.map((annotation) => <button
          type="button"
          key={annotation.id}
          className="annotation-choice-button"
          title={annotation.quote}
          onClick={(event) => { openingHint.current = { id: annotationGroupId(annotation), rect: event.currentTarget.getBoundingClientRect() }; onOpen(annotation.id); }}
        ><span className="annotation-color-dot" style={{ background: annotation.color }} /><span className="annotation-choice-copy"><span className="annotation-choice-ordinal">{t("批注")}{visibleAnnotations.findIndex((entry) => entry.id === annotation.id) + 1}</span><span className="annotation-choice-preview">{(annotation.mode === 'note' ? annotation.note?.trim() : annotation.question.trim()) || annotation.quote}</span></span></button>)}
      </details>}
      {selectionDraft && isComplete && createPortal(
        <div ref={selectionToolbarRef} className="annotation-selection-toolbar" style={readerStyle}>
          <button type="button" className="annotation-selection-button" data-testid="create-annotation" onPointerDown={event => event.preventDefault()} onClick={() => createAnnotation()}><MessageSquarePlus size={15} />{t("添加批注")}</button>
          {onExperimentSelection && <button type="button" className="annotation-selection-button" onPointerDown={e => e.preventDefault()} onClick={() => captureExperiment(selectionDraft)}><FlaskConical size={15} />{t('加入实验')}</button>}
          {chatText?.enabled && <button type="button" className="annotation-selection-button quote-selection-button" onPointerDown={event => event.preventDefault()} onClick={() => quoteSelection(selectionDraft)}><MessageSquareQuote size={15} />{t('引用到聊天')}</button>}
        </div>, document.body,
      )}
      {annotationChoice && choices.length > 1 && createPortal(
        <div
          ref={chooserRef}
          className="annotation-choice-popup"
          role="dialog"
          aria-label={t("选择批注")}
          data-testid="annotation-chooser"
          style={{ ...readerStyle, ...annotationPopupPosition(annotationChoice.rect, { width: innerWidth, height: innerHeight }, Math.min(360, choices.length * 58 + 50), 310), maxHeight: Math.min(360, window.innerHeight - 32) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setAnnotationChoice(null); }
          }}
        >
          <div className="annotation-choice-header"><strong>{t("这里有")}{choices.length}{t("条批注")}</strong><button type="button" className="annotation-icon-button" aria-label={t("关闭批注选择")} onClick={() => setAnnotationChoice(null)}><X size={15} /></button></div>
          <div className="annotation-choice-list">
            {choices.map((annotation) => {
              const ordinal = visibleAnnotations.findIndex((entry) => entry.id === annotation.id) + 1;
              const label = (annotation.mode === 'note' ? annotation.note?.trim() : annotation.question.trim()) || annotation.quote;
              return <button
                type="button"
                key={annotation.id}
                className="annotation-choice-button"
                aria-label={t("打开批注 {0}：{1}", [ordinal, label])}
                title={label}
                onClick={() => { setAnnotationChoice(null); onOpen(annotation.id); }}
              ><span className="annotation-color-dot" style={{ background: annotation.color }} /><span className="annotation-choice-copy"><span className="annotation-choice-ordinal">{t("批注")}{ordinal}{annotation.status === 'draft' ? t(" · 草稿") : ''}</span><span className="annotation-choice-preview">{label}</span></span></button>;
            })}
          </div>
        </div>, document.body,
      )}
      {answerMenu && createPortal(
        <div
          ref={menuRef}
          className="annotation-context-menu"
          role="menu"
          aria-label={t("回答与批注操作")}
          data-testid="annotation-context-menu"
          style={{ ...readerStyle, ...menuStyle }}
          onKeyDown={handleMenuKeyDown}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {answerMenu.selection && <>
            {onExperimentSelection && <button type="button" role="menuitem" onClick={() => captureExperiment(answerMenu.selection!)}><FlaskConical size={15} /><span>{t('加入实验')}</span></button>}
            {chatText?.enabled && <button type="button" role="menuitem" onClick={() => quoteSelection(answerMenu.selection!)}><MessageSquareQuote size={15} /><span>{t('引用到聊天')}</span></button>}
            {translation && <button type="button" role="menuitem" disabled={!translation.enabled} onClick={() => translateSelection(answerMenu.selection!)}><Languages size={15} /><span>{t('翻译选中文字')}</span><small>{shortcutLabel(translation.preferences.shortcut)}</small></button>}
            <button type="button" role="menuitem" onClick={() => void copyText(answerMenu.selection!.selector.quote)}><Copy size={15} /><span>{t("复制选中文字")}</span></button>
            <button type="button" role="menuitem" onClick={() => createAnnotation(answerMenu.selection)}><MessageSquarePlus size={15} /><span>{t("为选中文字添加批注")}</span></button>
            {menuAnnotations.length > 0 && <div role="separator" className="annotation-menu-separator" />}
          </>}
          {menuAnnotations.length > 1 && !menuAnnotation ? <>
            <div className="annotation-menu-heading">{t("此处有")}{menuAnnotations.length}{t("条批注，请选择")}</div>
            {menuAnnotations.map((annotation) => {
              const ordinal = visibleAnnotations.findIndex((entry) => entry.id === annotation.id) + 1;
              const label = (annotation.mode === 'note' ? annotation.note?.trim() : annotation.question.trim()) || annotation.quote;
              return <button key={annotation.id} type="button" role="menuitem" data-annotation-id={annotation.id} aria-label={t("选择批注 {0}：{1}", [ordinal, label])} title={label} onClick={() => setAnswerMenu({ ...answerMenu, targetId: annotation.id })}><span className="annotation-color-dot" style={{ background: annotation.color }} /><span className="annotation-menu-note-label"><small>{t("批注")}{ordinal}</small><span>{label}</span></span><span className="annotation-menu-chevron">›</span></button>;
            })}
          </> : menuAnnotation ? <>
            {menuAnnotations.length > 1 && <button type="button" role="menuitem" className="annotation-menu-back" onClick={() => setAnswerMenu({ ...answerMenu, targetId: null })}><ArrowLeft size={14} /><span>{t("选择其他批注")}</span></button>}
            <div className="annotation-menu-heading annotation-menu-current" title={menuAnnotation.quote}><span className="annotation-color-dot" style={{ background: menuAnnotation.color }} /><span>{t("批注")}{visibleAnnotations.findIndex((entry) => entry.id === menuAnnotation.id) + 1} · {menuAnnotation.quote}</span></div>
            <button type="button" role="menuitem" onClick={() => { closeMenu(); onOpen(menuAnnotation.id); }}><MessageSquare size={15} /><span>{t("打开批注")}</span></button>
            <button type="button" role="menuitem" onClick={() => void copyText(menuAnnotation.quote)}><Copy size={15} /><span>{t("复制原文")}</span></button>
            <button type="button" role="menuitem" disabled={menuAnnotation.mode === 'note' ? !menuAnnotation.note : !menuAnnotation.question && !menuAnnotation.answer} onClick={() => void copyText(menuAnnotation.mode === 'note' ? menuAnnotation.note || '' : t("问题：{0}\n\n回答：{1}", [menuAnnotation.question, menuAnnotation.answer]))}><Clipboard size={15} /><span>{menuAnnotation.mode === 'note' ? t("复制批注") : t("复制批注问答")}</span></button>
            <div role="separator" className="annotation-menu-separator" />
            <button type="button" role="menuitem" className="annotation-menu-danger" disabled={isAnnotationGenerating(menuAnnotation)}
              title={t(isAnnotationGenerating(menuAnnotation) ? '请等回答完成后再删除' : '删除这条批注，可撤销')}
              onClick={() => { closeMenu(); onDelete(menuAnnotation.id); }}><Trash2 size={15} /><span>{t('删除批注')}</span></button>
          </> : menuAnnotations.length === 0 && !answerMenu.selection ? <button type="button" role="menuitem"
            onClick={() => void copyText(plainText || content != null ? proseRef.current?.innerText || version.content : version.content)}
          ><Copy size={15} /><span>{t("复制回答")}</span></button> : null}
          <div className="annotation-menu-footnote">{t("粘贴请在输入框内右键操作")}</div>
        </div>, document.body,
      )}
      {manualCopy !== null && createPortal(
        <div className="annotation-copy-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setManualCopy(null); }}>
          <section className="annotation-copy-dialog" role="dialog" aria-modal="true" aria-label={t("手动复制")} onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setManualCopy(null); }
            if (event.key === 'Tab') {
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('textarea, button'));
              const first = items[0]; const last = items[items.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}>
            <header><strong>{t("手动复制")}</strong><button type="button" className="annotation-icon-button" aria-label={t("关闭手动复制")} onClick={() => setManualCopy(null)}><X size={17} /></button></header>
            <p>{t("浏览器未允许自动复制。内容已选中，请按 Ctrl + C（Mac 按 ⌘ + C）。")}</p>
            <textarea aria-label={t("待复制内容")} readOnly value={manualCopy} ref={(element) => { if (element) { element.focus({ preventScroll: true }); element.select(); } }} />
          </section>
        </div>, document.body,
      )}
    </>
  );
}
