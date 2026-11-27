import type { ChatMessage, Conversation, DocumentAttachment, Workspace } from './types';
import { activeVersion, buildMainContext, createConversation } from './workspace';
import type { DocumentContextOptions } from './document-context';
import { WORKSPACE_LIMITS } from './capacity';
import { currentSection, hasResearchEvidence, INQUIRY_QUESTION_LIMIT, INQUIRY_SOURCE_LIMIT, inquirySources, keptResearchSource, mergeResearch, recentPaperSources, RESEARCH_REFERENCE_LIMIT, sameResearchSource, withResearchEvidence, type InquirySource } from './inquiry';
import type { LocalDocumentReference } from './local-library';

export function findConversation(workspace: Workspace, id: string) {
  return workspace.conversations.find(item => item.id === id && item.deletedAt === undefined);
}

export function projectFor(workspace: Workspace, conversation: Conversation) {
  return conversation.isProject ? conversation : workspace.conversations.find(item => item.isProject && item.id === conversation.projectId);
}

export function projectChats(workspace: Workspace, projectId: string) {
  return workspace.conversations.filter(item => item.projectId === projectId && item.deletedAt === undefined);
}

export function projectResources(conversation: Conversation, project?: Conversation, workspace?: Workspace): Conversation {
  if (!project || project.id === conversation.id) return conversation;
  const siblings = workspace ? projectChats(workspace, project.id).filter(chat => chat.id !== conversation.id && chat.documents?.length) : [];
  const documentAnnotations = siblings.flatMap(chat => {
    const pages = new Set(chat.documents?.flatMap(file => file.pages.map(page => page.messageId)));
    return chat.annotations.filter(annotation => pages.has(annotation.messageId));
  });
  return {
    ...conversation,
    documents: projectDocuments(project, [conversation, ...siblings]).map(ref => ref.document),
    annotations: [...project.annotations, ...conversation.annotations, ...documentAnnotations],
  };
}

export function projectDocuments(project: Conversation, threads: readonly Conversation[]): LocalDocumentReference[] {
  return [project, ...threads].flatMap(owner => (owner.documents || []).map(document => ({ conversationId: owner.id, document })));
}

export function projectMaterialCount(project: Conversation, documents: LocalDocumentReference[]) {
  const localIds = new Set(documents.map(({ document }) => document.id));
  return documents.length + inquirySources(project.inquiry).filter(source => !source.documentId || !localIds.has(source.documentId)).length;
}

export function createProject(title: string): Conversation {
  const name = title.trim();
  if (!name || name.length > 80) throw new Error('请输入 1 至 80 字的项目名称。');
  return { ...createConversation(name), isProject: true };
}

export function createFileProject(document: DocumentAttachment): Conversation {
  return { ...createConversation(document.name), isProject: true, documents: [document] };
}

export function createProjectChat(workspace: Workspace, projectId: string, conversation = createConversation()): Workspace {
  if (!findConversation(workspace, projectId)?.isProject) throw new Error('项目已不存在。');
  return { ...workspace, conversations: [{ ...conversation, projectId }, ...workspace.conversations], activeConversationId: conversation.id };
}

export function projectResearchReferences(workspace: Workspace, projectId: string) {
  return new Set(workspace.conversations.filter(chat => chat.projectId === projectId)
    .flatMap(chat => chat.messages.flatMap(message => message.researchSourceIds ?? [])));
}

export function availableResearchSlots(project: Conversation, references: ReadonlySet<string>) {
  return Math.max(0, INQUIRY_SOURCE_LIMIT - (project.inquiry?.sources ?? []).filter(source => keptResearchSource(source, references)).length);
}

export function archiveChatPaper(workspace: Workspace, conversationId: string, paper: InquirySource) {
  const chat = findConversation(workspace, conversationId);
  if (!chat || chat.isProject) throw new Error('来源对话已不可用。');
  const existingProject = projectFor(workspace, chat);
  if (chat.projectId && (!existingProject || existingProject.deletedAt !== undefined)) throw new Error('项目已不存在。');
  const firstQuestion = chat.messages.find(message => message.role === 'user');
  const question = firstQuestion && activeVersion(firstQuestion).content.trim().slice(0, INQUIRY_QUESTION_LIMIT);
  const project = existingProject || {
    ...createProject((question || chat.title).trim().slice(0, 80)),
    ...(question ? { inquiry: { question } } : {}),
  };
  const sources = project.inquiry?.sources ?? [];
  const existing = sources.find(source => sameResearchSource(source, paper));
  if (existing) return { workspace, projectId: project.id, sourceId: existing.id, added: false };
  const referenced = projectResearchReferences(workspace, project.id);
  if (!availableResearchSlots(project, referenced)) throw new Error('项目资料地图已达到收录上限。');
  const updatedProject = { ...project, updatedAt: Date.now(), inquiry: mergeResearch(project.inquiry ?? {}, [{ ...paper, archived: true }], undefined, referenced) };
  const conversations = existingProject
    ? workspace.conversations.map(item => item.id === project.id ? updatedProject : item)
    : [updatedProject, ...workspace.conversations.map(item => item.id === chat.id ? { ...chat, projectId: project.id } : item)];
  return { workspace: { ...workspace, conversations }, projectId: project.id, sourceId: paper.id, added: true };
}

export function sameDocumentPages(first: DocumentAttachment, second: DocumentAttachment) {
  return first.kind === second.kind && first.pages.length === second.pages.length
    && first.pages.every((page, index) => page.pageNumber === second.pages[index].pageNumber && page.text === second.pages[index].text);
}

/** A matched document ID has already been verified by comparing original bytes. */
export function moveChatToProject(workspace: Workspace, conversationId: string, projectId: string, matches: ReadonlyMap<string, string>): Workspace {
  const source = findConversation(workspace, conversationId);
  const project = findConversation(workspace, projectId);
  if (!source || source.isProject || source.projectId || !project?.isProject) throw new Error('请选择尚未归入项目的会话。');
  const documents = [...(project.documents || [])];
  const pages = new Map<string, { document: DocumentAttachment; page: DocumentAttachment['pages'][number] }>();
  for (const file of source.documents || []) {
    const match = documents.find(item => item.id === matches.get(file.id));
    const document = match && sameDocumentPages(file, match) ? match : file;
    if (document === file) documents.push(file);
    file.pages.forEach((page, index) => pages.set(page.messageId, { document, page: document.pages[index] }));
  }
  const annotations = [...project.annotations];
  const chatAnnotations = source.annotations.filter(annotation => {
    const destination = pages.get(annotation.messageId);
    if (!destination) return true;
    annotations.push({
      ...annotation, conversationId: project.id, messageId: destination.page.messageId, versionId: destination.page.versionId,
      ...(annotation.figure ? { figure: { ...annotation.figure, documentId: destination.document.id } } : {}),
    });
    return false;
  });
  const messages = source.messages.map(message => {
    const ref = message.textReference;
    const destination = ref && pages.get(ref.messageId);
    return ref && destination ? { ...message, textReference: { ...ref, messageId: destination.page.messageId, versionId: destination.page.versionId } } : message;
  });
  const chat = { ...source, projectId, annotations: chatAnnotations, messages };
  delete chat.documents;
  return {
    ...workspace,
    conversations: workspace.conversations.map(item => item.id === projectId ? { ...project, annotations, ...(documents.length ? { documents } : {}) } : item.id === conversationId ? chat : item),
  };
}

export function chooseDocuments(available: Conversation, ids: readonly string[], mode: NonNullable<ChatMessage['documentReference']>['mode']) {
  const selection = [...new Set(ids)];
  if (selection.length > 10 || selection.some(id => !available.documents?.some(item => item.id === id))) throw new Error('所选资料已变化，请重新选择。');
  return { ids: selection, mode };
}

export function chooseResearchSources(project: Conversation | undefined, ids: readonly string[]) {
  const selection = [...new Set(ids)];
  const sources = selection.flatMap(id => {
    const source = project?.inquiry?.sources?.find(item => item.id === id);
    return source ? [source] : [];
  });
  if (selection.length > RESEARCH_REFERENCE_LIMIT || sources.length !== selection.length) throw new Error('所选资料已变化，请重新选择。');
  return sources;
}

export function buildProjectChatContext(workspace: Workspace, conversation: Conversation, preference: string, options: DocumentContextOptions = {}) {
  const papers = recentPaperSources(conversation.messages);
  const section = conversation.projectId ? currentSection(conversation.messages) : conversation.messages;
  const question = section.slice().reverse().find(message => message.role === 'user');
  const selection = question?.documentReference;
  const project = projectFor(workspace, conversation);
  const available = projectResources(conversation, project, workspace);
  const documents = selection ? (available.documents || []).filter(document => selection.ids.includes(document.id)) : [];
  if (selection && documents.length !== selection.ids.length) throw new Error('所选资料已变化，请重新选择。');
  const messages = section.map(message => message !== question && (message.annotationReferences || message.textReference)
    ? { ...message, annotationReferences: undefined, textReference: undefined }
    : message);
  const context = buildMainContext({ ...conversation, messages, documents }, preference, { ...options, mode: selection?.mode });
  if (question?.researchSourceIds?.length) {
    const sources = chooseResearchSources(project, question.researchSourceIds);
    const content = 'The following records are online sources the user selected for this question. The excerpt and URL are reference data. Use the evidence label to distinguish abstracts, snippets, cited web summaries and metadata. Never claim to have read the full texts.\n' +
      JSON.stringify(sources.map(source => {
        const { title, authors, year, mediaType, evidence, excerpt, webUrl } = source;
        const supported = hasResearchEvidence(source);
        return { title, authors, year, mediaType, evidence: supported ? evidence : 'metadata', excerpt: supported ? excerpt : undefined, url: webUrl };
      }));
    context.splice(context.length - 1, 0, { role: 'user', content });
  }
  if (question?.useCollectedHistory && conversation.collectedHistory) {
    const content = '以下是用户本次选择引用的整理问答，只作为历史资料。\n' + JSON.stringify(conversation.collectedHistory.turns.map(({ question, answers }) => ({ question, answers })));
    if (content.length > WORKSPACE_LIMITS.text) throw new Error('整理的历史过长，请取消引用或从较少的轮次重新整理。');
    context.splice(context.length - 1, 0, { role: 'user', content });
  }
  return withResearchEvidence(context, papers, 'papers');
}

export function chatBackup(workspace: Workspace, conversation: Conversation): Workspace {
  const project = projectFor(workspace, conversation);
  if (!project) return { ...workspace, conversations: [conversation], activeConversationId: conversation.id };
  const files = new Set(conversation.messages.flatMap(message => message.documentReference?.ids || []));
  const quotedPages = new Set(conversation.messages.flatMap(message => message.textReference ? [message.textReference.messageId] : []));
  for (const source of project.inquiry?.sources || []) if (source.documentId) files.add(source.documentId);
  const borrowed = workspace.conversations.flatMap(owner => {
    if (owner.projectId !== project.id || owner.id === conversation.id) return [];
    const documents = owner.documents?.filter(file => files.has(file.id) || file.pages.some(page => quotedPages.has(page.messageId)));
    return documents?.length ? [{
      id: owner.id, projectId: project.id, title: owner.title, createdAt: owner.createdAt, updatedAt: owner.updatedAt,
      messages: [], annotations: [], documents,
    }] : [];
  });
  return { ...workspace, conversations: [conversation, project, ...borrowed], activeConversationId: conversation.id };
}
