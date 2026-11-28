import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDownToLine, BookOpen, ChevronDown, GripHorizontal, Layers, PanelTop, Search } from 'lucide-react';
import { MathMarkdown } from '../components/MathMarkdown';
import { textPreview } from '../domain/text-preview';
import { confirmationScope } from '../hooks/confirmation-shortcut';
import { t } from '../i18n/locale';
import { WIKI_REFERENCE_DRAG } from './wiki-editor';
import { clampReferenceFrame, loadReferencePreferences, referenceFraction, referenceFrame, REFERENCE_BATCH, saveReferencePreferences, type ReferenceFilter, type ReferenceFrame } from './reference-preferences';
import { referenceKinds, type ReferenceItem } from './wiki-types';

const labels: Record<ReferenceFilter, string> = {
  all: '全部', pdf_excerpt: '原文', annotation: '批注', ai_inquiry: 'AI', web_summary: '网页',
};

const viewportSize = () => ({ width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) });
type PointerGesture = { id: number; kind: 'move' | 'resize'; x: number; y: number; frame: ReferenceFrame };

export function FloatingReferencePanel({ items, pageId, title, citedSources, onInsert, pinnedId, onBrowse, aiSources, toggleAI }: {
  onBrowse:()=>void; aiSources?:readonly string[]; toggleAI:(id:string)=>void;
  pinnedId?: string; items: readonly ReferenceItem[]; pageId?: string; title: string; citedSources: ReadonlySet<string>; onInsert: (item: ReferenceItem) => void;
}) {
  const [preferences, setPreferences] = useState(loadReferencePreferences);
  const current = useRef(preferences);
  const update = (next: Partial<typeof preferences>, persist = false) => {
    current.current = { ...current.current, ...next };
    setPreferences(current.current);
    if (persist) saveReferencePreferences(current.current);
  };
  const [viewport, setViewport] = useState(viewportSize);
  const [focused, setFocused] = useState(true);
  const [peek, setPeek] = useState(false);
  const dim = preferences.mode === 'translucent' && !focused;
  const [dragFrame, setDragFrame] = useState<ReferenceFrame>();
  const root = useRef<HTMLElement>(null), list = useRef<HTMLDivElement>(null);
  const drag = useRef<PointerGesture | null>(null);
  const frame = dragFrame ?? referenceFrame(preferences.frame, viewport);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const query = useDeferredValue(preferences.query).trim().toLowerCase();
  const titleNeedle = title.trim().toLowerCase();
  const matches = useMemo(() => {
    const score = (item: ReferenceItem) => {
      if (item.id === pinnedId) return 4;
      if (pageId && item.linkedPageIds.includes(pageId)) return 3;
      if (citedSources.has(item.sourceId)) return 2;
      return titleNeedle.length >= 2 && item.title.toLowerCase().includes(titleNeedle) ? 1 : 0;
    };
    return items.flatMap(item => item.id === pinnedId || (
      (preferences.filter === 'all' || item.kind === preferences.filter) &&
      (!query || item.title.toLowerCase().includes(query) || item.sourceTitle.toLowerCase().includes(query) || item.content.toLowerCase().includes(query))
    ) ? [{ item, score: score(item) }] : []).sort((a, b) => b.score - a.score);
  }, [items, preferences.filter, query, pageId, titleNeedle, citedSources, pinnedId]);

  useLayoutEffect(() => {
    const body = list.current;
    if (body) body.scrollTop = pinnedId ? 0 : current.current.scroll;
    return () => {
      if (body) current.current = { ...current.current, scroll: body.scrollTop };
      saveReferencePreferences(current.current);
    };
  }, []);
  useEffect(() => {
    const resize = () => setViewport(viewportSize());
    const hit = (event: PointerEvent) => {
      if (event.target instanceof Node) setFocused(Boolean(root.current?.contains(event.target)));
    };
    const move = (event: PointerEvent) => {
      const gesture = drag.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      const start = gesture.frame, size = viewportSize();
      const next = gesture.kind === 'move'
        ? { ...start, left: start.left + dx, top: start.top + dy }
        : { ...start, width: Math.min(start.width + dx, size.width - start.left - 8),
          height: Math.min(start.height + dy, size.height - start.top - 8) };
      const placed = clampReferenceFrame(next, size);
      frameRef.current = placed;
      setDragFrame(placed);
    };
    const finish = (event: PointerEvent) => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      const size = viewportSize();
      update({ frame: referenceFraction(clampReferenceFrame(frameRef.current, size), size) }, true);
      setDragFrame(undefined);
    };
    window.addEventListener('resize', resize);
    document.addEventListener('pointerdown', hit, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('lostpointercapture', finish, true);
    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('pointerdown', hit, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('lostpointercapture', finish, true);
    };
  }, []);
  useEffect(() => {
    if (!dim) { setPeek(false); return; }
    const show = (event: KeyboardEvent) => {
      if (event.key === 'Alt' && !event.ctrlKey && !event.metaKey && !event.isComposing) {
        event.preventDefault();
        setPeek(true);
      }
    };
    const hide = (event: KeyboardEvent) => { if (event.key === 'Alt' || !event.altKey) setPeek(false); };
    const blur = () => setPeek(false);
    window.addEventListener('keydown', show, true);
    window.addEventListener('keyup', hide, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', show, true);
      window.removeEventListener('keyup', hide, true);
      window.removeEventListener('blur', blur);
    };
  }, [dim]);

  const start = (kind: PointerGesture['kind'], event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || drag.current) return;
    if (kind === 'move' && event.target instanceof Element && event.target.closest('button')) return;
    event.preventDefault();
    setFocused(true);
    drag.current = { kind, id: event.pointerId, x: event.clientX, y: event.clientY, frame };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners handle gestures within the viewport. */ }
  };
  const changeFilter = (next: Partial<typeof preferences>) => {
    if (list.current) list.current.scrollTop = 0;
    update({ ...next, scroll: 0, limit: REFERENCE_BATCH, expanded: undefined }, true);
  };
  return <aside ref={root} className="wiki-reference-panel" aria-label={t('参考资料')} style={frame} {...confirmationScope}
    data-mode={preferences.mode} data-dimmed={dim || undefined} data-peek={dim && peek || undefined} data-moving={dragFrame ? true : undefined}>
    <header className="wiki-reference-header" onPointerDown={event => start('move', event)}>
      <GripHorizontal size={14} aria-hidden="true" /><strong>{t('参考资料')}</strong>
      <button type="button" className="wiki-reference-mode" aria-pressed={preferences.mode === 'solid'}
        onMouseDown={event => event.preventDefault()} onClick={() => {
          setFocused(true);
          update({ mode: preferences.mode === 'solid' ? 'translucent' : 'solid' }, true);
        }} title={t(preferences.mode === 'solid' ? '切换到失焦淡出' : '切换到固定显示')}>
        {preferences.mode === 'solid' ? <PanelTop size={13} /> : <Layers size={13} />}
        <span>{t(preferences.mode === 'solid' ? '固定显示' : '失焦淡出')}</span>
      </button>
    </header>
    <div className="wiki-reference-content" inert={dim}>
      <div className="wiki-reference-controls">
        <div className="wiki-reference-filters" role="group" aria-label={t('资料类型')}>
          {(['all', ...referenceKinds] as const).map(kind => <button key={kind} type="button" aria-pressed={kind === preferences.filter}
            onClick={() => {onBrowse();changeFilter({ filter: kind });}}>{t(labels[kind])}</button>)}
        </div>
        <label className="wiki-reference-search"><Search size={14} aria-hidden="true" />
          <input type="search" aria-label={t('搜索参考资料')} placeholder={t('搜索参考资料')} maxLength={200} value={preferences.query}
            onFocus={onBrowse} onChange={event => {onBrowse();changeFilter({ query: event.target.value });}} />
        </label>
      </div>
      <div className="wiki-reference-list" ref={list} onScroll={event => { current.current = { ...current.current, scroll: event.currentTarget.scrollTop }; }}>
        {!matches.length && <p className="wiki-muted">{t('没有匹配的参考资料。')}</p>}
        {matches.slice(0, preferences.limit).map(({ item }) => {
          const expanded = preferences.expanded === item.id;
          const location = [item.sourceTitle === item.title ? '' : item.sourceTitle, item.locator?.page ? t('第 {0} 页', [item.locator.page]) : ''].filter(Boolean).join(' · ');
          return <article key={item.id} className="wiki-reference-card" data-current={item.id === pinnedId || undefined} draggable onDragStart={event => {
            event.dataTransfer.setData(WIKI_REFERENCE_DRAG, item.id);
            event.dataTransfer.effectAllowed = 'copy';
          }}>
            <button type="button" aria-expanded={expanded} className="wiki-reference-expand"
              onClick={() => update({ expanded: expanded ? undefined : item.id })}>
              <span><strong>{item.title}</strong>{location && <small>{location}</small>}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {expanded && (item.kind === 'ai_inquiry' || item.kind === 'annotation'
              ? <div className="wiki-reference-detail"><MathMarkdown referencePreview>{item.content}</MathMarkdown></div>
              : <p className="wiki-reference-detail wiki-reference-plain">{item.content}</p>)}
            {!expanded && <p className="wiki-reference-excerpt">{textPreview(item.content, 360)}</p>}
            {aiSources && <label className="wiki-ai-source"><input type="checkbox" checked={aiSources.includes(item.id)} onChange={()=>toggleAI(item.id)}/>{t('用于本次 AI 编辑')}</label>}
            <button type="button" className="wiki-reference-insert" onMouseDown={event => event.preventDefault()} onClick={() => onInsert(item)}>
              <ArrowDownToLine size={13} />{t('插入引用')}
            </button>
          </article>;
        })}
        {matches.length > preferences.limit && <button type="button" className="wiki-action" onClick={() => update({ limit: preferences.limit + REFERENCE_BATCH })}>{t('显示更多')}</button>}
      </div>
    </div>
    <button type="button" aria-label={t('调整参考框尺寸')} title={t('调整参考框尺寸')} className="wiki-reference-resize" tabIndex={-1}
      disabled={dim} onPointerDown={event => start('resize', event)} />
  </aside>;
}
