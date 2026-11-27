import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import { loadSplitRatio, saveSplitRatio } from '../adapters/split-preferences';
import type { LocalDocumentReference } from '../domain/local-library';
import { clampSplitRatio, DEFAULT_SPLIT_RATIO, SPLIT_DIVIDER_WIDTH, splitRatioBounds } from '../domain/split-layout';
import type { PreviewTabs } from '../domain/workspace-view';
import { t } from '../i18n/locale';
import './workspace-split.css';

interface DividerDrag { pointerId: number; startX: number; ratio: number; width: number; direction: number }

export function WorkspaceSplit({ split, hidden, children, reader }: { split: boolean; hidden: boolean; children: ReactNode; reader: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<DividerDrag | null>(null);
  const [width, setWidth] = useState(0);
  const [preferred, setPreferred] = useState(loadSplitRatio);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const dragging = dragRatio !== null;
  const ratio = clampSplitRatio(dragRatio ?? preferred, width);
  const bounds = splitRatioBounds(width);

  useLayoutEffect(() => {
    const element = container.current;
    if (!split || !element) { drag.current = null; setDragRatio(null); return; }
    const measure = () => setWidth(Math.max(0, element.clientWidth - SPLIT_DIVIDER_WIDTH));
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => resize.disconnect();
  }, [split]);
  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      const active = drag.current;
      if (!active) return;
      const divider = container.current?.querySelector('.workspace-split-divider');
      drag.current = null;
      setDragRatio(null);
      if (divider?.hasPointerCapture(active.pointerId)) divider.releasePointerCapture(active.pointerId);
    };
    window.addEventListener('blur', end);
    return () => window.removeEventListener('blur', end);
  }, [dragging]);

  function remember(value: number) {
    setPreferred(value);
    saveSplitRatio(value);
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || !width || drag.current) return;
    event.preventDefault();
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, ratio, width, direction };
    setDragRatio(ratio);
  }
  function pointerRatio(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return undefined;
    return clampSplitRatio(active.ratio + (event.clientX - active.startX) * active.direction / active.width, width);
  }
  function finishDrag(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const value = commit && event.clientX !== drag.current.startX ? pointerRatio(event) : undefined;
    drag.current = null;
    setDragRatio(null);
    if (value !== undefined) remember(value);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function resizeByKey(event: KeyboardEvent<HTMLDivElement>) {
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
    const values: Record<string, number> = { ArrowLeft: ratio - direction * .05, ArrowRight: ratio + direction * .05, Home: bounds.min, End: bounds.max, Enter: DEFAULT_SPLIT_RATIO };
    const next = values[event.key];
    if (typeof next !== 'number') return;
    event.preventDefault();
    remember(clampSplitRatio(next, width));
  }

  return <div ref={container} hidden={hidden} className={'workspace-content' + (split ? ' with-reader' : '')} style={{ '--split-ratio': ratio, '--split-divider-width': SPLIT_DIVIDER_WIDTH + 'px' } as CSSProperties} data-resizing={dragging || undefined}>
    {children}
    {split && <div className="workspace-split-divider" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('调整分栏宽度')} title={t('拖动调整分栏，双击复位')} aria-valuemin={Math.round(bounds.min * 100)} aria-valuemax={Math.round(bounds.max * 100)} aria-valuenow={Math.round(ratio * 100)}
      onPointerDown={startDrag} onPointerMove={event => { const next = pointerRatio(event); if (next !== undefined) setDragRatio(next); }}
      onPointerUp={event => finishDrag(event, true)} onPointerCancel={event => finishDrag(event, false)} onLostPointerCapture={event => finishDrag(event, false)}
      onDoubleClick={() => remember(DEFAULT_SPLIT_RATIO)} onKeyDown={resizeByKey} />}
    {reader}
  </div>;
}

interface TabProps {
  preview: PreviewTabs; documents: readonly LocalDocumentReference[]; disabled: boolean;
  onOpen: (reference: LocalDocumentReference) => void; onClose: (documentId: string) => void;
}

export const SPLIT_READER_PANEL_ID = 'split-reader-panel';

export function SplitDocumentTabs({ preview, documents, disabled, onOpen, onClose }: TabProps) {
  const activeId = preview.active.documentId;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const strip = useRef<HTMLDivElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const byId = new Map(documents.map(ref => [ref.document.id, ref]));
  const tabs = preview.tabs.flatMap(tab => {
    const ref = byId.get(tab.documentId);
    return ref ? [ref] : [];
  });
  const opened = new Set(preview.tabs.map(tab => tab.documentId));
  const remaining = documents.filter(ref => !opened.has(ref.document.id));
  const showPicker = pickerOpen && !disabled && remaining.length > 0;

  useLayoutEffect(() => {
    const viewport = strip.current;
    const active = buttons.current.get(activeId)?.parentElement;
    if (!viewport || !active) return;
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const resize = new ResizeObserver(() => {
      const tab = active.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      if (tab.left < bounds.left || tab.right > bounds.right) active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    });
    resize.observe(viewport);
    return () => resize.disconnect();
  }, [activeId]);
  useEffect(() => {
    if (!showPicker) return;
    panel.current?.querySelector('button')?.focus({ preventScroll: true });
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !add.current?.contains(event.target)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss); };
  }, [showPicker]);

  function focusTab(id: string) {
    requestAnimationFrame(() => buttons.current.get(id)?.focus({ preventScroll: true }));
  }
  function closeTab(index: number) {
    const id = tabs[index].document.id;
    const neighbor = id === activeId ? tabs[index + 1] ?? tabs[index - 1] : byId.get(activeId);
    onClose(id);
    if (neighbor) focusTab(neighbor.document.id);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Delete') { event.preventDefault(); closeTab(index); return; }
    const forward = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
    const indexes: Record<string, number> = {
      Home: 0, End: tabs.length - 1,
      ArrowLeft: (index - forward + tabs.length) % tabs.length,
      ArrowRight: (index + forward + tabs.length) % tabs.length,
    };
    const next = tabs[indexes[event.key]];
    if (!next) return;
    event.preventDefault();
    onOpen(next);
    focusTab(next.document.id);
  }

  return <div className="split-document-tabs" onKeyDown={event => {
    if (!showPicker || event.key !== 'Escape') return;
    event.stopPropagation(); setPickerOpen(false); add.current?.focus({ preventScroll: true });
  }}>
    <div ref={strip} className="split-tab-strip" role="tablist" aria-label={t('文档标签页')}>
      {tabs.map((ref, index) => {
        const { id, name } = ref.document;
        const active = id === activeId;
        return <div className="split-tab" role="presentation" key={id} data-active={active}>
          <button ref={node => { if (node) buttons.current.set(id, node); else buttons.current.delete(id); }} type="button" className="split-tab-name" role="tab" aria-selected={active} aria-controls={SPLIT_READER_PANEL_ID} tabIndex={active ? 0 : -1} title={name} disabled={disabled} onClick={() => onOpen(ref)} onKeyDown={event => navigate(event, index)}><span>{name}</span></button>
          <button type="button" className="split-tab-close" aria-label={t('关闭标签页 {0}', [name])} title={t('关闭标签页 {0}', [name])} tabIndex={active ? 0 : -1} disabled={disabled} onClick={() => closeTab(index)}><X size={13} /></button>
        </div>;
      })}
    </div>
    <button ref={add} type="button" className="split-tab-add document-icon-button" aria-label={t('添加文档标签页')} title={t(remaining.length ? '添加文档标签页' : '项目文档已全部打开')} aria-expanded={showPicker} aria-controls={panelId} disabled={disabled || !remaining.length} onClick={() => setPickerOpen(open => !open)}><Plus size={17} /></button>
    {showPicker && <div className="split-tab-picker" id={panelId} ref={panel} role="group" aria-label={t('添加文档标签页')}>
      {remaining.map(ref => <button key={ref.document.id} type="button" title={ref.document.name} onClick={() => { setPickerOpen(false); onOpen(ref); focusTab(ref.document.id); }}><FileText size={15} /><span>{ref.document.name}</span></button>)}
    </div>}
  </div>;
}
