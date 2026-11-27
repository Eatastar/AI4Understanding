import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { annotationGroupId, groupAnnotations } from '../domain/annotation-groups';
import type { AnnotationWindow } from '../domain/companion-view';
import type { Annotation, Conversation, DocumentAttachment } from '../domain/types';
import { subAnnotationMarker } from '../hooks/useCompanionPosition';
import { AnnotationActions } from './AnnotationActions';
import { AnnotationCard } from './AnnotationCard';
import { MovableAnnotationPopup } from './MovableAnnotationPopup';
import { annotationPopupPosition } from './popup-position';
import { SubAnnotationWindows } from './SubAnnotationCard';

type Reader = { source: DocumentAttachment; ownerId: string; annotations: Annotation[]; disabled: boolean };
interface WindowSource {
  annotation: Annotation;
  sourceKey: string;
  documentId?: string;
  disabled: boolean;
}
interface Props {
  windows: readonly AnnotationWindow[];
  reader?: Reader;
  chat?: Conversation;
  chatBusy: boolean;
  onOpen: (id: string) => void;
  onClose: (ids: readonly string[]) => void;
  onUpdate: (ownerId: string, id: string, patch: Partial<Annotation>) => void;
  onAsk: (ownerId: string, id: string) => void;
  onStop: (id: string) => void;
  onReask: (ownerId: string, id: string, action: 'start' | 'cancel' | 'edit') => void;
  onDelete: (ownerId: string, id: string) => void;
  onReference: (id: string, documentId?: string, childId?: string) => void;
}

export function AnnotationWindows(props: Props) {
  const { windows, reader, chat, chatBusy } = props;
  const sources = useMemo(() => {
    const found = new Map<string, WindowSource>();
    if (!windows.length) return found;
    const include = (annotation: Annotation, ownerId: string, disabled: boolean, documentId?: string) => {
      if (annotation.figure || annotation.deletedAt !== undefined) return;
      const sourceKey = `${ownerId}:${annotation.messageId}:${annotation.versionId}`;
      found.set(annotation.id, { annotation, sourceKey, disabled, documentId });
    };
    if (chat) {
      const versions = new Map(chat.messages.map(message => [message.id, message.activeVersionId]));
      for (const annotation of chat.annotations) if (versions.get(annotation.messageId) === annotation.versionId) include(annotation, chat.id, chatBusy);
    }
    if (reader) {
      const versions = new Map(reader.source.pages.map(page => [page.messageId, page.versionId]));
      for (const annotation of reader.annotations) if (versions.get(annotation.messageId) === annotation.versionId) include(annotation, reader.ownerId, reader.disabled, reader.source.id);
    }
    return found;
  }, [reader, chat, chatBusy, Boolean(windows.length)]);
  const groups = useMemo(() => groupAnnotations([...sources.values()].map(source => source.annotation)), [sources]);
  const active = windows.flatMap(window => window.kind === 'parent' && sources.has(window.id)
    ? [{ groupId: window.groupId, source: sources.get(window.id)! }] : []);
  // Keep DOM order stable while pointer capture is active. Only z-indices change.
  active.sort((a, b) => a.groupId.localeCompare(b.groupId));

  const closeTop = useRef<(event: KeyboardEvent) => void>(() => {});
  closeTop.current = event => {
    if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229 || event.defaultPrevented || !active.length
      || document.querySelector('dialog[open], .translation-result, .reader-settings, .annotation-context-menu, .annotation-choice-popup, .chat-text-selection, .figure-selection-hint')) return;
    const section = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-sub-annotation], [data-annotation-id]') : null;
    const focused = windows.find(window => window.id === (section?.dataset.subAnnotation ?? section?.dataset.annotationId));
    const family = focused?.kind === 'child' ? focused.ownerId : focused?.id;
    const ordered = windows.slice().reverse();
    const top = ordered.find(window => window.kind === 'child' && sources.has(window.ownerId) && (!family || family === window.ownerId))
      ?? ordered.find(window => window.kind === 'parent' && sources.has(window.id) && (!family || family === window.id));
    if (!top) return;
    event.preventDefault();
    if (top.kind === 'child') {
      const parent = document.getElementById(`annotation-window-${top.parentId}`);
      (subAnnotationMarker(parent, top.id) ?? parent?.querySelector<HTMLElement>('.annotation-card-header'))?.focus({ preventScroll: true });
    }
    props.onClose([top.id]);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => closeTop.current(event);
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);

  return active.length ? createPortal(<div className="annotation-windows-layer">
    {active.map(({ groupId, source }) => <SourceAnnotationWindow key={groupId}
      source={source} slots={groups.get(groupId) ?? []} actions={props} />)}
  </div>, document.body) : null;
}

function SourceAnnotationWindow({ source, slots, actions }: {
  source: WindowSource; slots: readonly Annotation[]; actions: Props;
}) {
  const context = useContext(AnnotationActions)!;
  const { anchors, windowOrder, dispatchWindow } = context;
  const { annotation, sourceKey, documentId, disabled } = source;
  const groupId = annotationGroupId(annotation);
  const popup = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const moved = useRef(false);
  const lastAnchor = useRef<DOMRect | null>(null);
  const [position, setPosition] = useState(() => annotationPopupPosition(anchors.measure(sourceKey, groupId), { width: innerWidth, height: innerHeight }));
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      if (moved.current) return;
      const rect = anchors.measure(sourceKey, groupId);
      if (rect) lastAnchor.current = rect;
      const next = annotationPopupPosition(lastAnchor.current, { width: innerWidth, height: innerHeight }, popup.current?.offsetHeight || 440);
      setPosition(previous => previous.left === next.left && previous.top === next.top && previous.width === next.width
        && previous.maxHeight === next.maxHeight ? previous : next);
    };
    const schedule = () => { if (!frame && !moved.current) frame = requestAnimationFrame(place); };
    const unsubscribe = anchors.subscribe(sourceKey, schedule);
    const observer = new ResizeObserver(schedule);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    place();
    return () => {
      unsubscribe(); observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    };
  }, [anchors, sourceKey, groupId]);
  const { id, conversationId: owner } = annotation;
  const reference = (childId?: string) => actions.onReference(id, documentId, childId);
  return <MovableAnnotationPopup popupRef={popup} id={`annotation-window-${id}`} style={{ ...position, zIndex: windowOrder.get(id) }}
    onUserMoveOrResize={() => { moved.current = true; }}
    onActivate={() => dispatchWindow({ type: 'raise', id })}
    renderAttached={rect => <SubAnnotationWindows annotation={annotation} parentCard={card} parentRect={rect}
      parentId={id} parentQuote={annotation.quote} disabled={disabled || annotation.status === 'generating' || !!annotation.reask} onReferenceToChat={reference} />}>
    <AnnotationCard key={id} cardRef={card} annotation={annotation} slots={slots} onSwitchSlot={actions.onOpen}
      onClose={() => actions.onClose([id])} onUpdate={patch => actions.onUpdate(owner, id, patch)} onAsk={() => actions.onAsk(owner, id)}
      onStop={() => actions.onStop(id)} onReask={action => actions.onReask(owner, id, action)} onDelete={() => actions.onDelete(owner, id)}
      onReferenceToChat={reference} disabled={disabled} />
  </MovableAnnotationPopup>;
}
