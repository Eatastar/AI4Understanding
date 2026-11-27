import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, MessageSquareQuote, Trash2, X } from 'lucide-react';
import type { AnnotationReference, Conversation } from '../domain/types';
import { RESEARCH_REFERENCE_LIMIT, type InquirySource } from '../domain/inquiry';
import { annotationReferenceBranches, annotationReferenceChoices, annotationSourceLabel, MAX_CHAT_REFERENCES, searchAnnotationReferenceBranches, type AnnotationReferenceBranch } from '../domain/chat-references';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import { MathMarkdown } from './MathMarkdown';
import './chat-annotations.css';

const PAGE_SIZE = 40;

export function ChatAnnotationPicker({ conversation, selected, selectedDocuments = [], researchSources, selectedResearch = [], onApply, onClose }: {
  conversation: Conversation; selected: string[]; selectedDocuments?: string[]; researchSources?: InquirySource[]; selectedResearch?: string[];
  onApply: (ids: string[], documents: string[], sources: string[]) => void; onClose: () => void;
}) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [ids, setIds] = useState(() => new Set(selected)), [query, setQuery] = useState(''), [page, setPage] = useState(0), [error, setError] = useState('');
  const [documents, setDocuments] = useState(selectedDocuments);
  const [sources, setSources] = useState(selectedResearch);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => { dialog.current?.showModal(); }, []);
  const available = useMemo(() => annotationReferenceChoices(conversation.annotations).sort((a, b) =>
    (b.child ?? b.annotation).updatedAt - (a.child ?? a.annotation).updatedAt), [conversation.annotations]);
  const roots = useMemo(() => annotationReferenceBranches(available), [available]);
  const filtered = useMemo(() => searchAnnotationReferenceBranches(roots, query), [roots, query]);
  const files = conversation.documents;
  const hasSources = Boolean(conversation.projectId || files?.length || researchSources?.length);
  const searching = Boolean(query.trim());
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const toggle = (id: string) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_CHAT_REFERENCES) next.add(id);
    else { setError('每次最多引用 10 条批注。'); return; }
    setIds(next);
    setError('');
  };
  const toggleBranch = (id: string) => {
    const update = searching ? setSearchCollapsed : setExpanded;
    update(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const tree = { conversation, ids, open: (id: string) => searching ? !searchCollapsed.has(id) : expanded.has(id), toggle, toggleBranch };
  return <dialog ref={dialog} className="settings-dialog chat-annotation-picker" aria-labelledby="chat-annotation-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="dialog-header"><div><h2 id="chat-annotation-title">{t(hasSources ? '引用资料' : '引用批注到聊天')}</h2><p>{t(hasSources ? '此次对话会带上你选中的资料和批注。' : '只带入你选择的批注。发送后保留当时的内容，可继续展开讨论。')}</p></div><button type="button" className="icon-button" aria-label={t('关闭批注选择')} onClick={onClose}><X size={19} /></button></header>
    <div className="chat-annotation-picker-body">
      {!!files?.length && <ReferenceSection title={t('原文文件')} selected={documents.length} total={files.length} className="chat-project-documents">
        {files.map(file => <label key={file.id}>
          <input type="checkbox" checked={documents.includes(file.id)} onChange={event => {
            const checked = event.target.checked;
            setDocuments(previous => checked ? [...previous, file.id] : previous.filter(id => id !== file.id));
          }} />
          <span className="chat-reference-title" title={file.name}>{file.name}</span>
        </label>)}
      </ReferenceSection>}
      {!!researchSources?.length && <ReferenceSection title={t('在线资料（摘要或摘录）')} selected={sources.length} total={researchSources.length}
        className="chat-project-documents chat-research-sources" initiallyOpen={false}>
        {researchSources.map(source => <label key={source.id}>
          <input type="checkbox" checked={sources.includes(source.id)} disabled={sources.length >= RESEARCH_REFERENCE_LIMIT && !sources.includes(source.id)} onChange={event => {
            const checked = event.currentTarget.checked;
            setSources(previous => checked ? [...previous, source.id] : previous.filter(id => id !== source.id));
          }} />
          <span><strong className="chat-reference-title" title={source.title}>{source.title}</strong><small>{source.provider}{source.excerpt ? '' : ' · ' + t('仅有书目信息')}</small></span>
        </label>)}
      </ReferenceSection>}
      <ReferenceSection title={t('批注')} selected={ids.size} total={available.length} className="chat-annotation-section">
        <input className="chat-annotation-search" aria-label={t('搜索原文、问题或笔记')} placeholder={t('搜索原文、问题或笔记')} value={query} onChange={event => {
          setQuery(event.target.value); setSearchCollapsed(new Set()); setPage(0);
        }} />
        <div className="chat-annotation-list">
          {!filtered.length && <p className="chat-annotation-empty">{t(available.length ? '没有匹配的批注。' : '还没有已保存的批注，可先在原文中提问或写笔记。')}</p>}
          {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(branch =>
            <AnnotationReferenceItem key={branch.id} branch={branch} tree={tree} depth={0} />)}
        </div>
        {pages > 1 && <nav className="chat-annotation-pagination" aria-label={t('批注列表翻页')}><button type="button" className="secondary-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t('上一页')}</button><span>{currentPage + 1} / {pages}</span><button type="button" className="secondary-button" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>{t('下一页')}</button></nav>}
        {error && <p role="alert" className="recovery-message">{t(error)}</p>}
      </ReferenceSection>
    </div>
    <footer className="chat-annotation-picker-actions">
      <div className="chat-annotation-picked" aria-live="polite">
        {!!files?.length && <span>{t('已选 {0} 份文件', [documents.length])}</span>}
        {!!researchSources?.length && <span>{t('已选 {0} 份在线资料', [sources.length])}</span>}
        <span>{t('已选 {0} 条批注', [ids.size])}</span>
      </div>
      <div className="chat-annotation-confirm">
        <button type="button" className="secondary-button" onClick={onClose}>{t('取消')}</button>
        <button type="button" className="primary-button" {...confirmShortcut} onClick={() => onApply([...ids].filter(id => available.some(annotation => annotation.id === id)), documents, sources.filter(id => researchSources?.some(source => source.id === id)))}>{t(hasSources ? '引用所选资料' : '引用所选批注')}</button>
      </div>
    </footer>
  </dialog>;
}

function ReferenceSection({ title, selected, total, className, initiallyOpen = true, children }: {
  title: string; selected: number; total: number; className: string; initiallyOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details className={'chat-reference-section ' + className} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronDown size={15} aria-hidden="true" /><strong>{title}</strong><small>{selected} / {total}</small></summary>
    {open && <div className="chat-reference-section-body" role="group" aria-label={title}>{children}</div>}
  </details>;
}

interface ReferenceTreeControls {
  conversation: Conversation;
  ids: ReadonlySet<string>;
  open: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleBranch: (id: string) => void;
}

function AnnotationReferenceItem({ branch, tree, depth }: { branch: AnnotationReferenceBranch; tree: ReferenceTreeControls; depth: number }) {
  const childrenId = useId();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { id, annotation, child, children } = branch;
  const open = !!children.length && tree.open(id);
  const source = depth ? '' : annotationSourceLabel(tree.conversation, annotation);
  const quote = child?.quotedText ?? annotation.quote;
  const note = child ? child.note : annotation.note;
  const description = note ?? child?.question ?? annotation.question;
  return <div className="chat-annotation-branch" data-reference-id={id}>
    <div className="chat-annotation-row" style={{ '--branch-depth': Math.min(depth, 4) } as CSSProperties}>
      <label className="chat-annotation-choice">
        <input type="checkbox" checked={tree.ids.has(id)} onChange={() => tree.toggle(id)} aria-label={t('选择批注：{0}', [quote.slice(0, 80)])} />
        <span>
          {!depth && <small title={source}>{source === 'AI 回答' ? t('AI 回答') : source} · {t(note !== undefined ? '笔记' : 'AI 问答')}</small>}
          {depth > 0 && note !== undefined && <small>{t('笔记')}</small>}
          <strong>{quote.slice(0, 240)}</strong>
          {description && <span>{description.slice(0, 240)}</span>}
        </span>
      </label>
      {!!children.length && <button type="button" className="chat-annotation-branch-toggle" aria-expanded={open} aria-controls={childrenId}
        aria-label={t(open ? '收起子批注' : '展开子批注')} title={t(open ? '收起子批注' : '展开子批注')} onClick={() => tree.toggleBranch(id)}>
        {children.length}<ChevronDown size={14} aria-hidden="true" />
      </button>}
    </div>
    {!!children.length && <div id={childrenId} className="chat-annotation-children" hidden={!open}>
      {open && children.slice(0, visibleCount).map(node => <AnnotationReferenceItem key={node.id} branch={node} tree={tree} depth={depth + 1} />)}
      {open && children.length > visibleCount && <button type="button" className="chat-annotation-more secondary-button" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>{t('显示更多')}</button>}
    </div>}
  </div>;
}

export function ChatAnnotationReferences({ references }: { references: AnnotationReference[] }) {
  useLocale(); const [open, setOpen] = useState(false);
  return <details className="chat-annotation-references" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><MessageSquareQuote size={13} />{t('主动引用 {0} 条批注', [references.length])}<ChevronDown className="chat-annotation-disclosure" size={13} aria-hidden="true" /></summary>
    {open && <div>{references.map(reference => <article key={reference.subAnnotation?.id ?? reference.annotationId}>
      <small>{reference.label === 'AI 回答' ? t('AI 回答') : reference.label}</small><blockquote>{reference.quote}</blockquote>
      {reference.mode === 'note' ? <p>{reference.note}</p> : !reference.subAnnotation?.path && <><strong>{reference.question}</strong><p>{reference.answer}</p></>}
      {reference.subAnnotation && <div className="chat-sub-annotation-reference">
        <small>{t('子批注')}{reference.subAnnotation.path?.length ? ' · ' + reference.subAnnotation.path.join(' / ') : ''}</small>
        <blockquote><MathMarkdown>{reference.subAnnotation.quotedText}</MathMarkdown></blockquote>
        {reference.subAnnotation.note !== undefined ? <p className="chat-sub-annotation-note">{reference.subAnnotation.note}</p>
          : <><strong>{reference.subAnnotation.question}</strong><MathMarkdown>{reference.subAnnotation.answer}</MathMarkdown></>}
        {reference.subAnnotation.followUps?.map((turn, index) => <div key={index}>
          <strong>{turn.question}</strong><MathMarkdown>{turn.answer}</MathMarkdown>
        </div>)}
      </div>}
    </article>)}</div>}
  </details>;
}

export function DeleteChatTurnDialog({ question, annotationCount, referenceCount, disabled, onClose, onDelete }: { question: string; annotationCount: number; referenceCount: number; disabled: boolean; onClose: () => void; onDelete: () => Promise<void> }) {
  useLocale(); const dialog = useRef<HTMLDialogElement>(null), [working, setWorking] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const busy = disabled || working;
  return <dialog ref={dialog} className="settings-dialog chat-turn-delete-dialog" aria-labelledby="chat-turn-delete-title" onCancel={event => { event.preventDefault(); if (!working) onClose(); }}>
    <header className="dialog-header"><h2 id="chat-turn-delete-title">{t('删除本轮对话？')}</h2><button type="button" className="icon-button" aria-label={t('关闭删除确认')} disabled={working} onClick={onClose}><X size={19} /></button></header>
    <blockquote>{question.slice(0, 500)}</blockquote><p>{t('将删除本轮问题、回答及所有回答版本，之后的提问不再引用这一轮。此操作不进入回收站。')}</p>
    {annotationCount > 0 && <p>{t('这轮回答上的 {0} 条批注也会删除，PDF 原文上的批注保留。', [annotationCount])}</p>}
    {referenceCount > 0 && <p>{t('后续聊天中对本轮内容的文字和批注引用也会移除。')}</p>}
    <p className="trash-backup-note">{t('以前的自动备份和导出备份仍可能保留这些内容。')}</p>
    {error && <p role="alert" className="recovery-message">{t(error)}</p>}
    <footer className="chat-annotation-picker-actions"><button type="button" className="secondary-button" disabled={working} onClick={onClose}>{t('取消')}</button><button type="button" className="danger-button" {...confirmShortcut} disabled={busy} onClick={() => { setWorking(true); setError(''); void onDelete().catch(failure => { setError(failure instanceof Error ? failure.message : '操作未完成，请重试。'); setWorking(false); }); }}><Trash2 size={14} />{t(working ? '正在删除…' : '确认删除本轮')}</button></footer>
  </dialog>;
}
