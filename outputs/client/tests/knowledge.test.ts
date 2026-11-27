import assert from 'node:assert/strict';
import test from 'node:test';
import { addKnowledgeContext, exportKnowledgeCards, findKnowledgeDocument, knowledgeFromAnnotation, knowledgeFromAnswer, searchKnowledgeCards, type KnowledgeCard } from '../src/domain/knowledge';
import { buildProjectChatContext, createFileProject, projectResources } from '../src/domain/projects';
import { createAnnotation, createAssistantMessage, createConversation, createUserMessage } from '../src/domain/workspace';
import type { DocumentAttachment, Workspace } from '../src/domain/types';

const paper: DocumentAttachment = {
  id: 'paper', name: 'Synthetic paper.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 100, createdAt: 0,
  pages: [1, 2].map(number => ({ pageNumber: number, text: 'Excerpt ' + number, messageId: 'page-' + number, versionId: 'version-' + number })),
};

test('knowledge cards retain the displayed answer version and the linked annotation page across a project', () => {
  const project = createFileProject(paper);
  const page = paper.pages[1];
  const annotation = {
    ...createAnnotation(project, { messageId: page.messageId, versionId: page.versionId, quote: 'Excerpt 2', anchor: {}, color: '#eedd99' }),
    status: 'answered' as const, question: 'Why is this true?', answer: 'Because of the second premise.',
  };
  project.annotations = [annotation];
  const question = createUserMessage('Explain my excerpt');
  question.documentReference = { ids: [paper.id], mode: 'relevant' };
  question.annotationReferences = [{ annotationId: annotation.id, mode: 'ask', quote: 'Excerpt 2 as quoted', label: 'p. 2', question: annotation.question, answer: annotation.answer }];
  const answer = createAssistantMessage('First version', 'complete');
  const first = answer.activeVersionId;
  answer.versions.push({ ...answer.versions[0], id: 'second', content: 'Second version' });
  answer.activeVersionId = 'second';
  const conversation = { ...createConversation(), projectId: project.id, messages: [question, answer] };
  const available = projectResources(conversation, project);
  const fromChat = knowledgeFromAnswer(available, answer.id, first, { documentId: paper.id, pageNumber: 1 });
  assert.equal(fromChat?.content, 'First version');
  assert.equal(fromChat?.title, 'Explain my excerpt');
  assert.deepEqual(fromChat?.source, { docId: paper.id, docTitle: paper.name, page: 2, quote: 'Excerpt 2 as quoted' });
  assert.equal(fromChat?.origin.chatId, conversation.id);
  const fromAnnotation = knowledgeFromAnnotation(project, annotation);
  assert.deepEqual(fromAnnotation?.source, { docId: paper.id, docTitle: paper.name, page: 2, quote: 'Excerpt 2' });
});

test('knowledge from a project uses its chosen file and leaves ambiguous or unselected documents out', () => {
  const project = createFileProject(paper);
  const second = { ...paper, id: 'other', name: 'Other.pdf' };
  project.documents!.push(second);
  const question = createUserMessage('What is the core conclusion?');
  const answer = createAssistantMessage('A synthetic conclusion', 'complete');
  const conversation = { ...createConversation(), projectId: project.id, messages: [question, answer] };
  const location = { documentId: paper.id, pageNumber: 2 };
  const collect = () => knowledgeFromAnswer(projectResources(conversation, project), answer.id, answer.activeVersionId, location);
  assert.equal(collect()?.source, undefined);
  question.documentReference = { ids: [paper.id, second.id], mode: 'relevant' };
  assert.equal(collect()?.source, undefined);
  question.documentReference = { ids: [paper.id], mode: 'relevant' };
  assert.deepEqual(collect()?.source, { docId: paper.id, docTitle: paper.name, page: 2 });
});

test('only explicitly chosen card content enters a single normal or project request', () => {
  const chosen: KnowledgeCard = {
    id: 'chosen', title: 'Attention', content: 'A useful insight', tags: ['ML'],
    source: { docId: paper.id, docTitle: paper.name, page: 2, quote: 'Private source excerpt' },
    origin: { type: 'qa', chatId: 'old-conversation' }, createdAt: 1, updatedAt: 2,
  };
  const other = { ...chosen, id: 'other', title: 'Unselected', content: 'Unselected content', tags: ['notes'] };
  assert.deepEqual(searchKnowledgeCards([other, chosen], 'insight', 'ML'), [chosen]);
  assert.deepEqual(searchKnowledgeCards([other, chosen], 'ATTENTION'), [chosen]);
  assert.deepEqual(searchKnowledgeCards([other, chosen], 'notes'), [other]);
  const project = createFileProject(paper);
  const standard = { ...createConversation(), messages: [createUserMessage('Keep the original question')] };
  const inProject = { ...standard, id: 'project-chat', projectId: project.id };
  const workspace: Workspace = { schemaVersion: 1, activeConversationId: standard.id, conversations: [standard, inProject, project] };
  for (const conversation of [standard, inProject]) {
    const base = buildProjectChatContext(workspace, conversation, 'Use the existing preference.');
    assert.strictEqual(addKnowledgeContext(base, []), base);
    const context = addKnowledgeContext(base, [chosen]);
    assert.deepEqual(context.slice(0, -2), base.slice(0, -1));
    assert.strictEqual(context.at(-1), base.at(-1));
    const card = context.at(-2)!.content;
    assert.match(card, /Attention.*A useful insight.*Synthetic paper\.pdf/);
    assert.doesNotMatch(card, /Unselected|Private source excerpt|old-conversation/);
    assert.deepEqual(buildProjectChatContext(workspace, conversation, 'Use the existing preference.'), base);
  }
});

test('an exported card resolves the identical original file after a workspace import remaps its document ID', async () => {
  const card: KnowledgeCard = {
    id: 'card', title: 'Source', content: 'Proof', tags: [], source: { docId: paper.id, docTitle: paper.name, page: 2 },
    origin: { type: 'qa' }, createdAt: 1, updatedAt: 2,
  };
  const first = { conversationId: 'original', document: paper };
  const imported = { conversationId: 'restored', document: { ...paper, id: 'remapped-id' } };
  const other = { conversationId: 'other', document: { ...paper, id: 'other', name: paper.name } };
  const hash = async (document: DocumentAttachment) => (document.id === 'other' ? 'b' : 'a').repeat(64);
  const [exported] = await exportKnowledgeCards([card], [first], hash);
  assert.deepEqual(exported.source?.fingerprint, { size: paper.size, sha256: 'a'.repeat(64) });
  assert.equal(card.source?.fingerprint, undefined);
  assert.equal(await findKnowledgeDocument(exported.source!, [other, imported], hash), imported);
  assert.equal(await findKnowledgeDocument(exported.source!, [other], hash), undefined);
  assert.equal(await findKnowledgeDocument(card.source!, [first, imported], hash), first);
});
