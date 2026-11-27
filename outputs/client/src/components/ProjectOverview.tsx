import { useMemo, useState } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { Bookmark, BookMarked, BookOpen, Check, Columns2, Download, FileText, FolderOpen, MessageSquare, Pencil, Plus, RotateCcw, Search, X } from 'lucide-react';
import type { Conversation } from '../domain/types';
import { hasResearchEvidence, INQUIRY_NOTE_LIMIT, INQUIRY_QUESTION_LIMIT, inquirySources, READING_BUCKETS, showsProofSources, type InquirySource, type ReadingBucket, type ReadingStatus } from '../domain/inquiry';
import type { KnowledgeCard } from '../domain/knowledge';
import type { LocalDocumentReference } from '../domain/local-library';
import type { SearchIssue, SearchStep } from '../adapters/inquiry';
import { t } from '../i18n/locale';
import { KnowledgeDialog, knowledgeSourceLabel } from './KnowledgeBase';
import { MathMarkdown } from './MathMarkdown';
import { readingBucketText, researchStepText, ResearchSourceCard } from './ResearchSourceCard';

export interface InquiryRun {
  projectId: string; step?: SearchStep; issues?: SearchIssue[]; message?: string; configureWebSearch?: boolean;
}

interface Props {
  project: Conversation; threads: Conversation[]; documents: LocalDocumentReference[]; cards: KnowledgeCard[];
  run?: InquiryRun; busy: boolean; searchBusy: boolean;
  onNewChat: () => void; onRename: (title: string) => void;
  onSearch: (focus?: string) => void; onCancel: () => void; onWebSearch: () => void; onRetryWeb?: () => void; onGenerateGuide?: () => void; onContinue?: () => void;
  onAttach: (sourceId?: string) => void; onOpen: (ref: LocalDocumentReference, mode: 'focused' | 'split') => void;
  onDownload: (source: InquirySource) => void; onNote: (id: string, note: string, online: boolean) => void;
  onReadingStatus: (id: string, status?: ReadingStatus) => void;
  onOverviewCard?: () => void; onOpenCard: (card: KnowledgeCard) => void; onEditCard: (card: KnowledgeCard) => void;
}

const sourceBucket = (source: InquirySource) => hasResearchEvidence(source) && source.readingBucket || 'uncategorized';
type SourceFilter = 'all' | 'to_read' | 'uncategorized' | ReadingBucket;
const issueLabels: Record<SearchIssue['issue'], string> = {
  limited: '检索限流', timeout: '检索超时', access: '访问受限', unavailable: '暂不可用',
  unsupported: '接口拒绝搜索请求', 'no-citations': '未返回可验证的出处', 'missing-key': '缺少 API 密钥',
  'grounding-restricted': 'Gemini 搜索结果不适用于可保存的资料地图', unverified: '请重新检测或更换网页来源',
};

function TextDialog({ title, label, value, limit, optional, onClose, onSave }: {
  title: string; label: string; value: string; limit: number; optional?: boolean;
  onClose: () => void; onSave: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  return <KnowledgeDialog title={title} onClose={onClose} actions={<>
    <button type="button" className="secondary-button" onClick={onClose}>{t('取消')}</button>
    <button type="submit" className="primary-button" form="inquiry-text-form" {...confirmShortcut} disabled={!optional && !text.trim()}>{t('确定')}</button>
  </>}>
    <form className="knowledge-dialog-body inquiry-text-form" id="inquiry-text-form" onSubmit={event => { event.preventDefault(); if (optional || text.trim()) onSave(text.trim()); }}>
      <label>{label}<textarea data-knowledge-focus rows={4} maxLength={limit} value={text} onChange={event => setText(event.currentTarget.value)} /></label>
    </form>
  </KnowledgeDialog>;
}

function InsightContent({ card }: { card: KnowledgeCard }) {
  const [expanded, setExpanded] = useState(false);
  const firstParagraph = card.content.trim().split(/\n\s*\n/u, 1)[0];
  return <>
    <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{card.title}</summary>
      {expanded && <MathMarkdown>{card.content}</MathMarkdown>}
    </details>
    {!expanded && firstParagraph.length <= 400 && <div className="inquiry-insight-preview"><MathMarkdown>{firstParagraph}</MathMarkdown></div>}
  </>;
}

export function ProjectOverview(props: Props) {
  const { project, threads, documents, cards, busy, run } = props;
  const [searchOpen, setSearchOpen] = useState(false);
  const [note, setNote] = useState<{ id: string; content: string; online: boolean } | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insightLimit, setInsightLimit] = useState(8);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const proofView = showsProofSources(project.inquiry);
  const sources = inquirySources(project.inquiry);
  const earlier = proofView ? inquirySources(project.inquiry, true).filter(source => !sources.some(visible => visible.id === source.id)) : [];
  const materialsTitle = !proofView || sources.some(source => source.proofMaterial === 'related') ? '资料地图'
    : sources.some(source => source.proofMaterial === 'guide') ? '证明与导读' : '近期证明核验';
  const available = sources.filter(source => source.readingStatus !== 'skipped');
  const skipped = sources.filter(source => source.readingStatus === 'skipped');
  const savedOverview = project.inquiry?.overview;
  const overviewFits = savedOverview?.sourceIds.length && savedOverview.sourceIds.every(id => sources.some(source => source.id === id));
  const overview = !proofView || overviewFits ? savedOverview : undefined;
  const linked = new Set(sources.map(source => source.documentId));
  const unlinkedDocs = documents.filter(ref => !linked.has(ref.document.id));
  const sourceCount = sources.length + unlinkedDocs.length;
  const sourceFilters: { id: SourceFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: available.length + unlinkedDocs.length },
    ...READING_BUCKETS.map(id => ({ id, label: readingBucketText[id], count: available.filter(source => sourceBucket(source) === id).length })),
  ];
  const uncategorized = available.filter(source => sourceBucket(source) === 'uncategorized').length;
  const toRead = available.filter(source => source.readingStatus === 'to_read').length;
  if (uncategorized) sourceFilters.push({ id: 'uncategorized', label: '未分类', count: uncategorized });
  if (toRead) sourceFilters.push({ id: 'to_read', label: '待精读', count: toRead });
  const activeFilter = sourceFilters.some(item => item.id === filter) ? filter : 'all';
  const visibleSources = available.filter(source => activeFilter === 'all'
    || (activeFilter === 'to_read' ? source.readingStatus === 'to_read' : activeFilter === sourceBucket(source)));
  const noteCounts = useMemo(() => {
    const pageOwners = new Map(documents.flatMap(({ document }) => document.pages.map(page => [page.messageId, document.id] as const)));
    const counts = new Map<string, number>();
    for (const owner of [project, ...threads]) for (const annotation of owner.annotations) {
      const fileId = pageOwners.get(annotation.messageId);
      if (fileId && annotation.deletedAt === undefined) counts.set(fileId, (counts.get(fileId) || 0) + 1);
    }
    return counts;
  }, [project, threads, documents]);

  function localActions(ref: LocalDocumentReference) {
    return <>
      <button type="button" className="document-tool-button" disabled={busy} onClick={() => props.onOpen(ref, 'focused')}><BookOpen size={15} />{t('进入精读')}</button>
      <button type="button" className="document-tool-button" disabled={busy} onClick={() => props.onOpen(ref, 'split')}><Columns2 size={15} />{t('分屏预览')}</button>
      {!!noteCounts.get(ref.document.id) && <span>{t('{0} 条批注', [noteCounts.get(ref.document.id)])}</span>}
    </>;
  }

  function revealSource(id: string, showSkipped = false) {
    setFilter('all');
    if (showSkipped) setSkippedOpen(true);
    requestAnimationFrame(() => {
      const card = document.getElementById('inquiry-' + id);
      card?.scrollIntoView({ block: 'nearest' });
      card?.focus({ preventScroll: true });
    });
  }

  function renderSource(source: InquirySource) {
    const file = documents.find(ref => ref.document.id === source.documentId);
    const bookmarked = source.readingStatus === 'to_read';
    const emptyVideoPdf = source.mediaType === 'video_course' && !source.pdfUrl;
    return <ResearchSourceCard key={source.id} source={source} map readingActions={source.readingStatus === 'skipped'
      ? <button type="button" className="document-tool-button" disabled={busy} onClick={() => {
        props.onReadingStatus(source.id);
        if (skipped.length === 1) setSkippedOpen(false);
        revealSource(source.id);
      }}><RotateCcw size={13} />{t('恢复资料')}</button>
      : <>
        <button type="button" className="document-tool-button" disabled={busy} aria-pressed={bookmarked}
          onClick={() => props.onReadingStatus(source.id, bookmarked ? undefined : 'to_read')}><Bookmark size={13} />{t('待精读')}</button>
        <button type="button" className="document-tool-button" disabled={busy}
          onClick={() => props.onReadingStatus(source.id, 'skipped')}>{t('跳过资料')}</button>
      </>}>
      {file ? localActions(file) : source.pdfUrl &&
        <button type="button" className="document-tool-button" disabled={busy} onClick={() => props.onDownload(source)}><Download size={14} />{t('下载并精读')}</button>}
      {(!file || emptyVideoPdf) &&
        <button type="button" className="document-tool-button" disabled={busy} onClick={() => props.onAttach(source.id)}><FolderOpen size={14} />{t('关联本地 PDF')}</button>}
      <button type="button" className="document-icon-button" aria-label={t('编辑资料备注')} disabled={busy}
        onClick={() => setNote({ id: source.id, content: source.note || '', online: true })}><Pencil size={14} /></button>
    </ResearchSourceCard>;
  }

  return <section className="project-overview" aria-label={t('资料与概览')}>
    <div className="project-overview-content">
      <header className="project-overview-header">
        {titleDraft === null
          ? <h1><button type="button" aria-label={t('重命名项目：{0}', [project.title])} title={project.title} onClick={() => setTitleDraft(project.title)}><span>{project.title}</span><Pencil size={15} /></button></h1>
          : <form className="project-title-form" onSubmit={event => {
            event.preventDefault();
            if (titleDraft.trim()) { props.onRename(titleDraft.trim()); setTitleDraft(null); }
          }}>
            <input autoFocus aria-label={t('项目名称')} value={titleDraft} maxLength={80} onChange={event => setTitleDraft(event.currentTarget.value)}
              onKeyDown={event => { if (event.key === 'Escape') setTitleDraft(null); }} />
            <button type="submit" className="icon-button" {...confirmShortcut} aria-label={t('保存')} disabled={!titleDraft.trim()}><Check size={18} /></button>
            <button type="button" className="icon-button" aria-label={t('取消')} onClick={() => setTitleDraft(null)}><X size={18} /></button>
          </form>}
        {project.inquiry?.question && project.inquiry.question !== project.title && <p className="inquiry-main-question">{project.inquiry.question}</p>}
        <div className="project-overview-actions">
          <button type="button" className="document-tool-button" disabled={busy || props.searchBusy} onClick={() => setSearchOpen(true)}><Search size={15} />{t('补充检索')}</button>
          <button type="button" className="document-tool-button" disabled={busy} onClick={() => props.onAttach()}><Plus size={15} />{t('添加本地文献')}</button>
          <button type="button" className="document-tool-button" disabled={busy} onClick={props.onNewChat}><MessageSquare size={15} />{t('开启新对话')}</button>
        </div>
      </header>
      {run?.step && <div className="inquiry-run" role="status"><span className="inquiry-spinner" aria-hidden="true" />{t(researchStepText[run.step])}<button type="button" className="document-tool-button" onClick={props.onCancel}>{t('停止检索')}</button></div>}
      {(run?.message || run?.configureWebSearch || props.onRetryWeb) && <div className="inquiry-run">
        {run?.message && <span role="status">{t(run.message)}</span>}
        {props.onRetryWeb && <button type="button" className="document-tool-button" disabled={busy || props.searchBusy} onClick={props.onRetryWeb}><RotateCcw size={14} />{t('重试网页检索')}</button>}
        {run?.configureWebSearch && <button type="button" className="document-tool-button" disabled={busy || props.searchBusy} onClick={props.onWebSearch}>{t('网页检索设置')}</button>}
      </div>}
      {!!run?.issues?.length && <p className="inquiry-run inquiry-issues">{run.issues.map(({ provider, issue }) => t('{0} · {1}', [t(provider), t(issueLabels[issue])])).join(' / ')}</p>}

      {overview && <details className="inquiry-overview" open>
        <summary>{t('概览')}</summary>
        <p>{overview.text}{overview.sourceIds.map((id, index) => {
          const source = sources.find(item => item.id === id);
          return source?.provider === 'Model web search' && <a key={id} className="inquiry-inline-citation" href={source.webUrl}
            target="_blank" rel="noreferrer noopener" title={source.title}>{t('资料 {0}', [index + 1])}</a>;
        })}</p>
        <div className="inquiry-citations">
          {overview.sourceIds.map((id, index) => {
            const source = sources.find(item => item.id === id);
            return <button key={id} type="button" className="document-tool-button" title={source?.title}
              onClick={() => revealSource(id, source?.readingStatus === 'skipped')}>{t('资料 {0}', [index + 1])}</button>;
          })}
          {props.onOverviewCard && <button type="button" className="document-tool-button" onClick={props.onOverviewCard}><BookMarked size={14} />{t('存入知识库')}</button>}
        </div>
      </details>}
      {(props.onContinue || props.onGenerateGuide) && <div className="project-overview-actions project-guide-actions">
        {props.onContinue && <button type="button" className="document-tool-button" disabled={busy} onClick={props.onContinue}><MessageSquare size={15} />{t('继续追问')}</button>}
        {props.onGenerateGuide && <button type="button" className="document-tool-button" disabled={busy || props.searchBusy} onClick={props.onGenerateGuide}><BookOpen size={15} />{t('根据主问题生成导读')}</button>}
      </div>}

      <section className="project-materials" aria-labelledby="project-materials-heading">
        <header className="project-materials-header">
          <h2 id="project-materials-heading">{t(materialsTitle)} <small>{sourceCount}</small></h2>
        </header>
        {sourceCount === 0 && <p className="project-overview-empty">{t(proofView
          ? '目前没有可相互核对的证明资料。' : '可以添加本地文献，或为项目检索资料。')}</p>}
        {sources.length > 0 && <div className="research-filters" role="group" aria-label={t('按读法筛选')}>
          {sourceFilters.map(({ id, label, count }) =>
            <button key={id} type="button" className="research-toggle" aria-pressed={activeFilter === id} disabled={id !== 'all' && !count}
              onClick={() => { setFilter(id); setSkippedOpen(false); }}>
              {t(label)}<small>{count}</small>
            </button>)}
        </div>}
        <div className="inquiry-sources">
          {visibleSources.map(renderSource)}
          {activeFilter === 'all' && unlinkedDocs.map(ref => {
            const file = ref.document;
            const content = project.inquiry?.documentNotes?.[file.id] || '';
            return <article className="inquiry-source" key={file.id}>
              <div className="inquiry-source-meta"><FileText size={14} />{t('本地文献')}</div>
              <h3 title={file.name}>{file.name}</h3>{content && <p className="inquiry-source-note">{content}</p>}
              <div className="inquiry-source-actions">{localActions(ref)}
                {ref.conversationId === project.id && <button type="button" className="document-icon-button" disabled={busy} aria-label={t('编辑资料备注')} onClick={() => setNote({ id: file.id, content, online: false })}><Pencil size={14} /></button>}
              </div>
            </article>;
          })}
        </div>
        {skipped.length > 0 && <details className="research-skipped" open={skippedOpen} onToggle={event => setSkippedOpen(event.currentTarget.open)}>
          <summary>{t('已跳过')} <small>{skipped.length}</small></summary>
          {skippedOpen && <div className="inquiry-sources">{skipped.map(renderSource)}</div>}
        </details>}
        {earlier.length > 0 && <details className="research-skipped" open={earlierOpen} onToggle={event => setEarlierOpen(event.currentTarget.open)}>
          <summary>{t('此前保存的资料')} <small>{earlier.length}</small></summary>
          {earlierOpen && <div className="inquiry-sources">{earlier.map(renderSource)}</div>}
        </details>}
      </section>

      {cards.length > 0 && <details className="inquiry-insights" onToggle={event => setInsightsOpen(event.currentTarget.open)}>
        <summary>{t('理解卡片')} <small>{cards.length}</small></summary>
        {insightsOpen && <div className="inquiry-sources">{cards.slice(0, insightLimit).map(card => <article key={card.id} className="inquiry-source inquiry-insight">
          <InsightContent card={card} />
          <div className="inquiry-source-actions">
            {card.source && <button type="button" className="document-tool-button" disabled={busy} title={knowledgeSourceLabel(card.source)} onClick={() => props.onOpenCard(card)}><BookOpen size={14} />{t('返回出处')}</button>}
            <button type="button" className="document-icon-button" aria-label={t('编辑知识卡片')} onClick={() => props.onEditCard(card)}><Pencil size={14} /></button>
          </div>
        </article>)}
          {cards.length > insightLimit && <button type="button" className="document-tool-button inquiry-more-insights" onClick={() => setInsightLimit(value => value + 8)}>{t('查看更多卡片')}</button>}
        </div>}
      </details>}
    </div>
    {searchOpen && <TextDialog title={t('补充检索')} label={t(project.inquiry?.question ? '补充检索词（可选）' : '主问题')} value="" limit={INQUIRY_QUESTION_LIMIT}
      optional={Boolean(project.inquiry?.question)} onClose={() => setSearchOpen(false)} onSave={value => { setSearchOpen(false); props.onSearch(value || undefined); }} />}
    {note && <TextDialog title={t('编辑资料备注')} label={t('备注')} value={note.content} limit={INQUIRY_NOTE_LIMIT} optional
      onClose={() => setNote(null)} onSave={value => { setNote(null); props.onNote(note.id, value, note.online); }} />}
  </section>;
}
