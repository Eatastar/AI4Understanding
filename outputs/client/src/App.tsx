import { t, getLocale, localeDirection } from './i18n/locale';
import { downloadJson } from './adapters/download';
import { useLocale } from './i18n/react';
import { lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Columns2, Download, FileUp, FileText, FolderOpen, FolderPlus, MessageSquareQuote, Paperclip, PenLine, Plus, RefreshCw, RotateCcw, Settings2, Square, Trash2, X } from 'lucide-react';
import { ArrowLeft, BookMarked, BookOpenText, BookmarkPlus, Globe, Home, PanelLeft, PanelLeftClose, Search, SeparatorHorizontal } from 'lucide-react';
import { readerPolicy } from './adapters/reader-policy';
import { finishReport, type ReaderReport, type ReaderPlan } from './domain/reader-report';
import { readerIndex, evidenceSearchHit } from './domain/reader-evidence';
import { isEbookKind } from './domain/types';
import type { Annotation, ChatMessage, ChatTextReference, Conversation, DocumentAttachment, InputMessage, MessageVersion, ModelSettings, ProfileInput, Workspace } from './domain/types';
import { activeVersion, addAssistantVersion, completeAnnotation, createAssistantMessage, createConversation, createSiblingAnnotation, createUserMessage, deleteAnnotation, restoreAnnotation, deleteConversation, restoreConversation, deleteProjects, restoreProject, prepareAnnotationRequest, updateAnnotationCopy, saveNoteAnnotation, makeId } from './domain/workspace';
import { snapshotKnowledge, restoreKnowledge } from './adapters/knowledge-backup';
import { parseBackupData, exportWorkspaceBlob, importWorkspaceWithFiles, getDocumentBytes } from './adapters/storage';
import { deleteProfile, getSettings, saveProfile, selectProfile, streamReply } from './adapters/model';
import { AnnotatedAnswer } from './components/AnnotatedAnswer';
import { SettingsDialog } from './components/SettingsDialog';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import { useWorkspace } from './hooks/useWorkspace';
import { useChatPosition } from './hooks/useChatPosition';
import { pruneChatPositions } from './adapters/chat-position';
import { DocumentReader, type ReaderPageJump } from './components/DocumentReader';
import { SPLIT_READER_PANEL_ID, SplitDocumentTabs, WorkspaceSplit } from './components/WorkspaceSplit';
import { RecoveryDialog } from './components/RecoveryDialog';
import { desktop } from './adapters/desktop';
import { changeAnnotationReask, updateAnnotationRequest } from './domain/workspace';
import { isAnnotationGenerating } from './domain/annotation-state';
import { adjacentAnnotationSlot, annotationGroupId, appendAnnotation } from './domain/annotation-groups';
import { setBranchFeedback, addSubAnnotation, deleteSubAnnotation, editSubAnnotation, finishSubAnnotationFollowUp, finishSubAnnotationRequest, prepareSubAnnotationFollowUp, prepareSubAnnotationRequest, type SubAnnotationDraft, type SubAnnotationEdit, type SubAnnotationTarget } from './domain/sub-annotations';
import { SubAnnotationStreams } from './domain/sub-annotation-streams';
import { subAnnotationPath, subAnnotationSubtree } from './domain/sub-annotation-tree';
import { annotationWindows, type ChildAnnotationWindow } from './domain/companion-view';
import { AnnotationActions, type SubAnnotationQuestion } from './components/AnnotationActions';
import { readPdfExcerpt, selectionSourceStart, type OpenReaderPdf } from './adapters/pdf-excerpt';
import { AnnotationAnchors } from './components/annotation-anchors';
import { AnnotationWindows } from './components/AnnotationWindows';
import { recycleBin, type TrashTarget } from './domain/trash';
import { TrashDialog } from './components/TrashDialog';
import { BrandLogo } from './components/BrandLogo';
import { ReaderHome } from './components/ReaderHome';
import { ReaderHomeMenu } from './components/ReaderHomeMenu';
import { AppearanceButton, AppearanceDialog } from './components/ReaderAppearancePanel';
import { loadDocumentContextMode, saveDocumentContextMode } from './adapters/document-context';
import type { DocumentContextMode } from './domain/document-context';
import { freezeContext } from './domain/context-pool';
import { useLocalLibrary } from './hooks/useLocalLibrary';
import { conversationFileGroups, fileAnnotationCounter, localDocumentReferences, preferProjectFiles, projectFileAnnotations } from './domain/local-library';
import type { LocalDocumentGroup, LocalDocumentReference } from './domain/local-library';
import { loadReaderSession, saveReaderSession } from './adapters/reader-session';
import { changeAnnotationColor } from './domain/highlight-colors';
import { ShortcutButton, TranslationButton, TranslationProvider, useTranslation } from './components/Translation';
import { VirtualChatMessage } from './components/VirtualChatMessage';
import { loadChatPosition } from './adapters/chat-position';
import { bindCompleteChatCopy } from './adapters/chat-copy';
import { annotationReferenceChoices, canReferenceAnnotation, canReferenceSubAnnotation, captureAnnotationReferences, chatRound } from './domain/chat-references';
import { ChatTurnNavigation } from './components/ChatTurnNavigation';
import { MAX_CHAT_REFERENCES } from './domain/chat-references';
import { ChatAnnotationPicker, ChatAnnotationReferences, DeleteChatTurnDialog } from './components/ChatAnnotations';
import { confirmationScope, confirmShortcut, useConfirmationShortcut } from './hooks/confirmation-shortcut';
import { NativeSelect } from './components/NativeSelect';
import { ChatQuestionText, ChatTextReferencePreview, ChatTextReferenceProvider } from './components/ChatTextReference';
import { captureChatTextReference, hasChatTextSource, type ChatTextSelection } from './domain/chat-text-reference';
import type { ReaderSession } from './adapters/reader-session';
import { figureImageKey, figureSourceKey, FIGURE_LIMITS } from './domain/figure';
import { figureCache, figureDataURL, type PreparedFigureImage } from './adapters/figure';
import { updateFigureStrokes } from './domain/workspace';
import { DEFAULT_RESPONSE_PROMPT, responsePreference } from './domain/response-language';
import { parseDocumentFile, documentFileKind, DOCUMENT_ACCEPT, READER_ACCEPT } from './adapters/documents';
import { archiveChatPaper, buildProjectChatContext, chatBackup, chooseDocuments, chooseResearchSources, createFileProject, createProject, createProjectChat, findConversation, moveChatToProject, projectDocuments, projectFor, projectResources, sameDocumentPages } from './domain/projects';
import { closePreviewTab, conversationPreviewScope, moveProjectPreview, openPreviewTab, panePreviewScope, previewDocuments, restoreReaderView, retainPreviewTabs, setProjectPreview, type ProjectPreviews, type WorkspacePane, type WorkspaceView } from './domain/workspace-view';
import { ProjectConversationList, ProjectDialog, ProjectOrganizer } from './components/Projects';
import { AnnotationChatActions, AnnotationSummaryDialog } from './components/AnnotationSummary';
import { appendAnnotationSummary, buildSummaryContext, selectedSummaryTurns, summaryTarget } from './domain/annotation-summary';
import { collectionChoices, collectHistory } from './domain/collected-history';
import { CollectedHistory, CollectHistoryDialog } from './components/CollectedHistory';
import { useKnowledgeBase } from './hooks/useKnowledgeBase';
import { useReaderAppearance } from './hooks/useReaderAppearance';
import { KnowledgeBase, KnowledgeCardActions, KnowledgeCardEditor } from './components/KnowledgeBase';
import { KnowledgeCardPicker } from './components/KnowledgeCardPicker';
import { addKnowledgeContext, exportKnowledgeCards, findKnowledgeDocument, knowledgeFromAnnotation, knowledgeFromAnswer, projectKnowledge, type KnowledgeCard, type KnowledgeDraft, type KnowledgeSource } from './domain/knowledge';
import { appendInquirySearch, chatSearchAction, INQUIRY_QUESTION_LIMIT, INQUIRY_SOURCE_LIMIT, SECTION_TITLE_LIMIT, inquirySources, projectThreads, researchLink, sameResearchSource, setResearchReadingStatus, suggestsPaperSearch, toggleChatSearch, withResearchEvidence, type ChatSearchMode, type HomeQuestionAction, type Inquiry, type InquirySource, type ReplyResearch } from './domain/inquiry';
import { briefInquiry, downloadResearchPdf, inquiryIntroduction, inquiryReplyText, lookupWeb, researchInquiry, webSearchIssue, type SearchStep, type WebResearchRetry } from './adapters/inquiry';
import { ProjectOverview, type InquiryRun } from './components/ProjectOverview';
import { ResearchSourceCard, researchStepText } from './components/ResearchSourceCard';
import { ApiSetupPrompt, shouldRemindAboutApi, WebSearchDialog } from './components/InquirySettings';
import { hasWikiSource, selectedWikiMaterial } from './knowledge/legacy-reader-adapter';
import { buildDocumentSearch, searchDocument } from './domain/reader-navigation';
import type { ReferenceItem, SourceCitation } from './knowledge/wiki-types';

const WikiWorkspace = lazy(() => import('./knowledge/WikiWorkspace'));
const DEFAULT_SETTINGS: ModelSettings = { mode: 'demo', baseURL: 'https://api.openai.com/v1', model: '', systemPrompt: DEFAULT_RESPONSE_PROMPT, hasApiKey: false, apiFormat: 'openai-chat', profiles: [], activeProfileId: null, persistence: 'session' };
const SIDEBAR_DRAWER_QUERY = '(max-width: 1050px)';
type Busy = { conversationId: string; messageId: string; versionId: string; controller: AbortController };
type ChatResearchRun = Omit<Busy, 'controller'> & { step: SearchStep; mode: Exclude<ChatSearchMode, 'local'> };
type AnnotationChatRequest = { conversationId: string; id: string; documentId?: string };
type ProjectFileTarget = { projectId: string; sourceId?: string; stayOnOverview?: boolean };
type InquiryReplyTarget = { conversationId: string; messageId: string; versionId: string; question: string; savedSources?: readonly InquirySource[] };
type ProjectInquiryRun = InquiryRun & { retry?: { plan: WebResearchRetry; focus?: string; reply?: InquiryReplyTarget } };
type ChatPaperTarget = { conversationId: string; messageId: string; versionId: string; sourceId: string };

function inquiryTurn(question: string): [ChatMessage, ChatMessage] {
  return [createUserMessage(question), { ...createAssistantMessage(), inquiryIntro: true }];
}

function updateConversation(workspace: Workspace, id: string, change: (c: Conversation) => Conversation) {
  return { ...workspace, conversations: workspace.conversations.map(c => c.id === id ? change(c) : c) };
}
function patchVersion(c: Conversation, messageId: string, versionId: string, patch: Partial<MessageVersion>): Conversation {
  return { ...c, updatedAt: Date.now(), messages: c.messages.map(m => m.id === messageId ? { ...m, versions: m.versions.map(v => v.id === versionId ? { ...v, ...patch } : v) } : m) };
}
const errorText = (e: unknown) => e instanceof Error ? e.message : t("操作未完成，请重试。");

export default function App() {
  useConfirmationShortcut();
  const locale = useLocale();
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = localeDirection(locale); document.title = __APP_NAME__; desktop()?.setLocale?.(locale); }, [locale]);
  const { workspace, current, update, saveStatus, loadError, flush, checkpoint, invalidateCheckpoint, recover, purge, removeChatTurns, commitFileChanges, backupWarning, lastBackup } = useWorkspace();
  const knowledge = useKnowledgeBase();
  useEffect(() => { invalidateCheckpoint(); }, [knowledge.cards, invalidateCheckpoint]);
  const wikiRepository = desktop()?.wiki;
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiMaterial,setWikiMaterial] = useState<ReferenceItem>();
  const [wikiResume, setWikiResume] = useState<string>();
  const wikiFlush = useRef<(() => Promise<void>) | null>(null);
  const { appearance, setAppearance, saved: appearanceSaved } = useReaderAppearance();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft | null>(null);
  const [turnBusy, setTurnBusy] = useState(false);
  const [chatAnnotationRequest, setChatAnnotationRequest] = useState<AnnotationChatRequest | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeAttempt = useRef(0);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [apiSetupOpen, setApiSetupOpen] = useState(false);
  const [webSearchOpen, setWebSearchOpen] = useState(false);
  const [inquiryRun, setInquiryRun] = useState<ProjectInquiryRun>();
  const inquiryRequest = useRef<AbortController | null>(null);
  const [contextMode, setContextMode] = useState(loadDocumentContextMode);
  const readerLocation = useRef<{ documentId: string; pageNumber: number } | undefined>(undefined);
  const onReaderLocation = useCallback((location: { documentId: string; pageNumber: number }) => { readerLocation.current = location; }, []);
  const [readerPageJump, setReaderPageJump] = useState<ReaderPageJump | null>(null);
  const [readerPdf, setReaderPdf] = useState<OpenReaderPdf | null>(null);
  const onPageJumped = useCallback((jump: ReaderPageJump) => setReaderPageJump(previous => previous === jump ? null : previous), []);
  const changeContextMode = (value: DocumentContextMode) => { setContextMode(value); if (!saveDocumentContextMode(value)) notify('资料范围设置仅在本次有效。'); };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const closeSettings = () => setSettingsOpen(false);
  const [sidebar, setSidebar] = useState({ drawerOpen: false, dockedOpen: true });
  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebar(previous => previous.drawerOpen === open ? previous : { ...previous, drawerOpen: open });
  }, []);
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(() => new Set());
  const [compactSidebar, setCompactSidebar] = useState(() => window.matchMedia(SIDEBAR_DRAWER_QUERY).matches);
  const sidebarMenuButton = useRef<HTMLButtonElement>(null);
  const sidebarCloseButton = useRef<HTMLButtonElement>(null);
  const sidebarSettingsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = window.matchMedia(SIDEBAR_DRAWER_QUERY);
    const resizeSidebar = () => {
      setCompactSidebar(query.matches);
      if (!query.matches) setSidebarOpen(false);
    };
    query.addEventListener('change', resizeSidebar);
    return () => query.removeEventListener('change', resizeSidebar);
  }, [setSidebarOpen]);
  const [projectDialog, setProjectDialog] = useState<{ conversationId?: string } | null>(null);
  const [organizeProjectsOpen, setOrganizeProjectsOpen] = useState(false);
  const [summaryDialog, setSummaryDialog] = useState<{ conversationId: string; turnIds: string[] } | null>(null);
  const [collectionDialog, setCollectionDialog] = useState<{ projectId: string; ownerId: string; annotationId: string } | null>(null);
  const [sourceJump, setSourceJump] = useState<{ conversationId: string; id: string; serial: number } | null>(null);
  const [openAnnotationId, setOpenedAnnotation] = useState<string | null>(null);
  const [openedWindows, dispatchWindow] = useReducer(annotationWindows, []);
  const [annotationAnchors] = useState(() => new AnnotationAnchors());
  const [hoveredChild, updateHoveredChild] = useState<{ id: string; ownerId: string } | null>(null);
  const setHoveredChild = useCallback((id: string, ownerId: string, hovered: boolean) => {
    updateHoveredChild(previous => hovered ? { id, ownerId } : previous?.id === id ? null : previous);
  }, []);
  const { windowOrder, childWindows } = useMemo(() => {
    const windowOrder = new Map<string, number>(), childWindows = new Map<string, ChildAnnotationWindow[]>();
    openedWindows.forEach((window, index) => {
      windowOrder.set(window.id, index + 1);
      if (window.kind !== 'child') return;
      const siblings = childWindows.get(window.parentId) ?? [];
      siblings.push(window);
      childWindows.set(window.parentId, siblings);
    });
    childWindows.forEach(siblings => siblings.sort((a, b) => a.key.localeCompare(b.key)));
    return { windowOrder, childWindows };
  }, [openedWindows]);
  const [subAnnotationStreams] = useState(() => new SubAnnotationStreams());
  const lastOpenedSlots = useRef(new Map<string, string>());
  const closeAnnotationWindows = useCallback((ids: readonly string[]) => {
    if (!ids.length) return;
    dispatchWindow({ type: 'close', ids });
    setOpenedAnnotation(previous => previous && ids.includes(previous) ? null : previous);
  }, []);
  const setOpenAnnotationId = useCallback((id: string | null) => {
    if (id) for (const owner of current.current?.conversations ?? []) {
      const annotation = owner.annotations.find(item => item.id === id);
      if (!annotation) continue;
      if (!annotation.figure) {
        const groupId = annotationGroupId(annotation);
        lastOpenedSlots.current.set(groupId, id);
        dispatchWindow({ type: 'open-parent', id, groupId });
      }
      break;
    }
    setOpenedAnnotation(id);
    if (id === null) dispatchWindow({ type: 'clear' });
  }, [current]);
  const [notice, setNotice] = useState('');
  const [mainBusyId, setMainBusyId] = useState<string | null>(null);
  const [chatResearchRun, setChatResearchRun] = useState<ChatResearchRun | null>(null);
  const [modelSwitchBusy, setModelSwitchBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileProgress, setFileProgress] = useState<{ page: number; total: number; downloading?: boolean } | null>(null);
  const fileController = useRef<AbortController | null>(null);
  const [view, setView] = useState<WorkspaceView>({ kind: 'home' });
  const [projectPreviews, setProjectPreviews] = useState<ProjectPreviews>(() => new Map());
  const workspaceOpen = view.kind === 'workspace';
  const readerFocused = view.kind === 'reading';
  const pane = view.kind === 'home' ? undefined : view.pane;
  const drawerOpen = sidebar.drawerOpen && compactSidebar && workspaceOpen;
  const sidebarVisible = workspaceOpen && (compactSidebar ? drawerOpen : sidebar.dockedOpen);
  const closeSidebar = useCallback(() => {
    const flag = compactSidebar ? 'drawerOpen' : 'dockedOpen';
    setSidebar(previous => ({ ...previous, [flag]: false }));
    requestAnimationFrame(() => sidebarMenuButton.current?.focus({ preventScroll: true }));
  }, [compactSidebar]);
  function openSidebar() {
    const flag = window.matchMedia(SIDEBAR_DRAWER_QUERY).matches ? 'drawerOpen' : 'dockedOpen';
    setSidebar(previous => ({ ...previous, [flag]: true }));
  }
  useEffect(() => {
    if (!drawerOpen) return;
    sidebarCloseButton.current?.focus({ preventScroll: true });
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      closeSidebar();
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [drawerOpen, closeSidebar]);
  const [lastReader, setLastReader] = useState<ReaderSession | null>(loadReaderSession);
  const [chatTextReference, setChatTextReference] = useState<ChatTextReference | null>(null);
  const library = useLocalLibrary(workspace);
  const readerInput = useRef<HTMLInputElement>(null);
  const startupReaderRestored = useRef(false);
  const fileOperation = useRef(false);
  const mainRequest = useRef<Busy | null>(null);
  const annotationRequests = useRef(new Map<string, AbortController>());
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<ProjectFileTarget | undefined>(undefined);
  const notify = useCallback((text: string) => setNotice(text), []);
  useEffect(() => {
    let mounted = true;
    getSettings().then(value => {
      if (mounted) { setSettings(value); setApiSetupOpen(shouldRemindAboutApi(value)); }
    }).catch(() => { if (mounted) notify('模型服务暂未连接，请重新启动客户端。'); });
    return () => { mounted = false; };
  }, [notify]);
  useEffect(() => desktop()?.onPrepareClose(async () => {
    const attempt = ++closeAttempt.current;
    closingRef.current = true; setClosing(true);
    try {
      document.dispatchEvent(new Event('learn:close-translations'));
      setSummaryDialog(null);
      setWebSearchOpen(false);
      fileController.current?.abort();
      inquiryRequest.current?.abort();
      mainRequest.current?.controller.abort();
      for (const controller of annotationRequests.current.values()) controller.abort();
      // File parsing and aborted streams must settle before taking the last snapshot.
      while (fileOperation.current || inquiryRequest.current || mainRequest.current || annotationRequests.current.size) {
        if (attempt !== closeAttempt.current) throw new Error('退出已取消。');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      // Commits must settle before flushing a still-open annotation editor.
      document.dispatchEvent(new Event('learn:save-edits'));
      await wikiFlush.current?.();
      await flush(); await checkpoint();
    } finally { if (attempt === closeAttempt.current) { closingRef.current = false; setClosing(false); } }
  }, () => { closeAttempt.current++; closingRef.current = false; setClosing(false); }), [flush, checkpoint]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timeout);
  }, [notice]);

  const active = workspace && ((pane?.kind === 'chat' && findConversation(workspace, pane.conversationId)) || findConversation(workspace, workspace.activeConversationId));
  const activeProject = workspace && active ? projectFor(workspace, active) : undefined;
  const availableChat = useMemo(() => active ? projectResources(active, activeProject, workspace || undefined) : undefined, [active, activeProject, workspace?.conversations]);
  const conversationIds = workspace && JSON.stringify(workspace.conversations.map(c => c.id));
  useEffect(() => { if (conversationIds) pruneChatPositions(JSON.parse(conversationIds)); }, [conversationIds]);
  const previewScope = workspace && pane ? panePreviewScope(workspace, pane) : undefined;
  const panelDocuments = useMemo(() => workspace && previewScope ? previewDocuments(workspace, previewScope) : [],
    [workspace?.conversations, previewScope]);
  const storedPreview = previewScope ? projectPreviews.get(previewScope) : undefined;
  const preview = retainPreviewTabs(storedPreview, panelDocuments);
  useEffect(() => {
    if (previewScope && storedPreview !== preview) setProjectPreviews(previous => previous.get(previewScope) === storedPreview
      ? setProjectPreview(previous, previewScope, preview) : previous);
  }, [previewScope, storedPreview, preview]);
  const documentView = view.kind === 'reading' ? view.document : preview?.active;
  const readerOwner = workspace && documentView ? findConversation(workspace, documentView.ownerId) : undefined;
  const openDocument = readerOwner?.documents?.find(file => file.id === documentView?.documentId);
  const readerProject = workspace && readerOwner ? projectFor(workspace, readerOwner) : undefined;
  const overviewProject = workspace && pane?.kind === 'overview' ? findConversation(workspace, pane.projectId) : undefined;
  const overviewThreads = useMemo(() => overviewProject && workspace ? projectThreads(workspace.conversations, overviewProject.id) : [], [workspace?.conversations, overviewProject?.id]);
  const overviewDocuments = useMemo(() => overviewProject ? projectDocuments(overviewProject, overviewThreads) : [], [overviewProject, overviewThreads]);
  const readerSplit = workspaceOpen && !!openDocument;
  const chatVisible = workspaceOpen && pane?.kind === 'chat';
  const drawerVisible = drawerOpen;
  const projectInView = view.kind === 'home' ? undefined : overviewProject || activeProject;
  const latestDocumentReference = useMemo(() => {
    if (!chatVisible || !active) return undefined;
    for (let index = active.messages.length - 1; index >= 0; index--) {
      const message = active.messages[index];
      if (message.role === 'user' && message.documentReference) return message.documentReference;
    }
  }, [active?.messages, chatVisible]);
  const availableFiles = availableChat?.documents;
  const recentFileId = library.recentlyOpened.find(id => availableFiles?.some(file => file.id === id));
  const reopenDocument = availableFiles?.find(file => latestDocumentReference?.ids.includes(file.id))
    ?? availableFiles?.find(file => file.id === recentFileId)
    ?? availableFiles?.find(file => file.id === lastReader?.documentId)
    ?? availableFiles?.find(file => file.kind === 'pdf') ?? availableFiles?.[0];
  useEffect(() => {
    if (projectInView) setExpandedProjects(previous => previous.has(projectInView.id) ? previous : new Set([...previous, projectInView.id]));
  }, [projectInView?.id]);
  useEffect(() => { if (chatTextReference && (!availableChat || !hasChatTextSource(availableChat, chatTextReference))) setChatTextReference(null); }, [availableChat, chatTextReference]);
  const activeFileGroups = useMemo(() => [activeProject, active].flatMap(owner => owner ? conversationFileGroups(library.groups, owner) : []), [library.groups, activeProject, active]);
  const readerAnnotations = useMemo(() => {
    if (!readerOwner || !openDocument) return [];
    const equivalents = library.groups.find(group => group.references.some(ref => ref.document.id === openDocument.id))
      ?.references.filter(ref => ref.conversationId === readerOwner.id).map(ref => ref.document) || [openDocument];
    return projectFileAnnotations(openDocument, equivalents, readerOwner.annotations.filter(a => a.deletedAt === undefined));
  }, [readerOwner, openDocument, library.groups]);
  useEffect(() => {
    if (!workspace || startupReaderRestored.current) return;
    startupReaderRestored.current = true;
    const { view: restored, preview: restoredDocument } = restoreReaderView(workspace, loadReaderSession());
    if (restored.kind !== 'home' && restored.pane.kind === 'chat') {
      const conversationId = restored.pane.conversationId;
      if (workspace.activeConversationId !== conversationId) update(w => ({ ...w, activeConversationId: conversationId }));
    }
    if (restored.kind !== 'home' && restoredDocument) {
      const scope = panePreviewScope(workspace, restored.pane);
      if (scope) setProjectPreviews(previous => setProjectPreview(previous, scope, openPreviewTab(undefined, restoredDocument)));
    }
    setView(restored);
  }, [workspace, update]);
  const currentReaderSession = useMemo<ReaderSession | undefined>(() => {
    if (view.kind === 'home' || !openDocument || !readerOwner) return;
    return {
      conversationId: view.pane.kind === 'chat' ? view.pane.conversationId : readerOwner.id,
      documentId: openDocument.id, mode: view.kind === 'reading' ? 'focused' : 'split',
      projectId: view.pane.kind === 'overview' ? view.pane.projectId : readerProject?.id,
      workspacePane: view.pane.kind,
      ...(view.kind === 'reading' && preview?.active.documentId === openDocument.id ? { returnWithPreview: true } : {}),
    };
  }, [view, openDocument?.id, readerOwner?.id, readerProject?.id, preview?.active.documentId]);
  useEffect(() => {
    if (!currentReaderSession) return;
    setLastReader(currentReaderSession); saveReaderSession(currentReaderSession);
  }, [currentReaderSession]);
  function openReaderReference(ref: LocalDocumentReference, mode: 'focused' | 'split' = 'focused', returnPane?: WorkspacePane) {
    const snapshot = current.current;
    if (!snapshot) return;
    const owner = findConversation(snapshot, ref.conversationId);
    if (!owner?.documents?.some(d => d.id === ref.document.id)) return;
    document.dispatchEvent(new Event('learn:save-edits'));
    const project = projectFor(snapshot, owner);
    const target: WorkspacePane = returnPane || (project ? { kind: 'overview', projectId: project.id } : { kind: 'chat', conversationId: owner.id });
    const scope = panePreviewScope(snapshot, target);
    if (mode === 'split' && (!scope || scope !== conversationPreviewScope(snapshot, owner))) return;
    if (target.kind === 'chat' && snapshot.activeConversationId !== target.conversationId) {
      update(w => ({ ...w, activeConversationId: target.conversationId }));
    }
    const opened = { ownerId: owner.id, documentId: ref.document.id };
    if (mode === 'focused' || documentView?.documentId !== opened.documentId) {
      setOpenAnnotationId(null); setReaderPageJump(null);
    }
    if (mode === 'split' && scope) {
      setProjectPreviews(previous => setProjectPreview(previous, scope, openPreviewTab(previous.get(scope), opened)));
      setView({ kind: 'workspace', pane: target });
    } else {
      setSidebarOpen(false);
      setView({ kind: 'reading', pane: target, document: opened });
    }
    library.recordOpen(ref.document.id);
  }
  function openLibraryDocument(group: LocalDocumentGroup, preferred?: LocalDocumentReference) {
    const snapshot = current.current;
    if (fileOperation.current || !snapshot) return;
    const count = fileAnnotationCounter(snapshot.conversations);
    const ref = preferred || preferProjectFiles(snapshot, [...group.references].sort((a, b) => count([b]) - count([a])))[0];
    if (ref) openReaderReference(ref);
  }
  function openKnowledge() {
    setSidebarOpen(false);
    setKnowledgeOpen(true);
  }
  function openWiki() { showWiki(); }
  function showWiki(material?: ReferenceItem) {
    if (!wikiRepository || fileOperation.current || closingRef.current) return;
    document.dispatchEvent(new Event('learn:save-edits'));
    // An open annotation can be on an earlier page than the saved reading position.
    if (readerFocused) setOpenAnnotationId(null);
    setSidebarOpen(false);
    setWikiMaterial(material);
    setWikiOpen(true);
  }
  function openWikiSource(citation: SourceCitation) {
    const snapshot = current.current;
    if (!snapshot || fileOperation.current || closingRef.current || !hasWikiSource(snapshot, knowledge.cards, citation)) return false;
    const { locator, refId } = citation;
    if (locator.url) {
      const url = researchLink(locator.url);
      if (!url) return false;
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    const openAnnotation = (note: Annotation | undefined) => {
      if (!note) return;
      setOpenAnnotationId(note.id);
      if (!locator.subAnnotationId) return;
      let parentId = note.id;
      for (const child of subAnnotationPath(note.subAnnotations ?? [], locator.subAnnotationId)) {
        dispatchWindow({ type: 'open-child', ownerId: note.id, parentId, id: child.id });
        parentId = child.id;
      }
    };
    if (locator.documentId) {
      const ref = localDocumentReferences(snapshot).find(item => item.document.id === locator.documentId);
      if (!ref || locator.page !== undefined && !ref.document.pages.some(page => page.pageNumber === locator.page)) return false;
      const owner = findConversation(snapshot, ref.conversationId);
      const annotation = owner?.annotations.find(note => note.id === locator.annotationId && note.deletedAt === undefined);
      const pageIndex=ref.document.pages.findIndex(p=>p.pageNumber===locator.page);
      const page=ref.document.pages[pageIndex];
      if (locator.versionId && page?.versionId!==locator.versionId) return false;
      let sourceHit;
      if (page && locator.quote && !annotation && !locator.bbox) {
        const result=searchDocument(buildDocumentSearch(ref.document.pages),locator.quote,Math.max(2,(locator.start??0)+2),pageIndex,pageIndex+1);
        const hit=locator.start!==undefined ? result.hits.find(h=>h.start===locator.start) : result.count===1 ? result.hits[0] : undefined;
        if (hit) sourceHit={hit,query:locator.quote};
        else if (locator.start!==undefined) return false;
      }
      openReaderReference(ref);
      if (locator.page !== undefined) setReaderPageJump({
        documentId: ref.document.id, pageNumber: locator.page, annotationId: annotation?.id, bbox: locator.bbox, sourceHit,
      });
      openAnnotation(annotation);
      setWikiOpen(false);
      return true;
    }
    const owner = locator.conversationId && findConversation(snapshot, locator.conversationId);
    if (!owner) {
      let parts;
      try { parts=JSON.parse(refId); } catch { return false; }
      const card=Array.isArray(parts) && parts[0]==='card' && knowledge.cards.find(item=>item.id===parts[1]);
      if (!card) return false;
      setWikiOpen(false);setKnowledgeDraft(card);return true;
    }
    if (owner.isProject) openProject(owner.id);
    else {
      const message = locator.messageId && owner.messages.find(item => item.id === locator.messageId);
      if (locator.messageId && !message) return false;
      if (message && locator.versionId && !message.versions.some(v=>v.id===locator.versionId)) return false;
      if (message && locator.versionId && message.activeVersionId!==locator.versionId) setVersion(owner.id,message.id,locator.versionId);
      if (message) openSourceTurn(owner.id, [message.id]);
      else showChat(owner);
      openAnnotation(owner.annotations.find(note => note.id === locator.annotationId && note.deletedAt === undefined));
    }
    setWikiOpen(false);
    return true;
  }
  async function openKnowledgeSource(source: KnowledgeSource, projectId?: string) {
    const snapshot = current.current;
    if (!snapshot || fileOperation.current || closingRef.current) return false;
    const ref = await findKnowledgeDocument(source, localDocumentReferences(snapshot), file => library.index.fingerprint(file, getDocumentBytes));
    if (!ref || (source.page !== undefined && !ref.document.pages.some(page => page.pageNumber === source.page))) return false;
    const latest = current.current;
    if (!latest || fileOperation.current || closingRef.current || !findConversation(latest, ref.conversationId)?.documents?.some(file => file.id === ref.document.id)) return false;
    openReaderReference(ref, 'focused', projectId ? { kind: 'overview', projectId } : undefined);
    setReaderPageJump(source.page === undefined ? null : { documentId: ref.document.id, pageNumber: source.page });
    return true;
  }
  function saveAnswerToKnowledge(messageId: string, versionId: string) {
    const snapshot = current.current;
    const conversation = snapshot && findConversation(snapshot, snapshot.activeConversationId);
    if (!snapshot || !conversation || closingRef.current) return;
    const available = projectResources(conversation, projectFor(snapshot, conversation), snapshot);
    const draft = knowledgeFromAnswer(available, messageId, versionId, openDocument ? readerLocation.current : undefined);
    if (draft) setKnowledgeDraft({ ...draft, ...(conversation.projectId ? { projectId: conversation.projectId } : {}) });
  }
  function saveAnnotationToKnowledge(annotation: Annotation, childId?: string) {
    const snapshot = current.current;
    const owner = snapshot && findConversation(snapshot, annotation.conversationId);
    const saved = owner?.annotations.find(item => item.id === annotation.id);
    if (!snapshot || !owner || !saved || closingRef.current) return;
    const draft = knowledgeFromAnnotation(projectResources(owner, projectFor(snapshot, owner)), saved, childId);
    if (draft) {
      const project = readerProject?.isProject ? readerProject : projectFor(snapshot, owner);
      setKnowledgeDraft({ ...draft, ...(project ? { projectId: project.id } : {}) });
    }
  }
  function chooseReaderFile() {
    if (fileOperation.current || mainRequest.current || annotationRequests.current.size) { notify('请等当前文件或回答完成后再打开。'); return; }
    readerInput.current?.click();
  }
  function clearReaderDocument() {
    if (currentReaderSession) {
      const next: ReaderSession = { ...currentReaderSession, mode: 'closed' };
      setLastReader(next); saveReaderSession(next);
    }
    setOpenAnnotationId(null); setReaderPageJump(null);
  }
  function closeReader() {
    if (view.kind === 'home') return;
    document.dispatchEvent(new Event('learn:save-edits'));
    if (view.kind === 'workspace' && previewScope) {
      setProjectPreviews(previous => setProjectPreview(previous, previewScope, undefined));
    }
    if (view.kind === 'workspace' || !preview) clearReaderDocument();
    else if (view.document.documentId !== preview.active.documentId) {
      setOpenAnnotationId(null); setReaderPageJump(null);
    }
    setView({ kind: 'workspace', pane: view.pane });
  }
  function closeDocumentTab(documentId: string) {
    if (!readerSplit || !previewScope || !preview || fileOperation.current || closingRef.current) return;
    const next = closePreviewTab(preview, documentId);
    if (!next) { closeReader(); return; }
    if (next.active !== preview.active) {
      document.dispatchEvent(new Event('learn:save-edits'));
      setOpenAnnotationId(null); setReaderPageJump(null);
      library.recordOpen(next.active.documentId);
    }
    setProjectPreviews(previous => setProjectPreview(previous, previewScope, next));
  }
  function showHome() {
    document.dispatchEvent(new Event('learn:save-edits'));
    clearReaderDocument();
    setView({ kind: 'home' }); setSidebarOpen(false);
  }
  function expandReader(mode: 'focused' | 'split' = 'split') {
    if (fileOperation.current) return;
    if (mode === 'focused' && view.kind === 'workspace' && documentView && openDocument) {
      document.dispatchEvent(new Event('learn:save-edits'));
      setView({ kind: 'reading', pane: view.pane, document: documentView });
    } else if (active && reopenDocument) openChatDocument(reopenDocument.id, mode);
  }
  function openChatDocument(id: string, mode: 'focused' | 'split' = 'split') {
    if (fileOperation.current || closingRef.current) return;
    const ref = panelDocuments.find(item => item.document.id === id);
    if (ref && active) openReaderReference(ref, mode, { kind: 'chat', conversationId: active.id });
  }
  function chatForDocumentOwner(snapshot: Workspace, owner: Conversation) {
    const project = projectFor(snapshot, owner);
    if (!project) return owner;
    const currentChat = findConversation(snapshot, snapshot.activeConversationId);
    const chat = currentChat?.projectId === project.id ? currentChat : !owner.isProject ? owner : projectThreads(snapshot.conversations, project.id)[0];
    if (chat) return chat;
    const created = { ...createConversation(t('新对话')), projectId: project.id };
    update(w => createProjectChat(w, project.id, created));
    return created;
  }
  function toggleReaderFocus() {
    if (fileOperation.current || closingRef.current) return;
    if (!readerFocused) { expandReader('focused'); return; }
    const snapshot = current.current;
    if (!snapshot || !readerOwner) return;
    try {
      document.dispatchEvent(new Event('learn:save-edits'));
      showChat(chatForDocumentOwner(snapshot, readerOwner), true);
    } catch (error) { notify(errorText(error)); }
  }
  function quoteText(selection: ChatTextSelection) {
    if (closingRef.current || fileOperation.current) return;
    const snapshot = current.current;
    if (!snapshot) return;
    const source = findConversation(snapshot, selection.conversationId);
    if (!source) return;
    try {
      const owner = source.isProject || openDocument?.pages.some(page => page.messageId === selection.messageId)
        ? chatForDocumentOwner(snapshot, source) : source;
      const reference = captureChatTextReference(projectResources(owner, projectFor(snapshot, owner), snapshot), { ...selection, conversationId: owner.id });
      showChat(owner, true);
      setChatTextReference(reference);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus({ preventScroll: true }));
    } catch (error) { notify(errorText(error)); }
  }
  const deleted = useMemo(() => workspace && recycleBin(workspace), [workspace?.conversations]);
  const latestDeleted = deleted?.annotations[0];
  const mutateConversation = useCallback((id: string, change: (c: Conversation) => Conversation) => {
    update(previous => updateConversation(previous, id, change));
  }, [update]);
  function ensureModelIdle() {
    if (mainRequest.current || annotationRequests.current.size || inquiryRequest.current) throw new Error('请等当前回答或资料检索完成后，再修改或切换模型。');
  }
  async function chooseModel(profileId: string | null) {
    ensureModelIdle();
    setModelSwitchBusy(true);
    try { const next = await selectProfile(profileId); setSettings(next); notify(profileId ? '已切换模型，后续问题会使用这份配置。' : '已切换到演示模式。'); }
    finally { setModelSwitchBusy(false); }
  }
  async function storeProfile(value: ProfileInput) {
    ensureModelIdle();
    const next = await saveProfile(value);
    setSettings(next); notify('模型配置已保存。');
  }
  async function storeTranslationProfile(value: ProfileInput) {
    ensureModelIdle();
    const next = await saveProfile({ ...value, activate: false });
    setSettings(next); notify('共享 API 连接已保存。');
    return next;
  }
  async function removeProfile(id: string) {
    ensureModelIdle();
    const next = await deleteProfile(id);
    setSettings(next); notify('已删除模型配置，聊天记录继续保留。');
  }
  function showChat(selected: Conversation, keepReader = false) {
    const snapshot = current.current;
    const scope = snapshot && conversationPreviewScope(snapshot, selected);
    const preserve = documentView && readerOwner && snapshot && (workspaceOpen || keepReader)
      && conversationPreviewScope(snapshot, readerOwner) === scope;
    if (current.current?.activeConversationId !== selected.id) update(w => ({ ...w, activeConversationId: selected.id }));
    setSourceJump(null);
    if (preserve && keepReader && scope && documentView) {
      setProjectPreviews(previous => setProjectPreview(previous, scope, openPreviewTab(previous.get(scope), documentView)));
    } else if (!preserve) clearReaderDocument();
    if (preserve && (pane?.kind !== 'chat' || pane.conversationId !== selected.id)) {
      const pages = new Set(openDocument?.pages.map(page => page.messageId));
      const retained = new Set(readerAnnotations.filter(annotation => pages.has(annotation.messageId)).map(annotation => annotation.id));
      closeAnnotationWindows(openedWindows.filter(window => window.kind === 'parent' && !retained.has(window.id)).map(window => window.id));
    }
    if (!preserve) setSidebarOpen(false);
    setView({ kind: 'workspace', pane: { kind: 'chat', conversationId: selected.id } });
  }
  function selectConversation(id: string, keepReader = false) {
    if (fileOperation.current || closingRef.current) return;
    const selected = current.current && findConversation(current.current, id);
    if (!selected || selected.isProject) return;
    document.dispatchEvent(new Event('learn:save-edits'));
    showChat(selected, keepReader);
  }
  function openProject(projectId: string, keepDrawer = false) {
    const snapshot = current.current;
    if (!snapshot || fileOperation.current || closingRef.current || !findConversation(snapshot, projectId)?.isProject) return;
    document.dispatchEvent(new Event('learn:save-edits'));
    const samePreview = workspaceOpen && previewScope === projectId && preview;
    if (!samePreview) clearReaderDocument();
    setExpandedProjects(previous => previous.has(projectId) ? previous : new Set([...previous, projectId]));
    setView({ kind: 'workspace', pane: { kind: 'overview', projectId } });
    if (!keepDrawer && !samePreview) setSidebarOpen(false);
  }
  function toggleProject(projectId: string) {
    const wasExpanded = expandedProjects.has(projectId);
    if (!wasExpanded && projectInView?.id !== projectId) { openProject(projectId, true); return; }
    setExpandedProjects(previous => {
      const next = new Set(previous);
      if (wasExpanded) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }
  function openChatList() {
    const snapshot = current.current;
    if (!snapshot || fileOperation.current) return;
    const standalone = snapshot.conversations.filter(item => !item.isProject && !item.projectId && item.deletedAt === undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const chat = standalone.find(item => item.id === snapshot.activeConversationId) || standalone[0];
    if (chat) selectConversation(chat.id);
    else newConversation();
    setSidebarOpen(compactSidebar);
  }
  function newConversation(projectId?: string, title = t('新对话')) {
    if (fileOperation.current || closingRef.current) return;
    const conversation = { ...createConversation(title), ...(projectId ? { projectId } : {}) };
    document.dispatchEvent(new Event('learn:save-edits'));
    try { update(w => projectId ? createProjectChat(w, projectId, conversation) : { ...w, conversations: [conversation, ...w.conversations], activeConversationId: conversation.id }); }
    catch (error) { notify(errorText(error)); return; }
    showChat(conversation);
    return conversation;
  }
  function updateInquiry(projectId: string, change: (previous: Inquiry) => Inquiry) {
    mutateConversation(projectId, project => ({ ...project, inquiry: change(project.inquiry || {}), updatedAt: Date.now() }));
  }
  async function runInquiry(projectId: string, task: 'search' | 'guide', focus?: string, reply?: InquiryReplyTarget, retry?: WebResearchRetry) {
    const snapshot = current.current;
    const project = snapshot && findConversation(snapshot, projectId);
    if (!snapshot || closingRef.current || inquiryRequest.current || fileOperation.current || !project?.isProject) return;
    const question = reply?.question || project.inquiry?.question || focus?.trim();
    if (!question || question.length > INQUIRY_QUESTION_LIMIT) return;
    const saved = project.inquiry?.sources ?? [];
    const capacity = INQUIRY_SOURCE_LIMIT - saved.length;
    if (task === 'search' && !capacity) {
      setInquiryRun({ projectId, message: '项目资料地图已达到收录上限。' });
      return;
    }
    const controller = new AbortController();
    inquiryRequest.current = controller;
    try {
      if (!project.inquiry?.question) updateInquiry(projectId, inquiry => ({ ...inquiry, question }));
      const options: Parameters<typeof researchInquiry>[0] = {
        question, focus: reply ? undefined : project.inquiry?.question ? focus : undefined, settings, locale, signal: controller.signal,
        onStep: step => setInquiryRun({ projectId, step }),
        verifiedSources: saved.filter(source => project.inquiry?.proofSourceIds?.includes(source.id)),
      };
      const result = task === 'guide' ? await briefInquiry(options, reply?.savedSources ?? [])
        : await researchInquiry(options, 'project', saved, capacity, retry);
      let added = 0;
      if (result.sources.length || reply) {
        await flush();
        controller.signal.throwIfAborted();
        update(w => {
          const owner = findConversation(w, projectId);
          if (!owner?.isProject) return w;
          const previous = owner.inquiry ?? {};
          const { inquiry, sourceIds: researchSourceIds, added: newCount } = task === 'search'
            ? appendInquirySearch(previous, result.sources, result.overview, result.proofSearch)
            : { inquiry: previous, sourceIds: result.sources.map(source => source.id).filter(id => previous.sources?.some(source => source.id === id)), added: 0 };
          added = newCount;
          const next = added
            ? updateConversation(w, projectId, project => ({ ...project, inquiry, updatedAt: Date.now() })) : w;
          if (!reply) return next;
          return updateConversation(next, reply.conversationId, chat => {
            if (chat.deletedAt !== undefined || chat.projectId !== projectId) return chat;
            const answerIndex = chat.messages.findIndex(message => message.id === reply.messageId && message.activeVersionId === reply.versionId);
            if (answerIndex < 1) return chat;
            const answered = patchVersion(chat, reply.messageId, reply.versionId, {
              content: task === 'guide' && !result.sources.length ? t('项目还没有可用于导读的资料。可以在资料与概览中发起检索。') : inquiryReplyText(result, locale),
              status: 'complete', modelLabel: result.modelLabel || '资料简报',
            });
            const user = answered.messages[answerIndex - 1];
            if (user.role === 'user') answered.messages[answerIndex - 1] = { ...user, researchSourceIds: researchSourceIds.length ? researchSourceIds : undefined };
            return answered;
          });
        });
      }
      setInquiryRun({
        projectId, issues: result.issues,
        configureWebSearch: Boolean(webSearchIssue(result.issues) || result.targetMiss?.academicOnly || result.proofSearch && !result.sources.length && result.academicOnly),
        retry: result.retryWeb ? { plan: result.retryWeb, focus, reply: result.sources.length ? undefined : reply } : undefined,
        message: result.broadened ? '可靠的直接资料较少，已补充可查阅的背景或讨论。'
          : result.matchedSaved ? '这一轮没有找到新的资料。'
          : result.proofSearch && !result.sources.length
          ? inquiryIntroduction(result, locale) + (project.inquiry?.proofSourceIds?.length ? ' ' + t('下方显示此前核验的资料。') : '')
          : result.targetMiss ? inquiryIntroduction(result, locale) : reply ? undefined : !added
          ? !result.sources.length && result.issues.length ? '这次未取得资料。可以稍后重试或补充检索词。' : '这一轮没有找到新的资料。'
          : !result.modelLabel ? '已找到资料，可以先查看摘要或网页摘录。' : undefined,
      });
    } catch (error) {
      const message = controller.signal.aborted ? '已取消检索。' : errorText(error);
      setInquiryRun({ projectId, message: reply ? undefined : message });
      if (reply) {
        await flush().catch(() => {});
        try {
          mutateConversation(reply.conversationId, chat => patchVersion(chat, reply.messageId, reply.versionId, {
            status: controller.signal.aborted ? 'interrupted' : 'error', error: message, modelLabel: '资料简报',
          }));
        } catch (failure) { notify(errorText(failure)); }
      }
    } finally { inquiryRequest.current = null; }
  }
  function exploreQuestion({ question, pane: destination }: HomeQuestionAction) {
    if (inquiryRequest.current || fileOperation.current || mainRequest.current || closingRef.current) return false;
    if (destination === 'chat') {
      const chat = newConversation(undefined, question.slice(0, 25));
      if (chat) void sendMain(chat.id, question);
      return Boolean(chat);
    }
    const messages = inquiryTurn(question);
    const project = { ...createProject(question.slice(0, 80)), inquiry: { question } };
    const chat = { ...createConversation(question.slice(0, 25)), projectId: project.id, messages };
    document.dispatchEvent(new Event('learn:save-edits'));
    try { update(w => createProjectChat({ ...w, conversations: [project, ...w.conversations] }, project.id, chat)); }
    catch (error) { notify(errorText(error)); return false; }
    setChatTextReference(null); setChatAnnotationRequest(null);
    openProject(project.id);
    const intro = messages[1];
    void runInquiry(project.id, 'search', undefined, { conversationId: chat.id, messageId: intro.id, versionId: intro.activeVersionId, question });
    return true;
  }
  function startSavedInquiry(project: Conversation) {
    const snapshot = current.current;
    const question = project.inquiry?.question;
    if (!snapshot || !question || inquiryRequest.current || fileOperation.current || mainRequest.current || closingRef.current) return;
    const previous = projectThreads(snapshot.conversations, project.id).find(chat => !chat.messages.length && !chat.collectedHistory);
    const messages = inquiryTurn(question);
    const chat = { ...(previous || createConversation()), messages, title: previous?.customTitle ? previous.title : question.slice(0, 25), updatedAt: Date.now() };
    try {
      if (previous) mutateConversation(chat.id, () => chat);
      else update(w => createProjectChat(w, project.id, chat));
    } catch (error) { notify(errorText(error)); return; }
    void runInquiry(project.id, 'guide', undefined, { conversationId: chat.id, messageId: messages[1].id, versionId: messages[1].activeVersionId, question, savedSources: inquirySources(project.inquiry).slice(0, 8) });
  }
  function setSection(value: string | undefined) {
    if (!active?.projectId || mainRequest.current || fileOperation.current || turnBusy || closingRef.current) return;
    try {
      mutateConversation(active.id, chat => {
        const next = { ...chat, updatedAt: Date.now() };
        if (value === undefined) delete next.pendingSection;
        else next.pendingSection = value.slice(0, SECTION_TITLE_LIMIT);
        return next;
      });
    } catch (error) { notify(errorText(error)); }
  }
  function renameRecord(id: string, title: string) {
    try { mutateConversation(id, item => ({ ...item, title, customTitle: true, updatedAt: Date.now() })); }
    catch (error) { notify(errorText(error)); }
  }
  function saveSourceNote(projectId: string, id: string, note: string, online: boolean) {
    try {
      updateInquiry(projectId, inquiry => {
        if (online) return { ...inquiry, sources: inquiry.sources?.map(source => {
          if (source.id !== id) return source;
          const next = { ...source };
          if (note) next.note = note;
          else delete next.note;
          return next;
        }) };
        const documentNotes = { ...inquiry.documentNotes };
        if (note) documentNotes[id] = note;
        else delete documentNotes[id];
        return { ...inquiry, documentNotes };
      });
    } catch (error) { notify(errorText(error)); }
  }
  async function applyProject(projectId: string | undefined, title: string) {
    const snapshot = current.current;
    if (!snapshot || closingRef.current || fileOperation.current || mainRequest.current || annotationRequests.current.size) throw new Error('请等文件处理和回答结束后再整理项目。');
    const sourceId = projectDialog?.conversationId;
    const project = projectId ? findConversation(snapshot, projectId) : createProject(title);
    if (!project?.isProject) throw new Error('项目已不存在。');
    const withProject = (w: Workspace) => projectId ? w : { ...w, conversations: [project, ...w.conversations] };
    document.dispatchEvent(new Event('learn:save-edits'));
    if (!sourceId) {
      update(withProject);
      openProject(project.id);
    } else {
      const source = findConversation(snapshot, sourceId);
      if (!source) throw new Error('对话不存在。');
      const candidates = (project.documents || []).map(document => ({ conversationId: project.id, document }));
      const matches = new Map<string, string>();
      fileOperation.current = true; setFileBusy(true);
      try {
        for (const file of source.documents || []) {
          const compatible = candidates.filter(ref => sameDocumentPages(file, ref.document));
          const bytes = compatible.length ? await getDocumentBytes(file.id) : undefined;
          const duplicate = bytes && await library.index.find(bytes, file.kind, compatible, getDocumentBytes);
          if (duplicate) matches.set(file.id, duplicate.document.id);
          else candidates.push({ conversationId: project.id, document: file });
        }
        await commitFileChanges(w => moveChatToProject(withProject(w), sourceId, project.id, matches));
        setProjectPreviews(previous => moveProjectPreview(previous, sourceId, project.id, tab => ({
          ownerId: project.id, documentId: matches.get(tab.documentId) ?? tab.documentId,
        })));
        if (active?.id === sourceId) {
          setChatTextReference(null);
          setOpenAnnotationId(null); setReaderPageJump(null);
        }
        library.refresh();
      } finally { fileOperation.current = false; setFileBusy(false); }
    }
    setProjectDialog(null);
  }
  function removeConversation(id: string) {
    if (fileOperation.current) return;
    const conversation = current.current?.conversations.find(c => c.id === id);
    if (mainRequest.current?.conversationId === id || conversation?.annotations.some(isAnnotationGenerating)) { notify('请等这个对话的回答完成，或停止生成后再删除。'); return; }
    try {
      const next = update(w => deleteConversation(w, id));
      if (conversation) {
        const scope = conversationPreviewScope(next, conversation);
        setProjectPreviews(previous => setProjectPreview(previous, scope, retainPreviewTabs(previous.get(scope), previewDocuments(next, scope))));
      }
      if (pane?.kind === 'chat' && pane.conversationId === id) {
        const replacement = conversation?.projectId && projectThreads(next.conversations, conversation.projectId)[0];
        if (replacement) showChat(replacement);
        else if (conversation?.projectId) openProject(conversation.projectId);
        else {
          const fallback = findConversation(next, next.activeConversationId);
          if (fallback) showChat(fallback);
        }
      } else if (view.kind === 'workspace' && documentView?.ownerId === id) {
        clearReaderDocument();
      }
      notify('对话已移入回收站，可在那里恢复或永久删除。');
    }
    catch (e) { notify(errorText(e)); }
  }
  function moveProjectsToTrash(ids: readonly string[]) {
    const targets = new Set(ids);
    if (!targets.size) return;
    if (fileOperation.current || closingRef.current || turnBusy) throw new Error('请等文件处理和回答结束后再整理项目。');
    if (inquiryRequest.current && inquiryRun && targets.has(inquiryRun.projectId)) throw new Error('请先停止项目中正在进行的检索。');
    document.dispatchEvent(new Event('learn:save-edits'));
    update(w => deleteProjects(w, ids));
    setProjectPreviews(previous => {
      const next = new Map(previous);
      for (const id of targets) next.delete(id);
      return next;
    });
    setExpandedProjects(previous => new Set([...previous].filter(id => !targets.has(id))));
    if (projectInView && targets.has(projectInView.id)) {
      clearReaderDocument();
      setSidebarOpen(false);
      setView({ kind: 'home' });
    } else if (readerProject && targets.has(readerProject.id) && view.kind !== 'home') {
      clearReaderDocument();
      setView({ kind: 'workspace', pane: view.pane });
    }
    notify(targets.size === 1 ? '项目已移入回收站，可在那里恢复。' : t('已将 {0} 个项目移到回收站。', [targets.size]));
  }
  function removeProject(id: string) {
    try { moveProjectsToTrash([id]); }
    catch (error) { notify(errorText(error)); }
  }
  async function runMain(conversationId: string, messageId: string, versionId: string, messages: InputMessage[], variant = 0,
    search?: { mode: Exclude<ChatSearchMode, 'local'>; question: string }) {
    const controller = new AbortController();
    mainRequest.current = { conversationId, messageId, versionId, controller };
    setMainBusyId(conversationId);
    let content = '';
    let webResearch: ReplyResearch | undefined;
    let modelMessages = messages;
    let searching = Boolean(search);
    try {
      if (search) {
        const onStep = (step: SearchStep) => setChatResearchRun({ conversationId, messageId, versionId, mode: search.mode, step });
        onStep('searching');
        if (search.mode === 'papers') {
          const result = await researchInquiry({ question: search.question, settings, locale, signal: controller.signal, onStep }, 'papers');
          controller.signal.throwIfAborted();
          const research = result.sources.length ? { kind: 'papers' as const, sources: result.sources } : undefined;
          mutateConversation(conversationId, chat => patchVersion(chat, messageId, versionId, {
            content: inquiryIntroduction(result, locale), status: 'complete', modelLabel: result.modelLabel || '资料简报', research, context: undefined,
          }));
          return;
        }
        let sources: InquirySource[] = [];
        try { sources = await lookupWeb(search.question, controller.signal); }
        catch { controller.signal.throwIfAborted(); }
        controller.signal.throwIfAborted();
        if (sources.length) {
          webResearch = { kind: 'web', citations: sources.map(source => ({ title: source.title, url: source.webUrl })) };
          modelMessages = withResearchEvidence(messages, sources, 'web');
        } else notify('本轮未取得网页资料，按常规方式回答。可检查网页检索设置。');
        searching = false;
        setChatResearchRun(null);
      }
      mutateConversation(conversationId, c => patchVersion(c, messageId, versionId, { modelLabel: settings.mode === 'demo' ? '本地演示' : settings.model }));
      const result = await streamReply({ messages: modelMessages, kind: 'main', variant, ...(settings.activeProfileId ? { profileId: settings.activeProfileId } : settings.mode === 'demo' ? { profileId: null } : {}) }, delta => {
        const next = content + delta;
        mutateConversation(conversationId, c => patchVersion(c, messageId, versionId, { content: next }));
        content = next;
      }, controller.signal);
      if (!content.trim()) throw new Error('模型返回了空回答，请重试。');
      mutateConversation(conversationId, c => patchVersion(c, messageId, versionId, {
        content, status: 'complete', modelLabel: result.modelLabel, context: undefined, ...(webResearch ? { research: webResearch } : {}),
      }));
    } catch (e) {
      const aborted = controller.signal.aborted;
      mutateConversation(conversationId, c => patchVersion(c, messageId, versionId, {
        content, status: aborted ? 'interrupted' : 'error',
        error: aborted ? searching ? '已取消检索。' : '回答已停止，可以继续发送新问题或重新生成。' : errorText(e),
      }));
      if (!aborted) notify(errorText(e));
    } finally {
      mainRequest.current = null; setMainBusyId(null); setChatResearchRun(null);
    }
  }
  async function sendMain(conversationId: string, question: string, annotationIds: string[] = [], textReference?: ChatTextReference, documentIds: string[] = [], useHistory = false, knowledgeIds: string[] = [], researchIds: string[] = [], mode: ChatSearchMode = 'local'): Promise<boolean> {
    if (closingRef.current) return false;
    if (fileOperation.current) { notify('请等文件处理完成后再发送。'); return false; }
    if (mainRequest.current) { notify('请先等待当前回答完成，或停止生成。'); return false; }
    const snapshot = current.current;
    const conversation = snapshot && findConversation(snapshot, conversationId);
    if (!snapshot || !conversation || conversation.isProject || !question.trim()) return false;
    if (conversation.messages.some(message => message.inquiryIntro && activeVersion(message).status === 'streaming')) return false;
    let accepted = false;
    try {
      const user = createUserMessage(question.trim());
      const project = projectFor(snapshot, conversation);
      const available = projectResources(conversation, project, snapshot);
      const references = captureAnnotationReferences(available, annotationIds);
      if (references.length) user.annotationReferences = references;
      if (textReference) user.textReference = captureChatTextReference(available, textReference);
      if (conversation.projectId || documentIds.length) user.documentReference = chooseDocuments(available, documentIds, contextMode === 'auto' ? 'relevant' : contextMode);
      if (researchIds.length) user.researchSourceIds = chooseResearchSources(project, researchIds).map(source => source.id);
      if (useHistory && conversation.collectedHistory) user.useCollectedHistory = true;
      if (conversation.projectId && conversation.pendingSection !== undefined) {
        user.contextReset = true;
        if (conversation.pendingSection.trim()) user.sectionTitle = conversation.pendingSection.trim();
      }
      const base = { ...conversation, messages: [...conversation.messages, user] };
      delete base.pendingSection;
      const context = buildProjectChatContext(snapshot, base, responsePreference(settings.systemPrompt, getLocale()), { mode: contextMode, location: readerLocation.current });
      const cards = knowledgeIds.map(id => {
        const card = knowledge.cards.find(item => item.id === id);
        if (!card) throw new Error('所选知识卡片已变化，请重新选择。');
        return card;
      });
      const messages = addKnowledgeContext(context, cards);
      const assistant = createAssistantMessage();
      assistant.versions[0].context = freezeContext(messages);
      mutateConversation(conversationId, () => ({ ...base, title: conversation.messages.length === 0 && !conversation.collectedHistory && !conversation.customTitle ? question.trim().slice(0, 25) : conversation.title, updatedAt: Date.now(), messages: [...base.messages, assistant] }));
      accepted = true;
      if (textReference) setChatTextReference(previous => previous === textReference ? null : previous);
      void runMain(conversationId, assistant.id, assistant.activeVersionId, messages, 0, mode === 'local' ? undefined : { mode, question: user.versions[0].content })
        .catch(error => notify(errorText(error)));
    } catch (e) { notify(errorText(e)); }
    return accepted;
  }
  async function supplementChatPapers(conversationId: string, messageId: string, versionId: string) {
    if (closingRef.current || fileOperation.current || mainRequest.current || inquiryRequest.current) return;
    const snapshot = current.current;
    const chat = snapshot && findConversation(snapshot, conversationId);
    const position = chat?.messages.findIndex(message => message.id === messageId) ?? -1;
    const answer = position > 0 ? chat?.messages[position] : undefined;
    const question = position > 0 ? chat?.messages[position - 1] : undefined;
    const version = answer?.versions.find(item => item.id === versionId);
    if (answer?.role !== 'assistant' || question?.role !== 'user' || version?.status !== 'complete' || version.research) return;
    const controller = new AbortController();
    mainRequest.current = { conversationId, messageId, versionId, controller };
    setMainBusyId(conversationId);
    const onStep = (step: SearchStep) => setChatResearchRun({ conversationId, messageId, versionId, mode: 'papers', step });
    try {
      const result = await researchInquiry({ question: activeVersion(question).content, settings, locale, signal: controller.signal, onStep }, 'papers');
      controller.signal.throwIfAborted();
      if (result.sources.length) mutateConversation(conversationId, current => patchVersion(current, messageId, versionId, { research: { kind: 'papers', sources: result.sources } }));
      else notify(inquiryIntroduction(result, locale));
    } catch (error) {
      notify(controller.signal.aborted ? '已取消检索。' : errorText(error));
    } finally {
      mainRequest.current = null; setMainBusyId(null); setChatResearchRun(null);
    }
  }
  function referenceAnnotationToChat(id: string, sourceDocumentId?: string, childId?: string) {
    if (closingRef.current || fileOperation.current) return;
    document.dispatchEvent(new Event('learn:save-edits'));
    const snapshot = current.current;
    const source = snapshot && findConversation(snapshot, sourceDocumentId && openDocument?.id === sourceDocumentId && readerOwner ? readerOwner.id : snapshot.activeConversationId);
    if (!source || !snapshot) return;
    const annotation = projectResources(source, projectFor(snapshot, source), snapshot).annotations.find(item => item.id === id);
    if (!annotation || !canReferenceAnnotation(annotation)) { notify('引用的批注已删除或尚未保存，请重新选择。'); return; }
    if (childId && !annotation.subAnnotations?.some(child => child.id === childId && canReferenceSubAnnotation(child))) { notify('引用的批注已删除或尚未保存，请重新选择。'); return; }
    try {
      const owner = sourceDocumentId ? chatForDocumentOwner(snapshot, source) : source;
      const available = projectResources(owner, projectFor(snapshot, owner), snapshot);
      const documentId = available.documents?.some(file => file.id === sourceDocumentId) ? sourceDocumentId : undefined;
      showChat(owner, true);
      if (sourceDocumentId && openDocument?.id === sourceDocumentId) setOpenAnnotationId(id);
      setChatAnnotationRequest({ conversationId: owner.id, id: childId ?? id, documentId });
    } catch (error) { notify(errorText(error)); }
  }
  function openSourceTurn(conversationId: string, turnIds: string[]) {
    const source = current.current && findConversation(current.current, conversationId);
    const id = turnIds.find(id => source?.messages.some(message => message.id === id));
    if (!source || !id || fileOperation.current) { notify('来源对话已不可用。'); return; }
    selectConversation(source.id, true);
    setSourceJump(previous => ({ conversationId, id, serial: (previous?.serial || 0) + 1 }));
  }
  function resolveSummary(snapshot: Workspace, annotationId: string) {
    const source = summaryDialog && findConversation(snapshot, summaryDialog.conversationId);
    if (!summaryDialog || !source || source.isProject) throw new Error('来源对话已不可用。');
    const project = projectFor(snapshot, source);
    const owner = [source, project].find(item => item?.annotations.some(annotation => annotation.id === annotationId));
    const note = owner?.annotations.find(annotation => annotation.id === annotationId);
    if (!note || !owner || !canReferenceAnnotation(note)) throw new Error('请选择一条已保存的批注。');
    return { source, owner, note, turnIds: summaryDialog.turnIds };
  }
  async function generateSummary(annotationId: string, signal: AbortSignal) {
    const snapshot = current.current;
    if (!snapshot || closingRef.current) throw new Error('本机记录尚未就绪，请稍候。');
    const { source, note, turnIds } = resolveSummary(snapshot, annotationId);
    const messages = buildSummaryContext(source, turnIds, note, responsePreference('', getLocale()));
    if (settings.mode === 'demo') {
      return t('演示总结') + '\n\n' + selectedSummaryTurns(source, turnIds).map(turn => '- ' + (turn.answers.join(' ') || turn.question).slice(0, 240)).join('\n');
    }
    let draft = '';
    await streamReply({ messages, kind: 'main', ...(settings.activeProfileId ? { profileId: settings.activeProfileId } : {}) }, delta => { draft += delta; }, signal);
    return draft;
  }
  async function saveSummary(annotationId: string, content: string) {
    if (fileOperation.current || closingRef.current) throw new Error('本机记录尚未就绪，请稍候。');
    fileOperation.current = true;
    try {
      await commitFileChanges(snapshot => {
        const { source, owner, turnIds } = resolveSummary(snapshot, annotationId);
        selectedSummaryTurns(source, turnIds);
        return updateConversation(snapshot, owner.id, c => appendAnnotationSummary(c, annotationId, { id: makeId(), content, conversationId: source.id, turnIds, createdAt: Date.now() }));
      });
      setSummaryDialog(null); notify('总结已追加到批注。');
    } finally { fileOperation.current = false; }
  }
  function openCollection(annotation: Annotation) {
    const snapshot = current.current;
    const owner = snapshot && findConversation(snapshot, annotation.conversationId);
    const project = snapshot && owner && projectFor(snapshot, owner);
    if (!project || closingRef.current || fileOperation.current || mainRequest.current || annotationRequests.current.size) return;
    setCollectionDialog({ projectId: project.id, ownerId: annotation.conversationId, annotationId: annotation.id });
  }
  async function saveCollection(ids: string[]) {
    const selection = collectionDialog;
    if (!selection || fileOperation.current || closingRef.current) throw new Error('本机记录尚未就绪，请稍候。');
    fileOperation.current = true;
    try {
      const next = await commitFileChanges(snapshot => {
        const note = findConversation(snapshot, selection.ownerId)?.annotations.find(annotation => annotation.id === selection.annotationId);
        if (!note || !canReferenceAnnotation(note)) throw new Error('请选择一条已保存的批注。');
        const turns = collectHistory(snapshot, selection.projectId, note, ids);
        const conversation = { ...createConversation(t('批注问答整理')), collectedHistory: { annotationId: note.id, turns } };
        return createProjectChat(snapshot, selection.projectId, conversation);
      });
      const chat = findConversation(next, next.activeConversationId);
      if (chat) showChat(chat, true);
      setCollectionDialog(null);
      notify('问答已整理到新会话。');
    } finally { fileOperation.current = false; }
  }
  async function removeTurn(conversationId: string, messageId: string | readonly string[]): Promise<void> {
    if (closingRef.current || fileOperation.current || mainRequest.current || annotationRequests.current.size) throw new Error('请先停止回答，再删除本轮对话。');
    document.dispatchEvent(new Event('learn:save-edits'));
    fileOperation.current = true; setTurnBusy(true);
    try {
      const ids = typeof messageId === 'string' ? [messageId] : messageId;
      const annotations = current.current?.conversations.find(conversation => conversation.id === conversationId)?.annotations ?? [];
      const next = await removeChatTurns(conversationId, ids);
      const kept = new Set(next.conversations.find(conversation => conversation.id === conversationId)?.annotations.map(annotation => annotation.id));
      closeAnnotationWindows(annotations.filter(annotation => !kept.has(annotation.id)).map(annotation => annotation.id));
      notify(typeof messageId === 'string' ? '本轮对话已删除，后续请求不再带入。' : t('已删除 {0} 轮对话，后续请求不再带入。', [messageId.length]));
    } finally { fileOperation.current = false; setTurnBusy(false); }
  }
  async function regenerate(conversationId: string, messageId: string) {
    if (mainRequest.current || closingRef.current || fileOperation.current) return;
    const snapshot = current.current;
    const conversation = snapshot && findConversation(snapshot, conversationId);
    if (!snapshot || !conversation || conversation.isProject) return;
    const index = conversation.messages.findIndex(m => m.id === messageId);
    if (index < 0 || index !== conversation.messages.length - 1) { notify('请在最后一条回答上重新生成。旧回答仍可切换版本和查看批注。'); return; }
    try {
      const reply = conversation.messages[index];
      const project = projectFor(snapshot, conversation);
      const question = conversation.messages[index - 1];
      if (reply.inquiryIntro && project?.isProject && question?.role === 'user') {
        if (inquiryRequest.current) return;
        const next = addAssistantVersion(reply);
        const sourceIds = question.researchSourceIds;
        const savedSources = project.inquiry?.sources?.filter(source => !sourceIds?.length || sourceIds.includes(source.id)).slice(0, 8);
        mutateConversation(conversationId, c => ({ ...c, messages: c.messages.map(m => m.id === messageId ? next : m), updatedAt: Date.now() }));
        closeAnnotationWindows(conversation.annotations.filter(annotation => annotation.messageId === messageId).map(annotation => annotation.id));
        await runInquiry(project.id, 'guide', undefined, { conversationId, messageId, versionId: next.activeVersionId, question: activeVersion(question).content, savedSources });
        return;
      }
      const previous = activeVersion(conversation.messages[index]);
      const base = previous.status !== 'complete' && previous.context ? previous.context.slice() : buildProjectChatContext(snapshot, { ...conversation, messages: conversation.messages.slice(0, index) }, responsePreference(settings.systemPrompt, getLocale()), { mode: contextMode, location: readerLocation.current });
      const papers = previous.research?.kind === 'papers' ? previous.research : undefined;
      const messages = papers && !previous.context ? withResearchEvidence(base, papers.sources, 'papers') : base;
      const next = addAssistantVersion(conversation.messages[index]);
      next.versions[next.versions.length - 1].context = freezeContext(messages);
      if (papers) next.versions[next.versions.length - 1].research = papers;
      mutateConversation(conversationId, c => ({ ...c, messages: c.messages.map(m => m.id === messageId ? next : m), updatedAt: Date.now() }));
      closeAnnotationWindows(conversation.annotations.filter(annotation => annotation.messageId === messageId).map(annotation => annotation.id));
      await runMain(conversationId, messageId, next.activeVersionId, messages, next.versions.length - 1);
    } catch (e) { notify(errorText(e)); }
  }
  function setVersion(conversationId: string, messageId: string, versionId: string) {
    if (mainRequest.current) return;
    const annotations = current.current?.conversations.find(conversation => conversation.id === conversationId)?.annotations;
    closeAnnotationWindows(annotations?.filter(annotation => annotation.messageId === messageId && annotation.versionId !== versionId).map(annotation => annotation.id) ?? []);
    mutateConversation(conversationId, c => ({ ...c, messages: c.messages.map(m => m.id === messageId ? { ...m, activeVersionId: versionId } : m), updatedAt: Date.now() }));
  }
  function addAnnotation(conversationId: string, annotation: Annotation) {
    mutateConversation(conversationId, c => appendAnnotation(c, annotation));
    setOpenAnnotationId(annotation.id);
  }
  function addAnnotationSlot(annotation: Annotation) {
    if (fileOperation.current || closingRef.current) return;
    const owner = current.current && findConversation(current.current, annotation.conversationId);
    if (!owner) return;
    try {
      const slot = createSiblingAnnotation(owner, annotation.id);
      mutateConversation(owner.id, () => slot.conversation);
      setOpenAnnotationId(slot.id);
    } catch (error) { notify(errorText(error)); }
  }
  function editAnnotation(conversationId: string, id: string, patch: Partial<Annotation>) {
    try {
      mutateConversation(conversationId, c => {
        const annotation = c.annotations.find(a => a.id === id);
        if (!annotation) return c;
        if (patch.color !== undefined) return changeAnnotationColor(c, id, patch.color);
        if (isAnnotationGenerating(annotation)) return c;
        if (patch.reask) return changeAnnotationReask(c, id, 'edit', patch.reask.question);
        if (annotation.mode === 'note' && (patch.status === 'noted' || (annotation.status === 'noted' && patch.note !== undefined))) return saveNoteAnnotation(c, id, patch.note ?? annotation.note ?? '');
        const textPatch: { question?: string; answer?: string; mode?: 'ask' | 'note'; note?: string } = {};
        if (patch.mode !== undefined) textPatch.mode = patch.mode;
        if (patch.note !== undefined) textPatch.note = patch.note;
        if (patch.question !== undefined) textPatch.question = patch.question;
        if (patch.answer !== undefined && annotation.status === 'answered') textPatch.answer = patch.answer;
        return updateAnnotationCopy(c, id, textPatch);
      });
    } catch (e) { notify(errorText(e)); }
  }
  function removeAnnotation(conversationId: string, id: string) {
    if (annotationRequests.current.has(id)) { notify('请等批注回答完成后再删除。'); return; }
    try {
      const owner = current.current && findConversation(current.current, conversationId);
      const removed = owner?.annotations.find(annotation => annotation.id === id);
      const neighbor = owner && removed && adjacentAnnotationSlot(owner.annotations, removed);
      mutateConversation(conversationId, c => deleteAnnotation(c, id));
      if (removed?.subAnnotations?.length) subAnnotationStreams.stopNodes(id, new Set(removed.subAnnotations.map(child => child.id)));
      if (removed?.figure) figureCache.delete(figureSourceKey(removed.figure));
      if (neighbor && windowOrder.has(id)) setOpenAnnotationId(neighbor.id);
      else closeAnnotationWindows([id]);
      notify(neighbor ? '已删除当前编号批注，可撤销。' : '已删除批注与高亮，可撤销。');
    } catch (e) { notify(errorText(e)); }
  }
  function reaskAnnotation(conversationId: string, id: string, action: 'start' | 'cancel' | 'edit') {
    if (fileOperation.current || closingRef.current) return;
    try { mutateConversation(conversationId, c => changeAnnotationReask(c, id, action)); }
    catch (error) { notify(errorText(error)); }
  }
  function undoDelete() {
    if (mainRequest.current) { notify('请等主回答完成后再恢复批注。'); return; }
    const deleted = current.current?.conversations.filter(c => c.deletedAt === undefined).flatMap(c => c.annotations.filter(a => a.deletedAt !== undefined).map(annotation => ({ conversationId: c.id, annotation }))).sort((a, b) => b.annotation.deletedAt! - a.annotation.deletedAt!)[0];
    if (!deleted) return;
    restoreLocalAnnotation(deleted.conversationId, deleted.annotation);
    notify('批注与高亮已恢复。');
  }
  function restoreLocalAnnotation(ownerId: string, annotation: Annotation) {
    const owner = current.current && findConversation(current.current, ownerId);
    if (!owner) throw new Error('这条批注已不在回收站。');
    update(w => ({
      ...updateConversation(w, ownerId, c => ({ ...restoreAnnotation(c, annotation.id), messages: c.messages.map(m => m.id === annotation.messageId ? { ...m, activeVersionId: annotation.versionId } : m) })),
      activeConversationId: owner.isProject ? w.activeConversationId : owner.id,
    }));
    const file = owner.documents?.find(d => d.pages.some(p => p.messageId === annotation.messageId));
    if (file) openReaderReference({ conversationId: owner.id, document: file });
    else if (!owner.isProject) showChat(owner);
    setSidebarOpen(false); setOpenAnnotationId(annotation.id);
  }
  function sourceDocument(annotation:Annotation,report:ReaderReport) {
    const c=current.current?.conversations.find(item=>item.id===annotation.conversationId && item.deletedAt===undefined);
    if (!c?.annotations.some(a=>a.id===annotation.id && a.deletedAt===undefined && a.messageId===annotation.messageId && a.versionId===annotation.versionId)) return;
    return c.documents?.find(d=>d.id===report.documentId && d.pages.some(p=>p.messageId===annotation.messageId && p.versionId===annotation.versionId));
  }
  function finishReaderPlan(plan:ReaderPlan|undefined,annotation:Annotation,answer:string,result:Awaited<ReturnType<typeof streamReply>>) {
    if (!plan) return;
    const doc=sourceDocument(annotation,plan.report);
    if (!doc || readerIndex(doc).version!==plan.report.documentVersion) throw new Error('原文版本已经变化，请重新划选。');
    const report=finishReport(plan,answer,result.modelLabel,result.usage,readerIndex(doc).byId)!;
    return {...report,estimatedInput:result.readerEstimate??report.estimatedInput,
      ...(result.readerImage?{selectionImage:result.readerImage}:{}),
      ...(result.readerImage==='sent'?{priced:false,maxEstimateUSD:undefined,costUSD:undefined}:{})};
  }
  async function askAnnotation(conversationId: string, annotationId: string, figureOptions?: { image: PreparedFigureImage; profileId?: string | null }) {
    if (closingRef.current) return;
    if (fileOperation.current) { notify('请等文件处理完成后再提问。'); return; }
    if (annotationRequests.current.has(annotationId)) return;
    if (mainRequest.current?.conversationId === conversationId) { notify('请等主回答完成后再发送批注问题。'); return; }
    const conversation = current.current?.conversations.find(c => c.id === conversationId);
    if (!conversation) return;
    const sourceNote = conversation.annotations.find(annotation => annotation.id === annotationId);
    if (sourceNote?.figure && (!figureOptions || figureOptions.image.key !== figureImageKey(sourceNote.figure, sourceNote.reask?.figureStrokes || sourceNote.figure.strokes) || figureOptions.image.blob.size > FIGURE_LIMITS.imageBytes)) { notify('提问图片已变化，请重新打开这条图片批注。'); return; }
    if (!sourceNote?.figure && figureOptions) { notify('只有图片批注可以发送图片。'); return; }
    const requestPreference = figureOptions?.profileId ? settings.profiles.find(profile => profile.id === figureOptions.profileId)?.systemPrompt ?? settings.systemPrompt : settings.systemPrompt;
    let prepared;
    const inquiryQuestion = sourceNote?.anchorGroupId ? undefined : readerProject?.inquiry?.question;
    const isReadingQuestion = openDocument?.pages.some(page => page.messageId === sourceNote?.messageId);
    const engine=sourceNote?.figure?undefined:readerPolicy(settings);
    const preference = responsePreference(requestPreference, getLocale()) + (!engine && inquiryQuestion && isReadingQuestion
      ? '\n\nReader’s main question (background for the current annotation): ' + JSON.stringify(inquiryQuestion) : '');
    try { prepared = prepareAnnotationRequest(conversation, annotationId, preference, { mode: !engine && sourceNote?.anchorGroupId ? 'relevant' : contextMode, engine, projectQuestion:isReadingQuestion?inquiryQuestion:undefined }); }
    catch (e) { notify(errorText(e)); return; }
    try { mutateConversation(conversationId, () => prepared.conversation); }
    catch (error) { notify(errorText(error)); return; }
    const controller = new AbortController();
    annotationRequests.current.set(annotationId, controller);
    const pending=()=>annotationRequests.current.get(annotationId)===controller && current.current?.conversations.some(c=>c.id===conversationId && c.deletedAt===undefined && c.annotations.some(a=>a.id===annotationId && a.deletedAt===undefined && (a.status==='generating'||a.reask?.status==='generating')));
    let answer = '';
    try {
      let selectedImage: import('./adapters/figure').FigureImage | undefined = figureOptions?.image;
      let localImageStatus: 'unsupported' | 'budget' | 'unavailable' | undefined;
      const plan=prepared.plan, note=prepared.annotation;
      if (plan && settings.mode==='api' && readerPdf?.documentId===plan.report.documentId) {
        const doc=sourceDocument(note,plan.report);
        const page=doc?.pages.find(p=>p.messageId===note.messageId && p.versionId===note.versionId);
        if (doc?.kind==='pdf' && page && readerIndex(doc).version===plan.report.documentVersion) {
          try {
            const excerpt=await readPdfExcerpt(readerPdf,page,note.quote,selectionSourceStart(note,page),undefined,controller.signal,'question');
            if (excerpt && settings.imageInput==='unsupported') localImageStatus='unsupported';
            else if (excerpt && plan.guard.maxUSD!==undefined) localImageStatus='budget';
            else selectedImage=excerpt?.image;
          } catch { controller.signal.throwIfAborted(); localImageStatus='unavailable'; }
        }
      }
      const image=selectedImage?{dataURL:await figureDataURL(selectedImage,controller.signal),width:selectedImage.width,height:selectedImage.height}:undefined;
      if (!pending()) return;
      const profile = figureOptions ? (figureOptions.profileId === undefined ? {} : { profileId: figureOptions.profileId }) : settings.activeProfileId ? { profileId: settings.activeProfileId } : settings.mode === 'demo' ? { profileId: null } : {};
      const result = await streamReply({ messages: prepared.messages, kind: 'annotation', quote: prepared.annotation.quote, reader:prepared.plan?.guard, ...profile, ...(image ? { image } : {}) }, delta => {
        if (!pending() || controller.signal.aborted) return;
        const next = answer + delta;
        mutateConversation(conversationId, c => updateAnnotationRequest(c, annotationId, next));
        answer = next;
      }, controller.signal);
      if (!pending()) return;
      controller.signal.throwIfAborted();
      const report=finishReaderPlan(prepared.plan,prepared.annotation,answer,localImageStatus?{...result,readerImage:localImageStatus}:result);
      mutateConversation(conversationId, c => completeAnnotation(c, annotationId, answer, prepared.annotation.figure ? result.modelLabel : undefined,report));
    } catch (e) {
      if (!pending()) return;
      mutateConversation(conversationId, c => updateAnnotationRequest(c, annotationId, answer, { interrupted: controller.signal.aborted, error: controller.signal.aborted ? "回答已停止，可以用原问题和本次上下文重试。" : errorText(e) }));
    } finally { if (annotationRequests.current.get(annotationId)===controller) annotationRequests.current.delete(annotationId); }
  }
  function editAnnotationChild(annotation: Annotation, childId: string, patch: SubAnnotationEdit) {
    if (fileOperation.current || closingRef.current || subAnnotationStreams.get(childId)) return false;
    try {
      mutateConversation(annotation.conversationId, c => editSubAnnotation(c, annotation.id, childId, patch));
      return true;
    } catch (error) { notify(errorText(error)); return false; }
  }
  function saveAnnotationChildNote(annotation: Annotation, draftId: string, draft: SubAnnotationDraft, note: string) {
    if (fileOperation.current || closingRef.current) return false;
    const owner = current.current && findConversation(current.current, annotation.conversationId);
    if (!owner) return false;
    try {
      const created = addSubAnnotation(owner, annotation.id, draft, note);
      mutateConversation(owner.id, () => created.conversation);
      dispatchWindow({ type: 'commit', draftId, savedId: created.id });
      return true;
    } catch (error) { notify(errorText(error)); return false; }
  }
  function deleteAnnotationChild(annotation: Annotation, childId: string) {
    if (fileOperation.current || closingRef.current) return;
    const owner = current.current && findConversation(current.current, annotation.conversationId);
    const children = owner?.annotations.find(item => item.id === annotation.id)?.subAnnotations ?? [];
    const child = children.find(item => item.id === childId);
    if (!owner || !child) return;
    const removed = subAnnotationSubtree(children, childId);
    try {
      mutateConversation(owner.id, c => deleteSubAnnotation(c, annotation.id, childId));
      subAnnotationStreams.stopNodes(annotation.id, removed);
      dispatchWindow({ type: 'close', ids: [childId] });
    } catch (error) { notify(errorText(error)); }
  }
  function askAnnotationChild(annotation: Annotation, input: SubAnnotationQuestion): boolean {
    if (closingRef.current || annotationRequests.current.has(input.childId) || !input.question.trim()) return false;
    if (fileOperation.current || mainRequest.current) { notify('请等文件处理和回答结束后再提问。'); return false; }
    const conversation = current.current && findConversation(current.current, annotation.conversationId);
    if (!conversation) return false;
    try {
      const preference = responsePreference(settings.systemPrompt, getLocale());
      const created = 'draft' in input && input.draft ? addSubAnnotation(conversation, annotation.id, input.draft) : undefined;
      const childId = created?.id ?? input.childId;
      const baseline = created?.conversation ?? conversation;
      const engine=readerPolicy(settings);
      const followUp = 'followUp' in input
        ? prepareSubAnnotationFollowUp(baseline, annotation.id, childId, input.question, preference, input.retryId,engine,contextMode)
        : undefined;
      const prepared = followUp ?? prepareSubAnnotationRequest(baseline, annotation.id, childId, input.question, preference,engine,contextMode);
      const target: SubAnnotationTarget = {
        annotationId: annotation.id, childId, followUpId: followUp?.followUpId,
      };
      mutateConversation(conversation.id, () => prepared.conversation);
      const controller = new AbortController();
      annotationRequests.current.set(childId, controller);
      subAnnotationStreams.start(target, controller);
      if (created) dispatchWindow({ type: 'commit', draftId: input.childId, savedId: childId });
      const profile = settings.activeProfileId ? { profileId: settings.activeProfileId } : settings.mode === 'demo' ? { profileId: null } : {};
      const liveConversation = () => current.current && findConversation(current.current, conversation.id) || undefined;
      void (async () => {
        try {
          const result=await streamReply({ messages: prepared.messages, kind: 'annotation', quote: prepared.quote, reader:prepared.plan?.guard, ...profile },
            delta => subAnnotationStreams.append(liveConversation(), childId, controller, delta), controller.signal);
          const stream = subAnnotationStreams.current(liveConversation(), childId, controller);
          if (!stream) return;
          controller.signal.throwIfAborted();
          const report=finishReaderPlan(prepared.plan,annotation,stream.answer,result);
          mutateConversation(conversation.id, c => target.followUpId
            ? finishSubAnnotationFollowUp(c, target, stream.answer,report)
            : finishSubAnnotationRequest(c, annotation.id, childId, { answer: stream.answer,report }));
        } catch (error) {
          if (!subAnnotationStreams.current(liveConversation(), childId, controller)) return;
          const interrupted = controller.signal.aborted;
          const message = interrupted ? '这次回答已停止。' : errorText(error);
          if (!target.followUpId) {
            mutateConversation(conversation.id, c => finishSubAnnotationRequest(c, annotation.id, childId, { interrupted, error: message }));
          } else if (!interrupted) notify(message);
        } finally {
          subAnnotationStreams.finish(childId, controller);
          if (annotationRequests.current.get(childId) === controller) annotationRequests.current.delete(childId);
        }
      })().catch(error => notify(errorText(error)));
      return true;
    } catch (error) { notify(errorText(error)); return false; }
  }
  async function downloadBackup(conversationId?: string, legacy = false, propagate = false) {
    if (!current.current) return;
    try {
      const snapshot = current.current;
      const selected = conversationId ? snapshot.conversations.find(c => c.id === conversationId && c.deletedAt === undefined) : undefined;
      const source = selected && !selected.isProject ? chatBackup(snapshot, selected) : snapshot;
      if (legacy && source.conversations.some(c => c.isProject || c.annotations.some(annotation => annotation.summaries?.length))) throw new Error('项目与聊天总结需要新版备份，请使用默认导出格式。');
      if (legacy && source.conversations.some(c => c.documents?.some(d => isEbookKind(d.kind)))) throw new Error('电子书记录需要新版备份，请使用默认导出格式。');
      const archive = source===snapshot && !legacy ? await snapshotKnowledge() : undefined;
      const blob = await exportWorkspaceBlob(source, { compact: !legacy, knowledge: archive });
      downloadJson(blob, 'ai-paper-pdf-reader-' + (legacy ? t("兼容旧版-") : '') + t("备份-") + new Date().toISOString().slice(0, 10) + '.json');
      notify(archive ? '完整备份已导出，含工作区、原附件、Wiki 历史和知识卡片。' : '工作区备份已导出。');
    } catch (e) { if (propagate) throw e; notify(errorText(e)); }
  }
  async function downloadKnowledge(cardsOnly = false) {
    const bridge = desktop()?.knowledge;
    if (!bridge) return;
    const { cards } = await bridge.list();
    const references = localDocumentReferences(current.current);
    const exported = await exportKnowledgeCards(cards, references, file => library.index.fingerprint(file, getDocumentBytes));
    const data = cardsOnly ? exported : {format:'ai4u-knowledge-v1',knowledge:{cards:exported,wiki:await wikiRepository?.exportHistory() ?? []}};
    const blob = new Blob([JSON.stringify(data)],{type:'application/json'});
    if (blob.size > 350_000_000) throw new Error('知识库超过单份备份大小上限。');
    downloadJson(blob,'ai4u-'+(cardsOnly?'cards-':'wiki-')+new Date().toISOString().slice(0,10)+'.json');
  }
  async function importKnowledgeBackup(data: unknown) {
    if (data && typeof data==='object' && 'format' in data && data.format==='ai4u-knowledge-v1') {
      if (!('knowledge' in data) || !data.knowledge) throw new Error('知识库备份不完整。');
      await restoreKnowledge(data.knowledge);
      await knowledge.reload(); invalidateCheckpoint(); notify('Wiki 与知识卡片已恢复。'); return true;
    }
    if (!Array.isArray(data)) return false;
    const { added, skipped } = await knowledge.importCards(JSON.stringify(data));
    notify(t('知识库已导入。新增 {0} 张，跳过 {1} 张已有卡片。', [added, skipped]));
    return true;
  }
  async function importBackup(file: File) {
    if (fileOperation.current || mainRequest.current || annotationRequests.current.size) { notify('请等文件处理和回答结束后再导入。'); return; }
    fileOperation.current = true; setFileBusy(true);
    try {
      if (file.size > 350_000_000) throw new Error('备份超过 350 MB，请选择较小的备份文件。');
      const data = parseBackupData(await file.text());
      if (await importKnowledgeBackup(data)) return;
      const snapshot = current.current!;
      const merged = await importWorkspaceWithFiles(data, snapshot);
      if (current.current !== snapshot) throw new Error('对话在导入时发生变化，请重新导入。');
      update(() => merged); await knowledge.reload(); library.refresh();
      clearReaderDocument(); setProjectPreviews(new Map()); setSidebarOpen(false);
      if (view.kind !== 'home') setView({ kind: 'workspace', pane: { kind: 'chat', conversationId: merged.activeConversationId } });
      notify('已导入为新对话，附件和原有记录完整保留。');
    } catch (e) { notify(errorText(e)); }
    finally { if (fileInput.current) fileInput.current.value = ''; fileOperation.current = false; setFileBusy(false); }
  }
  function chooseAttachment(target?: ProjectFileTarget) {
    if (fileOperation.current || mainRequest.current || annotationRequests.current.size || closingRef.current) return;
    uploadTarget.current = target;
    if (uploadInput.current) {
      uploadInput.current.accept = target?.sourceId ? '.pdf,application/pdf' : DOCUMENT_ACCEPT;
      uploadInput.current.click();
    }
  }
  function openProjectDocument(projectId: string, ref: LocalDocumentReference, mode: 'focused' | 'split') {
    if (!fileOperation.current) openReaderReference(ref, mode, { kind: 'overview', projectId });
  }
  function chatPaper(snapshot: Workspace, target: ChatPaperTarget) {
    const chat = findConversation(snapshot, target.conversationId);
    const version = chat?.messages.find(message => message.id === target.messageId && message.role === 'assistant')
      ?.versions.find(item => item.id === target.versionId);
    if (!chat || version?.research?.kind !== 'papers') throw new Error('资料已变化，请重新选择。');
    const source = version.research.sources.find(item => item.id === target.sourceId);
    if (!source) throw new Error('资料已变化，请重新选择。');
    return { chat, source };
  }
  function collectChatPaper(target: ChatPaperTarget) {
    const snapshot = current.current;
    if (!snapshot || closingRef.current || fileOperation.current || mainRequest.current) return;
    try {
      const { source } = chatPaper(snapshot, target);
      const result = archiveChatPaper(snapshot, target.conversationId, source);
      if (result.added) update(() => result.workspace);
      setProjectPreviews(previous => moveProjectPreview(previous, target.conversationId, result.projectId));
      setExpandedProjects(previous => previous.has(result.projectId) ? previous : new Set([...previous, result.projectId]));
      notify(result.added ? '已收入资料地图。' : '这份资料已收录。');
    } catch (error) { notify(errorText(error)); }
  }
  function readChatPaper(target: ChatPaperTarget) {
    const snapshot = current.current;
    if (!snapshot || closingRef.current || fileOperation.current || mainRequest.current || annotationRequests.current.size) return;
    try {
      const { chat, source } = chatPaper(snapshot, target);
      const project = projectFor(snapshot, chat);
      const stored = project?.inquiry?.sources?.find(item => sameResearchSource(item, source));
      const linked = stored?.documentId && project && projectDocuments(project, projectThreads(snapshot.conversations, project.id))
        .find(ref => ref.document.id === stored.documentId);
      if (linked) {
        openReaderReference(linked, 'focused', { kind: 'chat', conversationId: chat.id });
        return;
      }
      const pdfSource = stored?.pdfUrl ? stored : source;
      if (!pdfSource.pdfUrl) return;
      void uploadDocument(signal => downloadResearchPdf(pdfSource, signal), 'open', undefined, { conversationId: chat.id, source });
    } catch (error) { notify(errorText(error)); }
  }
  function saveOverview(project: Conversation) {
    const overview = project.inquiry?.overview;
    if (!overview) return;
    const sources = overview.sourceIds.flatMap(id => {
      const source = project.inquiry?.sources?.find(item => item.id === id);
      return source ? ['- ' + source.title + ' · ' + source.webUrl] : [];
    });
    setKnowledgeDraft({
      title: t('{0} · 概览', [project.title]), content: [overview.text, sources.join('\n')].filter(Boolean).join('\n\n'), tags: [],
      projectId: project.id, origin: { type: 'synthesis' },
    });
  }
  function attachSourceDocument(inquiry: Inquiry, sourceId: string | undefined, documentId: string) {
    if (!sourceId) return inquiry;
    if (!inquiry.sources?.some(source => source.id === sourceId)) throw new Error('资料已变化，请重新选择。');
    return { ...inquiry, sources: inquiry.sources.map(source => source.id === sourceId ? { ...source, documentId } : source) };
  }
  async function uploadDocument(input: File | ((signal: AbortSignal) => Promise<File>), intent: 'open' | 'attach', target?: ProjectFileTarget,
    paper?: { conversationId: string; source: InquirySource }) {
    if (closingRef.current || fileOperation.current || mainRequest.current || annotationRequests.current.size) { notify('请等当前文件或回答完成后再打开。'); return; }
    const snapshot = current.current; if (!snapshot) return;
    const conversation = findConversation(snapshot, paper?.conversationId ?? snapshot.activeConversationId);
    if (!conversation || conversation.isProject) return;
    const targetProject = target ? findConversation(snapshot, target.projectId) : intent === 'attach' || paper ? projectFor(snapshot, conversation) : undefined;
    if (target && !targetProject?.isProject) return;
    const mode = !target && (intent === 'attach' || readerSplit) ? 'split' : 'focused';
    const returnPane: WorkspacePane | undefined = target
      ? { kind: 'overview', projectId: target.projectId }
      : intent === 'attach' && targetProject ? { kind: 'chat', conversationId: conversation.id } : undefined;
    const downloading = typeof input === 'function';
    fileOperation.current = true; setFileBusy(true);
    const controller = new AbortController(); fileController.current = controller; setFileProgress({ page: 0, total: 0, downloading });
    try {
      const file = typeof input === 'function' ? await input(controller.signal) : input;
      setFileProgress({ page: 0, total: 0 });
      const kind = documentFileKind(file), bytes = new Uint8Array(await file.arrayBuffer());
      if ((target?.sourceId || paper) && kind !== 'pdf') throw new Error('请选择 PDF 来关联这份资料。');
      controller.signal.throwIfAborted();
      const references = localDocumentReferences(snapshot);
      const candidates = targetProject ? projectDocuments(targetProject, projectThreads(snapshot.conversations, targetProject.id))
        : paper ? references.filter(ref => ref.conversationId === conversation.id) : preferProjectFiles(snapshot, references);
      const existing = await library.index.find(bytes, kind, candidates, getDocumentBytes, controller.signal);
      if (existing && !paper) {
        if (target?.sourceId) updateInquiry(target.projectId, inquiry => attachSourceDocument(inquiry, target.sourceId, existing.document.id));
        if (!target?.stayOnOverview) openReaderReference(existing, mode, returnPane);
        notify(target?.stayOnOverview ? '已有文献已关联到项目。' : '已打开本机已有的文件，批注可以继续使用。'); return;
      }
      if (!existing && targetProject && (targetProject.documents?.length || 0) >= 10) throw Error(t('每个项目最多包含 10 份文件。'));
      const parsed = existing ? undefined : await parseDocumentFile(file, { bytes, signal: controller.signal, onProgress: (page, total) => setFileProgress({ page, total }) });
      controller.signal.throwIfAborted();
      setFileProgress(null);
      document.dispatchEvent(new Event('learn:save-edits'));
      if (paper) {
        const document = existing?.document ?? parsed!.document;
        let projectId = '';
        await commitFileChanges(w => {
          const saved = archiveChatPaper(w, paper.conversationId, paper.source);
          projectId = saved.projectId;
          return updateConversation(saved.workspace, projectId, c => ({
            ...c, updatedAt: Date.now(),
            ...(parsed ? { documents: [...(c.documents || []), document] } : {}),
            inquiry: attachSourceDocument(c.inquiry || {}, saved.sourceId, document.id),
          }));
        }, parsed ? { id: document.id, bytes: parsed.bytes } : undefined);
        if (parsed) library.index.remember(document, parsed.bytes);
        setProjectPreviews(previous => moveProjectPreview(previous, paper.conversationId, projectId));
        setExpandedProjects(previous => new Set([...previous, projectId]));
        openReaderReference(existing ?? { conversationId: projectId, document }, 'focused', { kind: 'chat', conversationId: paper.conversationId });
        notify('文献已收入资料地图并打开。');
        return;
      }
      if (!parsed) return;
      const project = targetProject ?? createFileProject(parsed.document);
      await commitFileChanges(w => {
        if (!targetProject) return { ...w, conversations: [project, ...w.conversations] };
        if (!findConversation(w, project.id)?.isProject) throw Error(t("当前记录不可用，请重新打开。"));
        return updateConversation(w, project.id, c => ({
          ...c, documents: [...(c.documents || []), parsed.document], updatedAt: Date.now(),
          ...(target?.sourceId ? { inquiry: attachSourceDocument(c.inquiry || {}, target.sourceId, parsed.document.id) } : {}),
        }));
      }, { id: parsed.document.id, bytes: parsed.bytes });
      library.index.remember(parsed.document, parsed.bytes);
      if (!target?.stayOnOverview) openReaderReference({ conversationId: project.id, document: parsed.document }, mode, returnPane);
      notify(target?.stayOnOverview ? '文献已添加到项目。' : '文件已在本机打开，可以直接阅读和批注。');
    } catch (e) { notify(controller.signal.aborted ? '已取消打开文件。' : errorText(e)); }
    finally { fileOperation.current = false; fileController.current = null; setFileBusy(false); setFileProgress(null); if (uploadInput.current) uploadInput.current.value = ''; if (readerInput.current) readerInput.current.value = ''; }
  }
  async function restoreBackup(text: string) {
    if (fileOperation.current || mainRequest.current || annotationRequests.current.size) throw new Error('请先停止回答，等待文件处理完成后再恢复。');
    fileOperation.current = true; setFileBusy(true);
    try {
      const data=parseBackupData(text);
      if (await importKnowledgeBackup(data)) return;
      if (loadError) await recover(data);
      else {
        const snapshot = current.current!;
        const merged = await importWorkspaceWithFiles(data, snapshot);
        if (current.current !== snapshot) throw new Error('对话在恢复时发生变化，请重试。');
        update(() => merged); await flush();
      }
      await knowledge.reload(); library.refresh(); clearReaderDocument(); setProjectPreviews(new Map()); setSidebarOpen(false);
      if (view.kind !== 'home' && current.current) setView({ kind: 'workspace', pane: { kind: 'chat', conversationId: current.current.activeConversationId } });
      notify('备份已恢复，附件和批注可以继续使用。');
    } finally { fileOperation.current = false; setFileBusy(false); }
  }
  async function purgeTrash(target: TrashTarget) {
    if (fileOperation.current || mainRequest.current || annotationRequests.current.size) throw new Error('请先停止正在生成的回答，等待文件处理完成后再清理回收站。');
    fileOperation.current = true; setFileBusy(true);
    try { await purge(target); setOpenAnnotationId(null); notify(target.kind === 'all' ? '回收站已清空。' : '已永久删除，无法从回收站恢复。'); }
    finally { fileOperation.current = false; setFileBusy(false); }
  }
  async function restoreTrash(target: Exclude<TrashTarget, { kind: 'all' }>) {
    if (fileOperation.current || mainRequest.current || annotationRequests.current.size) throw new Error('请等文件处理和回答结束后再恢复。');
    fileOperation.current = true; setFileBusy(true);
    try {
      if (target.kind === 'project') update(w => restoreProject(w, target.id));
      else if (target.kind === 'conversation') {
        const restored = update(w => restoreConversation(w, target.id));
        const selected = findConversation(restored, target.id);
        if (selected) showChat(selected);
      } else {
        const annotation = current.current?.conversations.find(c => c.id === target.conversationId)?.annotations.find(a => a.id === target.id);
        if (!annotation) throw new Error('这条批注已不在回收站。');
        restoreLocalAnnotation(target.conversationId, annotation);
      }
      await flush(); setTrashOpen(false); setSidebarOpen(false); notify(target.kind === 'project' ? '项目已恢复。' : '记录已恢复。');
    } finally { fileOperation.current = false; setFileBusy(false); }
    if (target.kind === 'project') openProject(target.id);
  }
  const homeMenu = <ReaderHomeMenu busy={fileBusy || turnBusy} openFileDisabled={fileBusy || turnBusy || mainBusyId !== null || annotationRequests.current.size > 0}
    onOpenFile={chooseReaderFile} onNewChat={() => newConversation()} onConversations={openChatList} onNewProject={() => setProjectDialog({})}
    onKnowledge={knowledge.available ? openKnowledge : undefined} onWiki={wikiRepository ? openWiki : undefined}
    onSettings={() => setAppSettingsOpen(true)} onModels={() => setSettingsOpen(true)}
    onBackup={() => setRecoveryOpen(true)} onImport={() => fileInput.current?.click()} onTrash={() => setTrashOpen(true)}
    onUndoDelete={latestDeleted ? undoDelete : undefined} />;
  const recoveryDialog = recoveryOpen && <RecoveryDialog recovery={Boolean(loadError)} onClose={() => setRecoveryOpen(false)} onRestore={restoreBackup} onCreate={() => checkpoint({ force: true })} onDeleted={invalidateCheckpoint}
    onExport={workspace ? (legacy, currentOnly) => downloadBackup(currentOnly ? current.current?.activeConversationId : undefined, legacy, true) : undefined}
    onExportKnowledge={knowledge.available ? downloadKnowledge : undefined} />;
  if (!workspace || !active) return <div className="loading-screen"><BrandLogo size={78} /><h1>{__APP_NAME__}</h1><p>{t(loadError || t("正在打开你的阅读空间…"))}</p>{loadError && <div className="recovery-toolbar"><button onClick={() => setRecoveryOpen(true)} className="primary-button">{t("从备份恢复")}</button><button onClick={() => location.reload()} className="secondary-button">{t("重新打开")}</button></div>}{recoveryDialog}</div>;
  if (wikiOpen && wikiRepository) return <>
    <Suspense fallback={<div className="loading-screen"><BrandLogo size={66} /><p>{t('正在打开个人知识库…')}</p></div>}>
      <WikiWorkspace workspace={workspace} cards={knowledge.cards} repository={wikiRepository} resumeId={wikiResume} incoming={wikiMaterial}
        onChanged={invalidateCheckpoint} onRemember={setWikiResume} flushRef={wikiFlush} onExit={() => setWikiOpen(false)} onOpenSource={openWikiSource}
        onLegacy={knowledge.available ? () => { setWikiOpen(false); openKnowledge(); } : undefined} />
    </Suspense>
    {closing && <div className="closing-overlay" role="status">{t('正在保存并关闭…')}</div>}
  </>;
  const summarySource = summaryDialog && findConversation(workspace, summaryDialog.conversationId);
  const collectionNote = collectionDialog && findConversation(workspace, collectionDialog.ownerId)?.annotations.find(annotation => annotation.id === collectionDialog.annotationId);
  const draftProject = knowledgeDraft?.projectId ? findConversation(workspace, knowledgeDraft.projectId) : undefined;
  const shortcutsActive = !closing && !fileBusy && !turnBusy && !drawerVisible && !appearanceOpen && !settingsOpen && !apiSetupOpen && !webSearchOpen && !appSettingsOpen && !recoveryOpen && !trashOpen && !summaryDialog && !projectDialog && !organizeProjectsOpen && !collectionDialog && !knowledgeOpen && !knowledgeDraft;
  const modelLabel = settings.mode === 'demo' ? t("演示模式") : settings.model || t("连接模型");
  const workspaceBusy = closing || fileBusy || turnBusy || mainBusyId !== null || annotationRequests.current.size > 0;
  const searchBusy = Boolean(inquiryRun?.step);
  const pendingWebRetry = inquiryRun?.projectId === overviewProject?.id ? inquiryRun?.retry : undefined;
  const lastMessage = active.messages.at(-1);
  const preparingIntro = Boolean(lastMessage?.inquiryIntro && activeVersion(lastMessage).status === 'streaming');
  const guideThread = overviewThreads.find(thread => thread.messages.some(message => message.inquiryIntro));
  const returnProject = overviewProject || readerProject;
  const openModels = () => setSettingsOpen(true);
  const changeModel = (id: string | null) => { void chooseModel(id).catch(error => notify(errorText(error))); };
  const readerPane = openDocument && readerOwner ? <div className="document-pane">
    {readerSplit && preview && pane && <SplitDocumentTabs key={previewScope} preview={preview} documents={panelDocuments} disabled={fileBusy || turnBusy || closing}
      onOpen={ref => { if (!fileOperation.current && !closingRef.current) openReaderReference(ref, 'split', pane); }} onClose={closeDocumentTab} />}
    <div className="document-pane-body" id={readerSplit ? SPLIT_READER_PANEL_ID : undefined} role={readerSplit ? 'tabpanel' : undefined} aria-label={readerSplit ? openDocument.name : undefined}>
      <DocumentReader key={openDocument.id} source={openDocument} conversationId={readerOwner.id} focused={readerFocused} onPdfChange={setReaderPdf}
        onReferenceToChat={(id, childId) => referenceAnnotationToChat(id, openDocument.id, childId)}
        modelSettings={settings} onFigureAsk={(id, image, profileId) => void askAnnotation(readerOwner.id, id, { image, profileId })}
        onFigureStrokes={(id, strokes) => { try { mutateConversation(readerOwner.id, c => updateFigureStrokes(c, id, strokes)); } catch (error) { notify(errorText(error)); } }}
        contextMode={contextMode} onContextMode={changeContextMode} onLocation={onReaderLocation} pageJump={readerPageJump} onPageJumped={onPageJumped}
        modelLabel={modelLabel} onOpenModelSettings={openModels} onBackup={() => setRecoveryOpen(true)} onOpenKnowledge={knowledge.available ? openKnowledge : undefined}
        onOpenWiki={wikiRepository && readerFocused && !fileBusy && !closing ? openWiki : undefined}
        projectReturn={returnProject ? { title: returnProject.title, onReturn: closeReader } : undefined}
        appearance={appearance} appearanceSaved={appearanceSaved} onAppearance={setAppearance} onOpenFile={chooseReaderFile} onToggleFocus={toggleReaderFocus}
        annotations={readerAnnotations} reservedColors={readerOwner.annotations.map(a => a.color)} openAnnotationId={openAnnotationId} onOpen={setOpenAnnotationId}
        onDismissFigure={() => setOpenedAnnotation(previous => readerAnnotations.some(annotation => annotation.id === previous && annotation.figure) ? null : previous)}
        onCreate={a => addAnnotation(readerOwner.id, a)} onUpdate={(id, patch) => editAnnotation(readerOwner.id, id, patch)}
        onAsk={id => askAnnotation(readerOwner.id, id)} onReask={(id, action) => reaskAnnotation(readerOwner.id, id, action)}
        onStop={id => annotationRequests.current.get(id)?.abort()} onDelete={id => removeAnnotation(readerOwner.id, id)}
        onNotify={notify} disabled={mainBusyId !== null || fileBusy || turnBusy} onClose={readerFocused ? showHome : closeReader} />
    </div>
  </div> : null;
  return <AnnotationActions.Provider value={{
    toWiki: wikiRepository ? (ownerId,messageId,versionId,selection,note,childId) => {
      const owner=current.current && findConversation(current.current,ownerId);
      const material=owner && selectedWikiMaterial(owner,messageId,versionId,selection,note,childId);
      if (material) showWiki(material);
    } : undefined,
    readerPdf, sourceDocument, openSource:(annotation,report,id)=>{
      const doc=sourceDocument(annotation,report);
      const sourceHit=doc && evidenceSearchHit(doc,report,id);
      if (!doc || !sourceHit) {notify('这条来源无法在原文版本中定位。');return;}
      if (openDocument?.id!==doc.id) openReaderReference({conversationId:annotation.conversationId,document:doc});
      setOpenAnnotationId(null);
      setReaderPageJump({documentId:doc.id,pageNumber:sourceHit.hit.pageNumber,sourceHit});
    }, feedback:(a,id,feedback)=>{
      try {mutateConversation(a.conversationId,c=>setBranchFeedback(c,a.id,id,feedback));} catch(error){notify(errorText(error));}
    },
    addSlot: addAnnotationSlot, lastOpenedSlot: id => lastOpenedSlots.current.get(id),
    editChild: editAnnotationChild, saveChildNote: saveAnnotationChildNote, deleteChild: deleteAnnotationChild, askChild: askAnnotationChild,
    anchors: annotationAnchors, childWindows, windowOrder, dispatchWindow, hoveredChild, setHoveredChild, streams: subAnnotationStreams,
  }}><KnowledgeCardActions.Provider value={knowledge.available ? saveAnnotationToKnowledge : null}><AnnotationChatActions.Provider value={{ openTurn: openSourceTurn, collect: readerProject || chatVisible && activeProject ? openCollection : undefined }}><ChatTextReferenceProvider value={{ enabled: shortcutsActive, quote: quoteText }}><TranslationProvider settings={settings} scope={`${active.id}:${openDocument?.id || 'chat'}:${view.kind}:${pane?.kind || ''}`} enabled={shortcutsActive} onSaveProfile={storeTranslationProfile} onDeleteProfile={removeProfile} onNotify={notify}><div className={'app-shell reader-primary' + (readerFocused ? ' reader-focused' : '')}>
    {drawerVisible && <button type="button" className="mobile-overlay" aria-hidden="true" tabIndex={-1} onClick={closeSidebar} />}
    {sidebarVisible && pane && <aside id="conversation-sidebar" className={'sidebar ' + (drawerVisible ? 'sidebar-open' : '')} role={drawerVisible ? 'dialog' : undefined}
      aria-label={t('项目')} aria-modal={drawerVisible || undefined} onKeyDown={event => {
        if (!drawerVisible || event.defaultPrevented || event.key !== 'Tab') return;
        const from = event.shiftKey ? sidebarCloseButton.current : sidebarSettingsButton.current;
        const to = event.shiftKey ? sidebarSettingsButton.current : sidebarCloseButton.current;
        if (event.target === from) { event.preventDefault(); to?.focus({ preventScroll: true }); }
      }}>
      <div className="brand"><BrandLogo size={51} className="brand-mark" /><span className="brand-name"><span className="brand-title">{__APP_NAME__}</span></span><button ref={sidebarCloseButton} type="button" className="icon-button sidebar-toggle" aria-label={t('收起侧栏')} title={t('收起侧栏')} onClick={closeSidebar}><PanelLeftClose size={18} /></button></div>
      <button type="button" className="open-reading-file sidebar-home" disabled={fileBusy} onClick={showHome}><Home size={17} />{t('工作台首页')}</button>
      <button type="button" className="open-reading-file" disabled={fileBusy} onClick={() => newConversation()}><Plus size={17} />{t("开启新对话")}</button>
      <button className="open-reading-file" disabled={fileBusy || mainBusyId !== null} onClick={chooseReaderFile}><BookOpen size={17} />{t("打开 PDF / 电子书")}</button>
      <button className="open-reading-file" disabled={fileBusy || mainBusyId !== null} onClick={() => setProjectDialog({})}><FolderPlus size={17} />{t('新建项目')}</button>
      {knowledge.available && <button className="open-reading-file" onClick={openKnowledge}><BookMarked size={17} />{t('知识卡片')}</button>}
      <div className="sidebar-section-label sidebar-project-label"><span>{t('项目')}</span>
        {workspace.conversations.some(c => c.isProject && c.deletedAt === undefined) && <button type="button" className="document-tool-button"
          aria-label={t('整理项目')} aria-haspopup="dialog" onClick={() => setOrganizeProjectsOpen(true)}>{t('整理')}</button>}
      </div>
      <ProjectConversationList records={workspace.conversations} pane={pane} expanded={expandedProjects} busyId={mainBusyId} disabled={fileBusy || turnBusy || closing}
        onOpen={selectConversation} onToggle={toggleProject} onOverview={openProject} onNewChat={newConversation}
        onRename={renameRecord} onMove={id => setProjectDialog({ conversationId: id })} onDelete={removeConversation} onDeleteProject={removeProject} />
      <div className="sidebar-bottom">
        <button className="sidebar-settings" disabled={fileBusy} onClick={() => setTrashOpen(true)}><Trash2 size={16} /><span>{t("回收站（")}{deleted?.count ?? 0}）</span></button>
        {latestDeleted && <button className="sidebar-settings undo-deletion" onClick={undoDelete} disabled={mainBusyId !== null} title={t("恢复最近删除的批注与高亮，刷新后仍可使用")}><RotateCcw size={16} /><span>{t("撤销删除")}</span></button>}
        <div className="backup-actions"><button disabled={fileBusy} onClick={() => fileInput.current?.click()}><FileUp size={15} />{t("导入")}</button><button onClick={() => setRecoveryOpen(true)}><RotateCcw size={15} />{t("备份与恢复")}</button></div>
        <button ref={sidebarSettingsButton} className="sidebar-settings app-settings-trigger" aria-label={t('设置')} onClick={() => setAppSettingsOpen(true)}><Settings2 size={17} /><span>{t('设置')}</span></button>
        <div className={'save-status ' + (saveStatus.startsWith("保存失败") ? 'save-error' : '')}><span />{t(saveStatus)}</div>
        {lastBackup && <div className="backup-time">{t("自动备份")}{new Date(lastBackup).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })}</div>}
      </div>
    </aside>}
    <main className="main-pane" inert={drawerVisible}>
      {workspaceOpen && <header className="topbar" data-reader-split={readerSplit} data-project-overview={pane?.kind === 'overview'}>
        <div className="topbar-heading">
          {(!sidebarVisible || compactSidebar) && <button ref={sidebarMenuButton} type="button" className="icon-button" aria-label={t('展开侧栏')} title={t('展开侧栏')}
            aria-controls="conversation-sidebar" aria-expanded={sidebarVisible} onClick={openSidebar}><PanelLeft size={20} /></button>}
          {!sidebarVisible && <button type="button" className="icon-button" aria-label={t('返回工作台')} title={t('返回工作台')} disabled={fileBusy} onClick={showHome}><ArrowLeft size={17} /></button>}
          {chatVisible && <span title={active.title}>{active.title}</span>}
          {chatVisible && <span className="version-badge" title={t("构建 {0} · {1}", [__APP_BUILD__, new Date(__APP_BUILD_TIME__).toLocaleString(getLocale(), { hour12: false })])}>{__APP_VERSION__} · {__APP_BUILD__}</span>}
        </div>
        <div className="topbar-actions">
          {wikiRepository && <button type="button" className="document-tool-button wiki-launch-button" aria-label={t('个人知识库')} title={t('个人知识库')} disabled={fileBusy || turnBusy || closing} onClick={openWiki}><BookOpenText size={17} /><span>{t('个人知识库')}</span></button>}
          <AppearanceButton onOpen={() => setAppearanceOpen(true)} /><TranslationButton />{!readerSplit && <ShortcutButton />}
          {chatVisible && (openDocument || reopenDocument) && <div className="reader-mode-actions">
            {!openDocument && reopenDocument && <button type="button" className="reader-mode-button" aria-label={t('展开文档与聊天并排阅读')} title={t('展开文档：{0}', [reopenDocument.name])} disabled={fileBusy || turnBusy} onClick={() => expandReader('split')}><Columns2 size={17} /><span>{t('展开文档')}</span></button>}
            <button type="button" className="reader-mode-button" aria-label={t('返回阅读模式')} title={t('返回阅读模式')} disabled={fileBusy || turnBusy} onClick={() => expandReader('focused')}><BookOpen size={17} /><span>{t('阅读模式')}</span></button>
          </div>}
          {chatVisible && <button type="button" className="icon-button" aria-label={t("备份当前对话")} title={t("单独备份这个对话及其文件")} onClick={() => void downloadBackup(active.id)}><Download size={17} /></button>}
          <button type="button" className="connection-button" aria-label={t("模型与设置")} title={modelLabel} onClick={openModels}><span className="status-dot" /><span className="connection-label">{modelLabel}</span><Settings2 size={14} /></button>
        </div>
      </header>}
      {view.kind === 'home' && <ReaderHome menu={homeMenu} onAppearance={() => setAppearanceOpen(true)} settings={settings} onChooseModel={changeModel} onWiki={wikiRepository ? openWiki : undefined}
        recent={library.recent} onSetRecentHidden={(selection, hide) => { if (!library.setRecentHidden(selection, hide)) notify(t('阅读列表整理仅在本次有效。')); }}
        conversations={workspace.conversations} busy={workspaceBusy || modelSwitchBusy} exploreBusy={searchBusy} loading={library.loading}
        onExplore={exploreQuestion} onProject={openProject} onNewProject={() => setProjectDialog({})} onOrganizeProjects={() => setOrganizeProjectsOpen(true)}
        onOpenFile={chooseReaderFile} onDropFile={file => void uploadDocument(file, 'open')} onOpenDocument={openLibraryDocument} onChat={openChatList} onSettings={openModels} />}
      <WorkspaceSplit split={readerSplit} hidden={view.kind === 'home'} reader={readerPane}>
      {overviewProject?.isProject && <div className="project-overview-pane" hidden={!workspaceOpen}><ProjectOverview key={overviewProject.id} project={overviewProject} threads={overviewThreads} documents={overviewDocuments}
        cards={projectKnowledge(knowledge.cards, overviewProject, workspace.conversations)} run={inquiryRun?.projectId === overviewProject.id ? inquiryRun : undefined}
        busy={workspaceBusy} searchBusy={searchBusy} onNewChat={() => newConversation(overviewProject.id)}
        onRename={title => renameRecord(overviewProject.id, title)}
        onSearch={focus => void runInquiry(overviewProject.id, 'search', focus)} onCancel={() => inquiryRequest.current?.abort()}
        onWebSearch={() => setWebSearchOpen(true)}
        onRetryWeb={pendingWebRetry ? () => void runInquiry(overviewProject.id, 'search', pendingWebRetry.focus, pendingWebRetry.reply, pendingWebRetry.plan) : undefined}
        onGenerateGuide={overviewProject.inquiry?.question && inquirySources(overviewProject.inquiry).length && !guideThread ? () => startSavedInquiry(overviewProject) : undefined}
        onContinue={guideThread ? () => selectConversation(guideThread.id) : undefined}
        onAttach={sourceId => chooseAttachment({ projectId: overviewProject.id, sourceId, stayOnOverview: true })}
        onOpen={(ref, mode) => openProjectDocument(overviewProject.id, ref, mode)}
        onDownload={source => void uploadDocument(signal => downloadResearchPdf(source, signal), 'attach', { projectId: overviewProject.id, sourceId: source.id })}
        onNote={(id, note, online) => saveSourceNote(overviewProject.id, id, note, online)}
        onReadingStatus={(id, status) => {
          try { updateInquiry(overviewProject.id, inquiry => setResearchReadingStatus(inquiry, id, status)); }
          catch (error) { notify(errorText(error)); }
        }}
        onOverviewCard={knowledge.available ? () => saveOverview(overviewProject) : undefined}
        onOpenCard={card => { if (card.source) void openKnowledgeSource(card.source, overviewProject.id).then(opened => { if (!opened) notify('本机找不到这份出处。'); }).catch(error => notify(errorText(error))); }}
        onEditCard={card => setKnowledgeDraft({ ...card, projectId: overviewProject.id })}
      /></div>}
      <div className="conversation-pane" hidden={!chatVisible}>
      <ChatView key={active.id}
        preparingIntro={preparingIntro} onSectionChange={active.projectId ? setSection : undefined}
        onReadingSources={activeProject ? () => openProject(activeProject.id) : undefined}
        researchSources={activeProject?.inquiry?.sources}
        researchRun={chatResearchRun?.conversationId === active.id ? chatResearchRun : undefined}
        onSupplementPapers={(messageId, versionId) => void supplementChatPapers(active.id, messageId, versionId)}
        onCollectPaper={(messageId, versionId, sourceId) => collectChatPaper({ conversationId: active.id, messageId, versionId, sourceId })}
        onReadPaper={(messageId, versionId, sourceId) => readChatPaper({ conversationId: active.id, messageId, versionId, sourceId })}
        knowledge={knowledge.available ? { cards: knowledge.cards, loading: knowledge.loading, loadError: knowledge.loadError, saveAnswer: saveAnswerToKnowledge } : undefined}
        visible={chatVisible} fileGroups={activeFileGroups} filesLoading={library.loading} conversation={availableChat || active} isRunning={mainBusyId === active.id}
        previewDocumentId={chatVisible && readerSplit ? openDocument?.id : undefined}
        globallyBusy={mainBusyId !== null || modelSwitchBusy || fileBusy || turnBusy || closing || preparingIntro}
        turnDeleteDisabled={workspace.conversations.some(conversation => conversation.annotations.some(isAnnotationGenerating))}
        textReference={chatTextReference} onClearTextReference={() => setChatTextReference(null)}
        modelSwitchDisabled={modelSwitchBusy || mainBusyId !== null || turnBusy || searchBusy || active.annotations.some(isAnnotationGenerating)}
        onChooseModel={changeModel} onManageModels={openModels} settings={settings} openAnnotationId={openAnnotationId} onOpen={setOpenAnnotationId}
        onSend={(q, ids, files, history, cards, sources, mode) => sendMain(active.id, q, ids, chatTextReference || undefined, files, history, cards, sources, mode)}
        onDeleteTurn={id => removeTurn(active.id, id)} onDeleteTurns={ids => removeTurn(active.id, ids)}
        onSummarize={ids => { document.dispatchEvent(new Event('learn:save-edits')); setSummaryDialog({ conversationId: active.id, turnIds: ids }); }}
        sourceJump={sourceJump?.conversationId === active.id ? sourceJump : undefined}
        annotationChatRequest={chatAnnotationRequest?.conversationId === active.id ? chatAnnotationRequest : null}
        onAnnotationReferenceHandled={request => setChatAnnotationRequest(previous => previous === request ? null : previous)}
        onReferenceToChat={(id, childId) => referenceAnnotationToChat(id, undefined, childId)}
        onStop={() => mainRequest.current?.controller.abort()} onRegenerate={id => regenerate(active.id, id)} onVersion={(messageId, versionId) => setVersion(active.id, messageId, versionId)}
        onCreate={a => addAnnotation(active.id, a)} onUpdate={(id, patch) => editAnnotation(active.id, id, patch)} onAsk={id => askAnnotation(active.id, id)}
        onReask={(id, action) => reaskAnnotation(active.id, id, action)} onStopAnnotation={id => annotationRequests.current.get(id)?.abort()} onDelete={id => removeAnnotation(active.id, id)}
        onNotify={notify} onUpload={() => chooseAttachment()} onOpenDocument={openChatDocument} fileBusy={fileBusy} />
      </div>
      </WorkspaceSplit>
    </main>
    <input ref={fileInput} className="visually-hidden" tabIndex={-1} type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; if (file) void importBackup(file); }} aria-label={t("导入聊天备份")} />
    <input ref={readerInput} className="visually-hidden" tabIndex={-1} type="file" accept={READER_ACCEPT} onChange={e => { const file = e.target.files?.[0]; if (file) void uploadDocument(file, 'open'); }} aria-label={t("选择 PDF 或电子书")} />
    <input ref={uploadInput} className="visually-hidden" tabIndex={-1} type="file" accept={DOCUMENT_ACCEPT} onChange={event => {
      const file = event.currentTarget.files?.[0]; const target = uploadTarget.current; uploadTarget.current = undefined;
      if (file) void uploadDocument(file, 'attach', target);
    }} aria-label={t("添加本地 PDF 或文本文件")} />
    {fileProgress && <div className="file-open-progress" role="status"><span>{fileProgress.total ? t("正在提取文字：{0} / {1}", [fileProgress.page, fileProgress.total]) : t(fileProgress.downloading ? '正在下载 PDF…' : "正在读取本地文件…")}</span><progress max={fileProgress.total || 1} value={fileProgress.total ? fileProgress.page : undefined} /><button type="button" onClick={() => fileController.current?.abort()}>{t("取消打开")}</button></div>}
    {searchBusy && !fileProgress && (!workspaceOpen || inquiryRun?.projectId !== overviewProject?.id) && <div className="file-open-progress inquiry-background-search" role="status">
      <span className="inquiry-spinner" aria-hidden="true" /><span>{t('正在检索课题资料…')}</span><button type="button" onClick={() => inquiryRequest.current?.abort()}>{t('停止检索')}</button>
    </div>}
    {chatResearchRun && !fileProgress && (!chatVisible || active.id !== chatResearchRun.conversationId) && <div className="file-open-progress inquiry-background-search" role="status">
      <span className="inquiry-spinner" aria-hidden="true" /><span>{t(chatResearchRun.mode === 'web' ? '正在联网查询…' : researchStepText[chatResearchRun.step])}</span>
      <button type="button" onClick={() => mainRequest.current?.controller.abort()}>{t('停止检索')}</button>
    </div>}
    {notice && <div role="status" className="toast">{t(notice)}{notice === "已删除批注与高亮，可撤销。" && latestDeleted && <button className="undo-toast" onClick={undoDelete}>{t("撤销")}</button>}<button className="icon-button" aria-label={t("关闭提示")} onClick={() => setNotice('')}><X size={15} /></button></div>}
    {saveStatus.startsWith("保存失败") && <div className="save-failure" role="alert">{t(saveStatus)}<button onClick={() => void downloadBackup()}>{t("导出备份")}</button></div>}
    {appSettingsOpen && <AppSettingsDialog onClose={() => setAppSettingsOpen(false)} onModels={() => { setAppSettingsOpen(false); openModels(); }} onAppearance={() => { setAppSettingsOpen(false); setAppearanceOpen(true); }} onWebSearch={() => { setAppSettingsOpen(false); setWebSearchOpen(true); }} />}
    {apiSetupOpen && <ApiSetupPrompt onClose={() => setApiSetupOpen(false)} onConfigure={() => { setApiSetupOpen(false); openModels(); }} />}
    {webSearchOpen && <WebSearchDialog onClose={() => setWebSearchOpen(false)} />}
    {appearanceOpen && <AppearanceDialog appearance={appearance} onChange={setAppearance} saved={appearanceSaved} onClose={() => setAppearanceOpen(false)} />}
    {projectDialog && <ProjectDialog projects={workspace.conversations.filter(c => c.isProject && c.deletedAt === undefined)} conversation={projectDialog.conversationId ? findConversation(workspace, projectDialog.conversationId) : undefined} onApply={applyProject} onClose={() => setProjectDialog(null)} />}
    {organizeProjectsOpen && <ProjectOrganizer records={workspace.conversations} busy={fileBusy || turnBusy || closing}
      busyProject={inquiryRun?.step ? inquiryRun.projectId : undefined} onClose={() => setOrganizeProjectsOpen(false)} onTrash={moveProjectsToTrash} />}
    {summaryDialog && summarySource && <AnnotationSummaryDialog conversation={projectResources(summarySource, projectFor(workspace, summarySource))} turnCount={summaryDialog.turnIds.length} suggested={summaryTarget(summarySource, summaryDialog.turnIds)} onGenerate={generateSummary} onSave={saveSummary} onClose={() => setSummaryDialog(null)} />}
    {collectionDialog && collectionNote && <CollectHistoryDialog choices={collectionChoices(workspace, collectionDialog.projectId, collectionNote)} onApply={saveCollection} onClose={() => setCollectionDialog(null)} />}
    {settingsOpen && <SettingsDialog settings={settings} onClose={closeSettings} onSaveProfile={storeProfile} onDeleteProfile={removeProfile} onSelectProfile={chooseModel} />}
    {recoveryDialog}
    {knowledgeOpen && <KnowledgeBase cards={knowledge.cards} loading={knowledge.loading} loadError={knowledge.loadError} recovered={knowledge.recovered}
      onReload={() => void knowledge.reload()} onClose={() => setKnowledgeOpen(false)} onEdit={setKnowledgeDraft} onRemove={knowledge.remove} onOpenSource={openKnowledgeSource} />}
    {knowledgeDraft && <KnowledgeCardEditor draft={knowledgeDraft} project={draftProject?.isProject ? draftProject : undefined} disabled={closing || knowledge.loading} onClose={() => setKnowledgeDraft(null)}
      onSave={async draft => { await knowledge.save(draft); setKnowledgeDraft(null); notify('知识卡片已保存。'); }} />}
    {trashOpen && <TrashDialog workspace={workspace} busy={fileBusy || mainBusyId !== null || annotationRequests.current.size > 0} onClose={() => setTrashOpen(false)} onPurge={purgeTrash} onRestore={restoreTrash} />}
    {backupWarning && <div className="save-failure" role="alert">{t(backupWarning)}<button onClick={() => setRecoveryOpen(true)}>{t("备份与恢复")}</button></div>}
    {closing && <div className="closing-overlay" role="status">{t("正在保存并关闭…")}</div>}
    <AnnotationWindows windows={openedWindows} chat={chatVisible ? availableChat || active : undefined} chatBusy={mainBusyId === active.id}
      reader={view.kind !== 'home' && openDocument && readerOwner ? { source: openDocument, ownerId: readerOwner.id, annotations: readerAnnotations,
        disabled: mainBusyId !== null || fileBusy || turnBusy } : undefined}
      onOpen={setOpenAnnotationId} onClose={closeAnnotationWindows} onUpdate={editAnnotation} onAsk={askAnnotation}
      onStop={id => annotationRequests.current.get(id)?.abort()} onReask={reaskAnnotation} onDelete={removeAnnotation}
      onReference={referenceAnnotationToChat} />
  </div></TranslationProvider></ChatTextReferenceProvider></AnnotationChatActions.Provider></KnowledgeCardActions.Provider></AnnotationActions.Provider>;
}

type ChatViewProps = {
  conversation: Conversation; isRunning: boolean; globallyBusy: boolean; settings: ModelSettings; visible: boolean;
  previewDocumentId?: string;
  preparingIntro?: boolean; onReadingSources?: () => void; onSectionChange?: (value: string | undefined) => void;
  researchSources?: InquirySource[];
  researchRun?: ChatResearchRun;
  onSupplementPapers: (messageId: string, versionId: string) => void;
  onCollectPaper: (messageId: string, versionId: string, sourceId: string) => void;
  onReadPaper: (messageId: string, versionId: string, sourceId: string) => void;
  openAnnotationId: string | null; onOpen: (id: string | null) => void;
  onSend: (question: string, annotationIds?: string[], documentIds?: string[], useHistory?: boolean, knowledgeIds?: string[], researchSourceIds?: string[], mode?: ChatSearchMode) => Promise<boolean>; onStop: () => void; onRegenerate: (id: string) => void;
  knowledge?: { cards: KnowledgeCard[]; loading: boolean; loadError: boolean; saveAnswer: (messageId: string, versionId: string) => void };
  onDeleteTurn: (messageId: string) => Promise<void>;
  onDeleteTurns: (messageIds: string[]) => Promise<void>;
  onSummarize?: (messageIds: string[]) => void;
  sourceJump?: { id: string; serial: number };
  annotationChatRequest: AnnotationChatRequest | null; onAnnotationReferenceHandled: (request: AnnotationChatRequest) => void;
  onReferenceToChat: (id: string, subAnnotationId?: string) => void;
  turnDeleteDisabled: boolean;
  textReference: ChatTextReference | null; onClearTextReference: () => void;
  onVersion: (messageId: string, versionId: string) => void;
  onCreate: (annotation: Annotation) => void; onUpdate: (id: string, patch: Partial<Annotation>) => void; onAsk: (id: string) => void; onReask: (id: string, action: 'start' | 'cancel' | 'edit') => void; onStopAnnotation: (id: string) => void;
  onDelete: (id: string) => void; onNotify: (message: string) => void;
  modelSwitchDisabled: boolean; onChooseModel: (id: string | null) => void; onManageModels: () => void;
  onUpload: () => void; onOpenDocument: (id: string) => void; fileBusy: boolean;
  fileGroups: LocalDocumentGroup[]; filesLoading: boolean;
};
function ChatFileChip({ file, disabled, onOpen }: { file: DocumentAttachment; disabled: boolean; onOpen: (id: string) => void }) {
  return <button type="button" className="chat-file-chip" disabled={disabled} title={file.name} aria-label={t('阅读 {0}', [file.name])} onClick={() => onOpen(file.id)}>
    <FileText size={13} aria-hidden="true" /><span>{file.name}</span>
  </button>;
}

export function ChatView(props: ChatViewProps) {
  useLocale();
  const wikiActions=useContext(AnnotationActions);
  const { conversation, settings, isRunning, globallyBusy } = props;
  const projectChat = Boolean(conversation.projectId);
  const [searchMode, setSearchMode] = useState<ChatSearchMode>('local');
  useEffect(() => { if (!props.visible) setSearchMode('local'); }, [props.visible]);
  const [atBottom, setAtBottom] = useState(true);
  const [jumpTarget, setJumpTarget] = useState<{ id: string; serial: number } | null>(null);
  const chatPosition = useChatPosition(conversation.id, props.visible, isRunning, setAtBottom, conversation.messages.length === 2 && conversation.messages[1].inquiryIntro === true);
  useLayoutEffect(() => { if (props.preparingIntro) chatPosition.onSend(); }, [props.preparingIntro]);
  useEffect(() => { if (props.sourceJump) setJumpTarget(props.sourceJump); }, [props.sourceJump]);
  useLayoutEffect(() => {
    if (!jumpTarget) return;
    if (!props.visible) { setJumpTarget(null); return; }
    chatPosition.scrollToMessage(jumpTarget.id);
    const timer = setTimeout(() => setJumpTarget(null), 1500);
    return () => clearTimeout(timer);
  }, [jumpTarget, props.visible]);
  const copyMessages = useRef(conversation.messages); copyMessages.current = conversation.messages;
  useEffect(() => {
    const viewport = chatPosition.viewportRef.current, content = chatPosition.contentRef.current;
    if (props.visible && viewport && content) return bindCompleteChatCopy(viewport, content, () => copyMessages.current, () => t('你'));
  }, [props.visible, chatPosition.contentRef, chatPosition.viewportRef]);
  const translation = useTranslation();
  const heldPosition = useMemo(() => loadChatPosition(conversation.id), [conversation.id, props.visible]);
  const initialIndex = heldPosition?.anchor ? conversation.messages.findIndex(message => message.id === heldPosition.anchor!.messageId) : heldPosition?.atBottom === false ? 0 : conversation.messages.length - 1;
  const annotationsBySource = useMemo(() => {
    const groups = new Map<string, Annotation[]>();
    for (const annotation of conversation.annotations) { const key = `${annotation.messageId}:${annotation.versionId}`; const items = groups.get(key) || []; items.push(annotation); groups.set(key, items); }
    return groups;
  }, [conversation.annotations]);
  const [selectedAnnotations, setSelectedAnnotations] = useState<string[]>([]), [pickingAnnotations, setPickingAnnotations] = useState(false), [deletingMessage, setDeletingMessage] = useState<string | null>(null);
  // Null follows the reader. An empty selection explicitly excludes documents for this draft.
  const [documentSelection, setDocumentSelection] = useState<string[] | null>(null);
  const [selectedResearch, setSelectedResearch] = useState<string[]>([]);
  const [useHistory, setUseHistory] = useState(false);
  const [selectedKnowledge, setSelectedKnowledge] = useState<string[]>([]);
  const [knowledgePicker, setKnowledgePicker] = useState<{ mention?: { text: string; at: number } } | null>(null);
  const knowledgeCards = props.knowledge?.cards;
  const pickedCards = selectedKnowledge.flatMap(id => {
    const card = knowledgeCards?.find(item => item.id === id);
    return card ? [card] : [];
  });
  const localById = useMemo(() => new Map((conversation.documents ?? []).map(file => [file.id, file])), [conversation.documents]);
  const previewId = props.previewDocumentId;
  const selectedDocuments = documentSelection ?? (previewId && localById.has(previewId) ? [previewId] : []);
  const referenceCount = selectedAnnotations.length + selectedDocuments.length + selectedResearch.length;
  const pickedFiles = selectedDocuments.map(id => localById.get(id)).filter(file => file !== undefined);
  const pickedResearchNames = (props.researchSources ?? []).filter(source => selectedResearch.includes(source.id)).map(source => source.title);
  const annotationSummary = t('已选 {0} 条批注', [selectedAnnotations.length]);
  const hasFileChoices = projectChat || Boolean(conversation.documents?.length);
  const referenceLabel = hasFileChoices ? '引用资料' : '引用批注';
  const clearReferenceLabel = hasFileChoices ? '清除本次引用' : '清除本次批注引用';
  const referenceableAnnotations = useMemo(() => new Set(annotationReferenceChoices(conversation.annotations).map(choice => choice.id)), [conversation.annotations]);
  useEffect(() => { setSelectedAnnotations(previous => { const next = previous.filter(id => referenceableAnnotations.has(id)); return next.length === previous.length ? previous : next; }); }, [referenceableAnnotations]);
  useEffect(() => {
    setDocumentSelection(previous => {
      if (previous === null) return previous;
      const next = previous.filter(id => localById.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [localById]);
  useEffect(() => { setSelectedResearch(previous => { const next = previous.filter(id => props.researchSources?.some(source => source.id === id)); return next.length === previous.length ? previous : next; }); }, [props.researchSources]);
  useEffect(() => {
    setSelectedKnowledge(previous => {
      const next = previous.filter(id => knowledgeCards?.some(card => card.id === id));
      return next.length === previous.length ? previous : next;
    });
  }, [knowledgeCards]);
  useEffect(() => {
    const request = props.annotationChatRequest; if (!request) return;
    if (referenceableAnnotations.has(request.id)) {
      if (!selectedAnnotations.includes(request.id) && selectedAnnotations.length >= MAX_CHAT_REFERENCES) props.onNotify('每次最多引用 10 条批注。');
      else {
        try {
          if (request.documentId) {
            setDocumentSelection(chooseDocuments(conversation, [...selectedDocuments, request.documentId], 'auto').ids);
          }
          setSelectedAnnotations(previous => previous.includes(request.id) ? previous : [...previous, request.id]);
          queueMicrotask(() => chatPosition.viewportRef.current?.closest('.chat-root')?.querySelector<HTMLTextAreaElement>('.composer-input')?.focus({ preventScroll: true }));
        } catch (error) { props.onNotify(errorText(error)); }
      }
    }
    props.onAnnotationReferenceHandled(request);
  }, [props.annotationChatRequest]);
  const round = deletingMessage && conversation.messages.some(message => message.id === deletingMessage) ? chatRound(conversation.messages, deletingMessage) : [];
  const roundIds = new Set(round.map(message => message.id));
  const roundAnnotations = conversation.annotations.filter(annotation => roundIds.has(annotation.messageId));
  const roundAnnotationIds = new Set(roundAnnotations.map(annotation => annotation.id));
  const referencedElsewhere = conversation.messages.filter(message => !roundIds.has(message.id)).reduce((sum, message) => sum + Number(roundIds.has(message.textReference?.messageId || '')) + (message.annotationReferences || []).filter(reference => roundAnnotationIds.has(reference.annotationId)).length, 0);
  const deleteDisabled = globallyBusy || props.turnDeleteDisabled || conversation.annotations.some(isAnnotationGenerating);
  const convertMessage = useCallback((m: ChatMessage): ThreadMessageLike => ({
    id: m.id, role: m.role, content: [{ type: 'text', text: activeVersion(m).content }],
    ...(m.role === 'assistant' ? { status: activeVersion(m).status === 'streaming' ? { type: 'running' as const } : { type: 'complete' as const, reason: 'stop' as const } } : {}),
  }), []);
  const messages = useMemo(() => conversation.messages, [conversation.messages]);
  async function sendQuestion(question: string) {
    const action = chatSearchAction(question, searchMode);
    if (!action) return;
    chatPosition.onSend();
    if (await props.onSend(action.question, selectedAnnotations, selectedDocuments, useHistory, selectedKnowledge, selectedResearch, action.mode)) {
      setSearchMode(action.nextMode);
      setSelectedAnnotations([]); setDocumentSelection(null); setSelectedResearch([]); setUseHistory(false); setSelectedKnowledge([]);
    }
  }
  const runtime = useExternalStoreRuntime({
    messages, convertMessage, isRunning, isSendDisabled: globallyBusy,
    onNew: message => sendQuestion(message.content.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('\n')),
    onCancel: async () => props.onStop(),
  });
  function focusComposer() {
    chatPosition.viewportRef.current?.closest('.chat-root')?.querySelector<HTMLTextAreaElement>('.composer-input')?.focus({ preventScroll: true });
  }
  function openSection() {
    props.onSectionChange?.('');
    setSelectedAnnotations([]); setDocumentSelection(null); setSelectedResearch([]); setSelectedKnowledge([]); setUseHistory(false); props.onClearTextReference();
    chatPosition.scrollToBottom();
  }
  function openKnowledgeMention(event: ChangeEvent<HTMLTextAreaElement>) {
    const input = event.nativeEvent as InputEvent;
    if (!knowledgeCards?.length || input.isComposing || input.inputType !== 'insertText' || input.data !== '@') return;
    const { value, selectionStart } = event.currentTarget;
    const at = selectionStart - 1;
    if (value[at] === '@' && (at === 0 || /\s/u.test(value[at - 1]))) setKnowledgePicker({ mention: { text: value, at } });
  }
  function applyKnowledgeCards(ids: string[]) {
    const mention = knowledgePicker?.mention;
    if (mention && ids.length && runtime.thread.composer.getState().text === mention.text) {
      runtime.thread.composer.setText(mention.text.slice(0, mention.at) + mention.text.slice(mention.at + 1));
    }
    setSelectedKnowledge(ids);
    setKnowledgePicker(null);
  }
  const localFiles = !projectChat && Boolean(conversation.documents?.length) && <details className="chat-local-files" aria-label={t('对话本地文件')}>
    <summary><FolderOpen size={14} />{t('本地文件')}<small>{props.filesLoading ? t('整理中…') : props.fileGroups.length}</small>
      <span className="chat-files-disclosure" aria-hidden="true"><span className="chat-files-expand">{t('展开')}</span><span className="chat-files-collapse">{t('收起')}</span><ChevronDown size={14} strokeWidth={1.6} /></span>
    </summary>
    <div>{props.fileGroups.map(group => {
      const file = group.references[0].document;
      return <button type="button" key={group.id} title={t('阅读 {0}', [file.name])} onClick={() => props.onOpenDocument(file.id)}><FileText size={15} /><span>{file.name}</span><small>{file.pages.length}{t(isEbookKind(file.kind) ? '章' : '页')}</small></button>;
    })}</div>
  </details>;
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root className="chat-root">
      {localFiles}

      <div className="chat-scroll-region">
      <ThreadPrimitive.Viewport ref={chatPosition.viewportRef} className="chat-viewport" autoScroll={isRunning} scrollToBottomOnInitialize={false} scrollToBottomOnRunStart scrollToBottomOnThreadSwitch={false}>
        <div ref={chatPosition.contentRef} className="reading-column">
          {conversation.collectedHistory && <CollectedHistory turns={conversation.collectedHistory.turns} />}
          {conversation.messages.length === 0 ? !conversation.collectedHistory && (projectChat ? <p className="inquiry-chat-empty">{t('从下方开始提问，也可以选择项目资料和知识卡片。')}</p> : <div className="empty-state">
            <BrandLogo size={96} className="empty-symbol" /><div className="eyebrow">THINK WITHOUT LOSING YOUR PLACE</div><h1>{t("让好奇心，")}<br />{t("留在原文旁。")}</h1><p>{conversation.documents?.length ? <><span className="empty-file-status">{t("文件已准备好。点击上方文件可阅读、划选批注；")}<br /></span>{t(conversation.projectId ? '可在输入框旁选择要引用的文件和批注。' : "也可以在下方直接询问论文中的问题。")}</> : <>{t("聊一个想弄懂的话题，或上传一篇论文。")}<br />{t("选中文字后，可以询问 AI，也可以只写自己的批注。")}</>}</p>
          </div>) : <>
            {!projectChat && <div className="reading-guide"><PenLine size={14} /><span>{t("选中回答中的文字，就能在原处批注提问")}</span><span className="guide-end">READ · ASK · KEEP</span></div>}
            {conversation.messages.map((message, index) => <VirtualChatMessage key={message.id} id={message.id} versionId={message.activeVersionId} viewport={chatPosition.viewportRef} visible={props.visible} initial={Math.abs(index - initialIndex) <= 3} pinned={jumpTarget?.id === message.id || Boolean((annotationsBySource.get(`${message.id}:${message.activeVersionId}`) || []).some(annotation => annotation.id === props.openAnnotationId)) || translation?.sourceKey === `${conversation.id}:${message.id}:${message.activeVersionId}`} estimate={message.role === 'user' ? 120 : 450}>{() => {
              const version = activeVersion(message);
              const versionIndex = message.versions.findIndex(v => v.id === version.id);
              if (message.role === 'user') {
                const fileIds = message.documentReference?.ids || [];
                const files = fileIds.map(id => localById.get(id)).filter(file => file !== undefined);
                return <>{message.contextReset && <div className="inquiry-section-break" role="separator" aria-label={message.sectionTitle || t('新段落')}><span>{message.sectionTitle || t('新段落')}</span></div>}<div className="user-message" key={message.id} data-message-id={message.id} data-version-id={version.id}><span className="user-label">{t("你")}</span>
                  <div><ChatQuestionText selection={{ conversationId: conversation.id, messageId: message.id, versionId: version.id }}>{version.content}</ChatQuestionText>
                    {!!files.length && <div className="chat-message-files" role="group" aria-label={t('引用了 {0} 份文件', [fileIds.length])}>
                      {files.map(file => <ChatFileChip key={file.id} file={file} disabled={props.fileBusy} onOpen={props.onOpenDocument} />)}
                    </div>}
                    {!!fileIds.length && !files.length && <p className="chat-file-reference">{t('引用了 {0} 份文件', [fileIds.length])}</p>}
                    {!!message.researchSourceIds?.length && <p className="chat-file-reference" title={props.researchSources?.filter(source => message.researchSourceIds?.includes(source.id)).map(source => source.title).join(' · ')}>{t('引用了 {0} 份在线资料', [message.researchSourceIds.length])}</p>}
                    {message.textReference && <ChatTextReferencePreview reference={message.textReference} />}{Boolean(message.annotationReferences?.length) && <ChatAnnotationReferences references={message.annotationReferences!} />}
                  </div>{(!conversation.messages[index + 1] || conversation.messages[index + 1].role === 'user') && <button type="button" className="user-turn-delete" disabled={deleteDisabled} aria-label={t('删除本轮对话')} onClick={() => setDeletingMessage(message.id)}><Trash2 size={13} />{t('删除本轮')}</button>}
                </div></>;
              }
              const sourceAnnotations = annotationsBySource.get(`${message.id}:${version.id}`) || [];
              const annotations = sourceAnnotations.filter(a => a.deletedAt === undefined);
              const researchRun = props.researchRun?.messageId === message.id && props.researchRun.versionId === version.id ? props.researchRun : undefined;
              const preceding = conversation.messages[index - 1];
              const offerPapers = !message.inquiryIntro && version.status === 'complete' && !version.research && preceding?.role === 'user'
                && suggestsPaperSearch(activeVersion(preceding).content);
              return <article className="assistant-message" key={message.id} data-message-id={message.id} data-version-id={version.id}>
                <div className="assistant-label"><BrandLogo size={37.5} className="mini-brand" /><strong>{__APP_SHORT_NAME__}</strong><span>{version.modelLabel === '资料简报' ? t('资料简报') : version.modelLabel || (message.inquiryIntro ? t('资料导读') : conversation.title.includes(t("体验示例")) ? t("本地示例回答") : settings.mode === 'demo' ? t("本地演示") : settings.model)}</span>{version.status === 'streaming' && !researchRun && <span className="streaming-label"><span />{t(message.inquiryIntro ? '正在准备资料导读…' : '正在思考与书写')}</span>}</div>
                <AnnotatedAnswer key={version.id} conversationId={conversation.id} messageId={message.id} version={version} annotations={annotations} reservedColors={sourceAnnotations.map(a => a.color)} openAnnotationId={props.openAnnotationId} onOpen={props.onOpen} onCreate={props.onCreate} onUpdate={props.onUpdate} onAsk={props.onAsk} onReask={props.onReask} onStop={props.onStopAnnotation} onDelete={props.onDelete} onReferenceToChat={props.onReferenceToChat} onNotify={props.onNotify} disabled={isRunning} />
                {researchRun && <div className="inquiry-run chat-research-run" role="status">
                  <span className="inquiry-spinner" aria-hidden="true" />
                  {t(researchRun.mode === 'web' ? '正在联网查询…' : researchStepText[researchRun.step])}
                  <button type="button" className="document-tool-button" onClick={props.onStop}><Square size={13} />{t('停止检索')}</button>
                </div>}
                {version.research?.kind === 'web' && <details className="chat-web-citations" open>
                  <summary>{t('参考链接')} <small>{version.research.citations.length}</small></summary>
                  <ul>{version.research.citations.map(citation => <li key={citation.url}><a href={citation.url} target="_blank" rel="noopener noreferrer">{citation.title}</a></li>)}</ul>
                </details>}
                {version.research?.kind === 'papers' && <div className="inquiry-sources chat-paper-sources" data-testid="chat-paper-sources" aria-label={t('本轮文献')}>
                  {version.research.sources.map((source, sourceIndex) => {
                    const stored = props.researchSources?.find(item => sameResearchSource(item, source));
                    return <ResearchSourceCard key={source.id} source={source} number={sourceIndex + 1}>
                      <button type="button" className="document-tool-button" disabled={globallyBusy || Boolean(stored)} onClick={() => props.onCollectPaper(message.id, version.id, source.id)}>
                        {stored ? <Check size={14} /> : <Plus size={14} />}{t(stored ? '已收录' : '收入资料地图')}
                      </button>
                      {(source.pdfUrl || stored?.pdfUrl || stored?.documentId) && <button type="button" className="document-tool-button" disabled={globallyBusy} onClick={() => props.onReadPaper(message.id, version.id, source.id)}>
                        {stored?.documentId ? <BookOpen size={14} /> : <Download size={14} />}{t(stored?.documentId ? '进入精读' : '下载并精读')}
                      </button>}
                    </ResearchSourceCard>;
                  })}
                </div>}
                {offerPapers && !researchRun && <button type="button" className="document-tool-button chat-paper-suggestion" disabled={globallyBusy}
                  onClick={() => props.onSupplementPapers(message.id, version.id)}><Search size={15} />{t('调学术库实时检索并生成资料卡片')}</button>}
                {version.status !== 'complete' && (version.error || message.inquiryIntro && version.status === 'interrupted') && <div className="answer-error" role="alert">{t(version.error || '导读已中断，可以重试。')}<p>{t(message.inquiryIntro ? '可以重试导读，也可以继续提问。' : '你可以直接继续发送新问题，也可以重新生成。需要更换 API 时，在左下角切换模型即可。')}</p></div>}
                {projectChat && message.inquiryIntro && version.status === 'complete' && <div className="inquiry-next-actions">
                  <button type="button" className="document-tool-button" disabled={globallyBusy} onClick={focusComposer}><MessageSquareQuote size={15} />{t('继续追问')}</button>
                  {props.onReadingSources && Boolean(props.researchSources?.length || conversation.documents?.length) && <button type="button" className="document-tool-button" disabled={globallyBusy} onClick={props.onReadingSources}><BookOpen size={15} />{t('选资料精读')}</button>}
                </div>}
                <footer className="answer-actions">
                  {wikiActions?.toWiki && version.status==='complete' && <button type="button" onClick={()=>wikiActions.toWiki?.(conversation.id,message.id,version.id)}><BookOpenText size={14}/>{t('整理到 Wiki')}</button>}
                  {props.knowledge && version.status === 'complete' && <button type="button" onClick={() => props.knowledge?.saveAnswer(message.id, version.id)}><BookmarkPlus size={14} />{t('存为知识卡片')}</button>}
                  <button type="button" disabled={deleteDisabled} aria-label={t('删除本轮对话')} onClick={() => setDeletingMessage(message.id)}><Trash2 size={14} />{t('删除本轮')}</button>
                  {index === conversation.messages.length - 1 && <button disabled={globallyBusy || Boolean(message.inquiryIntro && props.modelSwitchDisabled)} onClick={() => props.onRegenerate(message.id)}><RefreshCw size={14} />{message.inquiryIntro ? t('重新生成导读') : version.status === 'error' || version.status === 'interrupted' ? t('重试这次回答') : t('重新生成')}</button>}
                  {message.versions.length > 1 && <div className="version-control"><button className="icon-button" aria-label={t("查看上一个回答版本")} disabled={globallyBusy || versionIndex === 0} onClick={() => props.onVersion(message.id, message.versions[versionIndex - 1].id)}><ChevronLeft size={15} /></button><span>{t("版本")}{versionIndex + 1} / {message.versions.length}</span><button className="icon-button" aria-label={t("查看下一个回答版本")} disabled={globallyBusy || versionIndex === message.versions.length - 1} onClick={() => props.onVersion(message.id, message.versions[versionIndex + 1].id)}><ChevronRight size={15} /></button></div>}
                  {annotations.length > 0 && <span className="annotation-count"><PenLine size={13} />{annotations.length}{t("条批注")}</span>}
                  {version.status === 'complete' && <span className="answer-complete"><Check size={12} />{t("已保存")}</span>}
                </footer>
              </article>;
            }}</VirtualChatMessage>)}
          </>}
          <div className="chat-bottom" />
        </div>
      </ThreadPrimitive.Viewport>
      <ChatTurnNavigation conversation={conversation} viewport={chatPosition.viewportRef} visible={props.visible} disabled={deleteDisabled} onJump={id => setJumpTarget(previous => ({ id, serial: (previous?.serial || 0) + 1 }))} onDelete={props.onDeleteTurns} onSummarize={conversation.annotations.some(canReferenceAnnotation) ? props.onSummarize : undefined} />
      </div>
      {!atBottom && <button className="scroll-bottom icon-button" aria-label={t("回到对话底部")} onClick={chatPosition.scrollToBottom}><ArrowDown size={18} /></button>}
      <div className="composer-area">
        <ComposerPrimitive.Root className="main-composer" {...confirmationScope}>
          {conversation.pendingSection !== undefined && <div className="inquiry-section-composer">
            <span><SeparatorHorizontal size={15} />{t('新段落')} · {t('上文已隔离')}</span>
            <input type="text" maxLength={SECTION_TITLE_LIMIT} aria-label={t('段落名称（可选）')} placeholder={t('段落名称（可选）')} value={conversation.pendingSection} disabled={globallyBusy}
              onChange={event => props.onSectionChange?.(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
            <button type="button" className="document-icon-button" aria-label={t('取消新段落')} title={t('取消新段落')} disabled={globallyBusy} onClick={() => props.onSectionChange?.(undefined)}><X size={15} /></button>
          </div>}
          {props.textReference && <ChatTextReferencePreview reference={props.textReference} onRemove={props.onClearTextReference} />}
          {referenceCount > 0 && <div className="composer-references">
            {(pickedFiles.length > 0 || pickedResearchNames.length > 0) && <div className="composer-reference-files">
              {pickedFiles.map(file => <ChatFileChip key={file.id} file={file} disabled={props.fileBusy} onOpen={props.onOpenDocument} />)}
              {!!pickedResearchNames.length && <span title={pickedResearchNames.join('\n')}>{pickedResearchNames.length === 1 ? pickedResearchNames[0] : t('已选 {0} 份资料', [pickedResearchNames.length])}</span>}
            </div>}
            {!!selectedAnnotations.length && <span className="composer-reference-notes" title={annotationSummary}><MessageSquareQuote size={14} aria-hidden="true" /><span>{annotationSummary}</span></span>}
            <button type="button" className="icon-button chat-reference-clear" title={t(clearReferenceLabel)} disabled={globallyBusy} aria-label={t(clearReferenceLabel)} onClick={() => { setSelectedAnnotations([]); setDocumentSelection([]); setSelectedResearch([]); }}><X size={15} /></button>
          </div>}
          {conversation.collectedHistory && <label className="collected-reference"><input type="checkbox" checked={useHistory} disabled={globallyBusy} onChange={event => setUseHistory(event.target.checked)} />{t('带上整理历史')}</label>}
          {!!pickedCards.length && <div className="knowledge-reference-chips">
            {pickedCards.map(card => <div key={card.id} className="knowledge-reference-chip"><span title={card.title}>{card.title}</span>
              <button type="button" className="icon-button" aria-label={t('移除知识卡片：{0}', [card.title])} disabled={globallyBusy}
                onClick={() => setSelectedKnowledge(previous => previous.filter(id => id !== card.id))}><X size={14} /></button>
            </div>)}
          </div>}
          <ComposerPrimitive.Input className="composer-input" placeholder={t(props.textReference ? '就这段文字，你想问什么？' : projectChat && conversation.messages.length ? '继续追问…' : '想弄懂什么？从这里开始…')} aria-label={t("输入主对话问题")} autoFocus={false} disabled={globallyBusy} maxRows={7} addAttachmentOnPaste={false} unstable_focusOnScrollToBottom={false} unstable_focusOnRunStart={false} onChange={props.knowledge ? openKnowledgeMention : undefined} />
          <div className="composer-toolbar">
            <div className="composer-quick-actions"><button type="button" className="upload-document-button" aria-label={t("添加本地文件")} title={`${t(conversation.projectId ? '添加文件到当前项目' : '打开新文件时创建同名项目')}\n${t("本地文件格式：PDF、EPUB、MOBI、AZW3、TXT、Markdown。")}`} disabled={globallyBusy} onClick={props.onUpload}><Paperclip size={15} /><span className="composer-action-label">{props.fileBusy ? t("读取中…") : t("本地文件")}</span></button>
              <button type="button" className="chat-reference-trigger" data-selected={referenceCount > 0 || undefined} aria-label={t(referenceLabel)} title={t(referenceLabel)} aria-haspopup="dialog" disabled={globallyBusy} onClick={() => setPickingAnnotations(true)}><MessageSquareQuote size={15} /><span className="composer-action-label">{t(referenceLabel)}</span></button>
              {props.knowledge && <button type="button" className="chat-reference-trigger knowledge-reference-trigger" data-selected={!!pickedCards.length || undefined} aria-label={t('引用知识卡片')} title={t('引用知识卡片')} aria-haspopup="dialog" disabled={globallyBusy} onClick={() => setKnowledgePicker({})}><BookMarked size={15} /></button>}
              {props.onSectionChange && conversation.pendingSection === undefined && Boolean(conversation.messages.length) && <button type="button" className="chat-reference-trigger section-trigger" aria-label={t('开启新段落')} title={t('开启新段落，后续提问从这里开始')} disabled={globallyBusy} onClick={openSection}><SeparatorHorizontal size={15} /><span className="composer-action-label">{t('新段落')}</span></button>}
              <div className="chat-search-controls" role="group" aria-label={t('本轮检索')}>
                <button type="button" className="research-toggle" aria-pressed={searchMode === 'web'} title={t('本轮联网查询')} disabled={globallyBusy}
                  onClick={() => setSearchMode(mode => toggleChatSearch(mode, 'web'))}><Globe size={14} />{t('联网')}</button>
                <button type="button" className="research-toggle" aria-pressed={searchMode === 'papers'} title={t('本轮搜文献，或输入 /paper 加空格')} disabled={globallyBusy}
                  onClick={() => setSearchMode(mode => toggleChatSearch(mode, 'papers'))}><BookOpen size={14} />{t('搜文献')}</button>
              </div>
            </div>
            <div className="composer-model-controls"><NativeSelect wrapperClassName="composer-model-select" aria-label={t("选择预载模型")} title={settings.mode === 'api' ? settings.model : t("选择已保存的模型配置")} value={settings.mode === 'demo' ? '__demo__' : settings.activeProfileId || '__current__'} disabled={props.modelSwitchDisabled} onChange={event => { if (event.target.value === '__manage__') props.onManageModels(); else props.onChooseModel(event.target.value === '__demo__' ? null : event.target.value); }}>
            <option value="__demo__">{t("演示模式")}</option>
            {settings.mode === 'api' && !settings.activeProfileId && <option value="__current__" disabled>{settings.model || t("当前连接（未保存）")}</option>}
            {settings.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}{!profile.hasApiKey && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?=[:/]|$)/.test(profile.baseURL) ? t("（需填写密钥）") : ''}</option>)}
            <option value="__manage__">{t("＋ 添加或管理模型…")}</option>
            </NativeSelect></div>{isRunning ? <ComposerPrimitive.Cancel className="send-button" aria-label={t(props.researchRun ? '停止检索' : '停止生成')}><Square size={15} fill="currentColor" /></ComposerPrimitive.Cancel> : <ComposerPrimitive.Send className="send-button" aria-label={t("发送问题")} {...confirmShortcut}><ArrowUp size={20} /></ComposerPrimitive.Send>}
          </div>
        </ComposerPrimitive.Root>
        <p className="composer-footnote">{t("Enter 发送，Shift + Enter 换行")}<span>·</span>{t(hasFileChoices ? '选中的文件和批注会带入本轮对话。' : '批注独立提问，聊天只引用你主动选择的批注')}</p>
      </div>
      {pickingAnnotations && <ChatAnnotationPicker conversation={conversation} selected={selectedAnnotations} selectedDocuments={selectedDocuments}
        researchSources={props.researchSources} selectedResearch={selectedResearch} onClose={() => setPickingAnnotations(false)}
        onApply={(ids, documents, sources) => { setSelectedAnnotations(ids); setDocumentSelection(documents); setSelectedResearch(sources); setPickingAnnotations(false); }} />}
      {knowledgePicker && props.knowledge && <KnowledgeCardPicker cards={props.knowledge.cards} selected={selectedKnowledge} loading={props.knowledge.loading} loadError={props.knowledge.loadError}
        onClose={() => setKnowledgePicker(null)} onApply={applyKnowledgeCards} />}
      {round.length > 0 && <DeleteChatTurnDialog question={activeVersion(round[0]).content} annotationCount={roundAnnotations.length} referenceCount={referencedElsewhere} disabled={deleteDisabled} onClose={() => setDeletingMessage(null)} onDelete={async () => { await props.onDeleteTurn(round[0].id); setDeletingMessage(null); }} />}
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}

