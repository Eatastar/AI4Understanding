import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/core';
import { legacyReaderReferences } from '../src/knowledge/legacy-reader-adapter';
import { citedReferences, sourceCitation, wikiHeadings, wikiText } from '../src/knowledge/wiki-document';
import { previewWikiFormula } from '../src/knowledge/wiki-formula';
import { wikiMarkdownContent } from '../src/knowledge/wiki-markdown';
import { clampReferenceFrame, referenceFraction, referenceFrame } from '../src/knowledge/reference-preferences';
import type { WikiDraft, WikiRepository } from '../src/knowledge/wiki-types';
import type { Annotation, Conversation, Workspace } from '../src/domain/types';

const { createWikiStore } = createRequire(import.meta.url)('../desktop/wiki-store.cjs') as {
  createWikiStore(options: { directory: string; io?: typeof fs; now?: () => number }): WikiRepository;
};
const paragraph = (value: string, id = 'first'): JSONContent => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text: value }] });
const document = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const draft = (title: string, body: JSONContent, note = ''): WikiDraft => ({ title, domains: ['Analysis', 'Methods'], body, ...(note ? { personalUnderstanding: note } : {}) });

test('the wiki checks invalid sum limits and previews corrected zeta formulas in both math modes', () => {
  const invalid = previewWikiFormula('\\zeta(s)=\\sum_{n=1}^\\inf \\frac{1}{n^s}', true);
  assert.ok('error' in invalid);
  assert.equal(invalid.infinityHint, true);
  assert.match(invalid.error, /as superscript/);

  const zeta = '\\zeta(s)=\\sum_{n=1}^{\\infty}\\frac{1}{n^s},\\quad \\operatorname{Re}(s)>1';
  for (const displayMode of [false, true]) {
    const formula = previewWikiFormula(zeta, displayMode);
    assert.ok('html' in formula);
    assert.match(formula.html, /∞/u);
    assert.equal(formula.html.includes('class="katex-display"'), displayMode);
  }
  const infimum = previewWikiFormula('\\inf_{x\\in A} f(x)', false);
  assert.ok('html' in infimum, 'A legitimate infimum should render as written.');
});

test('pasted Markdown becomes editable wiki blocks with both kinds of TeX delimiters', () => {
  const source = [
    '## 黎曼 ζ 函数', String.raw`行内 **定义** $s$ 和 \(\operatorname{Re}(s)\)。`, '',
    String.raw`$$\zeta(s)=\sum_{n=1}^{\infty}\frac{1}{n^s}$$`, '',
    '1. 开始', '   \\[', '   \\frac{1}{n^s}', '   \\]', '2. 继续', '',
    String.raw`$$\begin{aligned}`, String.raw`a&=b\\`, String.raw`\end{aligned}$$`, '',
    '> 上式取 $s=2$。', '', '| 条件 | 数值 |', '| --- | --- |', '| 收敛 | $2$ |',
  ].join('\n');
  const body = wikiMarkdownContent(source);
  assert.deepEqual(body?.content?.map(block => block.type), [
    'heading', 'paragraph', 'blockMath', 'orderedList', 'blockMath', 'blockquote', 'paragraph', 'paragraph',
  ]);
  const [, prose, zeta, list, aligned, quote, , tableRow] = body!.content!;
  assert.deepEqual(prose.content?.filter(node => node.type === 'inlineMath').map(node => node.attrs?.latex), ['s', '\\operatorname{Re}(s)']);
  assert.ok(prose.content?.some(node => node.text === '定义' && node.marks?.[0].type === 'bold'));
  assert.ok('html' in previewWikiFormula(zeta.attrs?.latex, true));
  assert.equal(list.content?.[0].content?.[1].attrs?.latex, '\\frac{1}{n^s}');
  assert.equal(list.content?.[1].content?.[0].content?.[0].text, '继续');
  assert.equal(aligned.attrs?.latex, '\\begin{aligned}\na&=b\\\\\n\\end{aligned}');
  assert.equal(quote.content?.[0].content?.[1].attrs?.latex, 's=2');
  assert.equal(tableRow.content?.at(-1)?.attrs?.latex, '2');
});

test('pasting math keeps literal code and unfinished formulas and defers ordinary text to normal paste', () => {
  const literalMath = '\\[\\inf_{x\\in A} f(x)\\]';
  const body = wikiMarkdownContent([
    '## 公式示例', '`' + literalMath + '`', '', '- 源码', '  ~~~latex', '  ' + literalMath, '  ~~~',
    '- 渲染 \\(x\\)', '', '$$', 'a = ',
  ].join('\n'));
  const [, prose, list, unfinished] = body!.content!;
  assert.deepEqual(prose.content, [{ type: 'text', text: literalMath, marks: [{ type: 'code' }] }]);
  assert.equal(list.content?.[0].content?.[1].content?.[0].text, literalMath);
  assert.equal(list.content?.[1].content?.[0].content?.at(-1)?.attrs?.latex, 'x');
  assert.equal(unfinished.content?.[0].text, '$$\na = ');
  assert.deepEqual(wikiMarkdownContent('>')?.content?.[0].content, [{ type: 'paragraph', content: [] }]);
  for (const input of ['一般的文本。', '价格 $5 或 $10。', '\\\\(escaped\\\\)', 'unfinished $x']) {
    assert.equal(wikiMarkdownContent(input), undefined, input);
  }
});

test('a separate wiki persists formula and anchor data, derives backlinks and records restorative revisions', async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'ai4u-wiki-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cards = join(directory, 'kb');
  await fs.mkdir(cards);
  const legacy = join(cards, 'cards.json');
  await fs.writeFile(legacy, '[{"synthetic":true}]');
  let time = 1800000000000;
  const wikiDir = join(directory, 'wiki_store');
  const repo = createWikiStore({ directory: wikiDir, now: () => time++ });
  const b = await repo.save({ expectedRevision: 0, draft: draft('Limits', document({
    type: 'heading', attrs: { level: 2, blockId: 'definition' }, content: [{ type: 'text', text: 'Definition' }],
  })) });
  const locator = { documentId: 'sample-pdf', page: 3, quote: 'Exact passage', annotationId: 'note-1' };
  const body = document({ type: 'paragraph', attrs: { blockId: 'proof' }, content: [
    { type: 'text', text: 'Compactness ' },
    { type: 'inlineMath', attrs: { latex: 'f(x)', blockId: 'inline-formula' } },
    { type: 'wikiLink', attrs: { label: 'Limits', pageId: b.page.id, toBlockId: 'definition', relation: 'depends_on', blockId: 'link-1' } },
    { type: 'sourceCite', attrs: { refId: 'passage', label: 'Synthetic · p. 3', sourceId: 'sample-pdf', locator } },
  ] }, { type: 'blockMath', attrs: { latex: '\\sum_n a_n', blockId: 'sum' } });
  const a = await repo.save({ expectedRevision: 0, draft: draft('Compactness', body, 'My note.\n\nSecond paragraph.') });
  const restarted = createWikiStore({ directory: wikiDir, now: () => time++ });
  const indexed = await restarted.list();
  assert.deepEqual(indexed.find(item => item.page.id === a.page.id), a);
  assert.deepEqual(a.page.body, body);
  assert.deepEqual(a.links, [{
    id: a.page.id + ':link-1', fromPageId: a.page.id, fromBlockId: 'proof', toPageId: b.page.id, toBlockId: 'definition',
    relation: 'depends_on', source: 'user', status: 'accepted',
  }]);
  assert.deepEqual(wikiHeadings(b.page.body), [{ id: 'definition', label: 'Definition' }]);
  assert.match(wikiText(a.page.body), /Compactness f\(x\) Limits Synthetic/);
  assert.deepEqual([...citedReferences(a.page.body).sources], ['sample-pdf']);

  const next = await restarted.save({ id: a.page.id, expectedRevision: 1, draft: draft('Updated', document(paragraph('Updated proof.'))) });
  assert.equal(next.page.revision, 2);
  const restored = await restarted.restore({ id: a.page.id, revision: 1, expectedRevision: 2 });
  assert.equal(restored.page.revision, 3);
  assert.deepEqual(restored.links, a.links);
  assert.equal(restored.page.personalUnderstanding, a.page.personalUnderstanding);
  assert.deepEqual((await restarted.history(a.page.id)).map(entry => entry.revision), [3, 2, 1]);
  assert.deepEqual((await restarted.revision({ id: a.page.id, revision: 2 })).body, next.page.body);
  assert.equal(await fs.readFile(legacy, 'utf8'), '[{"synthetic":true}]');
});

test('wiki serializes competing saves and a failed publish leaves the latest revision readable', async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'ai4u-wiki-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let fail = false;
  const io = { ...fs, rename: async (from: string, to: string) => { if (fail) throw new Error('simulated disk error'); await fs.rename(from, to); } } as typeof fs;
  const repo = createWikiStore({ directory, io });
  const created = await repo.save({ expectedRevision: 0, draft: draft('Initial', document(paragraph('Original'))) });
  const request = { id: created.page.id, expectedRevision: 1, draft: draft('Edit', document(paragraph('One editor'))) };
  const [first, second] = await Promise.allSettled([repo.save(request), repo.save(request)]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.match(String(second.status === 'rejected' && second.reason), /已有更新/);
  fail = true;
  await assert.rejects(repo.save({ ...request, expectedRevision: 2 }), /disk error/);
  assert.deepEqual((await repo.history(created.page.id)).map(item => item.revision), [2, 1]);
  assert.equal((await repo.list())[0].page.body.content?.[0].content?.[0].text, 'One editor');
});

test('the reader adapter maps real legacy anchors, notes, AI and web records without mutating them', () => {
  const root: Annotation = {
    id: 'note', conversationId: 'project', messageId: 'page', versionId: 'text',
    quote: 'PDF exact words', anchor: { selectors: [{ start: 0, end: 15, quote: 'PDF exact words' }] },
    color: '#f3cf67', question: 'How?', answer: 'A real saved answer', status: 'answered', edited: false, createdAt: 4, updatedAt: 6,
    subAnnotations: [
      { id: 'note-child', quotedText: 'words', question: '', answer: '', note: 'My personal note.', createdAt: 5, updatedAt: 5 },
      { id: 'qa-child', quotedText: 'answer', question: 'Why?', answer: 'A follow-up answer.', createdAt: 6, updatedAt: 7 },
    ],
  };
  const project: Conversation = {
    id: 'project', title: 'Synthetic project', createdAt: 1, updatedAt: 7, messages: [], annotations: [root], isProject: true,
    documents: [{ id: 'pdf', name: 'Synthetic.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 40, createdAt: 2,
      pages: [{ pageNumber: 1, text: 'PDF exact words in their full context.', messageId: 'page', versionId: 'text' }] }],
    inquiry: { sources: [{ id: 'survey', title: 'Synthetic web source', provider: 'Model web search', evidence: 'snippet', excerpt: 'Full stored web excerpt.', webUrl: 'https://example.org/source' }] },
  };
  const workspace: Workspace = { schemaVersion: 1, activeConversationId: project.id, conversations: [project] };
  const before = JSON.stringify(workspace);
  const items = legacyReaderReferences(workspace, [], []);
  const exact = items.find(item => item.kind === 'pdf_excerpt' && item.locator?.annotationId);
  assert.equal(exact?.content, root.quote);
  assert.deepEqual(exact?.locator, { documentId: 'pdf', conversationId: 'project', page: 1, annotationId: 'note', quote: root.quote });
  assert.equal(sourceCitation(exact!).locator.quote, root.quote);
  assert.equal(items.find(item => item.locator?.subAnnotationId === 'note-child')?.content, 'My personal note.');
  assert.equal(items.find(item => item.kind === 'ai_inquiry')?.content, 'A follow-up answer.');
  assert.equal(items.find(item => item.kind === 'web_summary')?.locator?.url, 'https://example.org/source');
  assert.deepEqual(legacyReaderReferences(workspace, [], []).map(item => item.id), items.map(item => item.id));
  assert.equal(JSON.stringify(workspace), before);
});

test('reference panel geometry stays within resized windows and can be restored from fractions', () => {
  const view = { width: 1200, height: 800 };
  const original = clampReferenceFrame({ left: 740, top: 150, width: 340, height: 420 }, view);
  const stored = referenceFraction(original, view);
  const recovered = referenceFrame(stored, view);
  assert.ok(Math.abs(recovered.left - original.left) < 1 && Math.abs(recovered.width - original.width) < 1);
  for (const size of [{ width: 460, height: 350 }, { width: 210, height: 120 }]) {
    const frame = referenceFrame(stored, size);
    assert.ok(frame.left >= 8 && frame.top >= 8 && frame.left + frame.width <= size.width - 8 && frame.top + frame.height <= size.height - 8);
  }
});
