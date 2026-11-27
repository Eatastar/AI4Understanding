import assert from 'node:assert/strict';
import test from 'node:test';
import { inquiryIntroduction, inquiryReplyText, parseBriefing, planResearchQueries, researchInquiry } from '../src/adapters/inquiry';
import { appendInquirySearch, INQUIRY_SOURCE_LIMIT, inquirySources, mergeResearch, newResearchSources, readResearchSource, type InquirySource, type ResearchSource } from '../src/domain/inquiry';
import { projectKnowledge, type KnowledgeCard } from '../src/domain/knowledge';
import { buildProjectChatContext, createProject } from '../src/domain/projects';
import type { Conversation, DocumentAttachment, ModelSettings, Workspace } from '../src/domain/types';
import { createAssistantMessage, createConversation, createUserMessage, deleteChatTurn, mergeImportedWorkspace, validateImport } from '../src/domain/workspace';
import { unpackWorkspace, WorkspaceCodec } from '../src/domain/workspace-codec';
import { isEnglishResearchQuery, needsCurrentProofSources, PAPER_RESEARCH_MS } from '../shared/research.mjs';

const source: ResearchSource = {
  id: 'sample-source', title: 'Synthetic source', provider: 'arXiv', evidence: 'abstract', excerpt: 'A little paper on the question.',
  webUrl: 'https://arxiv.org/abs/2601.01234', pdfUrl: 'https://arxiv.org/pdf/2601.01234',
};
const document: DocumentAttachment = {
  id: 'test-file', name: 'synthetic.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 74, createdAt: 1,
  pages: [{ pageNumber: 1, text: 'CURRENT REFERENCE', messageId: 'file-page', versionId: 'file-version' }],
};

function topic() {
  const project: Conversation = { ...createProject('Synthetic topic'), documents: [document] };
  const first = createUserMessage('OLD SECTION');
  const reset = { ...createUserMessage('NEW SECTION'), contextReset: true as const, sectionTitle: 'New direction' };
  const latest = { ...createUserMessage('LATEST QUESTION'), documentReference: { ids: [document.id], mode: 'full' as const } };
  const chat: Conversation = { ...createConversation('Research chat'), projectId: project.id, messages: [first, reset, latest] };
  const other = { ...createConversation('Other chat'), projectId: project.id, messages: [createUserMessage('OTHER CHAT')] };
  const workspace: Workspace = { schemaVersion: 1, activeConversationId: chat.id, conversations: [project, chat, other] };
  return { workspace, project, chat, first, reset, latest };
}

test('section boundaries leave prior messages visible and out of the model request', () => {
  const { workspace, chat, reset } = topic();
  const prompt = () => buildProjectChatContext(workspace, chat, 'Test instructions').map(message => message.content).join('\n');
  assert.match(prompt(), /NEW SECTION/);
  assert.match(prompt(), /CURRENT REFERENCE/);
  assert.match(prompt(), /LATEST QUESTION/);
  assert.doesNotMatch(prompt(), /OLD SECTION|OTHER CHAT|New direction/);
  assert.equal(chat.messages[0].versions[0].content, 'OLD SECTION');
  delete (reset as Conversation['messages'][number]).contextReset;
  delete (reset as Conversation['messages'][number]).sectionTitle;
  assert.match(prompt(), /OLD SECTION/);
  assert.doesNotMatch(prompt(), /OTHER CHAT/);
});

test('deleting the first turn of a section preserves the boundary for surviving questions', () => {
  const { workspace, chat, reset, latest } = topic();
  const after = deleteChatTurn(workspace, chat.id, reset.id);
  const saved = validateImport(after).conversations.find(item => item.id === chat.id)!;
  assert.equal(saved.messages[1].id, latest.id);
  assert.equal(saved.messages[1].contextReset, true);
  assert.equal(saved.messages[1].sectionTitle, 'New direction');
  assert.doesNotMatch(buildProjectChatContext(after, saved, '').map(message => message.content).join('\n'), /OLD SECTION/);
  assert.equal(deleteChatTurn(after, saved.id, latest.id).conversations.find(item => item.id === chat.id)?.pendingSection, 'New direction');
});

test('topic metadata, pending section and source links survive storage and backup import', () => {
  const { workspace, project, chat } = topic();
  project.inquiry = { question: 'What is the synthetic topic?', overview: { text: 'Evidence from the abstract.', sourceIds: [source.id] },
    sources: [{ ...source, documentId: document.id, note: 'Check the introduction.' }], documentNotes: { [document.id]: 'An old reading note.' },
  };
  chat.pendingSection = '';
  chat.customTitle = true;
  chat.messages[2].researchSourceIds = [source.id];
  const { header, rows } = new WorkspaceCodec().pack(workspace);
  const saved = validateImport(unpackWorkspace({ ...header, records: rows }));
  assert.deepEqual(saved, workspace);
  assert.equal(rows.filter(row => row.kind === 'document').length, 1);
  const imported = mergeImportedWorkspace(workspace, saved);
  const importedChat = imported.conversations.find(item => item.id === imported.activeConversationId)!;
  const importedProject = imported.conversations.find(item => item.id === importedChat.projectId)!;
  const importedDocumentId = importedProject.documents?.[0].id;
  assert(importedDocumentId && importedDocumentId !== document.id);
  assert.equal(importedProject.inquiry?.sources?.[0].documentId, importedDocumentId);
  assert.equal(importedProject.inquiry?.documentNotes?.[importedDocumentId], 'An old reading note.');
  assert.equal(importedChat.pendingSection, '');
  assert.equal(importedChat.messages[1].contextReset, true);
  assert.deepEqual(importedChat.messages[2].researchSourceIds, [source.id]);
});

test('selected online extracts are available to one question without storing a copy in the chat', () => {
  const { workspace, project, chat, latest } = topic();
  const other = { ...source, id: 'other-source', excerpt: 'DO NOT INCLUDE THIS SOURCE' };
  project.inquiry = { sources: [source, other] };
  latest.researchSourceIds = [source.id];
  const prompt = () => buildProjectChatContext(workspace, chat, '').map(message => message.content).join('\n');
  assert.match(prompt(), /A little paper on the question/);
  assert.doesNotMatch(prompt(), /DO NOT INCLUDE THIS SOURCE/);
  assert.doesNotMatch(JSON.stringify(chat), /A little paper on the question/);
  chat.messages.push(createUserMessage('Next question'));
  assert.doesNotMatch(prompt(), /A little paper on the question/);
});

test('refreshing results retains linked documents, user notes, and source identities', () => {
  const earlier = { ...source, documentId: document.id, note: 'My note' };
  const inquiry = mergeResearch({ sources: [earlier], overview: { text: 'First overview', sourceIds: [source.id] } }, [{ ...source, category: 'Introduction' }]);
  assert.equal(inquiry.sources?.length, 1);
  assert.equal(inquiry.sources?.[0].documentId, document.id);
  assert.equal(inquiry.sources?.[0].note, 'My note');
  assert.equal(inquiry.sources?.[0].category, 'Introduction');
  assert.equal(inquiry.overview?.text, 'First overview');
});

test('malformed source rows preserve real candidates and unsafe overview citations suppress only the overview', () => {
  const detail = { id: source.id, category: 'Overview', difficulty: 'introduction', coverage: 'Explains the central question.', pdfUrl: 'https://foreign.example/modified.pdf' };
  const output = { overview: 'A short synopsis.', overviewSourceIds: [source.id], sources: [detail] };
  assert.equal(parseBriefing(JSON.stringify(output), [source]).sources[0].pdfUrl, source.pdfUrl);
  const metadata = { ...source, id: 'title-only', evidence: 'metadata' as const, excerpt: 'Untrusted text', coverage: 'Unsupported claim' };
  const other = { ...source, id: 'other' };
  const partial = parseBriefing(JSON.stringify({
    ...output, overviewSourceIds: [source.id, metadata.id], sources: [null, detail, { ...detail, id: 'made-up' }, { ...detail, coverage: 'Duplicate' }],
  }), [metadata, source, other]);
  assert.equal(partial.overview, undefined);
  assert.deepEqual(partial.sources.map(item => item.id), [metadata.id, source.id, other.id]);
  assert.equal(partial.sources[0].coverage, undefined);
  assert.equal(partial.sources[1].coverage, detail.coverage);
  assert.deepEqual(partial.sources[2], other);
  assert.equal(parseBriefing(JSON.stringify({ ...output, overviewSourceIds: ['made-up'] }), [source]).overview, undefined);
  assert.throws(() => parseBriefing('Plain model text', [source]));
  assert.throws(() => readResearchSource({ ...source, pdfUrl: 'file:///private' }));
});

test('a Chinese request preserves the named work and plans separate English academic and commentary queries', () => {
  const question = '帮我找 levent 关于黎曼猜想证明的资料';
  const generic = JSON.stringify({
    intent: 'broad_topic', primary: 'Riemann hypothesis proof', topic: 'Riemann hypothesis', commentary: '证明路线图',
    context: 'Riemann hypothesis survey',
  });
  const plan = planResearchQueries(question, undefined, 'project', generic);
  assert.equal(plan.target, 'levent');
  assert.equal(plan.intent, 'specific_work_or_claim');
  assert.equal(plan.queries[0], 'levent Riemann hypothesis proof');
  assert.equal(plan.queries[1], 'Riemann hypothesis survey');
  assert.match(plan.commentaryQuery ?? '', /levent.*proof outline.*MathOverflow/u);
  assert([...plan.queries, plan.commentaryQuery].every(isEnglishResearchQuery));
  assert.deepEqual(planResearchQueries(question, undefined, 'project').queries, ['levent Riemann hypothesis proof']);
  const qualified = planResearchQueries(question, '查“Levent Alpöge”的原始公告', 'papers', JSON.stringify({
    primary: 'Levent Alpoge Riemann hypothesis Lean announcement', target: 'different author',
  }));
  assert.equal(qualified.target, 'Levent Alpöge');
  assert.equal(qualified.queries[0], 'Levent Alpoge Riemann hypothesis Lean announcement');
  assert.equal(qualified.commentaryQuery, undefined);
  const translated = planResearchQueries('阿尔珀格关于黎曼猜想的证明', undefined, 'project', JSON.stringify({
    target: '阿尔珀格', searchTarget: 'Alpoge', primary: '阿尔珀格 原始发布', commentary: 'Riemann hypothesis proof outline',
  }));
  assert.equal(translated.target, '阿尔珀格');
  assert.equal(translated.searchTarget, 'Alpoge');
  assert(translated.queries.every(isEnglishResearchQuery));
  const general = planResearchQueries('黎曼猜想有哪些证明方向', undefined, 'project', generic);
  assert.equal(general.target, undefined);
  assert.equal(general.intent, 'broad_topic');
  assert.deepEqual(planResearchQueries('Exact title', undefined, 'project', '```json\n{"primary":"Exact title","context":"topic terms"}\n```').queries,
    ['Exact title', 'topic terms']);
});

test('new search briefs can omit clearly off-topic records without removing saved or metadata-only records', () => {
  const offTopic = { ...source, id: 'other-work', excerpt: 'The paper addresses an entirely different problem.' };
  const metadata = { ...source, id: 'metadata', evidence: 'metadata' as const, excerpt: undefined };
  const output = JSON.stringify({
    overview: 'Wrong topic.', overviewSourceIds: [offTopic.id],
    sources: [{ id: offTopic.id, unrelated: true }, { id: metadata.id, unrelated: true }, { id: 'made-up', unrelated: true }],
  });
  const candidates = [source, offTopic, metadata];
  assert.deepEqual(parseBriefing(output, candidates).sources, candidates);
  assert.deepEqual(parseBriefing(output, candidates, 8, 'search'), { sources: [source, metadata] });
  const empty = { sources: [], issues: [], targetMiss: { target: 'Levent Alpöge', academicOnly: true } };
  assert.match(inquiryIntroduction(empty, 'zh-CN'), /未找到与「Levent Alpöge」直接相关.*仅检索了学术索引/u);
  assert.match(inquiryIntroduction(empty, 'en'), /no direct matches.*academic indexes only/u);
});

test('conjecture proof status uses current evidence while a deliberately historical search stays general', () => {
  assert.equal(needsCurrentProofSources('黎曼猜想证明'), true);
  assert.equal(needsCurrentProofSources('我想了解黎曼猜想', 'Levent 的证明'), true);
  assert.equal(needsCurrentProofSources('Has the Riemann hypothesis been solved?'), true);
  assert.equal(needsCurrentProofSources('黎曼猜想证明', '看经典历史尝试'), false);
  assert.equal(needsCurrentProofSources('贝叶斯假设检验教程'), false);
});

test('the proof query keeps primary, commentary and background as distinct search terms', () => {
  const plan = planResearchQueries('我想了解一下黎曼猜想的证明，你帮我检索资料', undefined, 'project', JSON.stringify({
    topic: 'Riemann hypothesis', primary: 'Riemann hypothesis latest official proof release',
    commentary: 'Levent Alpoge Lean mathematical roadmap', context: 'Riemann hypothesis lecture notes', target: null,
  }));
  assert.equal(plan.queries[0], 'Riemann hypothesis latest official proof release');
  assert.equal(plan.queries[1], 'Riemann hypothesis lecture notes');
  assert.match(plan.commentaryQuery ?? '', /^Levent Alpoge Lean mathematical roadmap.*proof outline/u);
  assert.equal(plan.target, undefined);
});

test('a previous verified release focuses the commentary query without narrowing current discovery', () => {
  const release = { ...source, title: 'A remark', excerpt: 'Ada Núñez announced the original Lean proof of a conjecture.' };
  const check = { ...source, id: 'check', title: 'Verification', excerpt: 'We independently rebuilt Núñez’s project and checked the statements.' };
  const plan = planResearchQueries('我想了解一下黎曼猜想的证明，你帮我检索一下资料', undefined, 'project',
    JSON.stringify({ primary: 'Riemann hypothesis recent proof', commentary: 'outline of the proof', commentaryWork: 'Different Person' }), [release, check]);
  assert.equal(plan.commentaryTarget, 'Ada Núñez');
  assert.match(plan.commentaryQuery ?? '', /Ada Núñez.*outline/u);
  assert.equal(plan.target, undefined);
  assert.doesNotMatch(plan.queries[0], /Núñez/u);
});

test('proof results require a check of the same release from another publisher and suppress uncorroborated claims', () => {
  const release: ResearchSource = {
    ...source, id: 'release', webUrl: 'https://author.example.org/remarks', pdfUrl: undefined, title: 'Source release',
    authors: 'Ada Núñez', excerpt: 'Ada Núñez announced the named release and source archive.',
  };
  const quote = 'We compared the statement of Ada Núñez’s release and independently compiled the exported proof.';
  const verifier: ResearchSource = {
    ...source, id: 'check', webUrl: 'https://university.example.edu/check', pdfUrl: undefined, title: 'Technical check',
    excerpt: quote, evidence: 'snippet',
  };
  const unsupported = {
    ...release, id: 'self-claim', authors: 'Different Person', webUrl: 'https://other.example.net/proof',
    doi: '10.0000/self-claim', citationCount: 800, excerpt: 'My proof follows from elementary algebra.',
  };
  const pair = { releaseId: release.id, checkId: verifier.id, work: 'Ada Nunez', quote };
  const response = (proofChecks: unknown[]) => JSON.stringify({
    overview: 'The posted release has an independent technical check.', overviewSourceIds: [verifier.id],
    sources: [{ id: release.id }, { id: verifier.id }, { id: unsupported.id, readingBucket: 'deep_dive' }], proofChecks,
  });
  const candidates = [unsupported, release, verifier];
  const result = parseBriefing(response([pair]), candidates, 8, 'proof');
  assert.deepEqual(result.sources, [release, verifier]);
  assert.deepEqual(result.overview?.sourceIds, [verifier.id]);
  assert.deepEqual(newResearchSources([release], [unsupported], 8, false), [release]);
  for (const invalid of [
    { ...pair, releaseId: unsupported.id },
    { ...pair, work: 'Riemann Hypothesis' },
    { ...pair, quote: 'A proof checker has accepted an invented test.' },
    { ...pair, checkId: release.id },
  ]) assert.deepEqual(parseBriefing(response([invalid]), candidates, 8, 'proof'), { sources: [] });
  assert.deepEqual(parseBriefing(response([pair]), [release, { ...verifier, webUrl: 'https://www.author.example.org/check' }], 8, 'proof'), { sources: [] });
  assert.deepEqual(parseBriefing(response([pair]), [release, { ...verifier, evidence: 'metadata' }], 8, 'proof'), { sources: [] });
  const citedRelease = { ...release, evidence: 'web-summary' as const };
  for (const excerpt of [
    'The verification team reports successfully building Ada Núñez’s release and checking that its theorems depend only on standard axioms.',
    'Our default and strict kernels both accepted the full formal proof released by Ada Núñez.',
    'Two independent tools confirmed that the theorem proved by Ada Núñez exactly matches the standard conjecture statement.',
  ]) {
    const checkSource = { ...verifier, excerpt, evidence: 'web-summary' as const };
    assert.deepEqual(parseBriefing(response([{ ...pair, quote: excerpt }]), [citedRelease, checkSource], 8, 'proof').sources, [citedRelease, checkSource]);
  }
  for (const excerpt of [
    'We plan to build Ada Núñez’s release.',
    'Our team failed to rebuild Ada Núñez’s release.',
    'The theorem proved by Ada Núñez did not match the challenge statement.',
  ]) {
    assert.deepEqual(parseBriefing(response([{ ...pair, quote: excerpt }]), [release, { ...verifier, excerpt }], 8, 'proof').sources, []);
  }
});

test('a failed web source makes proof verification incomplete and can be retried alone using the same terms', async t => {
  const queries: { scope: string; queries: string[]; currentProof: boolean; webOnly?: boolean; commentaryQuery?: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/api/inquiry/search');
    queries.push(JSON.parse(options.body as string));
    return Response.json({ sources: [], issues: queries.length === 1
      ? [{ provider: 'Semantic Scholar', issue: 'limited' }, { provider: 'Model web search', issue: 'timeout' }] : [] });
  });
  const settings: ModelSettings = {
    mode: 'demo', baseURL: 'https://api.example.org/v1', model: '', systemPrompt: '', hasApiKey: false,
    apiFormat: 'openai-chat', profiles: [], activeProfileId: null, persistence: 'session',
  };
  const options = { question: '黎曼猜想证明', settings, locale: 'zh-CN' as const, signal: new AbortController().signal, onStep() {} };
  const result = await researchInquiry(options, 'project');
  assert.match(inquiryIntroduction(result, 'zh-CN'), /网页检索未完成/u);
  assert.equal(result.retryWeb?.plan.queries[0], 'Riemann hypothesis proof');
  const retried = await researchInquiry(options, 'project', [], 8, result.retryWeb);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1], { ...queries[0], webOnly: true });
  assert.match(queries[0].commentaryQuery ?? '', /proof sketch/u);
  assert.equal(retried.retryWeb, undefined);
  assert.match(inquiryIntroduction(retried, 'zh-CN'), /未取得可以相互核对/u);
});

test('earlier automatically retrieved proof claims are hidden in the proof view and preserved in project storage', () => {
  const { workspace, project } = topic();
  const previous = { ...source, id: 'earlier-claim', note: 'My earlier reading note' };
  project.inquiry = { question: '黎曼猜想证明', sources: [previous, source] };
  assert.deepEqual(inquirySources(project.inquiry), []);
  assert.deepEqual(inquirySources(project.inquiry, true), [previous, source]);
  project.inquiry.proofSourceIds = [source.id];
  const { header, rows } = new WorkspaceCodec().pack(workspace);
  const restored = validateImport(unpackWorkspace({ ...header, records: rows })).conversations.find(item => item.id === project.id);
  assert.deepEqual(inquirySources(restored?.inquiry), [source]);
  assert.deepEqual(inquirySources(restored?.inquiry, true), [previous, source]);
});

test('supplementary proof search leaves duplicates in place and appends new checks and reading guides to the existing map', () => {
  const { workspace, project } = topic();
  const { pdfUrl: _pdfUrl, ...webSource } = source;
  const release: InquirySource = { ...source, note: 'Keep this note', readingStatus: 'to_read' };
  const check = { ...webSource, id: 'check', webUrl: 'https://checks.example.org/first' };
  const older = { ...webSource, id: 'older', webUrl: 'https://archive.example.org/claim' };
  const inquiry = { question: '黎曼猜想证明', sources: [release, check, older], proofSourceIds: [release.id, check.id],
    overview: { text: 'My original overview', sourceIds: [release.id] } };
  const duplicate = { ...release, id: 'another-provider-id', title: 'Provider changed the title', note: 'Changed note' };
  const repeated = appendInquirySearch(inquiry, [duplicate, check], { text: 'A replacement overview', sourceIds: [duplicate.id] }, true);
  assert.equal(repeated.inquiry, inquiry);
  assert.equal(repeated.added, 0);
  assert.deepEqual(repeated.sourceIds, [release.id, check.id]);

  const newCheck = { ...check, id: 'other-check', webUrl: 'https://second.example.org/record' };
  const guide: InquirySource = {
    ...webSource, id: 'guide', title: 'Synthetic proof outline', webUrl: 'https://guide.example.org/outline',
    proofMaterial: 'guide', readingBucket: 'overview',
  };
  const added = appendInquirySearch(inquiry, [duplicate, newCheck, guide], undefined, true);
  assert.equal(added.added, 2);
  assert.deepEqual(added.inquiry.sources, [release, check, older, newCheck, guide]);
  assert.deepEqual(added.inquiry.proofSourceIds, [release.id, check.id, newCheck.id]);
  assert.equal(added.inquiry.overview, inquiry.overview);
  assert.deepEqual(inquirySources(added.inquiry), [release, check, newCheck, guide]);
  const restoredCheck = appendInquirySearch({ ...inquiry, sources: [older, release, check] }, [release, older, guide], undefined, true);
  assert.equal(restoredCheck.added, 1);
  assert.deepEqual(inquirySources(restoredCheck.inquiry), [release, check, older, guide]);

  const background = { ...webSource, id: 'background', title: 'A historical reference', webUrl: 'https://history.example.org/record' };
  project.inquiry = appendInquirySearch(added.inquiry, [background]).inquiry;
  const { header, rows } = new WorkspaceCodec().pack(workspace);
  const restored = validateImport(unpackWorkspace({ ...header, records: rows })).conversations.find(item => item.id === project.id);
  assert.deepEqual(inquirySources(restored?.inquiry), [release, check, newCheck, guide, { ...background, proofMaterial: 'related' }]);
  assert.deepEqual(restored?.inquiry?.proofSourceIds, added.inquiry.proofSourceIds);
});

test('supplementary search keeps existing cards when the project source map is full', () => {
  const { pdfUrl: _pdfUrl, ...webSource } = source;
  const inquiry = { sources: Array.from({ length: INQUIRY_SOURCE_LIMIT }, (_, index) => ({
    ...webSource, id: 'old-' + index, title: 'Old source ' + index, webUrl: 'https://papers.example.org/' + index,
  })) };
  assert.equal(appendInquirySearch(inquiry, [source]).inquiry, inquiry);
});

test('multiple reading guides can be added without waiting for a corroborating release', async t => {
  const { pdfUrl: _pdfUrl, ...webSource } = source;
  const release: ResearchSource = {
    ...webSource, id: 'release', title: 'Ada Núñez’s release', webUrl: 'https://author.example.org/remarks',
    excerpt: 'Ada Núñez announced the proof and posted its Lean archive.',
  };
  const roadmap: ResearchSource = {
    ...release, id: 'roadmap', title: 'A roadmap to Ada Núñez’s proof', webUrl: 'https://guide.example.org/roadmap',
    excerpt: 'This reading guide describes the descent argument in the Lean proof by Ada Núñez.',
  };
  const sketch = {
    ...roadmap, id: 'sketch', webUrl: 'https://second.example.org/sketch', title: 'A proof sketch for the work by Ada Núñez',
  };
  const earlierGuide = { ...roadmap, id: 'earlier-guide', webUrl: 'https://guide.example.org/earlier', title: 'Earlier reading guide' };
  const signal = new AbortController().signal;
  const steps: string[] = [];
  const settings: ModelSettings = {
    mode: 'api', baseURL: 'https://api.example.org/v1', model: 'fixture', systemPrompt: '', hasApiKey: true,
    apiFormat: 'openai-chat', profiles: [], activeProfileId: null, persistence: 'session',
  };
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(options.signal, signal);
    const body = JSON.parse(options.body as string);
    if (path === '/api/inquiry/search') {
      steps.push('search');
      assert.equal(body.scope, 'project');
      assert.match(body.commentaryQuery, /Ada Nunez.*proof outline/u);
      return Response.json({
        issues: [],
        sources: [release, { ...earlierGuide, webUrl: earlierGuide.webUrl + '?utm_source=fixture' }, roadmap, sketch],
        assessments: {
          release: { track: 'primary', credibilityFlag: 'unverified_extraordinary_claim' },
          'earlier-guide': { track: 'commentary' }, roadmap: { track: 'commentary' }, sketch: { track: 'commentary' },
        },
      });
    }
    assert.equal(path, '/api/inquiry/compose');
    const input = JSON.parse(body.messages[1].content);
    steps.push(input.candidates ? 'compose' : 'plan');
    if (input.candidates) assert.deepEqual(input.candidates.map((item: ResearchSource) => item.id), [release.id, roadmap.id, sketch.id]);
    const answer = input.candidates
      ? { sources: [release, roadmap, sketch].map(item => ({ id: item.id, readingBucket: 'deep_dive' })), proofChecks: [] }
      : { primary: 'Synthetic conjecture proof release', commentary: 'Ada Nunez roadmap' };
    const delta = { type: 'delta', text: JSON.stringify(answer) };
    return new Response('data: ' + JSON.stringify(delta) + '\n\ndata: {"type":"done","modelLabel":"fixture"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  const result = await researchInquiry({ question: 'What is the latest proof of this conjecture?', settings, locale: 'en', signal, onStep() {} },
    'project', [earlierGuide]);
  assert.deepEqual(steps, ['plan', 'search', 'compose']);
  assert.deepEqual(result.sources.map(card => [card.id, card.proofMaterial, card.readingBucket]), [
    ['release', 'related', 'brief'], ['roadmap', 'guide', 'overview'], ['sketch', 'guide', 'overview'],
  ]);
  assert.match(result.sources[0].decisionSummary?.caveat ?? '', /independent verification.*unconfirmed/u);
  assert(!('credibilityFlag' in result.sources[0]));
});

test('lightweight chat papers enforce their own deadline without starting project search tracks', async t => {
  const userSignal = new AbortController().signal;
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, PAPER_RESEARCH_MS);
    return deadline.signal;
  });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    requests++;
    assert.equal(path, '/api/inquiry/search');
    assert.notEqual(options.signal, userSignal);
    const body = JSON.parse(options.body as string);
    assert.equal(body.scope, 'papers');
    assert(body.queries.length <= 2);
    assert.equal(body.commentaryQuery, undefined);
    deadline.abort(new DOMException('Light search deadline', 'TimeoutError'));
    options.signal?.throwIfAborted();
  });
  const settings: ModelSettings = {
    mode: 'demo', baseURL: 'https://api.example.org/v1', model: '', systemPrompt: '', hasApiKey: false,
    apiFormat: 'openai-chat', profiles: [], activeProfileId: null, persistence: 'session',
  };
  const result = await researchInquiry({ question: '黎曼猜想证明', settings, locale: 'en', signal: userSignal, onStep() {} }, 'papers');
  assert.equal(requests, 1);
  assert.equal(userSignal.aborted, false);
  assert.match(inquiryIntroduction(result, 'en'), /time limit/u);
});

test('query planning, search and evidence summaries share the same cancellation signal', async t => {
  const signal = new AbortController().signal;
  const paths: string[] = [];
  const metadata: ResearchSource = { id: 'metadata-only', title: 'Title only', provider: 'Crossref', evidence: 'metadata', webUrl: 'https://example.org/metadata' };
  const replies = [
    { queries: ['Synthetic index overview'], target: null },
    { overview: 'A synthetic overview.', overviewSourceIds: [source.id], sources: [{ id: source.id, readingBucket: 'overview' }] },
  ];
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    paths.push(path);
    assert.equal(options.signal, signal);
    if (path === '/api/inquiry/search') return Response.json({ sources: [source, metadata], issues: [] });
    assert.equal(path, '/api/inquiry/compose');
    const { messages } = JSON.parse(options.body as string);
    const input = JSON.parse(messages[1].content);
    if (input.candidates) {
      assert.match(messages[0].content, /Never infer methods, depth or limitations from bibliographic details alone/);
      assert.match(messages[0].content, /Use only the supplied abstracts, excerpts and cited web summaries/);
      assert.deepEqual(input.candidates.map((candidate: ResearchSource) => candidate.id), [source.id]);
    }
    const delta = { type: 'delta', text: JSON.stringify(replies.shift()) };
    return new Response('data: ' + JSON.stringify(delta) + '\n\ndata: {"type":"done","modelLabel":"fixture"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  const settings: ModelSettings = {
    mode: 'api', baseURL: 'https://api.example.org/v1', model: 'fixture', systemPrompt: '', hasApiKey: true,
    apiFormat: 'openai-chat', profiles: [], activeProfileId: null, persistence: 'session',
  };
  const result = await researchInquiry({ question: 'How do indexes work?', settings, locale: 'en', signal, onStep() {} }, 'project');
  assert.deepEqual(paths, ['/api/inquiry/compose', '/api/inquiry/search', '/api/inquiry/compose']);
  assert.equal(result.modelLabel, 'fixture');
  assert.equal(result.overview?.text, 'A synthetic overview.');
  const keptMetadata = result.sources.find(card => card.id === metadata.id);
  assert.ok(keptMetadata);
  assert.equal(keptMetadata.decisionSummary, undefined);
});

test('the opening chat reply uses the model’s overview and each supported source summary, with links from the source map', () => {
  const metadata: ResearchSource = { id: 'metadata', title: 'Title only', provider: 'Crossref', evidence: 'metadata', webUrl: 'https://example.org/metadata' };
  const briefing = parseBriefing(JSON.stringify({
    overview: 'This question is best approached by comparing the two introductory approaches.',
    overviewSourceIds: [source.id],
    sources: [
      { id: source.id, category: 'Introduction', difficulty: 'introduction', coverage: 'Compares two ways to frame the question.' },
      { id: metadata.id, category: 'Related work', difficulty: 'intermediate', coverage: 'Unsupported model claim.' },
    ],
    startWith: { id: source.id, reason: 'It defines the two approaches.' },
  }), [source, metadata]);
  const answer = inquiryReplyText({ ...briefing, issues: [], modelLabel: 'Synthetic model' }, 'en');
  assert.match(answer, /^This question is best approached/u);
  assert.match(answer, /Compares two ways to frame the question/u);
  assert.match(answer, /Title only.*Only bibliographic details/u);
  assert.doesNotMatch(answer, /It defines the two approaches/u);
  assert(answer.includes(source.webUrl) && answer.includes(metadata.webUrl));
  assert.doesNotMatch(answer, /Unsupported model claim/u);
  const fallback = inquiryReplyText({ sources: [source], issues: [], briefingUnavailable: true }, 'en');
  assert.match(fallback, /AI guide could not be generated/u);
  assert(fallback.includes(source.excerpt!));
});

test('an opening question and its guide round-trip as chat messages and inform the next turn', () => {
  const { workspace, project, chat } = topic();
  project.inquiry = { question: 'How do I start?', sources: [source] };
  const question = { ...createUserMessage(project.inquiry.question!), researchSourceIds: [source.id] };
  const intro = { ...createAssistantMessage('Start with the introductory survey.', 'complete'), inquiryIntro: true as const };
  chat.messages = [question, intro];
  const { header, rows } = new WorkspaceCodec().pack(workspace);
  const saved = validateImport(unpackWorkspace({ ...header, records: rows }));
  const reopened = saved.conversations.find(item => item.id === chat.id)!;
  assert.deepEqual(reopened.messages, chat.messages);
  const reply = createUserMessage('What should I read after that?');
  const context = buildProjectChatContext(saved, { ...reopened, messages: [...reopened.messages, reply] }, '');
  assert.deepEqual(context.map(message => message.content), [
    'How do I start?', 'Start with the introductory survey.', 'What should I read after that?',
  ]);
});

test('old knowledge cards appear in their topic and explicit removal stays effective', () => {
  const { workspace, project, chat } = topic();
  const card = { title: 'An insight', content: 'A synthetic result.', id: 'card', tags: [], origin: { type: 'qa', chatId: chat.id }, createdAt: 1, updatedAt: 4 } satisfies KnowledgeCard;
  const cards = [card, { ...card, id: 'detached', projectId: null }, { ...card, id: 'explicit', projectId: project.id, origin: { type: 'synthesis' as const } }];
  assert.deepEqual(projectKnowledge(cards, project, workspace.conversations).map(item => item.id), ['card', 'explicit']);
});
