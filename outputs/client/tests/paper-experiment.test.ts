import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksFromPdf, locateSelection, parseShadow, shadowText, splitWiki, suggestPointers } from '../src/domain/experiment-material';
import { GROUPS, blindBallots, checkCase, gradeComplete, newRound, trialKey, trialMessages, trialQueue } from '../src/domain/paper-experiment';
import type { Category, Connection, ExperimentCase, ExperimentRound } from '../src/domain/paper-experiment';
import type { DocumentAttachment } from '../src/domain/types';
import { loadPaperRounds, runPaperRound, saveRound } from '../src/adapters/paper-experiment';

const blocks = parseShadow('[P01 | Def 1.1] The trace is linear.\n[P04 | Def 2.1] Build the Gram matrix using Definition 1.1.\n[P05 | Eq 2.2] Nearby material.\n[P19 | Lemma 7] By Definition 2.1 the matrix estimates a norm.', 20);
const paper: DocumentAttachment = { id: 'fixture', name: 'Synthetic paper', kind: 'pdf', mimeType: 'application/pdf', createdAt: 1, size: 1000,
  pages: blocks.map((b, i) => ({ pageNumber: b.page, text: b.text, messageId: 'm' + i, versionId: 'v' + i })) };
const connection: Connection = { baseURL: 'http://localhost/v1', apiFormat: 'openai-chat', model: 'fixture', temperature: 0.2 };
const item: ExperimentCase = {
  id: 'question', category: 'C', anchor: blocks[1].anchor, quote: 'Gram matrix', question: 'Why introduce the matrix?',
  pointers: suggestPointers(blocks, blocks[1].anchor, 'Gram matrix'), wiki: [{ id: 'w', title: 'Prior section', text: 'WIKI ONLY', revision: 2 }],
  correction: 'The terms need not be orthogonal.', falsified: 'Drop the cross term.', followUp: 'Try another derivation.', fresh: 'Which condition is sufficient?',
  blindOrder: ['G2', 'G1', 'G3', 'G0'],
};

test('aligned source preserves formulas and distinct coordinates; PDF selections can disambiguate repeated passages', () => {
  assert.deepEqual(parseShadow(shadowText(blocks), 20), blocks);
  assert.throws(() => parseShadow('[P20 | Eq] a\n[P19 | Eq] b', 20), /页码/);
  assert.throws(() => parseShadow('[P01 | Eq] a\n[P01 | Eq] b', 20), /重复/);
  assert.throws(() => parseShadow('[P21 | Eq] a', 20), /页码/);
  const text = 'same line\n\nsame line';
  const pdf = blocksFromPdf([{ pageNumber: 1, text, messageId: 'm', versionId: 'v' }]);
  assert.equal(locateSelection(pdf, { page: 1, quote: 'line' }), undefined);
  assert.equal(locateSelection(pdf, { page: 1, quote: 'line', start: text.lastIndexOf('line') }), pdf[1].anchor);
  assert.deepEqual(item.pointers.filter(p => p.confidence === 'explicit').map(p => p.anchor), [blocks[0].anchor, blocks[3].anchor]);
  assert.throws(() => checkCase({ ...item, selection: { page: 5, quote: item.quote } }, blocks), /同一 PDF 页/);
});

test('only the selected frozen Wiki section is read, preserving inline math and the revision', () => {
  const slices = splitWiki([{ links: [], page: {
    id: 'wiki', title: 'Matrices', domains: [], createdAt: 1, updatedAt: 1, revision: 3, body: { type: 'doc', content: [
      { type: 'heading', attrs: { blockId: 'a' }, content: [{ type: 'text', text: 'Norm' }] },
      { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: '\\|A\\|' } }] },
      { type: 'heading', attrs: { blockId: 'b' }, content: [{ type: 'text', text: 'Other' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Unrelated section' }] },
    ] },
  } }]);
  assert.equal(slices.length, 2);
  assert.deepEqual(slices[0], { id: 'wiki/a', title: 'Matrices / Norm', text: '\\|A\\|', revision: 3 });
});

test('forward ranking favors a named use in a proof, keeps explicit references first and spreads equal uses across pages', () => {
  const shadow = parseShadow([
    '[P01 | Def 3] Definition 3 (phase balance). Define the phase balance condition.',
    '[P01 | ¶1] Phase balance is an interesting subject.',
    '[P01 | ¶2] Phase balance holds here. The fourth equality uses symmetry.',
    '[P02 | ¶1] We used phase balance in the first equality.',
    '[P02 | ¶2] We used phase balance in the second equality.',
    '[P07 | ¶1] We used phase balance in the last equality.',
    '[P08 | ¶1] The exposition ends here.',
  ].join('\n'), 8);
  const rec = () => suggestPointers(shadow, shadow[0].anchor, 'phase balance 后文怎样使用？', 'phase balance');
  assert.deepEqual(rec().map(p => p.anchor), [shadow[3].anchor, shadow[5].anchor]);
  shadow[6].text = 'See Definition 3.';
  assert.deepEqual(rec(), [{ anchor: shadow[6].anchor, confidence: 'explicit' }, { anchor: shadow[3].anchor, confidence: 'inferred' }]);
  const oldItem = { ...item, anchor: shadow[0].anchor, quote: 'phase balance', pointers: [rec()[0]] };
  const prev = { ...newRound(paper), blocks: shadow, cases: [oldItem, { ...oldItem, pointerMode: 'manual' as const }, { ...oldItem, pointerMode: 'auto' as const }] };
  const cloned = newRound(paper, prev);
  assert.deepEqual(cloned.cases.map(c => c.pointers.length), [1, 1, 2]);
  assert.equal(prev.cases[2].pointers.length, 1);
});

test('independent warm-ups save usage only, resume once and precede all four formal answers', async () => {
  const question = { ...item, category: 'A' as const };
  let round: ExperimentRound = { ...newRound(paper), comparison: undefined, blocks, cases: [question], preheat: true };
  const abort = new AbortController(), captured: string[] = [];
  const send = async (messages: ReturnType<typeof trialMessages>, _connection: Connection, onText: (s: string) => void) => {
    captured.push(JSON.stringify(messages));
    const warming = messages.at(-1)!.content.includes('仅预热');
    onText(warming ? 'discarded warm answer' : 'formal answer');
    return { modelLabel: 'fixture', usage: { inputTokens: 21, cacheReadTokens: warming ? 0 : 18 } };
  };
  await assert.rejects(runPaperRound(round, connection, abort.signal, next => {
    round = next; if (Object.keys(next.warmups ?? {}).length === 1) abort.abort();
  }, send), { name: 'AbortError' });
  assert.equal(captured.length, 1); assert.deepEqual(round.answers, {});
  await assert.rejects(runPaperRound(round, { ...connection, temperature: null }, new AbortController().signal, () => {}, send), /连接已变更/);
  await runPaperRound(round, connection, new AbortController().signal, next => { round = next; }, send);
  assert.equal(captured.length, 6); assert.equal(Object.keys(round.answers).length, 4);
  for (const [i, group] of (['G1', 'G2'] as const).entries()) {
    const key = trialKey(question, group, 1), receipt = round.warmups![key];
    assert.deepEqual(JSON.parse(captured[i]).slice(0, -1), JSON.parse(captured[3 + i]));
    assert.equal(receipt.cacheReadTokens, 0); assert.ok(receipt.finishedAt > 0);
    assert.equal(receipt.cacheWriteTokens, undefined); assert.ok(!('text' in receipt));
    assert.equal(round.answers[key].cacheReadTokens, 18);
  }
  assert.doesNotMatch(JSON.stringify(round) + captured.slice(2).join(), /discarded warm answer|仅预热/);
  assert.equal(newRound(paper, round).warmups, undefined);
});

test('five arms share system and question, with no sibling, future or other-group history', () => {
  const round: ExperimentRound = { ...newRound(paper), blocks, cases: [item] };
  const trials = trialQueue(round);
  const messages = (group: typeof GROUPS[number], turn: number) => trialMessages(round, trials.find(trial => trial.group === group && trial.turn === turn)!);
  const full = messages('G1', 1);
  for (const group of GROUPS) {
    const first = messages(group, 1);
    assert.equal(first[0].content, full[0].content);
    if (group === 'G0' || group === 'G4') { assert.doesNotMatch(first[1].content, /trace is linear|estimates a norm/); assert.match(first[1].content, /Nearby/); }
    else assert.deepEqual(first.slice(0, 2), full.slice(0, 2));
    assert.equal(first.at(-1)!.content.includes('in_paper_pointers'), ['G2', 'G3'].includes(group));
    assert.equal(first.at(-1)!.content.includes('WIKI ONLY'), group === 'G3');
    assert.ok(!JSON.stringify(first).includes(item.correction));
    for (let turn = 1; turn <= 2; turn++) round.answers[trialKey(item, group, turn)] = { model: 'fixture', text: group + '-actual-' + turn, firstTextMs: 2, elapsedMs: 5 };
    const same = messages(group, 3);
    assert.match(same[4].content, /need not be orthogonal/);
    assert.equal(same.at(-1)!.content.includes('<active_branch_memory>'), group === 'G3');
    assert.deepEqual(same.filter(m => m.role === 'assistant').map(m => m.content), [group + '-actual-1', group + '-actual-2']);
    const fresh = messages(group, 4);
    assert.doesNotMatch(JSON.stringify(fresh), /actual-|need not be orthogonal|Drop the cross term|active_branch_memory/);
  }
  const grade = { core: 2, depth: 2, evidence: 0 };
  assert.equal(gradeComplete(item, grade), false);
  assert.equal(gradeComplete(item, { ...grade, sameBranch: false, freshBranch: true }), true);
});

test('15 real-case slots resume from the persisted successful call and prevent stale-window writes', async () => {
  const categories: Category[] = ['A', 'B', 'C', 'D', 'E'];
  let round: ExperimentRound = { ...newRound(paper), comparison: undefined, blocks, cases: categories.flatMap(category => [1, 2, 3].map(i => ({ ...item, category, id: category + i }))) };
  const stale = round;
  const abort = new AbortController();
  let calls = 0;
  const send = async (_messages: unknown, _connection: Connection, onText: (text: string) => void) => {
    calls++; onText('fixture answer ' + calls);
    return { modelLabel: 'fixture', usage: { inputTokens: 20, outputTokens: 3, cacheReadTokens: 0 } };
  };
  await assert.rejects(runPaperRound(round, connection, abort.signal, next => {
    round = next;
    if (Object.keys(next.answers).length === 5) abort.abort();
  }, send), { name: 'AbortError' });
  const saved = (await loadPaperRounds(paper.id)).find(r => r.id === round.id)!;
  assert.equal(calls, 5);
  assert.equal(Object.keys(saved.answers).length, 5);
  await assert.rejects(saveRound(stale), /另一窗口/);
  await runPaperRound(saved, connection, new AbortController().signal, next => { round = next; }, send);
  assert.equal(calls, 96);
  assert.equal(Object.keys(round.answers).length, 96);
  const ballots = blindBallots(round);
  assert.equal(ballots.length, 60);
  assert.ok(ballots.every(b => b.complete && !/G[0-3]/.test(b.label)));
  assert.equal(round.answers[trialKey(round.cases[0], 'G0', 1)].text, 'fixture answer 1');
});
