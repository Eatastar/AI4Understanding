import assert from 'node:assert/strict';
import test from 'node:test';
import { companionArrowTop, companionAttachment, findCompanionOpening, placeCompanion, snapCompanion } from '../src/components/popup-position';
import { annotationReferenceBranches, annotationReferenceChoices, captureAnnotationReferences, chatQuestionContent, searchAnnotationReferenceBranches } from '../src/domain/chat-references';
import { annotationWindows, type AnnotationWindow } from '../src/domain/companion-view';
import { contentHash } from '../src/domain/context-pool';
import { knowledgeFromAnnotation } from '../src/domain/knowledge';
import { SubAnnotationStreams } from '../src/domain/sub-annotation-streams';
import { subAnnotationPath } from '../src/domain/sub-annotation-tree';
import { addSubAnnotation, deleteSubAnnotation, editSubAnnotation, finishSubAnnotationFollowUp, finishSubAnnotationRequest, prepareSubAnnotationFollowUp, prepareSubAnnotationRequest } from '../src/domain/sub-annotations';
import type { Annotation, Conversation, Workspace } from '../src/domain/types';
import { completeAnnotation, createAnnotation, createConversation, createSiblingAnnotation, createUserMessage, mergeImportedWorkspace, prepareAnnotationRequest, updateAnnotationCopy, validateImport } from '../src/domain/workspace';
import { unpackWorkspace, WorkspaceCodec } from '../src/domain/workspace-codec';

const snapshot = (conversation: Conversation): Workspace => ({ schemaVersion: 1, conversations: [conversation], activeConversationId: conversation.id });
function roundTrip(conversation: Conversation): Conversation {
  const { header, rows } = new WorkspaceCodec().pack(snapshot(conversation));
  return validateImport(unpackWorkspace({ ...header, records: rows })).conversations[0];
}
function fixture() {
  const conversation = createConversation('Synthetic companion');
  const page = { messageId: 'math-page', versionId: 'math-version', pageNumber: 1, text: 'Original proof anchor. Local document context for the proof.' };
  conversation.documents = [{ id: 'math-file', name: 'Synthetic.pdf', kind: 'pdf', size: 500, mimeType: 'application/pdf', createdAt: 1, pages: [page] }];
  const parent = createAnnotation(conversation, {
    ...page, quote: 'Original proof anchor', anchor: { selectors: [{ start: 0, end: 21, quote: 'Original proof anchor' }] },
    color: '#f3cf67', question: 'Parent card question',
  });
  conversation.annotations = [parent];
  const current = completeAnnotation(prepareAnnotationRequest(conversation, parent.id).conversation, parent.id, 'Parent card answer about the proof');
  return { conversation: current, parent: current.annotations[0] };
}
const parentOf = (conversation: Conversation, id: string) => conversation.annotations.find(item => item.id === id)!;
function createNode(conversation: Conversation, parent: Annotation, quote: string, question: string, answer: string, parentSubId?: string, turnIndex?: number) {
  const source = parentOf(conversation, parent.id).subAnnotations?.find(item => item.id === parentSubId);
  const parentAnswer = source ? turnIndex ? source.followUps![turnIndex - 1].answer : source.answer : parent.answer;
  const added = addSubAnnotation(conversation, parent.id, { quotedText: quote, parentAnswerHash: contentHash(parentAnswer), blockIndex: 0, parentSubId, turnIndex });
  const prepared = prepareSubAnnotationRequest(added.conversation, parent.id, added.id, question);
  return {
    id: added.id, messages: prepared.messages,
    conversation: finishSubAnnotationRequest(prepared.conversation, parent.id, added.id, { answer }),
  };
}
function addTurn(conversation: Conversation, parent: Annotation, childId: string, question: string, answer: string) {
  const request = prepareSubAnnotationFollowUp(conversation, parent.id, childId, question);
  const target = { annotationId: parent.id, childId, followUpId: request.followUpId };
  return { target, messages: request.messages, conversation: finishSubAnnotationFollowUp(request.conversation, target, answer) };
}

test('third-level drill-down includes the path and only the direct upper exchange, even across numbered slots', () => {
  const { conversation, parent } = fixture();
  const sibling = createSiblingAnnotation(conversation, parent.id);
  const isolated = updateAnnotationCopy(sibling.conversation, sibling.id, { question: 'Other slot question' });
  const numbered = completeAnnotation(prepareAnnotationRequest(isolated, sibling.id).conversation, sibling.id, 'Other slot answer');
  const one = createNode(numbered, parent, 'analytic continuation', 'First ancestor question', 'First ancestor answer');
  const turn = addTurn(one.conversation, parent, one.id, 'Source turn question', 'Source turn answer');
  const two = createNode(turn.conversation, parent, 'identity theorem', 'Direct upper question', 'Direct upper answer', one.id, 1);
  assert.match(two.messages.at(-1)!.content, /Source turn question.*Source turn answer/s);
  assert.doesNotMatch(two.messages.at(-1)!.content, /First ancestor answer/);
  const three = createNode(two.conversation, parent, 'accumulation point', 'Why this point?', 'Third answer', two.id, 0);
  const prompt = three.messages.map(message => message.content).join('\n');
  assert.match(prompt, /Local document context/);
  assert.match(prompt, /Original proof anchor → analytic continuation → identity theorem → accumulation point/);
  assert.match(prompt, /Direct upper question.*Direct upper answer.*Why this point/s);
  assert.doesNotMatch(prompt, /First ancestor (question|answer)|Source turn (question|answer)|Parent card (question|answer)|Other slot (question|answer)/);
  const followOne = addTurn(three.conversation, parent, three.id, 'One more detail', 'Additional explanation');
  const followTwo = addTurn(followOne.conversation, parent, three.id, 'And one more?', 'Further explanation');
  assert.match(followTwo.messages.at(-1)!.content, /Direct upper answer.*Third answer.*One more detail.*Additional explanation.*And one more/s);
  assert.doesNotMatch(followTwo.messages.at(-1)!.content, /First ancestor answer|Other slot answer/);
});

test('legacy root nodes, descendant links and follow-up answers survive a compact backup and import', () => {
  const { conversation, parent } = fixture();
  const legacy = createNode(conversation, parent, 'Legacy quote', 'Legacy question', 'Legacy answer');
  const legacyNode = parentOf(legacy.conversation, parent.id).subAnnotations![0];
  assert.deepEqual(roundTrip(legacy.conversation).annotations[0].subAnnotations![0], legacyNode);
  assert.equal(legacyNode.parentSubId, undefined);
  const followed = addTurn(legacy.conversation, parent, legacy.id, 'Keep this turn?', 'Keep it.');
  const nested = createNode(followed.conversation, parent, 'New selection', 'Nested question', 'Nested reply', legacy.id, 1);
  const context = createUserMessage('Use the nested annotation');
  context.annotationReferences = captureAnnotationReferences(nested.conversation, [nested.id, legacy.id]);
  const recorded = { ...nested.conversation, messages: [context] };
  assert.deepEqual(roundTrip(recorded), recorded);
  const imported = mergeImportedWorkspace(snapshot(conversation), snapshot(recorded)).conversations[1];
  const [head, leaf] = imported.annotations[0].subAnnotations!;
  assert.notEqual(head.id, legacy.id);
  assert.equal(leaf.parentSubId, head.id);
  assert.equal(leaf.turnIndex, 1);
  assert.notEqual(head.followUps![0].id, followed.target.followUpId);
  assert.equal(head.followUps![0].answer, 'Keep it.');
  assert.equal(imported.messages[0].annotationReferences![0].subAnnotation!.id, leaf.id);
  assert.match(chatQuestionContent(context, 'Next question'), /Original proof anchor.*Legacy quote → New selection.*Nested question.*Nested reply.*Keep this turn\?.*Keep it\./s);
});

test('personal sub-annotations persist, can be edited, and can be explicitly cited as notes', () => {
  const { conversation, parent } = fixture();
  const anchor = { quotedText: 'the proof', blockIndex: 0, parentAnswerHash: contentHash(parent.answer) };
  assert.throws(() => addSubAnnotation(conversation, parent.id, anchor, ' \n '), /请输入批注内容/);
  const created = addSubAnnotation(conversation, parent.id, anchor, 'Why compactness matters.\n\nTry a counterexample.');
  const text = 'Why compactness matters.\n\nTry a second counterexample.';
  const edited = editSubAnnotation(created.conversation, parent.id, created.id, { note: text });
  const saved = parentOf(edited, parent.id).subAnnotations![0];
  assert.equal(saved.note, text);
  assert.equal(saved.question, '');
  assert.equal(saved.answer, '');
  assert.equal(saved.request, undefined);
  assert.throws(() => prepareSubAnnotationRequest(edited, parent.id, saved.id, 'Submit'), /普通批注/);
  assert.throws(() => editSubAnnotation(edited, parent.id, saved.id, { answer: 'Override' }), /普通批注/);
  assert.throws(() => editSubAnnotation(edited, parent.id, saved.id, { note: ' ' }), /请输入批注内容/);

  const choices = annotationReferenceBranches(annotationReferenceChoices(edited.annotations));
  assert.equal(searchAnnotationReferenceBranches(choices, 'second counterexample')[0].children[0].id, saved.id);
  const question = createUserMessage('Discuss my observation');
  question.annotationReferences = captureAnnotationReferences(edited, [saved.id]);
  const copy = question.annotationReferences[0].subAnnotation!;
  assert.equal(copy.note, text);
  assert.match(chatQuestionContent(question, 'Discuss my observation'), /子批注笔记（读者自己的理解）：\nWhy compactness matters\.\n\nTry a second counterexample/);
  const card = knowledgeFromAnnotation(edited, parentOf(edited, parent.id), saved.id)!;
  assert.equal(card.content, text);
  assert.equal(card.origin.type, 'quote');
  assert.deepEqual(roundTrip({ ...edited, messages: [question] }), { ...edited, messages: [question] });
});

test('descendants can anchor to personal notes and same-passage siblings stay independent', () => {
  const { conversation, parent } = fixture();
  const text = 'My note about compactness and a limiting argument.';
  const root = addSubAnnotation(conversation, parent.id, { quotedText: 'the proof', parentAnswerHash: contentHash(parent.answer) }, text);
  const child = addSubAnnotation(root.conversation, parent.id, {
    quotedText: 'limiting argument', parentSubId: root.id, turnIndex: 0, blockIndex: 0,
    quoteOffset: text.indexOf('limiting argument'), parentAnswerHash: contentHash(text),
  });
  const asked = prepareSubAnnotationRequest(child.conversation, parent.id, child.id, 'Can we make the limit precise?');
  const content = asked.messages.at(-1)!.content;
  assert.match(content, /Original proof anchor → the proof → limiting argument/);
  assert.ok(content.includes(text));
  assert.match(content, /直接上一级笔记/);
  assert.doesNotMatch(content, /Parent card answer about the proof/);

  const other = addSubAnnotation(asked.conversation, parent.id, { quotedText: 'the proof', siblingOf: root.id });
  const sibling = parentOf(other.conversation, parent.id).subAnnotations!.at(-1)!;
  assert.notEqual(sibling.id, root.id);
  assert.equal(sibling.parentSubId, undefined);
  assert.equal(sibling.parentAnswerHash, contentHash(parent.answer));
  assert.equal(sibling.quotedText, 'the proof');
  assert.equal(sibling.note, undefined);
  const siblingQuestion = prepareSubAnnotationRequest(other.conversation, parent.id, sibling.id, 'A separate angle');
  assert.doesNotMatch(siblingQuestion.messages.at(-1)!.content, /My note about compactness|make the limit precise/);
  const nestedSibling = addSubAnnotation(other.conversation, parent.id, { quotedText: 'limiting argument', siblingOf: child.id }, 'My second angle.');
  const newNote = parentOf(nestedSibling.conversation, parent.id).subAnnotations!.at(-1)!;
  assert.equal(newNote.parentSubId, root.id);
  assert.equal(newNote.quoteOffset, text.indexOf('limiting argument'));
});

test('deleting a streaming subtree aborts stale fragments and completion cannot recreate either kind of reply', () => {
  const { conversation, parent } = fixture();
  const root = createNode(conversation, parent, 'Root', 'Root question', 'Root response');
  const leaf = createNode(root.conversation, parent, 'Leaf', 'Leaf question', 'Leaf response', root.id, 0);
  const sibling = createNode(leaf.conversation, parent, 'Other root', 'Other question', 'Other response');
  const first = prepareSubAnnotationRequest(sibling.conversation, parent.id, root.id, 'Replace root reply');
  const follow = prepareSubAnnotationFollowUp(first.conversation, parent.id, leaf.id, 'Follow-up while parent is reasked');
  const target = { annotationId: parent.id, childId: leaf.id, followUpId: follow.followUpId };
  const streams = new SubAnnotationStreams();
  const firstController = new AbortController(), followController = new AbortController();
  streams.start({ annotationId: parent.id, childId: root.id }, firstController);
  streams.start(target, followController);
  streams.append(follow.conversation, root.id, firstController, 'First chunk');
  streams.append(follow.conversation, leaf.id, followController, 'First chunk');
  assert.equal(streams.get(leaf.id)?.answer, 'First chunk');

  const removed = deleteSubAnnotation(follow.conversation, parent.id, root.id);
  streams.append(removed, root.id, firstController, 'Stale delta');
  streams.append(removed, leaf.id, followController, 'Stale delta');
  assert.equal(firstController.signal.aborted, true);
  assert.equal(followController.signal.aborted, true);
  assert.equal(streams.get(root.id)?.answer, 'First chunk');
  assert.equal(streams.get(leaf.id)?.answer, 'First chunk');
  assert.equal(finishSubAnnotationRequest(removed, parent.id, root.id, { answer: 'Late root answer' }), removed);
  assert.equal(finishSubAnnotationFollowUp(removed, target, 'Late follow-up answer'), removed);
  assert.deepEqual(removed.annotations[0].subAnnotations?.map(node => node.id), [sibling.id]);
});

test('annotation windows keep siblings, independent anchors and deep branches open together', () => {
  let windows: readonly AnnotationWindow[] = [];
  windows = annotationWindows(windows, { type: 'open-parent', id: 'slot-one', groupId: 'group-one' });
  windows = annotationWindows(windows, { type: 'open-child', ownerId: 'slot-one', id: 'first-child', parentId: 'slot-one' });
  windows = annotationWindows(windows, { type: 'open-child', ownerId: 'slot-one', id: 'sibling', parentId: 'slot-one' });
  let parentId = 'first-child';
  for (let depth = 2; depth <= 12; depth++) {
    const id = `level-${depth}`;
    windows = annotationWindows(windows, { type: 'open-child', ownerId: 'slot-one', id, parentId });
    parentId = id;
  }
  windows = annotationWindows(windows, { type: 'open-parent', id: 'other-root', groupId: 'group-two' });
  windows = annotationWindows(windows, { type: 'open-child', ownerId: 'other-root', id: 'other-child', parentId: 'other-root' });
  assert.equal(windows.length, 16);
  windows = annotationWindows(windows, { type: 'open-child', ownerId: 'slot-one', id: 'first-child', parentId: 'slot-one' });
  assert.equal(windows.length, 16);
  assert.equal(windows.at(-1)?.id, 'first-child');

  const draft = { quotedText: 'Selected formula', parentSubId: 'sibling', turnIndex: 1 };
  windows = annotationWindows(windows, { type: 'open-child', ownerId: 'slot-one', id: 'draft', parentId: 'sibling', draft });
  windows = annotationWindows(windows, { type: 'commit', draftId: 'draft', savedId: 'saved' });
  assert.deepEqual(windows.at(-1), { kind: 'child', ownerId: 'slot-one', id: 'saved', key: 'draft', parentId: 'sibling', draft: undefined });
  windows = annotationWindows(windows, { type: 'close', ids: ['first-child'] });
  assert.deepEqual(new Set(windows.map(window => window.id)), new Set(['slot-one', 'sibling', 'saved', 'other-root', 'other-child']));

  windows = annotationWindows(windows, { type: 'open-child', ownerId: 'slot-one', id: 'unsent', parentId: 'sibling', draft });
  windows = annotationWindows(windows, { type: 'close', ids: ['unsent'] });
  assert.equal(windows.some(window => window.id === 'unsent'), false);
  windows = annotationWindows(windows, { type: 'open-parent', id: 'slot-two', groupId: 'group-one' });
  assert.deepEqual(windows.map(window => window.id), ['other-root', 'other-child', 'slot-two']);
  assert.equal(annotationWindows(windows, { type: 'open-child', ownerId: 'slot-one', id: 'late-open', parentId: 'sibling' }), windows);
  assert.deepEqual(annotationWindows(windows, { type: 'clear' }), []);
});

const openingViewport = { width: 1440, height: 900, top: 54 };
const parentWindow = { left: 136, top: 180, width: 438, height: 370 };
const childSize = { width: 316, height: 180 };

test('child windows open along free edges and avoid covering a sibling header', () => {
  const preferred = { left: 583, top: 240 };
  const right = findCompanionOpening(parentWindow, childSize, preferred, openingViewport, [parentWindow]);
  assert.equal(right.side, 'right');
  const first = { ...placeCompanion(parentWindow, childSize, right, openingViewport), ...childSize };
  assert.deepEqual(first, { ...preferred, ...childSize });
  const next = findCompanionOpening(parentWindow, childSize, preferred, openingViewport, [parentWindow, first]);
  const sibling = placeCompanion(parentWindow, childSize, next, openingViewport);
  assert.ok(sibling.top >= first.top + first.height || sibling.top + childSize.height <= first.top || sibling.left >= first.left + first.width || sibling.left + childSize.width <= first.left);

  const farRight = { ...parentWindow, left: 850 };
  const left = findCompanionOpening(farRight, childSize, preferred, openingViewport, [farRight]);
  assert.equal(left.side, 'left');
  assert.equal(placeCompanion(farRight, childSize, left, openingViewport).left + childSize.width, farRight.left - 9);
  const narrow = { width: 510, height: 610, top: 54 };
  const crowded = findCompanionOpening(parentWindow, childSize, preferred, narrow, [parentWindow, first]);
  const inside = placeCompanion(parentWindow, childSize, crowded, narrow);
  assert.ok(inside.left >= 12 && inside.left + childSize.width <= 498 && inside.top >= 54);
});

test('releasing near a seam snaps and a root drag carries both snapped and free descendants at every depth', () => {
  const view = { width: 1800, height: 1000 };
  const released = { left: 599, top: 232, ...childSize };
  const snapped = snapCompanion(parentWindow, released, view);
  assert.deepEqual(snapped, { side: 'right', offset: 52 });
  const first = { ...placeCompanion(parentWindow, childSize, snapped, view), ...childSize };
  assert.equal(first.left, parentWindow.left + parentWindow.width + 9);
  const freeRelease = { left: 964, top: 330, ...childSize };
  const free = snapCompanion(first, freeRelease, view);
  assert.equal(free.side, 'free');
  const second = { ...placeCompanion(first, childSize, free, view), ...childSize };
  const thirdAttachment = { side: 'below', offset: 0 } as const;
  const third = placeCompanion(second, childSize, thirdAttachment, view);
  const shift = { left: 49, top: -81 };
  const movedRoot = { ...parentWindow, left: parentWindow.left + shift.left, top: parentWindow.top + shift.top };
  const movedFirst = { ...placeCompanion(movedRoot, childSize, snapped, view), ...childSize };
  const movedSecond = { ...placeCompanion(movedFirst, childSize, free, view), ...childSize };
  const movedThird = placeCompanion(movedSecond, childSize, thirdAttachment, view);
  for (const [before, after] of [[first, movedFirst], [second, movedSecond], [third, movedThird]]) {
    assert.deepEqual({ left: after.left - before.left, top: after.top - before.top }, shift);
  }
  const farUp = companionAttachment(movedRoot, { left: 64, top: 12 }, 'free');
  assert.equal(placeCompanion(movedRoot, childSize, farUp, view).top, 12);
  assert.equal(placeCompanion({ ...parentWindow, width: 480 }, childSize, snapped, view).left, first.left + 42);
});

test('magnetic pointers stay in the visible parent body and vanish after scrolling it away', () => {
  const child = { left: 583, top: 240, ...childSize };
  assert.equal(companionArrowTop(parentWindow, child, 'right', { center: 82, visibleTop: 40, visibleBottom: 260 }), 22);
  assert.equal(companionArrowTop(parentWindow, child, 'right', { center: 25, visibleTop: 72, visibleBottom: 220 }), 12);
  assert.equal(companionArrowTop(parentWindow, child, 'right', undefined), undefined);
  assert.equal(companionArrowTop(parentWindow, { ...child, left: 610 }, 'right', { center: 82, visibleTop: 40, visibleBottom: 260 }), undefined);
});
test('both branch targets stay valid as the displayed stack changes and a broken import keeps its nodes', () => {
  const { conversation, parent } = fixture();
  const a = createNode(conversation, parent, 'A', 'A question', 'A answer');
  const b = createNode(a.conversation, parent, 'B', 'B question', 'B answer', a.id, 0);
  const pendingA = prepareSubAnnotationFollowUp(b.conversation, parent.id, a.id, 'Ask A');
  const pendingB = prepareSubAnnotationFollowUp(pendingA.conversation, parent.id, b.id, 'Ask B');
  const targetA = { annotationId: parent.id, childId: a.id, followUpId: pendingA.followUpId };
  const targetB = { annotationId: parent.id, childId: b.id, followUpId: pendingB.followUpId };
  const streams = new SubAnnotationStreams();
  const ca = new AbortController(), cb = new AbortController();
  streams.start(targetA, ca);
  streams.start(targetB, cb);
  streams.append(pendingB.conversation, b.id, cb, 'B result');
  streams.append(pendingB.conversation, a.id, ca, 'A result');
  let next = finishSubAnnotationFollowUp(pendingB.conversation, targetB, streams.get(b.id)!.answer);
  next = finishSubAnnotationFollowUp(next, targetA, streams.get(a.id)!.answer);
  const nodes = parentOf(next, parent.id).subAnnotations!;
  assert.deepEqual(nodes.map(node => node.followUps![0].answer), ['A result', 'B result']);
  const broken = structuredClone(next);
  broken.annotations[0].subAnnotations![0].parentSubId = b.id;
  const repaired = roundTrip(broken);
  const repairedNodes = repaired.annotations[0].subAnnotations!;
  assert.equal(repairedNodes.length, 2);
  for (const node of repairedNodes) assert.equal(subAnnotationPath(repairedNodes, node.id)[0].parentSubId, undefined);
});
