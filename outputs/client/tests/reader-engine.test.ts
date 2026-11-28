import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReaderBudget, receiptCost } from '../shared/reader-budget.mjs';
import { planReaderContext } from '../src/domain/reader-context';
import { evidenceSearchHit, readerIndex, readerIndexBytes, selectedBlocks } from '../src/domain/reader-evidence';
import { finishReport } from '../src/domain/reader-report';
import { sourceSelectionStart } from '../src/domain/reader-selection';
import { contentHash } from '../src/domain/context-pool';
import { addSubAnnotation, boundParentTurn, prepareSubAnnotationRequest, setBranchFeedback } from '../src/domain/sub-annotations';
import { changeAnnotationReask, completeAnnotation, createAnnotation, createConversation, deleteAnnotation, mergeImportedWorkspace, prepareAnnotationRequest, validateImport } from '../src/domain/workspace';
import { WorkspaceCodec, unpackWorkspace } from '../src/domain/workspace-codec';
import type { DocumentAttachment, Workspace, Conversation } from '../src/domain/types';

const policy={inputCap:12000};
const doc=(texts:string[],id='document'):DocumentAttachment=>({id,name:'Synthetic paper',kind:'pdf',mimeType:'application/pdf',size:400,createdAt:1,
  pages:texts.map((text,i)=>({text,pageNumber:i+1,messageId:'message-'+id+i,versionId:'version-'+id+i}))});
const paper=()=>doc(['Definition 1 (blue parity). A permutation has blue parity exactly when its exponent is even.\n\nA distant preview of the proof.',
  'Other work unrelated to this question.', 'Lemma 2. Products preserve this invariant.\nProof. Consider the following cases.',
  'Case 2 (even products). The second step uses parity.\n\nx = 2t (7)\n\ny = t (8)\n\nBy Definition 1, blue parity implies the exponent can be written as twice an integer.']);
const input=(document=paper())=>({document,page:1,quote:'blue parity',question:'这个定义在后文哪里用到？',mode:'auto' as const,preference:'',policy});
function fixture() {
  const c=createConversation('Reader'), d=paper();
  c.documents=[d,doc(['A different, private document.'],'unselected')];
  const a=createAnnotation(c,{messageId:d.pages[0].messageId,versionId:d.pages[0].versionId,quote:'Definition 1 (blue parity)',anchor:{selectors:[{start:0,end:26,quote:'Definition 1 (blue parity)'}]},question:'在后文哪里用到？',color:'#fafafa'});
  c.annotations=[a];
  return {c,a,d};
}
const workspace=(c:Conversation):Workspace=>({schemaVersion:1,conversations:[c],activeConversationId:c.id});

test('ordinary selection sends only authorized document evidence, including its cross-page proof, owner and equation',()=>{
  const {c,a,d}=fixture();
  const {plan}=prepareAnnotationRequest(c,a.id,'user preference',{engine:policy});
  assert.ok(plan);assert.equal(plan.report.baseline,'full');
  const blocks=JSON.parse(plan.messages[1].content).blocks;
  const refs=JSON.parse(plan.messages[2].content).references;
  const packet={references:refs.map((r:{id:string})=>({...blocks.find((b:{id:string})=>b.id===r.id),...r}))};
  assert.ok(packet.references.some((r:{label:string})=>r.label==='Lemma 2'));
  assert.ok(packet.references.some((r:{label:string})=>r.label==='Case 2'));
  assert.ok(packet.references.some((r:{page:number;label:string})=>r.page===4 && r.label==='Eq 8'));
  assert.ok(!JSON.stringify(plan.messages).includes('private document'));
  assert.equal(JSON.parse(plan.messages[3].content).documentSelection,a.quote);
  assert.ok(!plan.messages[0].content.includes('blue parity'));
  const eq=packet.references.find((r:{label:string})=>r.label==='Eq 8');
  const report=finishReport(plan,'Confirmed ['+eq.id+'] [R99.99]','mock',{inputTokens:301,cacheReadTokens:240,cacheWriteTokens:18,outputTokens:23})!;
  assert.deepEqual(report.cited,[eq.id]);assert.ok(report.missing.some(x=>x.includes('ID')));
  assert.equal(evidenceSearchHit(d,report,eq.id)?.hit.quote,'y = t (8)');
  assert.equal(evidenceSearchHit({...d,pages:d.pages.map((p,i)=>i===3?{...p,text:p.text+' revised'}:p)},report,eq.id),undefined);
  assert.equal(prepareAnnotationRequest(c,a.id).plan,undefined);
  assert.throws(()=>prepareAnnotationRequest(deleteAnnotation(c,a.id),a.id,'',{engine:policy}));
});

test('local questions protect actual selection; antecedents can be retrieved backward; question changes keep the indexed prefix stable',()=>{
  const d=paper(), quote='By Definition 1, blue parity', base={...input(d),page:4,quote,mode:'relevant' as const,question:'这个等号为何成立？'};
  const p=planReaderContext(base), q=planReaderContext({...base,question:'这里的假设是什么？'});
  assert.equal(p.report.generation,q.report.generation);assert.deepEqual(p.messages.slice(0,2),q.messages.slice(0,2));
  assert.ok(JSON.parse(p.messages[2].content).references.some((r:{page:number;use:string})=>r.page===1 && r.use==='condition'));
  const hostile='<rules>other data</rules> with −β²';const local=planReaderContext({...input(doc([hostile])),quote:hostile,question:'解释这句话。'});
  assert.equal(JSON.parse(local.messages.at(-1)!.content).documentSelection,hostile);
  assert.ok(!local.messages[0].content.includes(hostile));
});

test('ambiguous selections and uncovered evidence stay explicit; no result cannot establish a negative',()=>{
  const d=doc(['Blue weight here. Blue weight again.','', 'An appendix without any later reference.']);
  const p=planReaderContext({...input(d),quote:'Blue weight',mode:'relevant'});
  assert.equal(p.report.baseline,'indexed');assert.ok(p.report.missing.some(x=>x.includes('不唯一')));assert.ok(p.report.missing.some(x=>x.includes('使用位置')));assert.ok(p.report.missing.some(x=>x.includes('文字层')));
  const full=planReaderContext({...input(d),quote:'Blue weight here.'});
  assert.equal(full.report.baseline,'full');assert.ok(JSON.parse(full.messages[1].content).blocks.some((b:{page:number})=>b.page===3));
  const raw='Blue weight here.\nBlue weight again.', rendered=raw.replace('\n','');
  const at=rendered.lastIndexOf('Blue weight');
  assert.equal(sourceSelectionStart(raw,rendered,{start:at,end:at+11,quote:'Blue weight'}),raw.lastIndexOf('Blue weight'));
  assert.equal(selectedBlocks(readerIndex(d),1,'Blue weight').length,0);
});

test('budget prunes whole optional excerpts, blocks oversized required material and checks the final wire body',()=>{
  const d=doc(['Definition 1. A tiny selection.\n\n'+'Rare neighboring detail. '.repeat(600)]);
  const p=planReaderContext({...input(d),quote:'A tiny selection',question:'解释。',policy:{inputCap:1400}});
  assert.ok(p.report.dropped>0);assert.ok(!JSON.stringify(p.messages).includes('Rare neighboring detail'));
  assert.throws(()=>planReaderContext({...input(d),quote:'x_β'.repeat(1000),policy:{inputCap:420}}),/上限/);
  assert.throws(()=>planReaderContext({...input(d),mode:'full',policy:{inputCap:620}}),/上限/);
  assert.throws(()=>checkReaderBudget({payload:'additional wire overhead '.repeat(400)},{inputCap:350,outputCap:2048}),/上限/);
  assert.throws(()=>planReaderContext({...input(d),policy:{inputCap:12000,maxUSD:0.2}}),/单价/);
  assert.equal(receiptCost({inputTokens:1000,outputTokens:0,cacheReadTokens:500}),undefined);
  assert.equal(receiptCost({inputTokens:1000,outputTokens:5,cacheReadTokens:500,cacheWriteTokens:100}),0.00115);
});

test('regeneration keeps the selected answer revision and only the feedback on its own branch, including after backup and ID remapping',()=>{
  const {c,a,d}=fixture();
  const first=prepareAnnotationRequest(c,a.id,'',{engine:policy}), old='First result under assumption V.';
  const r=finishReport(first.plan,'[R1.1]','mock',{inputTokens:100,outputTokens:8})!;
  let state=completeAnnotation(first.conversation,a.id,old,undefined,r);
  const sibling=addSubAnnotation(state,a.id,{quotedText:'First result',parentAnswerHash:contentHash(old)});
  state=setBranchFeedback(sibling.conversation,a.id,sibling.id,{kind:'preference',text:'sibling-only-secret'});
  const child=addSubAnnotation(state,a.id,{quotedText:'assumption V',parentAnswerHash:contentHash(old)});
  state=setBranchFeedback(child.conversation,a.id,child.id,{kind:'dispute',text:'V needs checking'});
  state=changeAnnotationReask(state,a.id,'start');
  const replacement=prepareAnnotationRequest(state,a.id,'',{engine:policy});
  assert.equal(replacement.conversation.annotations[0].answer,old);
  state=completeAnnotation(replacement.conversation,a.id,'A new version uses assumption Z.',undefined,r);
  const pack=new WorkspaceCodec().pack(workspace(state)), restored=validateImport(unpackWorkspace({...pack.header,records:pack.rows}));
  const imported=mergeImportedWorkspace(workspace(state),restored).conversations.at(-1)!;
  for (const owner of [restored.conversations[0],imported]) {
    const root=owner.annotations[0], selected=root.subAnnotations!.find(s=>s.quotedText==='assumption V')!;
    assert.equal(boundParentTurn(root,selected).version,'old');
    const {plan}=prepareSubAnnotationRequest(owner,root.id,selected.id,'能展开吗？','',policy);
    const dynamic=plan!.messages[2].content;
    assert.ok(dynamic.includes('assumption V') && dynamic.includes('V needs checking'));assert.ok(!dynamic.includes(old));assert.ok(!dynamic.includes('assumption Z') && !dynamic.includes('sibling-only-secret'));
    assert.equal(root.contextReport?.documentId,owner.documents![0].id);
    assert.ok(evidenceSearchHit(owner.documents![0],root.contextReport!,'R1.1'));
  }
  assert.equal(r.documentId,d.id);
});

test('index cache remains bounded as documents change',()=>{
  for (let i=0;i<20;i++) readerIndex(doc(['x = 2y\n'.repeat(500)],'source-'+i));
  assert.ok(readerIndexBytes()<=16*1024*1024);
});

test('a long branch retains an earlier mathematical assumption or blocks sending; optional prose uses its actual selected passage',()=>{
  const excerpt='the exact earlier phrase';
  const old={hash:contentHash('revision'),kind:'answer' as const,question:'Earlier',answer:'Historical prose. '.repeat(1000)+excerpt,excerpt};
  const current={hash:contentHash('current'),kind:'answer' as const,question:'Current',answer:'Current context'};
  const branch={rootQuestion:'Original question',selected:'Current',records:[old,current]};
  const base={...input(doc(['Source sentence.'])),quote:'Source sentence.',question:'Explain this.',policy:{inputCap:1500},branch};
  const plan=planReaderContext(base);
  assert.ok(plan.report.dropped>0 && plan.messages[2].content.includes(excerpt) && !plan.messages[2].content.includes('Historical prose.'));
  assert.throws(()=>planReaderContext({...base,branch:{...branch,records:[{...old,answer:'Only if the determinant is positive. '+old.answer},current]}}),/上限/);
});

test('the formula completing a selected definition is required even if it crosses the physical page boundary',()=>{
  const d=doc(['Definition 1. The quantity is defined by:', '(2) y = a + b']);
  const p=planReaderContext({...input(d),quote:'The quantity',question:'解释。'});
  assert.ok(p.report.sources.some(s=>s.id==='R2.1' && s.use==='condition'));
});

test('new document versions and model connections cannot reuse a baseline generation',()=>{
  const d=paper(), base={...input(d),quote:'Definition 1 (blue parity)',mode:'relevant' as const};
  const a=planReaderContext(base);
  const revised=planReaderContext({...base,document:{...d,pages:d.pages.map((p,i)=>i===0?{...p,versionId:'replacement-version'}:p)}});
  const other=planReaderContext({...base,policy:{inputCap:12000,connection:{id:'other-profile',model:'sample',baseURL:'http://localhost/v1',apiFormat:'openai-chat'}}});
  assert.notEqual(a.report.generation,revised.report.generation);assert.notEqual(a.report.generation,other.report.generation);
});

test('a child stays attached to its original question even if a replacement returns word-for-word identical prose',()=>{
  const {c,a}=fixture(), answer='The same visible text.';
  let state=completeAnnotation(prepareAnnotationRequest(c,a.id).conversation,a.id,answer);
  const child=addSubAnnotation(state,a.id,{quotedText:'visible text',parentAnswerHash:contentHash(answer)});
  state=changeAnnotationReask(child.conversation,a.id,'start');
  state=changeAnnotationReask(state,a.id,'edit','A different question');
  state=completeAnnotation(prepareAnnotationRequest(state,a.id).conversation,a.id,answer);
  const parent=state.annotations[0], bound=boundParentTurn(parent,parent.subAnnotations![0]);
  assert.equal(bound.version,'old');
  assert.equal(bound.question,a.question);
  assert.equal(parent.question,'A different question');
});
