import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { BookmarkPlus, CornerDownRight, GripHorizontal, LoaderCircle, MessageSquareQuote, Pencil, Plus, RotateCcw, Send, Square, Trash2, X } from 'lucide-react';
import { canReferenceSubAnnotation } from '../domain/chat-references';
import type { ChildAnnotationWindow } from '../domain/companion-view';
import { groupSubAnnotations, subAnnotationLabel } from '../domain/sub-annotation-tree';
import type { SubAnnotationAnchor } from '../domain/sub-annotations';
import type { Annotation, SubAnnotation } from '../domain/types';
import { useAnnotationMathOverflow } from '../hooks/useAnnotationMathOverflow';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { subAnnotationMarker, useCompanionPosition } from '../hooks/useCompanionPosition';
import { t } from '../i18n/locale';
import { AnswerCitations } from './reader-citations';
import { ReaderSources, BranchSource } from './ReaderSources';
import { AnnotationActions } from './AnnotationActions';
import { AnnotationAnswerBody } from './AnnotationAnswerBody';
import type { SubAnnotationMarker } from '../hooks/useSubAnnotationHighlights';
import { KnowledgeCardActions } from './KnowledgeBase';
import { MathMarkdown } from './MathMarkdown';
import { MovableAnnotationPopup } from './MovableAnnotationPopup';
import type { PopupRect } from './popup-position';
import './sub-annotation-card.css';

interface CompanionProps {
  annotation: Annotation;
  parentCard: RefObject<HTMLElement | null>;
  parentRect: PopupRect;
  parentId: string;
  parentQuote: string;
  disabled?: boolean;
  onReferenceToChat?: (childId: string) => void;
}

export function SubAnnotationWindows(props: CompanionProps) {
  const actions = useContext(AnnotationActions);
  return actions?.childWindows.get(props.parentId)?.map(selection =>
    <SubAnnotationCard key={selection.key} {...props} selection={selection} />);
}

function SubAnnotationCard({ annotation, parentCard, parentRect, parentId, parentQuote, selection, disabled, onReferenceToChat }: CompanionProps & { selection: ChildAnnotationWindow }) {
  const actions = useContext(AnnotationActions)!;
  const popup = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const lastArrow = useRef(23);
  const { position, side, arrowTop, move } = useCompanionPosition(parentRect, parentCard, popup, selection.id);
  const child = annotation.subAnnotations?.find(node => node.id === selection.id);
  const quote = selection.draft?.quotedText ?? child?.quotedText;
  const { setHoveredChild } = actions;
  useEffect(() => () => setHoveredChild(selection.id, annotation.id, false), [setHoveredChild, selection.id, annotation.id]);
  if (!quote) return null;

  const close = () => {
    actions.dispatchWindow({ type: 'close', ids: [selection.id] });
    const parent = parentCard.current;
    const focus = !selection.draft && subAnnotationMarker(parent, selection.id) || parent?.querySelector<HTMLElement>('.annotation-card-header');
    focus?.focus({ preventScroll: true });
  };
  const hover = (hovered: boolean) => setHoveredChild(selection.id, annotation.id, hovered);
  const addSibling = () => {
    if (!child) return;
    const { id, quotedText, blockIndex, quoteOffset, parentAnswerHash, parentSubId, turnIndex } = child;
    actions.dispatchWindow({
      type: 'open-child', ownerId: annotation.id, parentId, id: crypto.randomUUID(),
      draft: { siblingOf: id, quotedText, blockIndex, quoteOffset, parentAnswerHash, parentSubId, turnIndex },
    });
  };
  if (arrowTop !== undefined) lastArrow.current = arrowTop;

  return <MovableAnnotationPopup popupRef={popup} id={`annotation-window-${selection.id}`} style={{ ...position, zIndex: actions.windowOrder.get(selection.id) }} className="sub-annotation-popup"
    isolateKeys resizable={false} onMove={move} onActivate={() => actions.dispatchWindow({ type: 'raise', id: selection.id })}
    renderAttached={rect => <SubAnnotationWindows annotation={annotation} parentCard={card} parentRect={rect} parentId={selection.id}
      parentQuote={quote} disabled={disabled} onReferenceToChat={onReferenceToChat} />}>
    <span className="sub-annotation-arrow" data-side={side} data-visible={arrowTop !== undefined}
      style={{ top: arrowTop ?? lastArrow.current }} aria-hidden="true" />
    <section ref={card} className="sub-annotation-card" role="dialog" aria-modal="false" aria-label={t('子批注')}
      data-sub-annotation={selection.id} data-docked={side !== 'free'} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
      <header className="annotation-card-header sub-annotation-card-header" tabIndex={0} aria-label={t('批注标题栏，可拖动或使用方向键移动')}>
        <GripHorizontal size={13} className="annotation-drag-icon" aria-hidden="true" />
        <span className="annotation-color-dot" style={{ background: annotation.color }} aria-hidden="true" />
        <div className="sub-annotation-heading">
          <CornerDownRight size={12} aria-hidden="true" />
          <button type="button" className="sub-annotation-parent-link" title={parentQuote}
            aria-label={t('定位上一级批注')} onClick={() => {
              actions.dispatchWindow({ type: 'raise', id: parentId });
              parentCard.current?.querySelector<HTMLElement>('.annotation-card-header')?.focus({ preventScroll: true });
            }}>{subAnnotationLabel(parentQuote, 18)}</button>
          <span aria-hidden="true">/</span>
          <strong className="sub-annotation-current" title={quote}>{subAnnotationLabel(quote)}</strong>
        </div>
        <div className="sub-annotation-card-header-actions">
          {child && <button type="button" className="annotation-icon-button" disabled={disabled}
            title={t('新增同位置批注')} aria-label={t('新增同位置批注')} onClick={addSibling}><Plus size={14} /></button>}
          {child && <button type="button" className="annotation-icon-button" title={t('删除子批注及其下级')} aria-label={t('删除子批注')}
            onClick={() => actions.deleteChild(annotation, child.id)}><Trash2 size={14} /></button>}
          <button type="button" className="annotation-icon-button" aria-label={t('关闭子批注')} title={t('关闭子批注')} onClick={close}><X size={16} /></button>
        </div>
      </header>
      <SubAnnotationConversation key={selection.id} annotation={annotation} selection={selection} child={child}
        quote={quote} disabled={disabled} onCancelDraft={close} onReferenceToChat={onReferenceToChat} />
    </section>
  </MovableAnnotationPopup>;
}

type Editor = { kind: 'reask'; question: string } | { kind: 'edit'; question: string; answer: string } | { kind: 'note'; note: string };

function SubAnnotationConversation({ annotation, selection, child, quote, disabled, onCancelDraft, onReferenceToChat }: {
  annotation: Annotation;
  selection: ChildAnnotationWindow;
  child?: SubAnnotation;
  quote: string;
  disabled?: boolean;
  onCancelDraft: () => void;
  onReferenceToChat?: (childId: string) => void;
}) {
  const actions = useContext(AnnotationActions)!;
  const saveKnowledge = useContext(KnowledgeCardActions);
  const [draftText, setDraftText] = useState(child?.answer ? '' : child?.question ?? '');
  const [draftMode, setDraftMode] = useState<'ask' | 'note'>('ask');
  const [editor, setEditor] = useState<Editor | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false), followTail = useRef(false), justSent = useRef(false);
  const subscribe = useCallback((listener: () => void) => actions.streams.subscribe(child?.id, listener), [actions.streams, child?.id]);
  const stream = useSyncExternalStore(subscribe, () => actions.streams.get(child?.id));
  const request = child?.request;
  const isNote = child?.note !== undefined;
  const saved = !!child && canReferenceSubAnnotation(child);
  const answered = saved && !isNote;
  const pending = Boolean(stream || request?.status === 'generating');
  const firstError = !stream && request && request.status !== 'generating' ? request : undefined;
  const writingNote = editor?.kind === 'note' || !!selection.draft && draftMode === 'note';
  const value = editor?.kind === 'note' ? editor.note : editor?.question ?? draftText;
  const scope = annotation.subAnnotations;
  const childWindows = actions.childWindows.get(selection.id);
  const openMarkers = useMemo(() => new Set(childWindows?.map(window => window.id)), [childWindows]);
  useAnnotationMathOverflow(scroll);

  const nested = useMemo(() => {
    const markers = new Map<number, SubAnnotationMarker[]>();
    if (!child) return markers;
    const completeTurns = new Set([0]);
    child.followUps?.forEach((turn, index) => { if (turn.answer) completeTurns.add(index + 1); });
    const last = [...completeTurns].at(-1)!;
    const drafts = childWindows?.flatMap(window => window.draft ? [{ ...window.draft, id: window.id }] : []) ?? [];
    for (const node of [...(groupSubAnnotations(scope ?? []).get(child.id) ?? []), ...drafts]) {
      const turn = node.turnIndex ?? 0;
      const matches = completeTurns.has(turn);
      const index = matches ? turn : last;
      const list = markers.get(index) ?? [];
      list.push(matches ? node : { ...node, blockIndex: undefined, missingSourceTurn: true });
      markers.set(index, list);
    }
    return markers;
  }, [child, scope, childWindows]);

  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !followTail.current) return;
    if (justSent.current) {
      justSent.current = false;
      element.scrollTo({ top: element.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    } else if (!element.matches(':hover') || element.scrollHeight - element.scrollTop - element.clientHeight < 44) {
      element.scrollTop = element.scrollHeight;
    }
  }, [stream?.answer, pending, child?.answer, child?.followUps]);

  useLayoutEffect(() => {
    if (selection.draft || editor || !saved && !pending && !firstError) input.current?.focus({ preventScroll: true });
  }, [selection.draft, Boolean(editor), saved, pending, Boolean(firstError), writingNote]);

  const scrollToBottom = () => {
    followTail.current = true;
    justSent.current = true;
  };

  const submit = () => {
    if (disabled || pending || composing.current || !value.trim()) return;
    if (writingNote) {
      const accepted = selection.draft
        ? actions.saveChildNote(annotation, selection.id, selection.draft, value)
        : actions.editChild(annotation, selection.id, { note: value });
      if (accepted) setEditor(null);
      return;
    }
    if (editor?.kind === 'edit') {
      if (editor.answer.trim() && actions.editChild(annotation, selection.id, { question: value, answer: editor.answer })) setEditor(null);
      return;
    }
    const accepted = answered && !editor
      ? actions.askChild(annotation, { childId: selection.id, question: value, followUp: true })
      : actions.askChild(annotation, { childId: selection.id, question: value, draft: selection.draft });
    if (accepted) {
      setDraftText(''); setEditor(null); scrollToBottom();
    }
  };
  const changeText = (text: string) => {
    if (editor?.kind === 'note') setEditor({ kind: 'note', note: text });
    else if (editor) setEditor({ ...editor, question: text });
    else setDraftText(text);
  };

  const drill = (anchor: SubAnnotationAnchor, turnIndex: number) => {
    if (!child) return;
    actions.dispatchWindow({ type: 'open-child', ownerId: annotation.id, parentId: child.id, id: crypto.randomUUID(),
      draft: { ...anchor, parentSubId: child.id, turnIndex } });
  };
  const renderBody = (answer: string, turnIndex: number, plainText = false) => <AnnotationAnswerBody answer={answer} color={annotation.color} plainText={plainText}
    markers={nested.get(turnIndex)} openMarkers={openMarkers} emphasizedMarker={actions.hoveredChild?.id}
    onOpenMarker={id => actions.dispatchWindow({ type: 'open-child', ownerId: annotation.id, parentId: selection.id, id })}
    onSelect={answer.trim() && !disabled ? anchor => drill(anchor, turnIndex) : undefined} />;
  const retryFirst = () => {
    if (firstError && actions.askChild(annotation, { childId: selection.id, question: firstError.question })) scrollToBottom();
  };
  const showComposer = !!editor || !isNote && (answered || !pending && !firstError);
  const prompt = writingNote ? '写下你的批注…' : answered && !editor ? '继续追问…' : '这一步哪里还没看懂？';
  const inputLabel = writingNote ? '普通批注正文' : answered && !editor ? '继续追问…' : '子批注问题';
  const submitLabel = editor?.kind === 'edit' || editor?.kind === 'note' ? '保存修改' : writingNote ? '保存批注' : '发送';

  return <>
    <div ref={scroll} className="sub-annotation-scroll"
      onScroll={event => { const body = event.currentTarget; followTail.current = body.scrollHeight - body.scrollTop - body.clientHeight < 44; }}>
      <blockquote className="sub-annotation-excerpt" aria-label={t('子批注选段')}><MathMarkdown>{quote}</MathMarkdown></blockquote>
      {child && <BranchSource annotation={annotation} child={child}/>}
      {selection.draft && <div className="annotation-mode-switch sub-annotation-mode" role="group" aria-label={t('批注类型')}>
        <button type="button" aria-pressed={draftMode === 'ask'} onClick={() => setDraftMode('ask')}>{t('询问 AI')}</button>
        <button type="button" aria-pressed={draftMode === 'note'} onClick={() => setDraftMode('note')}>{t('只写批注')}</button>
      </div>}
      {child?.note !== undefined && <div className="sub-annotation-turn">{renderBody(child.note, 0, true)}</div>}
      {child?.answer && <div className="sub-annotation-turn">
        <p className="sub-annotation-question">{child.question}</p>
        <AnswerCitations annotation={annotation} report={child.contextReport}>{renderBody(child.answer, 0)}</AnswerCitations><ReaderSources annotation={annotation} report={child.contextReport}/>
      </div>}
      {child?.followUps?.map((turn, index) => <div className="sub-annotation-turn" key={turn.id} data-follow-up-id={turn.id}>
        <p className="sub-annotation-question">{turn.question}</p>
        {turn.answer ? <><AnswerCitations annotation={annotation} report={turn.contextReport}>{renderBody(turn.answer, index + 1)}</AnswerCitations><ReaderSources annotation={annotation} report={turn.contextReport}/></>
          : stream?.target.followUpId === turn.id ? <StreamingAnswer answer={stream.answer} />
          : <div className="sub-annotation-retry"><span>{t('这次回答未完成。')}</span>
            <button type="button" className="annotation-text-button" disabled={disabled || pending}
              onClick={() => {
                if (actions.askChild(annotation, { childId: selection.id, question: turn.question, followUp: true, retryId: turn.id })) scrollToBottom();
              }}><RotateCcw size={12} />{t('重试原问题')}</button></div>}
      </div>)}
      {pending && !stream?.target.followUpId && request && <div className="sub-annotation-turn">
        <p className="sub-annotation-question">{request.question}</p>
        <StreamingAnswer answer={stream?.answer ?? ''} />
      </div>}
      {firstError && !editor && <div className="sub-annotation-retry">
        <p>{firstError.question}</p><span>{t(firstError.error || '这次回答未完成。')}</span>
        <button type="button" className="annotation-text-button" disabled={disabled} onClick={retryFirst}><RotateCcw size={12} />{t('重试原问题')}</button>
        <button type="button" className="annotation-text-button" onClick={() => setEditor({ kind: 'reask', question: firstError.question })}><Pencil size={12} />{t('修改问题')}</button>
      </div>}
    </div>
    <footer className="sub-annotation-card-footer">
      {showComposer && <form className="sub-annotation-composer" data-writing-note={writingNote || undefined} onSubmit={event => { event.preventDefault(); submit(); }}>
        <textarea ref={input} rows={writingNote ? 3 : 1} value={value} aria-label={t(inputLabel)}
          placeholder={t(prompt)} onChange={event => changeText(event.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => {
            if (writingNote || editor?.kind === 'edit' || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
              || event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
            event.preventDefault(); submit();
          }} />
        {editor?.kind === 'edit' && <textarea rows={3} value={editor.answer} aria-label={t('回答')}
          onChange={event => setEditor({ ...editor, answer: event.target.value })} />}
        <div className="sub-annotation-composer-actions">
          {(selection.draft || editor) && <button type="button" className="annotation-text-button"
            onClick={() => editor ? setEditor(null) : onCancelDraft()}>{t('取消')}</button>}
          <button type="submit" className="annotation-icon-button sub-annotation-send" {...confirmShortcut} disabled={disabled || pending || !value.trim() || editor?.kind === 'edit' && !editor.answer.trim()}
            aria-label={t(submitLabel)} title={t(submitLabel)}>
            {submitLabel === '发送' ? <Send size={15} /> : t(submitLabel)}
          </button>
        </div>
      </form>}
      {pending && child && <div className="sub-annotation-actions">
        <button type="button" className="annotation-text-button" onClick={() => actions.streams.stop(child.id)}><Square size={12} />{t('停止回答')}</button>
      </div>}
      {child && saved && !pending && !editor && <div className="sub-annotation-actions">
        {answered && <button type="button" className="annotation-icon-button" disabled={disabled} title={t('重新提问')} aria-label={t('重新提问')}
          onClick={() => setEditor({ kind: 'reask', question: child.question })}><RotateCcw size={13} /></button>}
        <button type="button" className="annotation-icon-button" disabled={disabled} title={t('编辑')} aria-label={t('编辑')}
          onClick={() => setEditor(child.note === undefined ? { kind: 'edit', question: child.question, answer: child.answer } : { kind: 'note', note: child.note })}><Pencil size={13} /></button>
        {onReferenceToChat && <button type="button" className="annotation-text-button" disabled={disabled}
          onClick={() => onReferenceToChat(child.id)}><MessageSquareQuote size={13} />{t('引用到聊天')}</button>}
        {saveKnowledge && <button type="button" className="annotation-text-button"
          onClick={() => saveKnowledge(annotation, child.id)}><BookmarkPlus size={13} />{t('存入知识库')}</button>}
      </div>}
    </footer>
  </>;
}

function StreamingAnswer({ answer }: { answer: string }) {
  return answer ? <MathMarkdown streaming>{answer}</MathMarkdown>
    : <div className="sub-annotation-waiting" role="status"><LoaderCircle size={13} className="annotation-spin" />{t('正在回答')}</div>;
}
