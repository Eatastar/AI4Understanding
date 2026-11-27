import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { ChevronDown, Check, Folder, FolderInput, Layers3, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Conversation } from '../domain/types';
import { isAnnotationGenerating } from '../domain/annotation-state';
import { projectDocuments, projectMaterialCount } from '../domain/projects';
import type { WorkspacePane } from '../domain/workspace-view';
import { t } from '../i18n/locale';
import { NativeSelect } from './NativeSelect';
import { KnowledgeDialog } from './KnowledgeBase';
import './projects.css';

export function ProjectConversationList({ records, pane, expanded, disabled, busyId, onOpen, onToggle, onOverview, onNewChat, onRename, onMove, onDelete, onDeleteProject }: {
  records: Conversation[]; pane: WorkspacePane; expanded: ReadonlySet<string>; disabled: boolean; busyId: string | null;
  onOpen: (id: string) => void; onToggle: (id: string) => void; onOverview: (id: string) => void; onNewChat: (id: string) => void;
  onRename: (id: string, title: string) => void; onMove: (id: string) => void; onDelete: (id: string) => void;
  onDeleteProject: (id: string) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const live = records.filter(c => c.deletedAt === undefined).sort((a, b) => b.updatedAt - a.updatedAt);
  const active = pane.kind === 'chat' ? live.find(c => c.id === pane.conversationId) : undefined;
  const selectedProjectId = pane.kind === 'overview' ? pane.projectId : active?.projectId;
  const threads = new Map<string, Conversation[]>();
  for (const chat of live) if (chat.projectId) {
    const siblings = threads.get(chat.projectId) || [];
    siblings.push(chat);
    threads.set(chat.projectId, siblings);
  }
  const hasRunningAnswer = (item: Conversation) => busyId === item.id || item.annotations.some(isAnnotationGenerating)
    || item.messages.at(-1)?.versions.some(version => version.status === 'streaming') === true;
  function menuEvents(id: string, locked: boolean) {
    return {
      onBlur: (event: FocusEvent<HTMLDivElement>) => {
        if (menu === id && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setMenu(null);
      },
      onContextMenu: (event: MouseEvent<HTMLDivElement>) => {
        if (locked || editing?.id === id) return;
        event.preventDefault();
        setMenu(id);
        event.currentTarget.querySelector<HTMLButtonElement>('.project-chat-menu-trigger')?.focus();
      },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape') return;
        if (editing?.id === id) { event.stopPropagation(); setEditing(null); }
        else if (menu === id) {
          event.stopPropagation();
          setMenu(null);
          event.currentTarget.querySelector<HTMLButtonElement>('.project-chat-menu-trigger')?.focus();
        }
      },
    };
  }
  const row = (c: Conversation) => {
    const notes = c.annotations.filter(annotation => annotation.deletedAt === undefined).length;
    const locked = disabled || hasRunningAnswer(c);
    const chosen = c.id === active?.id;
    const expanded = menu === c.id;
    return <div key={c.id} className={'project-chat-row' + (chosen ? ' active' : '')} {...menuEvents(c.id, locked)}>
      {editing?.id === c.id ? <form className="project-chat-rename" onSubmit={event => {
        event.preventDefault();
        if (!locked && editing.title.trim()) { onRename(c.id, editing.title.trim()); setEditing(null); }
      }}>
        <input autoFocus aria-label={t('对话名称')} maxLength={80} value={editing.title} onChange={event => setEditing({ id: c.id, title: event.currentTarget.value })} />
        <button type="submit" className="icon-button" {...confirmShortcut} aria-label={t('保存')} disabled={locked || !editing.title.trim()}><Check size={14} /></button>
        <button type="button" className="icon-button" aria-label={t('取消')} onClick={() => setEditing(null)}><X size={14} /></button>
      </form> : <>
        <button type="button" className="conversation-item" title={c.title} disabled={disabled} onClick={() => { setMenu(null); onOpen(c.id); }} aria-current={chosen ? 'page' : undefined}>
          <MessageSquare size={15} /><span>{c.title}</span>{notes > 0 && <small>{notes}</small>}
        </button>
        <button type="button" className="icon-button project-chat-menu-trigger" aria-label={t('管理对话：{0}', [c.title])} aria-expanded={expanded}
          disabled={locked} onClick={() => setMenu(expanded ? null : c.id)}><MoreHorizontal size={17} /></button>
      </>}
      {expanded && <div className="project-chat-actions" role="group" aria-label={t('管理对话：{0}', [c.title])}>
        <button type="button" disabled={locked} onClick={() => { setMenu(null); setEditing({ id: c.id, title: c.title }); }}><Pencil size={14} />{t('重命名对话')}</button>
        {!c.projectId && <button type="button" disabled={locked} onClick={() => { setMenu(null); onMove(c.id); }}><FolderInput size={14} />{t('移入项目')}</button>}
        <button type="button" disabled={locked} onClick={() => { setMenu(null); onDelete(c.id); }}><Trash2 size={14} />{t('移到回收站')}</button>
      </div>}
    </div>;
  };
  const standalone = live.filter(c => !c.isProject && !c.projectId);
  return <nav className="conversation-list project-list" aria-label={t('项目')}>
    {live.filter(c => c.isProject).map(project => {
      const open = expanded.has(project.id), children = threads.get(project.id) || [];
      const overview = pane.kind === 'overview' && pane.projectId === project.id;
      const menuOpen = menu === project.id;
      const locked = disabled || hasRunningAnswer(project) || children.some(hasRunningAnswer);
      const actionsLabel = t('管理项目「{0}」', [project.title]);
      return <section className="project-list-group" key={project.id}>
        <div className="project-chat-row project-heading-row" {...menuEvents(project.id, locked)}>
          <button type="button" className="conversation-item project-list-heading" data-current-project={selectedProjectId === project.id || undefined}
            title={project.title} aria-expanded={open} disabled={disabled} onClick={() => { setMenu(null); onToggle(project.id); }}>
            <ChevronDown size={13} className="project-chevron" /><Folder size={16} /><span>{project.title}</span>
          </button>
          <button type="button" className="icon-button project-chat-menu-trigger" aria-label={actionsLabel} title={actionsLabel}
            aria-expanded={menuOpen} disabled={locked} onClick={() => setMenu(menuOpen ? null : project.id)}><MoreHorizontal size={17} /></button>
          {menuOpen && <div className="project-chat-actions" role="group" aria-label={actionsLabel}>
            <button type="button" disabled={locked} onClick={() => { setMenu(null); onDeleteProject(project.id); }}><Trash2 size={14} />{t('移到回收站')}</button>
          </div>}
        </div>
        {open && <div className="project-list-children">
          <button type="button" className={'conversation-item project-overview-link' + (overview ? ' active' : '')}
            aria-current={overview ? 'page' : undefined} disabled={disabled} onClick={() => { setMenu(null); onOverview(project.id); }}>
            <Layers3 size={15} /><span>{t('资料与概览')}</span><small>{projectMaterialCount(project, projectDocuments(project, children))}</small>
          </button>
          {children.map(row)}
          <button type="button" className="conversation-item project-new-chat" disabled={disabled} onClick={() => { setMenu(null); onNewChat(project.id); }}>
            <Plus size={15} /><span>{t('新建对话')}</span>
          </button>
        </div>}
      </section>;
    })}
    {standalone.length > 0 && <section className="project-standalone">
      <h3>{t('独立对话')}</h3>{standalone.map(row)}
    </section>}
  </nav>;
}

export function ProjectOrganizer({ records, busy, busyProject, onClose, onTrash }: {
  records: Conversation[]; busy: boolean; busyProject?: string;
  onClose: () => void; onTrash: (ids: readonly string[]) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');
  const live = records.filter(record => record.deletedAt === undefined);
  const projects = live.filter(record => record.isProject).sort((a, b) => b.updatedAt - a.updatedAt);
  const locked = new Set(live.filter(record => record.annotations.some(isAnnotationGenerating)
    || record.messages.some(message => message.versions.some(version => version.status === 'streaming'))).map(record => record.projectId ?? record.id));
  if (busyProject) locked.add(busyProject);
  const eligible = projects.filter(project => !locked.has(project.id));
  const picked = projects.filter(project => selected.has(project.id));
  const allSelected = eligible.length > 0 && eligible.every(project => selected.has(project.id));

  function toggle(id: string, checked: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setError('');
  }

  function moveSelection() {
    try { onTrash(picked.map(project => project.id)); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请重试。'); }
  }

  return <KnowledgeDialog title={t('整理项目')} onClose={onClose} actions={<>
    <button type="button" className="secondary-button" onClick={onClose}>{t('取消')}</button>
    <button type="button" className="primary-button" {...confirmShortcut} disabled={busy || !picked.length || picked.some(project => locked.has(project.id))}
      onClick={moveSelection}><Trash2 size={15} />{t('移到回收站')}{picked.length > 0 && ` (${picked.length})`}</button>
  </>}>
    <div className="knowledge-dialog-body project-organizer">
      <div className="project-organizer-toolbar">
        <label><input type="checkbox" checked={allSelected} disabled={busy || !eligible.length} data-knowledge-focus
          ref={input => { if (input) input.indeterminate = !allSelected && eligible.some(project => selected.has(project.id)); }}
          onChange={event => { setSelected(event.currentTarget.checked ? new Set(eligible.map(project => project.id)) : new Set()); setError(''); }} />
          {t('全选可移动的项目')}
        </label>
        <span role="status">{t('已选 {0} 个项目', [picked.length])}</span>
      </div>
      <ul className="project-organizer-list">
        {projects.map(project => <li key={project.id}>
          <label title={project.title}>
            <input type="checkbox" checked={selected.has(project.id)} disabled={busy || (locked.has(project.id) && !selected.has(project.id))}
              onChange={event => toggle(project.id, event.currentTarget.checked)} />
            <Folder size={15} aria-hidden="true" /><span>{project.title}</span>
            {locked.has(project.id) && <small>{t('项目正在处理')}</small>}
          </label>
        </li>)}
      </ul>
      {error && <p className="recovery-message" role="alert">{t(error)}</p>}
    </div>
  </KnowledgeDialog>;
}

export function ProjectDialog({ projects, conversation, onApply, onClose }: {
  projects: Conversation[]; conversation?: Conversation; onApply: (projectId: string | undefined, name: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(conversation ? projects[0]?.id || '' : '');
  const [name, setName] = useState(conversation?.documents?.[0]?.name.slice(0, 80) || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function apply() {
    setBusy(true); setError('');
    try { await onApply(selected || undefined, name); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请重试。'); setBusy(false); }
  }
  return <dialog ref={dialog} className="settings-dialog project-dialog" aria-labelledby="project-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy && (selected || name.trim())) void apply(); }}>
      <header className="dialog-header"><h2 id="project-title">{t(conversation ? '移入项目' : '新建项目')}</h2><button type="button" className="icon-button" aria-label={t('关闭')} disabled={busy} onClick={onClose}><X size={18} /></button></header>
      {conversation && <label className="project-field">{t('选择项目')}<NativeSelect value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
        <option value="">{t('新建项目')}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
      </NativeSelect></label>}
      {!selected && <label className="project-field">{t('项目名称')}<input value={name} maxLength={80} autoFocus disabled={busy} onChange={event => setName(event.target.value)} /></label>}
      {error && <p className="recovery-message" role="alert">{t(error)}</p>}
      <footer className="project-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t('取消')}</button><button type="submit" className="primary-button" {...confirmShortcut} disabled={busy || (!selected && !name.trim())}>{t(busy ? '正在保存…' : conversation ? '移入项目' : '新建项目')}</button></footer>
    </form>
  </dialog>;
}
