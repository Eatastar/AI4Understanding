import { createContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import type { ReactNode } from 'react';
import { ArrowUpRight, Pencil, Trash2, X } from 'lucide-react';
import type { Annotation } from '../domain/types';
import { searchKnowledgeCards, type KnowledgeCard, type KnowledgeDraft, type KnowledgeSource } from '../domain/knowledge';
import { textPreview as knowledgePreview } from '../domain/text-preview';
import { getLocale, t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import { MathMarkdown } from './MathMarkdown';
import { NativeSelect } from './NativeSelect';
import './knowledge-base.css';

export const KnowledgeCardActions = createContext<((annotation: Annotation, childId?: string) => void) | null>(null);

export function knowledgeSourceLabel(source: KnowledgeSource) {
  return source.page === undefined ? source.docTitle : t('{0} · 第 {1} 页', [source.docTitle, source.page]);
}

export { knowledgePreview };

export function KnowledgeDialog({ title, busy, children, actions, onClose }: {
  title: string; busy?: boolean; children: ReactNode; actions?: ReactNode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLElement>('[data-knowledge-focus]')?.focus();
    return () => { element?.close(); };
  }, []);
  return <dialog ref={dialog} className="settings-dialog knowledge-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="dialog-header"><h2 id={heading}>{title}</h2><button type="button" className="icon-button" aria-label={t('关闭')} disabled={busy} onClick={onClose}><X size={19} /></button></header>
    {children}
    {actions && <footer className="knowledge-dialog-actions">{actions}</footer>}
  </dialog>;
}

export function KnowledgeBase({ cards, loading, loadError, recovered, onReload, onClose, onEdit, onRemove, onOpenSource }: {
  cards: KnowledgeCard[]; loading: boolean; loadError: boolean; recovered: boolean;
  onReload: () => void; onClose: () => void; onEdit: (card: KnowledgeCard) => void;
  onRemove: (id: string) => Promise<void>; onOpenSource: (source: KnowledgeSource) => Promise<boolean>;
}) {
  useLocale();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [limit, setLimit] = useState(40);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const tags = useMemo(() => [...new Set(cards.flatMap(card => card.tags))].sort((a, b) => a.localeCompare(b, getLocale())), [cards]);
  const activeTag = tags.includes(tag) ? tag : '';
  const matches = useMemo(() => searchKnowledgeCards(cards, query, activeTag), [cards, query, activeTag]);

  async function remove(id: string) {
    setRemoving(true);
    setError('');
    try {
      await onRemove(id);
      setConfirm(null);
    } catch {
      setError('删除知识卡片失败，请重试。');
    } finally {
      setRemoving(false);
    }
  }
  async function openSource(source: KnowledgeSource) {
    setOpening(true);
    setError('');
    try {
      if (await onOpenSource(source)) onClose();
      else setError('暂时无法打开这张卡片的出处。');
    } catch {
      setError('暂时无法打开这张卡片的出处。');
    } finally {
      setOpening(false);
    }
  }

  const busy = removing || opening;
  return <KnowledgeDialog title={t('知识卡片')} busy={busy} onClose={onClose}>
    <div className="knowledge-dialog-body">
      <div className="knowledge-filters">
        <input data-knowledge-focus type="search" aria-label={t('搜索标题、正文或标签')} placeholder={t('搜索标题、正文或标签')} value={query} onChange={event => { setQuery(event.target.value); setLimit(40); }} />
        <NativeSelect wrapperClassName="knowledge-tag-select" aria-label={t('按标签筛选')} value={activeTag} onChange={event => { setTag(event.target.value); setLimit(40); }}>
          <option value="">{t('全部标签')}</option>
          {tags.map(value => <option key={value} value={value}>{value}</option>)}
        </NativeSelect>
      </div>
      {loading && <p className="knowledge-status" role="status">{t('正在读取知识库…')}</p>}
      {loadError && <div className="knowledge-feedback"><p role="alert">{t('无法读取知识库，请重试。')}</p><button type="button" className="secondary-button" disabled={loading} onClick={onReload}>{t('重试')}</button></div>}
      {recovered && <p className="knowledge-status" role="status">{t('已从上一份备份读取知识卡片。')}</p>}
      {error && <p className="knowledge-error" role="alert">{t(error)}</p>}
      {!loading && !loadError && !matches.length && <p className="knowledge-status">{t(cards.length ? '没有匹配的知识卡片。' : '还没有知识卡片，可从 AI 回答收藏。')}</p>}
      <ul className="knowledge-card-list">
        {matches.slice(0, limit).map(card => <li className="knowledge-card" key={card.id}>
          <h3>{card.title}</h3>
          {(card.content.length <= 1600 || expanded === card.id) && <div className="knowledge-card-markdown"><MathMarkdown>{card.content}</MathMarkdown></div>}
          {!!card.tags.length && <ul className="knowledge-tags">{card.tags.map(value => <li key={value}>{value}</li>)}</ul>}
          {card.source && <p className="knowledge-source-label" title={knowledgeSourceLabel(card.source)}>{knowledgeSourceLabel(card.source)}</p>}
          <div className="knowledge-card-actions">
            {confirm === card.id ? <>
              <span>{t('删除这张卡片？')}</span>
              <button type="button" className="secondary-button" {...confirmShortcut} disabled={removing} onClick={() => { void remove(card.id); }}>{t('删除')}</button>
              <button type="button" className="secondary-button" disabled={removing} onClick={() => setConfirm(null)}>{t('取消')}</button>
            </> : <>
              {card.content.length > 1600 && <button type="button" className="secondary-button" aria-expanded={expanded === card.id} onClick={() => setExpanded(previous => previous === card.id ? null : card.id)}>{t(expanded === card.id ? '收起正文' : '查看正文')}</button>}
              {card.source && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void openSource(card.source!); }}><ArrowUpRight size={14} />{t('打开出处')}</button>}
              <button type="button" className="secondary-button" disabled={loading || loadError || busy} onClick={() => onEdit(card)}><Pencil size={14} />{t('编辑')}</button>
              <button type="button" className="secondary-button" disabled={loading || loadError || busy} onClick={() => setConfirm(card.id)}><Trash2 size={14} />{t('删除')}</button>
            </>}
          </div>
        </li>)}
      </ul>
      {matches.length > limit && <button type="button" className="secondary-button knowledge-more" onClick={() => setLimit(value => value + 40)}>{t('显示更多卡片')}</button>}
    </div>
  </KnowledgeDialog>;
}

export function KnowledgeCardEditor({ draft, project, disabled, onClose, onSave }: {
  draft: KnowledgeDraft; disabled?: boolean; onClose: () => void; onSave: (draft: KnowledgeDraft) => Promise<void>;
  project?: { id: string; title: string };
}) {
  useLocale();
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [tags, setTags] = useState(draft.tags.join(', '));
  const [source, setSource] = useState(draft.source);
  const [linkToProject, setLinkToProject] = useState(draft.projectId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const form = useId();
  const canSave = Boolean(title.trim() && content.trim()) && !saving && !disabled;
  async function save() {
    setSaving(true);
    setError(false);
    try {
      await onSave({ ...draft, title: title.trim(), content: content.trim(), tags: tags.split(/[,，\n]/u).map(tag => tag.trim()).filter(Boolean), source,
        ...(project ? { projectId: linkToProject ? project.id : null } : {}),
      });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return <KnowledgeDialog title={t(draft.id ? '编辑知识卡片' : '存入知识库')} busy={saving} onClose={onClose} actions={<>
    <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{t('取消')}</button>
    <button type="submit" form={form} className="primary-button" {...confirmShortcut} disabled={!canSave}>{t(saving ? '正在保存…' : '保存')}</button>
  </>}>
    <form id={form} className="knowledge-dialog-body knowledge-editor" onSubmit={event => { event.preventDefault(); if (canSave) void save(); }}>
      <label>{t('标题')}<input data-knowledge-focus value={title} maxLength={500} disabled={saving} onChange={event => setTitle(event.target.value)} required /></label>
      <label>{t('正文')}<textarea rows={7} value={content} disabled={saving} onChange={event => setContent(event.target.value)} required /></label>
      <label>{t('标签')}<input value={tags} placeholder={t('用逗号分隔标签')} disabled={saving} onChange={event => setTags(event.target.value)} /></label>
      {project && <label className="inquiry-checkbox"><input type="checkbox" checked={linkToProject} disabled={saving} onChange={event => setLinkToProject(event.target.checked)} />{t('关联课题「{0}」', [project.title])}</label>}
      {source && <div className="knowledge-editor-source">
        <p className="knowledge-source-label">{knowledgeSourceLabel(source)}</p>
        {source.quote && <blockquote>{knowledgePreview(source.quote, 400)}</blockquote>}
        <button type="button" className="secondary-button" disabled={saving} onClick={() => setSource(undefined)}>{t('移除出处')}</button>
      </div>}
      {error && <p className="knowledge-error" role="alert">{t('知识卡片保存失败，请检查内容后重试。')}</p>}
    </form>
  </KnowledgeDialog>;
}
