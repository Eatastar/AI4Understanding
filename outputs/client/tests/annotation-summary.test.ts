import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAnnotationSummary, buildSummaryContext } from '../src/domain/annotation-summary';
import { createAnnotation, createAssistantMessage, createConversation, createUserMessage, saveNoteAnnotation, validateImport } from '../src/domain/workspace';
import { unpackWorkspace, WorkspaceCodec } from '../src/domain/workspace-codec';
import type { Workspace } from '../src/domain/types';

test('summary uses visible text from only the chosen turns and target annotation', () => {
  const conversation = createConversation();
  conversation.documents = [{ id: 'doc', name: 'Synthetic.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 100, createdAt: 1, pages: [{ pageNumber: 1, text: 'PRIVATE DOCUMENT', messageId: 'page', versionId: 'page-v' }] }];
  const target = createAnnotation(conversation, { mode: 'note', quote: 'PRIVATE QUOTE', anchor: {}, color: '#654321', messageId: 'page', versionId: 'page-v' });
  conversation.annotations = saveNoteAnnotation({ ...conversation, annotations: [target] }, target.id, 'TARGET NOTE').annotations;
  const selected = createUserMessage('CHOSEN QUESTION');
  const answer = createAssistantMessage('CHOSEN ANSWER', 'complete');
  answer.versions[0].context = [{ role: 'user', content: 'FROZEN CONTEXT' }];
  selected.textReference = { conversationId: conversation.id, messageId: 'page', versionId: 'page-v', label: 'PDF', text: 'REFERENCED PDF' };
  conversation.messages = [createUserMessage('UNSELECTED QUESTION'), createAssistantMessage('UNSELECTED ANSWER', 'complete'), selected, answer];
  const payload = JSON.parse(buildSummaryContext(conversation, [selected.id], conversation.annotations[0], '')[1].content);
  assert.deepEqual(payload, { turns: [{ question: 'CHOSEN QUESTION', answers: ['CHOSEN ANSWER'] }], annotation: { note: 'TARGET NOTE' } });
  const saved = appendAnnotationSummary(conversation, target.id, { id: 'summary', createdAt: 2, conversationId: conversation.id, turnIds: [selected.id], content: 'Edited preview' });
  const space: Workspace = { schemaVersion: 1, conversations: [saved], activeConversationId: saved.id };
  const packed = new WorkspaceCodec().pack(space);
  const [note] = validateImport(unpackWorkspace({ ...packed.header, records: packed.rows })).conversations[0].annotations;
  assert.equal(note.note, 'TARGET NOTE');
  assert.equal(note.summaries?.[0].content, 'Edited preview');
  assert.deepEqual(note.summaries?.[0].turnIds, [selected.id]);
});
