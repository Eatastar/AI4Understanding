import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { locateSubAnnotationQuotes } from '../src/adapters/sub-annotation-selection';
import { MathMarkdown } from '../src/components/MathMarkdown';
import { adjacentAnnotationSlot, appendAnnotation, groupAnnotations, preferredAnnotationSlot } from '../src/domain/annotation-groups';
import { isAnnotationGenerating } from '../src/domain/annotation-state';
import { annotationReferenceBranches, annotationReferenceChoices, captureAnnotationReferences, chatQuestionContent, searchAnnotationReferenceBranches } from '../src/domain/chat-references';
import { contentHash } from '../src/domain/context-pool';
import { changeAnnotationColor } from '../src/domain/highlight-colors';
import { knowledgeFromAnnotation } from '../src/domain/knowledge';
import { addSubAnnotation, finishSubAnnotationRequest, prepareSubAnnotationRequest, subAnnotationBlock } from '../src/domain/sub-annotations';
import type { Annotation, Conversation, SubAnnotation, Workspace } from '../src/domain/types';
import { buildAnnotationContext, completeAnnotation, createAnnotation, createConversation, createSiblingAnnotation, createUserMessage, deleteAnnotation, mergeImportedWorkspace, prepareAnnotationRequest, restoreAnnotation, updateAnnotationCopy, validateImport } from '../src/domain/workspace';
import { unpackWorkspace, WorkspaceCodec } from '../src/domain/workspace-codec';

const quote = 'source anchor';
const parentAnswer = 'Use $e^{i\\theta}=1+i\\theta+O(\\theta^2)$ for the first step.\n\nNow collect the terms.';
const workspace = (conversation: Conversation): Workspace => ({ schemaVersion: 1, conversations: [conversation], activeConversationId: conversation.id });
const group = (conversation: Conversation, id: string) => groupAnnotations(conversation.annotations).get(id) ?? [];
const roundTrip = (conversation: Conversation) => {
  const { header, rows } = new WorkspaceCodec().pack(workspace(conversation));
  return validateImport(unpackWorkspace({ ...header, records: rows })).conversations[0];
};

function noteAt(conversation: Conversation, offset = 0, question = 'Parent asks about the expansion') {
  const page = conversation.documents![0].pages[0];
  return createAnnotation(conversation, {
    messageId: page.messageId, versionId: page.versionId, quote, question, color: '#f3cf67',
    anchor: { selectors: [{ start: offset, end: offset + quote.length, quote }] },
  });
}

function finish(conversation: Conversation, note: Annotation, answer: string) {
  const { conversation: pending } = prepareAnnotationRequest(conversation, note.id);
  return completeAnnotation(pending, note.id, answer);
}

function fixture() {
  const conversation = createConversation('Synthetic reader');
  conversation.documents = [{
    id: 'doc-id', name: 'Synthetic.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 500, createdAt: 1,
    pages: [{ pageNumber: 1, messageId: 'pdf-page', versionId: 'pdf-version', text: quote + ' around the original passage. A second source anchor follows.' }],
  }];
  const note = noteAt(conversation);
  conversation.annotations = [note];
  const answered = finish(conversation, note, parentAnswer);
  return { conversation: answered, parent: answered.annotations[0] };
}

test('legacy annotations load as one slot, exact re-selection joins the group and distinct spans stay independent', () => {
  const { conversation, parent } = fixture();
  const saved = roundTrip(conversation);
  assert.deepEqual(saved.annotations[0], parent);
  assert.deepEqual(group(saved, parent.id).map(item => item.id), [parent.id]);

  const sibling = createSiblingAnnotation(saved, parent.id);
  const exact = noteAt(sibling.conversation, 0, 'Another question at the same occurrence');
  let next = appendAnnotation(sibling.conversation, exact);
  const anotherOccurrence = noteAt(next, conversation.documents![0].pages[0].text.lastIndexOf(quote));
  next = appendAnnotation(next, anotherOccurrence);
  assert.deepEqual(group(next, parent.id).map(note => note.id), [parent.id, sibling.id, exact.id]);
  assert.deepEqual(group(next, anotherOccurrence.id).map(note => note.id), [anotherOccurrence.id]);
  const last = preferredAnnotationSlot(group(next, parent.id), sibling.id);
  assert.equal(last.id, sibling.id);
  assert.equal(last.question, '');
  assert.equal(last.answer, '');
  assert.equal(last.originalAnswer, undefined);
  assert.equal(last.subAnnotations, undefined);
  assert.equal(last.slotIndex, 2);
  assert.deepEqual(last.anchor, parent.anchor);
  const siblingContext = buildAnnotationContext(next, { ...last, question: 'A separate question' }, '', { mode: 'full' });
  assert.match(siblingContext[0].content, /以下为附件的按需引用资料/);
  assert.doesNotMatch(JSON.stringify(siblingContext), /Parent asks|collect the terms/);
});

test('deleting a numbered slot selects a neighbor, keeps one anchor and preserves order after restore', () => {
  const { conversation, parent } = fixture();
  const second = createSiblingAnnotation(conversation, parent.id);
  const third = createSiblingAnnotation(second.conversation, second.id);
  const slots = group(third.conversation, parent.id);
  assert.equal(adjacentAnnotationSlot(third.conversation.annotations, slots[1])?.id, third.id);
  const colored = changeAnnotationColor(third.conversation, third.id, '#b7ddba');
  assert.ok(group(colored, parent.id).every(annotation => annotation.color === '#b7ddba'));
  let next = deleteAnnotation(colored, second.id);
  assert.deepEqual(group(next, parent.id).map(annotation => annotation.id), [parent.id, third.id]);
  assert.equal(adjacentAnnotationSlot(next.annotations, group(next, parent.id)[1])?.id, parent.id);
  next = restoreAnnotation(next, second.id);
  assert.deepEqual(group(next, parent.id).map(annotation => annotation.id), [parent.id, second.id, third.id]);
  for (const { id } of slots) next = deleteAnnotation(next, id);
  assert.equal(groupAnnotations(next.annotations).size, 0);
  assert.equal(next.annotations.filter(annotation => annotation.deletedAt !== undefined).length, 3);
});

test('child requests have three local context layers, with no content from another slot', () => {
  const { conversation, parent } = fixture();
  const second = createSiblingAnnotation(conversation, parent.id);
  const withQuestion = updateAnnotationCopy(second.conversation, second.id, { question: 'Sibling question marker' });
  const answeredSecond = finish(withQuestion, withQuestion.annotations[1], 'Sibling answer marker');
  const child = addSubAnnotation(answeredSecond, parent.id, { quotedText: '$O(\\theta^2)$', blockIndex: 0, parentAnswerHash: contentHash(parent.answer) });
  const pending = prepareSubAnnotationRequest(child.conversation, parent.id, child.id, 'Why does the remainder have this order?', 'Reply preference');
  const content = pending.messages.map(message => message.content).join('\n');
  for (const expected of [quote, 'around the original passage', parent.question, parent.answer, '$O(\\theta^2)$', 'Why does the remainder have this order?']) {
    assert.ok(content.includes(expected), expected);
  }
  assert.doesNotMatch(content, /Sibling question marker|Sibling answer marker/);
  assert.equal(isAnnotationGenerating(pending.conversation.annotations[0]), true);
  assert.throws(() => deleteAnnotation(pending.conversation, parent.id));
  assert.equal(roundTrip(pending.conversation).annotations[0].subAnnotations?.[0].request?.status, 'interrupted');
  const done = finishSubAnnotationRequest(pending.conversation, parent.id, child.id, { answer: 'A Taylor remainder.' });
  const retry = prepareSubAnnotationRequest(done, parent.id, child.id, 'A replacement attempt');
  const stopped = finishSubAnnotationRequest(retry.conversation, parent.id, child.id, { error: 'Stopped', interrupted: true });
  assert.equal(stopped.annotations[0].subAnnotations?.[0].answer, 'A Taylor remainder.');
  assert.equal(stopped.annotations[0].answer, parentAnswer);
});

test('Markdown exposes block slots and an end slot for edited or stale selections', () => {
  const { conversation, parent } = fixture();
  const one = addSubAnnotation(conversation, parent.id, { quotedText: '$O(\\theta^2)$', blockIndex: 0, parentAnswerHash: contentHash(parent.answer) });
  const two = addSubAnnotation(one.conversation, parent.id, { quotedText: 'Missing block', blockIndex: 99, parentAnswerHash: contentHash(parent.answer) });
  const children = two.conversation.annotations[0].subAnnotations!;
  const render = (markdown: string) => {
    const renderChild = (item: SubAnnotation) => createElement('aside', { key: item.id }, item.quotedText);
    const hash = contentHash(markdown);
    return renderToStaticMarkup(createElement(MathMarkdown, { children: markdown, slots: {
      afterBlock: (index, count) => children.filter(item => subAnnotationBlock(item, hash, count) === index).map(renderChild),
      afterAnswer: count => children.filter(item => subAnnotationBlock(item, hash, count) === undefined).map(renderChild),
    } }));
  };
  const html = render(parent.answer);
  assert.match(html, /<annotation encoding="application\/x-tex">/);
  assert.match(html, /first step\.<\/p><\/div><aside>.*?<\/aside>.*?Now collect the terms\..*?<aside>Missing block<\/aside>/s);
  const edited = render('The entire answer was edited.');
  assert.match(edited, /edited\..*?<aside>.*?<\/aside><aside>Missing block<\/aside>/s);
  assert.match(render(''), /<aside>.*?<\/aside><aside>Missing block<\/aside>/s);
});

test('saved child highlights distinguish repeated words and keep the offset through backup and import', () => {
  const { conversation, parent } = fixture();
  const { conversation: withChild, id } = addSubAnnotation(conversation, parent.id, {
    quotedText: '解析', blockIndex: 0, quoteOffset: 7, parentAnswerHash: contentHash(parent.answer),
  });
  const saved = roundTrip(withChild).annotations[0].subAnnotations?.find(child => child.id === id);
  assert.equal(saved?.quoteOffset, 7);
  const text = '先看解析，再看解析';
  const index = { text, blocks: [{ index: 0, start: 0, end: text.length }] };
  const hash = contentHash(parent.answer);
  assert.deepEqual(locateSubAnnotationQuotes(index, saved!, hash), [{ start: 7, end: 9 }]);
  assert.deepEqual(locateSubAnnotationQuotes(index, { ...saved!, quoteOffset: undefined }, hash), [{ start: 2, end: 4 }, { start: 7, end: 9 }]);
  assert.deepEqual(locateSubAnnotationQuotes(index, saved!, contentHash('Revised answer')), []);
});

test('legacy child highlights recover from the original block or a unique passage after reflow or edits', () => {
  const text = 'partial proof\nThe exact\nproof sketch\npartial proof';
  const index = { text, blocks: [
    { index: 0, start: 0, end: 13 }, { index: 1, start: 14, end: 36 }, { index: 2, start: 37, end: text.length },
  ] };
  const repeated = { quotedText: 'partial proof', blockIndex: 2, parentAnswerHash: 'same' };
  assert.deepEqual(locateSubAnnotationQuotes(index, repeated, 'same'), [{ start: 37, end: 50 }]);
  assert.deepEqual(locateSubAnnotationQuotes(index, repeated, 'edited'), []);
  assert.deepEqual(locateSubAnnotationQuotes(index, { ...repeated, quotedText: 'exact proof' }, 'edited'), [{ start: 18, end: 29 }]);
  assert.deepEqual(locateSubAnnotationQuotes(index, { ...repeated, quotedText: 'changed text' }, 'edited'), []);
});

test('an older highlight uses its saved excerpt when its word appears throughout a long paragraph', () => {
  const text = 'term '.repeat(2000);
  const index = { text, blocks: [{ index: 0, start: 0, end: text.length }] };
  const marker = { quotedText: 'term', blockIndex: 0, parentAnswerHash: 'same' };
  assert.deepEqual(locateSubAnnotationQuotes(index, marker, 'same'), []);
  assert.deepEqual(locateSubAnnotationQuotes(index, { ...marker, quoteOffset: 475 }, 'same'), [{ start: 475, end: 479 }]);
});

test('child references and knowledge cards use the correct slot and survive compact backup and ID remapping', () => {
  const { conversation, parent } = fixture();
  const originalIds = group(conversation, parent.id).map(item => item.id);
  const second = createSiblingAnnotation(conversation, parent.id);
  const question = 'Second slot question';
  const withQuestion = { ...second.conversation, annotations: second.conversation.annotations.map(item => item.id === second.id ? { ...item, question } : item) };
  const answered = finish(withQuestion, withQuestion.annotations[1], parentAnswer);
  const child = addSubAnnotation(answered, second.id, { quotedText: '$O(\\theta^2)$', parentAnswerHash: contentHash(parentAnswer) });
  const pending = prepareSubAnnotationRequest(child.conversation, second.id, child.id, 'Child question');
  const ready = finishSubAnnotationRequest(pending.conversation, second.id, child.id, { answer: 'Child answer' });
  const user = createUserMessage('Follow-up chat');
  user.annotationReferences = captureAnnotationReferences(ready, [second.id, child.id]);
  assert.equal(user.annotationReferences[1].annotationId, second.id);
  const prompt = chatQuestionContent(user, user.versions[0].content);
  assert.match(prompt, /source anchor.*Second slot question.*Child question.*Child answer/s);
  assert.doesNotMatch(prompt, /Parent asks/);
  assert.match(knowledgeFromAnnotation(ready, ready.annotations[1], child.id)!.content, /Child answer/);

  // A purged first slot leaves an anchor ID even when no record owns that ID.
  const remaining = { ...ready, annotations: ready.annotations.filter(item => !originalIds.includes(item.id)), messages: [user] };
  const restored = roundTrip(remaining);
  assert.deepEqual(restored, remaining);
  const imported = mergeImportedWorkspace(workspace(conversation), workspace(restored)).conversations[1];
  assert.notEqual(imported.annotations[0].anchorGroupId, parent.id);
  assert.equal(imported.messages[0].annotationReferences?.[1].annotationId, imported.annotations[0].id);
  assert.equal(imported.messages[0].annotationReferences?.[1].subAnnotation?.id, imported.annotations[0].subAnnotations?.[0].id);
});

test('reference choices nest descendants and search keeps the matching ancestry', () => {
  const { conversation, parent } = fixture();
  const child: SubAnnotation = { id: 'child', quotedText: 'Expansion', question: 'Why expand?', answer: 'A useful series.', createdAt: 2, updatedAt: 2 };
  const leaf: SubAnnotation = { ...child, id: 'leaf', parentSubId: child.id, quotedText: 'Remainder', question: 'How do we bound it?' };
  const pending: SubAnnotation = { ...child, id: 'unfinished', answer: '' };
  const saved: SubAnnotation = { ...child, id: 'saved', parentSubId: pending.id, quotedText: 'Term' };
  const annotation = { ...parent, subAnnotations: [leaf, child, pending, saved] };
  const roots = annotationReferenceBranches(annotationReferenceChoices([annotation]));
  assert.deepEqual(roots.map(node => node.id), [parent.id]);
  assert.deepEqual(roots[0].children.map(node => node.id), ['child', 'saved']);
  assert.deepEqual(roots[0].children[0].children.map(node => node.id), ['leaf']);

  const found = searchAnnotationReferenceBranches(roots, '  BOUND IT  ');
  assert.equal(found[0]?.id, parent.id);
  assert.deepEqual(found[0].children.map(node => node.id), ['child']);
  assert.equal(found[0].children[0].children[0]?.id, 'leaf');
  assert.deepEqual(searchAnnotationReferenceBranches(roots, 'unmatched'), []);

  const references = captureAnnotationReferences({ ...conversation, annotations: [annotation] }, ['leaf']);
  assert.equal(references.length, 1);
  assert.equal(references[0].subAnnotation?.id, 'leaf');
});
