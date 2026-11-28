import { useMemo, useRef, useState, type ReactNode } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { ArrowRight, BookOpenText, ChevronDown, FolderOpen, MessageSquare, Plus, Search, Settings2 } from 'lucide-react';
import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import type { Conversation, ModelSettings } from '../domain/types';
import type { LocalDocumentGroup, LocalDocumentReference } from '../domain/local-library';
import { homeQuestionAction, INQUIRY_QUESTION_LIMIT, type HomeQuestionAction } from '../domain/inquiry';
import { projectDocuments, projectMaterialCount } from '../domain/projects';
import { BrandLogo } from './BrandLogo';
import { LanguageSelector } from './LanguageSelector';
import { NativeSelect } from './NativeSelect';
import { AppearanceButton } from './ReaderAppearancePanel';
import { RecentReading } from './RecentReading';
import { ShortcutButton, TranslationButton } from './Translation';
import './documents.css';
import './inquiry.css';

interface ToolbarProps {
  settings: ModelSettings; busy: boolean;
  onChooseModel: (id: string | null) => void; onSettings: () => void; onAppearance: () => void;
}

export function WorkbenchModelMenu({ settings, busy, onChooseModel, onSettings }: Omit<ToolbarProps, 'onAppearance'>) {
  const root = useRef<HTMLDetailsElement>(null);
  const label = settings.mode === 'api' ? settings.model : t('本地演示');
  return <details className="workbench-model" ref={root} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={event => { if (event.key === 'Escape' && root.current?.open) {
    event.preventDefault(); event.stopPropagation(); root.current.open = false; root.current.querySelector('summary')?.focus();
  } }}>
    <summary className="connection-button" aria-label={t('模型与 API 连接')} title={label}><span className="status-dot" data-online={settings.mode === 'api'} /><span className="connection-label">{label}</span><ChevronDown size={14} /></summary>
    <div className="workbench-model-options">
      {!!settings.profiles.length && <NativeSelect aria-label={t('选择预载模型')} disabled={busy} value={settings.mode === 'demo' ? '__demo__' : settings.activeProfileId || '__current__'} onChange={event => {
        onChooseModel(event.currentTarget.value === '__demo__' ? null : event.currentTarget.value);
        if (root.current) root.current.open = false;
      }}>
        <option value="__demo__">{t('本地演示')}</option>
        {settings.mode === 'api' && !settings.activeProfileId && <option value="__current__" disabled>{settings.model}</option>}
        {settings.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
      </NativeSelect>}
      <button type="button" className="document-tool-button" onClick={() => { if (root.current) root.current.open = false; onSettings(); }}><Settings2 size={15} />{t('配置 API')}</button>
    </div>
  </details>;
}

interface Props extends ToolbarProps {
  menu: ReactNode;
  onWiki?: () => void;
  recent: { visible: LocalDocumentGroup[]; hidden: LocalDocumentGroup[] };
  conversations: Conversation[]; loading: boolean; exploreBusy: boolean;
  onOpenFile: () => void; onDropFile: (file: File) => void;
  onOpenDocument: (group: LocalDocumentGroup, ref?: LocalDocumentReference) => void;
  onSetRecentHidden: (groups: LocalDocumentGroup[], hide: boolean) => void;
  onExplore: (action: HomeQuestionAction) => boolean; onProject: (id: string) => void; onNewProject: () => void; onOrganizeProjects: () => void; onChat: () => void;
}

export function ReaderHome({ menu, recent, conversations, busy, loading, exploreBusy, onOpenFile, onDropFile, onOpenDocument, onSetRecentHidden, onExplore, onProject, onNewProject, onOrganizeProjects, onChat, onSettings, onAppearance, settings, onChooseModel, onWiki }: Props) {
  useLocale();
  const [question, setQuestion] = useState('');
  const [syncSearch, setSyncSearch] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const projects = useMemo(() => {
    const activity = new Map<string, Conversation[]>();
    for (const chat of conversations) if (chat.projectId && chat.deletedAt === undefined) {
      const previous = activity.get(chat.projectId) || [];
      previous.push(chat);
      activity.set(chat.projectId, previous);
    }
    return conversations.filter(project => project.isProject && project.deletedAt === undefined).map(project => {
      const threads = activity.get(project.id) || [];
      return { project, updatedAt: Math.max(project.updatedAt, ...threads.map(chat => chat.updatedAt)), chats: threads.length, documents: projectMaterialCount(project, projectDocuments(project, threads)) };
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [conversations]);

  return <section className="reader-home inquiry-home" aria-label={t('工作台')} data-testid="reader-home" data-dragging={dropping}
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDropping(!busy); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }}
    onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropping(false); }}
    onDrop={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current = 0; setDropping(false);
      const file = event.dataTransfer.files[0]; if (file && !busy) onDropFile(file);
    }}>
    <header className="reader-home-toolbar">
      <div className="reader-home-heading">{menu}<BrandLogo size={28} className="reader-home-logo" /><span className="reader-home-brand">{__APP_NAME__}</span></div>
      <div className="reader-home-actions"><LanguageSelector /><AppearanceButton onOpen={onAppearance} /><TranslationButton /><ShortcutButton />
        {onWiki && <button type="button" className="document-tool-button wiki-launch-button" aria-label={t('个人知识库')} title={t('个人知识库')} onClick={onWiki}><BookOpenText size={17} /><span>{t('个人知识库')}</span></button>}
        <WorkbenchModelMenu settings={settings} busy={busy || exploreBusy} onChooseModel={onChooseModel} onSettings={onSettings} />
        <button type="button" className="document-icon-button" aria-label={t('打开对话')} title={t('打开对话')} onClick={onChat}><MessageSquare size={18} /></button>
      </div>
    </header>
    <div className="reader-home-content">
      <div className="inquiry-home-intro">
        <h1><BrandLogo size={72} /><span>{t('从一个问题开始')}</span></h1>
        <form className="inquiry-search-form" onSubmit={event => {
          event.preventDefault();
          const action = homeQuestionAction(question, syncSearch);
          if (action && !busy && !exploreBusy && onExplore(action)) {
            setQuestion(''); setSyncSearch(action.nextSearch);
          }
        }}>
          <input aria-label={t('主问题')} value={question} maxLength={INQUIRY_QUESTION_LIMIT} onChange={event => setQuestion(event.currentTarget.value)} placeholder={t('输入想探索的问题，或拖入 PDF / 电子书…')} />
          <div className="inquiry-home-submit">
            <button type="button" className="research-toggle" aria-pressed={syncSearch} disabled={busy || exploreBusy} onClick={() => setSyncSearch(value => !value)}>
              <Search size={14} />{t('同步检索文献')}
            </button>
            <button type="submit" className="primary-button" {...confirmShortcut} disabled={busy || exploreBusy || !question.trim()}>
              {syncSearch ? <Search size={15} /> : <MessageSquare size={15} />}{t(syncSearch ? '探索' : '提问')}
            </button>
          </div>
        </form>
        <button type="button" className="document-tool-button home-open-local" disabled={busy} onClick={onOpenFile}><FolderOpen size={16} />{t('打开本地 PDF / 电子书')}</button>
      </div>
      <div className="inquiry-home-columns">
        <section className="home-topics" aria-label={t('进行中的项目')}>
          <header><h2>{t('进行中的项目')}</h2><div className="home-project-actions">
            {!!projects.length && <button type="button" className="document-tool-button" aria-label={t('整理项目')} aria-haspopup="dialog" onClick={onOrganizeProjects}>{t('整理')}</button>}
            <button type="button" className="document-tool-button" onClick={onNewProject} disabled={busy}><Plus size={14} />{t('新建')}</button>
          </div></header>
          {projects.length === 0 && <p className="reader-recent-empty">{t('探索过的问题和文献项目会出现在这里。')}</p>}
          <ul>{projects.slice(0, showAll ? undefined : 5).map(({ project, chats, documents }) =>
            <li key={project.id}><button type="button" disabled={busy} onClick={() => onProject(project.id)} title={project.title}>
              <span><strong>{project.title}</strong><small>{t('{0} 份资料', [documents])}{chats ? t(' · {0} 条对话', [chats]) : ''}</small></span><ArrowRight size={15} />
            </button></li>
          )}</ul>
          {projects.length > 5 && <button type="button" className="document-tool-button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{t(showAll ? '收起' : '查看全部项目')}</button>}
        </section>
        <RecentReading visible={recent.visible} hidden={recent.hidden} conversations={conversations} busy={busy} loading={loading} onOpenDocument={onOpenDocument} onSetHidden={onSetRecentHidden} />
      </div>
    </div>
    {dropping && <div className="inquiry-drop-indicator" aria-hidden="true"><FolderOpen size={24} />{t('松开以打开文件')}</div>}
  </section>;
}
