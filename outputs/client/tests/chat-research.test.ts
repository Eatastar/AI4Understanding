import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseBriefing } from '../src/adapters/inquiry';
import { ResearchSourceCard } from '../src/components/ResearchSourceCard';
import { chatSearchAction, homeQuestionAction, INQUIRY_SOURCE_LIMIT, mergeResearch, newResearchSources, readResearchSource, setResearchReadingStatus, suggestsPaperSearch, toggleChatSearch, type Inquiry, type InquirySource } from '../src/domain/inquiry';
import { archiveChatPaper, buildProjectChatContext, createProject } from '../src/domain/projects';
import type { DocumentAttachment, Workspace } from '../src/domain/types';
import { activeVersion, createAssistantMessage, createConversation, createUserMessage, validateImport } from '../src/domain/workspace';
import { unpackWorkspace, WorkspaceCodec } from '../src/domain/workspace-codec';

const paper: InquirySource = {
  id: 'fixture-paper', provider: 'Semantic Scholar', title: 'Synthetic review of source protocols',
  authors: 'A. Reader', year: 2025, venue: 'Synthetic Review', citationCount: 0, citationProvider: 'Semantic Scholar',
  evidence: 'abstract', excerpt: 'The paper compares the protocols under a controlled workload.',
  webUrl: 'https://research.example.org/papers/source-protocols', pdfUrl: 'https://research.example.org/papers/source-protocols.pdf',
  doi: '10.0000/source-protocols', readingBucket: 'overview',
  decisionSummary: { angle: 'Compares the protocols.', depth: 'Reports a controlled workload.', caveat: 'The abstract describes a single workload.' },
};

test('the home action selects the chat by default and grants overview search for one submission', () => {
  assert.deepEqual(homeQuestionAction('  My question  ', false), { question: 'My question', pane: 'chat', nextSearch: false });
  const explicit = homeQuestionAction('  My question  ', true)!;
  assert.equal(explicit.pane, 'overview');
  assert.equal(homeQuestionAction('Another question', explicit.nextSearch)?.pane, 'chat');
  assert.equal(homeQuestionAction('  ', true), undefined);
});

test('chat search modes are exclusive, reset on acceptance and recognize the explicit paper command', () => {
  const web = toggleChatSearch('local', 'web');
  assert.deepEqual(chatSearchAction('A current fact', web), { question: 'A current fact', mode: 'web', nextMode: 'local' });
  const papers = toggleChatSearch(web, 'papers');
  assert.deepEqual(chatSearchAction('Find the literature', papers), { question: 'Find the literature', mode: 'papers', nextMode: 'local' });
  assert.equal(toggleChatSearch(papers, 'papers'), 'local');
  assert.deepEqual(chatSearchAction('/paper  A paper title', web), { question: 'A paper title', mode: 'papers', nextMode: 'local' });
  assert.deepEqual(chatSearchAction('What is /paper?', 'local'), { question: 'What is /paper?', mode: 'local', nextMode: 'local' });
  assert.equal(chatSearchAction('/paper ', 'local'), undefined);
  assert(suggestsPaperSearch('帮我找几篇量子纠错的综述论文'));
  assert(suggestsPaperSearch('Find recent papers on energy storage.'));
  assert(!suggestsPaperSearch('解释这篇论文里的公式。'));
});

test('paper cards round-trip with the answer and project creation happens only at explicit archive', () => {
  const first = createUserMessage('How do the protocols differ?');
  const reply = createAssistantMessage('These are the sources I found.', 'complete');
  activeVersion(reply).research = { kind: 'papers', sources: [paper] };
  const legacy = createAssistantMessage('Older reply', 'complete');
  const chat = { ...createConversation('Standalone'), messages: [first, reply, createUserMessage('Follow-up'), legacy] };
  const workspace: Workspace = { schemaVersion: 1, activeConversationId: chat.id, conversations: [chat] };
  const packed = new WorkspaceCodec().pack(workspace);
  const restored = validateImport(unpackWorkspace({ ...packed.header, records: packed.rows }));
  assert.deepEqual(activeVersion(restored.conversations[0].messages[1]).research, { kind: 'papers', sources: [paper] });
  assert.equal(activeVersion(restored.conversations[0].messages[3]).research, undefined);
  assert.equal(restored.conversations.length, 1);
  const result = archiveChatPaper(restored, chat.id, paper);
  assert.equal(result.added, true);
  assert.equal(result.workspace.activeConversationId, chat.id);
  const project = result.workspace.conversations.find(item => item.id === result.projectId)!;
  assert.equal(project.title, activeVersion(first).content);
  assert.deepEqual(project.inquiry?.sources, [{ ...paper, archived: true }]);
  const moved = result.workspace.conversations.find(item => item.id === chat.id)!;
  assert.equal(moved.projectId, project.id);
  assert.deepEqual(moved.messages, restored.conversations[0].messages);
  const retry = archiveChatPaper(result.workspace, chat.id, { ...paper, id: 'different-index', title: 'Alternate title' });
  assert.deepEqual(retry, { workspace: result.workspace, projectId: project.id, sourceId: paper.id, added: false });
});

test('normalization excludes saved DOI, title and URL aliases before choosing a batch', () => {
  const withoutDoi = { ...paper, doi: undefined, pdfUrl: undefined };
  const sameDoi = readResearchSource({ ...withoutDoi, id: 'doi-match', title: 'Alternate title', webUrl: 'https://doi.org/10.0000/SOURCE-PROTOCOLS' });
  const sameUrl = { ...withoutDoi, id: 'url-match', title: 'Translated title', webUrl: paper.webUrl + '?utm_source=ref#abstract' };
  const sameTitle = { ...withoutDoi, id: 'title-match', title: 'Synthetic review of SOURCE protocols!', webUrl: 'https://different.example.net/record' };
  const different = { ...withoutDoi, id: 'new-paper', title: 'Independent article', webUrl: 'https://different.example.net/independent', pdfUrl: undefined };
  assert.deepEqual(newResearchSources([sameDoi, sameUrl, sameTitle, different, { ...different, id: 'mirror' }], [paper], 5), [different]);
  assert.deepEqual(newResearchSources([different], [], 0), []);
});

test('bibliographic records and incomplete model classifications render from trusted candidate data', () => {
  const metadata: InquirySource = { ...paper, id: 'metadata', evidence: 'metadata', excerpt: undefined, readingBucket: undefined, decisionSummary: undefined };
  const briefing = parseBriefing(JSON.stringify({
    sources: [
      { ...paper, id: metadata.id, decisionSummary: { angle: 'Invented', depth: 'Invented', caveat: 'Invented' } },
      { id: paper.id, readingBucket: 'invalid', decisionSummary: { angle: 'Only one field' }, venue: 'Invented', citationCount: 99, mediaType: 'repo' },
    ],
  }), [metadata, readResearchSource(paper)]);
  assert.equal(briefing.sources[0].readingBucket, undefined);
  assert.equal(briefing.sources[0].decisionSummary, undefined);
  assert.equal(briefing.sources[1].readingBucket, undefined);
  assert.equal(briefing.sources[1].decisionSummary, undefined);
  assert.equal(briefing.sources[1].venue, paper.venue);
  assert.equal(briefing.sources[1].citationCount, 0);
  assert.equal(briefing.sources[1].mediaType, undefined);
});

test('source cards keep older summaries and only render depth supported by evidence', () => {
  const legacy = { ...paper, readingBucket: undefined, decisionSummary: undefined, coverage: 'An older saved explanation.' };
  const render = (source: InquirySource) => renderToStaticMarkup(createElement(ResearchSourceCard, { source }));
  const old = render(legacy);
  assert.match(old, /未分类.*Synthetic Review.*引用 0.*An older saved explanation/u);
  assert.doesNotMatch(old, /论文 \/ PDF|视频 \/ 网课/u);

  for (const metadata of [{ ...paper, evidence: 'metadata' as const }, { ...paper, excerpt: ' ' }]) {
    const html = render({ ...metadata, citationCount: undefined, coverage: 'Invented' });
    assert.match(html, /仅有书目信息.*暂无法判断内容深度.*缺少摘要或正文片段/u);
    assert.doesNotMatch(html, /Invented|Reports a controlled workload|引用 \d/u);
  }
  assert.equal(readResearchSource({ ...legacy, year: '2024', mediaType: 'invalid' }).year, 2024);
  assert.equal(readResearchSource({ ...legacy, year: 'unknown', mediaType: 'invalid' }).mediaType, undefined);
});

test('videos retain a separate medium label and viewing action in every reading bucket', () => {
  const video: InquirySource = { ...paper, id: 'course', mediaType: 'video_course', doi: undefined, pdfUrl: undefined, webUrl: 'https://www.youtube.com/watch?v=fixture' };
  const matchingTitle = { ...paper, mediaType: 'paper' as const };
  const mirror = { ...video, id: 'mirror', webUrl: video.webUrl + '&utm_source=fixture' };
  assert.deepEqual(newResearchSources([video, mirror], [matchingTitle], 5), [video]);
  assert.deepEqual(newResearchSources([{ ...matchingTitle, id: 'legacy-with-handout', mediaType: undefined, title: 'Different title', doi: undefined }],
    [{ ...video, pdfUrl: paper.pdfUrl }], 5).map(source => source.id), ['legacy-with-handout']);
  for (const [readingBucket, label] of [['overview', '综述 / 入门'], ['deep_dive', '技术'], ['brief', '简报']] as const) {
    const card = createElement(ResearchSourceCard, { source: { ...video, readingBucket }, children: '关联本地 PDF' });
    const html = renderToStaticMarkup(card);
    assert(html.includes(label));
    assert.match(html, /视频 \/ 网课.*请在原网站观看。可关联本地 PDF 讲义。.*打开观看.*关联本地 PDF/u);
    assert.match(html, /href="https:\/\/www.youtube.com\/watch\?v=fixture"/u);
  }
});

test('source reading status round-trips with project data and bookmarks survive source rotation', () => {
  const docId = 'retained-file';
  const watched: InquirySource = { ...paper, id: 'video-doc', mediaType: 'video_course', note: 'Original note', documentId: docId };
  const initial: Inquiry = { sources: [watched, { ...paper, id: 'other-source' }] };
  const bookmarked = setResearchReadingStatus(initial, watched.id, 'to_read');
  const skipped = setResearchReadingStatus(bookmarked, 'other-source', 'skipped');
  assert.equal(initial.sources?.[0].readingStatus, undefined);
  assert.equal(setResearchReadingStatus(skipped, watched.id, 'to_read'), skipped);
  const document: DocumentAttachment = {
    id: docId, kind: 'pdf', mimeType: 'application/pdf', name: 'Slides.pdf', size: 90, createdAt: 1,
    pages: [{ pageNumber: 1, text: 'Synthetic slides', messageId: 'doc-page', versionId: 'doc-version' }],
  };
  const project = { ...createProject('Fixture'), documents: [document], inquiry: skipped };
  const chat = { ...createConversation(), projectId: project.id };
  const { header, rows } = new WorkspaceCodec().pack({ schemaVersion: 1, activeConversationId: chat.id, conversations: [project, chat] });
  const saved = validateImport(unpackWorkspace({ ...header, records: rows })).conversations[0];
  assert.deepEqual(saved.inquiry, skipped);
  const restore = setResearchReadingStatus(saved.inquiry!, 'other-source');
  assert.equal(restore.sources?.[1].readingStatus, undefined);
  assert.equal(restore.sources?.[0].documentId, docId);
  const unlinkedBookmark = { ...paper, readingStatus: 'to_read' as const };
  const batch = Array.from({ length: INQUIRY_SOURCE_LIMIT }, (_, index) => ({ ...paper, id: 'new-' + index }));
  const rotated = mergeResearch({ sources: [unlinkedBookmark] }, batch);
  assert.equal(rotated.sources?.length, INQUIRY_SOURCE_LIMIT);
  assert(rotated.sources?.includes(unlinkedBookmark));
});

test('ordinary follow-ups can read saved papers in their own section without reusing the web lookup', () => {
  const question = createUserMessage('Find papers.');
  const papers = createAssistantMessage('Paper results', 'complete');
  activeVersion(papers).research = { kind: 'papers', sources: [paper] };
  const web = createAssistantMessage('A current fact', 'complete');
  activeVersion(web).research = { kind: 'web', citations: [{ title: 'Web fixture', url: 'https://web.example.org/current' }] };
  const followUp = { ...createConversation(), messages: [question, papers, createUserMessage('A web question'), web, createUserMessage('Compare the first two papers.')] };
  const workspace: Workspace = { schemaVersion: 1, activeConversationId: followUp.id, conversations: [followUp] };
  const context = buildProjectChatContext(workspace, followUp, '').map(message => message.content).join('\n');
  assert.match(context, /controlled workload/u);
  assert.doesNotMatch(context, /web\.example\.org/u);
  const section = { ...followUp, projectId: 'project', messages: [...followUp.messages, { ...createUserMessage('New section'), contextReset: true as const }] };
  assert(!buildProjectChatContext(workspace, section, '').some(message => message.content.includes('controlled workload')));
});

test('standalone chats restored with old attachments include only files selected for the question', () => {
  const first = createUserMessage('Discuss the selected document.');
  const firstFile: DocumentAttachment = {
    id: 'legacy-one', name: 'legacy first.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 25, createdAt: 1,
    pages: [{ pageNumber: 1, text: 'ONLY WHEN SELECTED', messageId: 'legacy-page-one', versionId: 'legacy-version-one' }],
  };
  const secondFile: DocumentAttachment = {
    ...firstFile, id: 'legacy-two', name: 'legacy second.pdf',
    pages: [{ pageNumber: 1, text: 'UNSELECTED FILE', messageId: 'legacy-page-two', versionId: 'legacy-version-two' }],
  };
  const chat = { ...createConversation(), documents: [firstFile, secondFile], messages: [first] };
  const workspace: Workspace = { schemaVersion: 1, activeConversationId: chat.id, conversations: [chat] };
  const prompt = () => buildProjectChatContext(workspace, chat, '').map(message => message.content).join('\n');
  assert.doesNotMatch(prompt(), /ONLY WHEN SELECTED|UNSELECTED FILE/u);
  first.documentReference = { ids: [firstFile.id], mode: 'full' };
  assert.match(prompt(), /ONLY WHEN SELECTED/u);
  assert.doesNotMatch(prompt(), /UNSELECTED FILE/u);
});
