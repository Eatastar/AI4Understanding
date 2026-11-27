import type { ReaderSession } from '../adapters/reader-session';
import type { LocalDocumentReference } from './local-library';
import { findConversation, projectChats, projectDocuments, projectFor } from './projects';
import type { Conversation, Workspace } from './types';

export type WorkspacePane = { kind: 'overview'; projectId: string } | { kind: 'chat'; conversationId: string };
export interface OpenDocument { ownerId: string; documentId: string }
export interface PreviewTabs {
  tabs: readonly OpenDocument[];
  active: OpenDocument;
}
export type ProjectPreviews = ReadonlyMap<string, PreviewTabs>;
export type WorkspaceView =
  | { kind: 'home' }
  | { kind: 'workspace'; pane: WorkspacePane }
  | { kind: 'reading'; pane: WorkspacePane; document: OpenDocument };

export function conversationPreviewScope(workspace: Workspace, conversation: Conversation): string {
  return projectFor(workspace, conversation)?.id ?? conversation.id;
}

export function panePreviewScope(workspace: Workspace, pane: WorkspacePane): string | undefined {
  const owner = findConversation(workspace, pane.kind === 'overview' ? pane.projectId : pane.conversationId);
  return owner && conversationPreviewScope(workspace, owner);
}

export function previewDocuments(workspace: Workspace, scope: string): LocalDocumentReference[] {
  const owner = findConversation(workspace, scope);
  if (!owner) return [];
  return owner.isProject ? projectDocuments(owner, projectChats(workspace, owner.id))
    : (owner.documents ?? []).map(document => ({ conversationId: owner.id, document }));
}

export function openPreviewTab(preview: PreviewTabs | undefined, document: OpenDocument): PreviewTabs {
  const existing = preview?.tabs.find(tab => tab.documentId === document.documentId);
  if (preview && existing?.ownerId === document.ownerId) {
    return preview.active === existing ? preview : { ...preview, active: existing };
  }
  const tabs = existing ? preview!.tabs.map(tab => tab === existing ? document : tab) : [...(preview?.tabs ?? []), document];
  return { tabs, active: document };
}

export function closePreviewTab(preview: PreviewTabs, documentId: string): PreviewTabs | undefined {
  const index = preview.tabs.findIndex(tab => tab.documentId === documentId);
  if (index < 0) return preview;
  const tabs = preview.tabs.filter(tab => tab.documentId !== documentId);
  if (!tabs.length) return undefined;
  const active = preview.active.documentId === documentId ? tabs[Math.min(index, tabs.length - 1)] : preview.active;
  return { tabs, active };
}

export function retainPreviewTabs(preview: PreviewTabs | undefined, available: readonly LocalDocumentReference[]): PreviewTabs | undefined {
  return preview?.tabs.reduce<PreviewTabs | undefined>((next, tab) =>
    next && !available.some(ref => ref.document.id === tab.documentId && ref.conversationId === tab.ownerId)
      ? closePreviewTab(next, tab.documentId) : next, preview);
}

export function setProjectPreview(previews: ProjectPreviews, scope: string, preview: PreviewTabs | undefined): ProjectPreviews {
  if (previews.get(scope) === preview) return previews;
  const next = new Map(previews);
  if (preview) next.set(scope, preview);
  else next.delete(scope);
  return next;
}

export function moveProjectPreview(previews: ProjectPreviews, from: string, to: string, mapTab = (tab: OpenDocument) => tab): ProjectPreviews {
  const source = previews.get(from);
  if (!source || from === to) return previews;
  const combined = source.tabs.reduce<PreviewTabs | undefined>((next, tab) => openPreviewTab(next, mapTab(tab)), previews.get(to));
  return setProjectPreview(setProjectPreview(previews, from, undefined), to, openPreviewTab(combined, mapTab(source.active)));
}

interface RestoredReaderView { view: WorkspaceView; preview?: OpenDocument }
export function restoreReaderView(workspace: Workspace, session: ReaderSession | null): RestoredReaderView {
  if (!session || session.mode === 'closed') return { view: { kind: 'home' } };
  const owner = workspace.conversations.find(record => record.deletedAt === undefined && record.documents?.some(file => file.id === session.documentId));
  if (!owner) return { view: { kind: 'home' } };
  const project = projectFor(workspace, owner);
  const savedChat = findConversation(workspace, session.conversationId);
  const chat = savedChat && !savedChat.isProject && (owner.id === savedChat.id || project && savedChat.projectId === project.id)
    ? savedChat : !owner.isProject ? owner : undefined;
  const savedProject = session.projectId && findConversation(workspace, session.projectId);
  const returnProject = session.workspacePane !== 'chat' && session.mode !== 'split' && savedProject && savedProject.isProject ? savedProject : project;
  const reopenChat = chat && (!returnProject || session.workspacePane === 'chat' || session.workspacePane === undefined && session.mode === 'split');
  const pane: WorkspacePane | undefined = reopenChat ? { kind: 'chat', conversationId: chat.id }
    : returnProject ? { kind: 'overview', projectId: returnProject.id } : undefined;
  if (!pane) return { view: { kind: 'home' } };
  const document = { ownerId: owner.id, documentId: session.documentId };
  return session.mode === 'split' ? { view: { kind: 'workspace', pane }, preview: document }
    : { view: { kind: 'reading', pane, document }, ...(session.returnWithPreview ? { preview: document } : {}) };
}
