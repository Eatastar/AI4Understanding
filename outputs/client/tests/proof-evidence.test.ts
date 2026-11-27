import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShadow } from '../src/domain/experiment-material';
import { retrieveProofEvidence } from '../src/domain/proof-evidence';
import { blindBallots, changeComparison, newRound, trialMessages, trialQueue, uncachedInput, warmupGroups } from '../src/domain/paper-experiment';
import { importProofQuestions } from '../src/domain/proof-question-set';
import type { DocumentAttachment } from '../src/domain/types';

const shadow = [
  '[P01 | Def 2] Definition 2. [phase balance] The weights within a pair are equal.',
  '[P02 | Def 3] Definition 3. [fold index] An optional local statistic.',
  '[P03 | ¶1] An unrelated passage.',
  '[P04 | Lemma 6] Lemma 6. The operator is normalized.',
  '[P04 | ¶1] Proof. Consider the following cases.',
  '[P05 | Case 2] Case 2. Distinct indices.',
  '[P05 | Eq 11] a+b', '[P05 | Eq 12] 2a', '[P05 | Eq 13] c',
  '[P05 | ¶1] We used phase balance in the second equality.',
  '[P06 | Lemma 7] Lemma 7. A different statement.',
  '[P06 | Eq 14] EXCLUDED-EQUATION',
  '[P07 | References] References', '[P07 | ¶1] By phase balance in the last equality (book title).',
].join('\n');
const blocks=parseShadow(shadow,7);
test('proof retrieval carries the owning statement, case and equation chain across pages and stops at boundaries', () => {
  const hits=retrieveProofEvidence(blocks,blocks[0].anchor,'phase balance','Which proof uses it?');
  assert.deepEqual(hits,[{target:'P05 | ¶1',owner:'P04 | Lemma 6',part:'P05 | Case 2',anchors:blocks.slice(3,4).concat(blocks.slice(5,10)).map(b=>b.anchor)}]);
  assert.deepEqual(retrieveProofEvidence(blocks,blocks[1].anchor,'fold index','Which proof uses it?'),[]);
  const delayed=parseShadow('[P01 | Def 1] Definition 1 [a filter].\n[P02 | Lemma 2] Lemma 2. First result.\n[P03 | Lemma 3] Lemma 3. Another result.\n[P04 | Sec 4] Appendix A\n[P04 | ¶1] Proof of Lemma 2.\n[P04 | ¶2] By Definition 1 this follows.',4);
  assert.equal(retrieveProofEvidence(delayed,delayed[0].anchor,'a filter','why?')[0].owner,'P02 | Lemma 2');
});
test('paired runs import questions without answer hints, balance order, and retrieve original text even with edited pointers', () => {
  const paper={id:'fixture',name:'Synthetic.pdf',pages:[]} as unknown as DocumentAttachment;
  const fresh=newRound(paper);
  const file=JSON.stringify({paper:paper.name,shadow,questions:[
    {anchor:blocks[0].anchor,quote:'phase balance',question:'Where is this used?',pointers:['oracle'],answer:'oracle'},
    {anchor:blocks[1].anchor,quote:'fold index',question:'Where does this reappear?',category:'E'},
  ]});
  const round=changeComparison(importProofQuestions(fresh,file,7),'proof');
  assert.equal(importProofQuestions(round,file,7).cases.length,2);
  assert.throws(()=>importProofQuestions(round,file.replace('Synthetic.pdf','Other.pdf'),7));
  round.cases[0].pointers=[{anchor:blocks.at(-1)!.anchor,confidence:'explicit'}];
  assert.deepEqual(trialQueue(round).map(t=>t.group),['G1','G4','G4','G1']);
  assert.equal(blindBallots(round).length,4);assert.deepEqual(warmupGroups(round),['G1','G4']);
  const messages=trialMessages(round,trialQueue(round)[1]);
  assert.match(messages[2].content,/P04 \| Lemma 6/);assert.match(messages[2].content,/P05 \| Eq 12/);
  assert.doesNotMatch(JSON.stringify(messages),/oracle|EXCLUDED-EQUATION|book title/);
  assert.equal(uncachedInput({inputTokens:100,cacheReadTokens:100}),0);
  assert.equal(uncachedInput({inputTokens:100,cacheReadTokens:0}),100);
  assert.equal(uncachedInput({inputTokens:100}),undefined);
});
