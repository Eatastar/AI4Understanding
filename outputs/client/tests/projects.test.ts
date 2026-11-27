import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnnotation, createConversation, createUserMessage, mergeImportedWorkspace, saveNoteAnnotation, validateImport } from '../src/domain/workspace';
import { buildProjectChatContext, chatBackup, chooseDocuments, createFileProject, createProject, createProjectChat, moveChatToProject, projectDocuments, projectMaterialCount, projectResources } from '../src/domain/projects';
import { restoreReaderView } from '../src/domain/workspace-view';
import { unpackWorkspace, WorkspaceCodec } from '../src/domain/workspace-codec';
import { captureAnnotationReferences } from '../src/domain/chat-references';
import type { Conversation, DocumentAttachment, Workspace } from '../src/domain/types';

const makeDocument = (id: string): DocumentAttachment => ({
  id, name: 'Synthetic.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 128, createdAt: 1,
  pages: [{ pageNumber: 1, text: 'SYNTHETIC DOCUMENT MATERIAL', messageId: id + '-page', versionId: id + '-v' }],
});
const get = (workspace: Workspace, id: string) => workspace.conversations.find(c => c.id === id)!;
const createSpace = (conversations: Conversation[], activeConversationId: string): Workspace => ({ schemaVersion: 1, conversations, activeConversationId });

test('legacy chats can share one verified document with their original annotation IDs', () => {
  const project = createProject('Methods');
  const first = { ...createConversation(), documents: [makeDocument('first')] };
  const second = { ...createConversation(), documents: [makeDocument('second')] };
  const note = createAnnotation(second, { messageId: 'second-page', versionId: 'second-v', quote: 'SYNTHETIC', anchor: {}, color: '#654321', mode: 'note' });
  second.annotations = saveNoteAnnotation({ ...second, annotations: [note] }, note.id, 'Shared note').annotations;
  let space = createSpace([project, first, second], second.id);
  space = moveChatToProject(space, first.id, project.id, new Map());
  space = moveChatToProject(space, second.id, project.id, new Map([['second', 'first']]));
  const saved = validateImport(space);
  assert.equal(saved.conversations.flatMap(c => c.documents || []).length, 1);
  const resources = projectResources(get(saved, first.id), get(saved, project.id));
  assert.equal(resources.annotations[0].id, note.id);
  assert.equal(resources.annotations[0].messageId, 'first-page');
  assert.equal(resources.annotations[0].conversationId, project.id);
});

test('project chat sends only selected materials and its own messages', () => {
  const excluded = makeDocument('second-document');
  excluded.pages[0].text = 'SECOND DOCUMENT';
  const project = { ...createProject('Project'), documents: [makeDocument('shared'), excluded] };
  const first = { ...createConversation(), projectId: project.id, messages: [createUserMessage('OTHER CHAT')] };
  const second = { ...createConversation(), projectId: project.id, messages: [createUserMessage('MY CHAT')] };
  const note = createAnnotation(project, { messageId: 'shared-page', versionId: 'shared-v', quote: 'SYNTHETIC', anchor: {}, color: '#654321', mode: 'note' });
  project.annotations = saveNoteAnnotation({ ...project, annotations: [note] }, note.id, 'Shared note').annotations;
  const space = createSpace([project, first, second], second.id);
  const available = projectResources(second, project);
  second.messages[0].annotationReferences = captureAnnotationReferences(available, [note.id]);
  const prompt = () => buildProjectChatContext(space, second, '').map(message => message.content).join('\n');
  assert.match(prompt(), /MY CHAT|Shared note/);
  assert.doesNotMatch(prompt(), /OTHER CHAT|SYNTHETIC DOCUMENT MATERIAL/);
  second.messages[0].documentReference = chooseDocuments(available, ['shared'], 'relevant');
  assert.match(prompt(), /SYNTHETIC DOCUMENT MATERIAL/);
  assert.doesNotMatch(prompt(), /SECOND DOCUMENT/);
  const following = buildProjectChatContext(space, { ...second, messages: [...second.messages, createUserMessage('FOLLOW UP')] }, '').map(message => message.content).join('\n');
  assert.match(following, /MY CHAT.*\n.*FOLLOW UP/);
  assert.doesNotMatch(following, /Shared note|SYNTHETIC DOCUMENT MATERIAL|OTHER CHAT/);
  const subset = chatBackup(space, second);
  const packed = new WorkspaceCodec().pack(subset);
  assert.deepEqual(validateImport(unpackWorkspace({ ...packed.header, records: packed.rows })), validateImport(subset));
  const restored = mergeImportedWorkspace(space, subset);
  const restoredChat = get(restored, restored.activeConversationId);
  const restoredProject = get(restored, restoredChat.projectId!);
  assert.notEqual(restoredProject.id, project.id);
  assert.equal(restoredChat.messages[0].documentReference?.ids[0], restoredProject.documents?.[0].id);
  assert.equal(restoredChat.messages[0].annotationReferences?.[0].annotationId, restoredProject.annotations[0].id);
});

test('an empty project can own an independent chat without a document', () => {
  const standalone = createConversation(), project = createProject('Empty project');
  const next = validateImport(createProjectChat(createSpace([standalone, project], standalone.id), project.id));
  assert.equal(get(next, next.activeConversationId).projectId, project.id);
  assert.equal(get(next, project.id).documents, undefined);
});

test('a file project keeps the full filename and stores the document once for all its chats', () => {
  const existing = createConversation('Existing chat');
  const file = { ...makeDocument('named'), name: 'Synthetic paper '.repeat(10) + 'final.pdf' };
  const project = createFileProject(file);
  const workspace = createProjectChat(createSpace([project, existing], existing.id), project.id);
  const first = get(workspace, workspace.activeConversationId);
  const next = createProjectChat(workspace, project.id);
  const packed = new WorkspaceCodec().pack(next);
  const reopened = validateImport(unpackWorkspace({ ...packed.header, records: packed.rows }));
  assert.equal(get(reopened, project.id).title, file.name);
  assert.deepEqual(get(reopened, existing.id), existing);
  assert.equal(get(reopened, first.id).projectId, project.id);
  assert.deepEqual(projectResources(get(reopened, reopened.activeConversationId), get(reopened, project.id)).documents, [file]);
  assert.equal(packed.rows.filter(row => row.kind === 'document').length, 1);
});

test('overview includes legacy conversation attachments with their owners and counts a linked PDF once', () => {
  const shared = makeDocument('shared-pdf');
  const legacy = makeDocument('older-chat-pdf');
  const project = { ...createFileProject(shared), inquiry: { sources: [
    { id: 'online', title: 'Linked', provider: 'Crossref' as const, evidence: 'metadata' as const, webUrl: 'https://example.org/online', documentId: shared.id },
    { id: 'other', title: 'Online only', provider: 'Crossref' as const, evidence: 'metadata' as const, webUrl: 'https://example.org/other' },
  ] } };
  const child = { ...createConversation(), projectId: project.id, documents: [legacy] };
  const materials = projectDocuments(project, [child]);
  assert.deepEqual(materials, [{ conversationId: project.id, document: shared }, { conversationId: child.id, document: legacy }]);
  assert.equal(projectMaterialCount(project, materials), 3);
  assert.deepEqual(projectResources(child, project).documents, [shared, legacy]);
});

test('project chats share legacy files by identity and an explicit chat export includes referenced files once', () => {
  const oldFile = makeDocument('legacy-shared');
  const project = { ...createProject('Legacy files'), inquiry: { sources: [
    { id: 'reference', title: 'Reference', provider: 'Crossref' as const, evidence: 'metadata' as const, webUrl: 'https://example.org/reference', documentId: oldFile.id },
  ] } };
  const author = { ...createConversation(), projectId: project.id, documents: [oldFile], messages: [createUserMessage('PRIVATE SIBLING QUESTION')] };
  const user = createUserMessage('Ask about the shared attachment');
  const reader = { ...createConversation(), projectId: project.id, messages: [user] };
  const workspace = createSpace([project, author, reader], reader.id);
  const files = projectResources(reader, project, workspace);
  assert.equal(files.documents?.[0], oldFile);
  assert.doesNotMatch(buildProjectChatContext(workspace, reader, '').map(item => item.content).join('\n'), /SYNTHETIC DOCUMENT MATERIAL|PRIVATE SIBLING QUESTION/u);
  user.documentReference = chooseDocuments(files, [oldFile.id], 'full');
  assert.match(buildProjectChatContext(workspace, reader, '').map(item => item.content).join('\n'), /SYNTHETIC DOCUMENT MATERIAL/u);
  assert.equal(validateImport(workspace).conversations[0].inquiry?.sources?.[0].documentId, oldFile.id);
  const openWorkspace = new WorkspaceCodec().pack(workspace);
  assert.equal(openWorkspace.rows.filter(row => row.kind === 'document').length, 1);
  const exported = validateImport(chatBackup(workspace, reader));
  assert.equal(exported.conversations.flatMap(item => item.documents || []).length, 1);
  assert.doesNotMatch(JSON.stringify(exported), /PRIVATE SIBLING QUESTION/u);
});

test('preview.24 reading sessions reopen the original document and map to the new return pane', () => {
  const file = makeDocument('old-pdf');
  const project = createFileProject(file);
  const chat = { ...createConversation(), projectId: project.id };
  const other = { ...createConversation(), documents: [makeDocument('unrelated')] };
  const workspace = createSpace([project, chat, other], other.id);
  const saved = { conversationId: chat.id, documentId: file.id };
  const document = { ownerId: project.id, documentId: file.id };
  assert.deepEqual(restoreReaderView(workspace, { ...saved, mode: 'split' }), {
    view: { kind: 'workspace', pane: { kind: 'chat', conversationId: chat.id } }, preview: document,
  });
  const { view: focused } = restoreReaderView(workspace, { ...saved, mode: 'focused' });
  assert.equal(focused.kind, 'reading');
  assert.deepEqual(focused.kind === 'reading' && focused.pane, { kind: 'overview', projectId: project.id });
  assert.deepEqual(restoreReaderView(workspace, { ...saved, mode: 'closed' }), { view: { kind: 'home' } });
  assert.equal(workspace.activeConversationId, other.id);
});

test('split preview and immersive return can be restored for projects with no conversation', () => {
  const file = makeDocument('overview-pdf');
  const project = createFileProject(file);
  const standalone = createConversation();
  const workspace = createSpace([project, standalone], standalone.id);
  const session = { conversationId: project.id, documentId: file.id, projectId: project.id, workspacePane: 'overview' as const };
  const document = { ownerId: project.id, documentId: file.id };
  const pane = { kind: 'overview', projectId: project.id };
  assert.deepEqual(restoreReaderView(workspace, { ...session, mode: 'split' }), { view: { kind: 'workspace', pane }, preview: document });
  assert.deepEqual(restoreReaderView(workspace, { ...session, mode: 'focused', returnWithPreview: true }), { view: { kind: 'reading', pane, document }, preview: document });
  assert.equal(workspace.conversations.length, 2);
});
