import assert from 'node:assert/strict';
import test from 'node:test';
import { loadReaderPosition, saveReaderPosition } from '../src/adapters/reader';
import { loadSplitRatio, saveSplitRatio } from '../src/adapters/split-preferences';
import type { ReaderPosition } from '../src/domain/reader';
import { clampSplitRatio, DEFAULT_SPLIT_RATIO, splitRatioBounds } from '../src/domain/split-layout';
import { closePreviewTab, moveProjectPreview, openPreviewTab, panePreviewScope, setProjectPreview, type ProjectPreviews } from '../src/domain/workspace-view';
import { createConversation } from '../src/domain/workspace';

const first = { ownerId: 'project-a', documentId: 'first' };
const second = { ownerId: 'project-a', documentId: 'second' };
const third = { ownerId: 'project-a', documentId: 'third' };

test('preview tabs deduplicate, choose a neighbor, and end when the last tab is closed', () => {
  const initial = openPreviewTab(undefined, first);
  assert.equal(openPreviewTab(initial, { ...first }), initial);
  const stacked = openPreviewTab(openPreviewTab(initial, second), third);
  const switched = openPreviewTab(stacked, second);
  assert.deepEqual(switched.tabs, [first, second, third]);
  assert.equal(switched.active, second);
  const removedInactive = closePreviewTab(switched, first.documentId)!;
  assert.equal(removedInactive.active, second);
  const removedActive = closePreviewTab(removedInactive, second.documentId)!;
  assert.equal(removedActive.active, third);
  assert.equal(closePreviewTab(removedActive, third.documentId), undefined);
  assert.equal(closePreviewTab(stacked, third.documentId)?.active, second);
});

test('reselecting a tab uses the existing page, scroll and zoom saved for that document', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const firstPosition: ReaderPosition = { pageIndex: 5, view: 'original', layout: 'continuous', pageOffset: .4, scrollX: .2, scrollY: .3, zoom: 1.25 };
  const secondPosition: ReaderPosition = { ...firstPosition, pageIndex: 12, pageOffset: .75, zoom: 1.75 };
  const preview = openPreviewTab(openPreviewTab(undefined, first), second);
  saveReaderPosition(first.documentId, firstPosition, storage);
  saveReaderPosition(second.documentId, secondPosition, storage);
  assert.deepEqual(loadReaderPosition(preview.active.documentId, 24, 'pdf', storage), secondPosition);
  const back = openPreviewTab(preview, first);
  assert.deepEqual(loadReaderPosition(back.active.documentId, 24, 'pdf', storage), firstPosition);
});

test('project chats and overview share one stack while unrelated projects and standalone chats have separate stacks', () => {
  const a = { ...createConversation('A'), isProject: true as const };
  const b = { ...createConversation('B'), isProject: true as const };
  const chatA = { ...createConversation(), projectId: a.id };
  const chatB = { ...createConversation(), projectId: b.id };
  const standalone = createConversation();
  const workspace = { schemaVersion: 1 as const, activeConversationId: chatA.id, conversations: [a, b, chatA, chatB, standalone] };
  const aChat = panePreviewScope(workspace, { kind: 'chat', conversationId: chatA.id })!;
  const aOverview = panePreviewScope(workspace, { kind: 'overview', projectId: a.id })!;
  const bChat = panePreviewScope(workspace, { kind: 'chat', conversationId: chatB.id })!;
  let previews: ProjectPreviews = new Map();
  previews = setProjectPreview(previews, aChat, openPreviewTab(undefined, first));
  assert.equal(previews.get(aOverview)?.active, first);
  assert.equal(previews.get(bChat), undefined);
  previews = setProjectPreview(previews, bChat, openPreviewTab(undefined, { ownerId: b.id, documentId: 'foreign' }));
  assert.equal(previews.get(aChat)?.active, first);
  assert.equal(previews.get(panePreviewScope(workspace, { kind: 'chat', conversationId: standalone.id })!), undefined);
});

test('a chat moved into a project keeps its tabs and deduplicates against the project files', () => {
  const doc = { ownerId: 'project', documentId: 'existing' };
  const source = openPreviewTab(openPreviewTab(undefined, first), second);
  const target = openPreviewTab(undefined, doc);
  const moved = moveProjectPreview(new Map([['chat', source], ['project', target]]), 'chat', 'project',
    tab => ({ ownerId: 'project', documentId: tab === second ? doc.documentId : tab.documentId }));
  assert.equal(moved.get('chat'), undefined);
  assert.deepEqual(moved.get('project')?.tabs, [doc, { ownerId: 'project', documentId: first.documentId }]);
  assert.equal(moved.get('project')?.active, doc);
});

test('split width respects usable pane sizes and can persist a reset to equal halves', () => {
  assert.deepEqual(splitRatioBounds(1200), { min: .3, max: .7 });
  assert.equal(clampSplitRatio(0, 1200), .3);
  assert.equal(clampSplitRatio(1, 1200), .7);
  assert.equal(clampSplitRatio(.25, 750), .45);
  assert.equal(clampSplitRatio(.9, 750), .55);
  assert.equal(clampSplitRatio(NaN, 1200), DEFAULT_SPLIT_RATIO);
  let value: string | null = null;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  assert.equal(loadSplitRatio(storage), .5);
  saveSplitRatio(.63, storage);
  assert.equal(loadSplitRatio(storage), .63);
  saveSplitRatio(DEFAULT_SPLIT_RATIO, storage);
  assert.equal(loadSplitRatio(storage), .5);
  value = '1.8';
  assert.equal(loadSplitRatio(storage), .5);
});
