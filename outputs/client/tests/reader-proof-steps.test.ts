import assert from 'node:assert/strict';
import test from 'node:test';
import {planReaderContext} from '../src/domain/reader-context';
import {evidenceSearchHit} from '../src/domain/reader-evidence';
import {finishReport,readReaderReport} from '../src/domain/reader-report';
import type {DocumentAttachment} from '../src/domain/types';

const passage='Using violet balance, the two contributions cancel in the second equality.';
const makePaper=(content: string[]):DocumentAttachment=>({
  id:'synthetic-proof',kind:'pdf',name:'Synthetic document',size:1000,createdAt:1,mimeType:'application/pdf',
  pages:content.map((text,i)=>({pageNumber:i+1,text,messageId:'page-'+i,versionId:'version-'+i})),
});
const paper=makePaper([
  'Definition 1 (violet balance). The two weights have equal magnitude.',
  'Theorem 4. A preliminary cancellation.\nProof. Using violet balance, a preliminary bound follows. □',
  'Theorem 9. The target cancellation.\nProof. We establish a preliminary identity and keep both contributions until their terms have been expressed in a common basis.\n'+passage,
]);
const base={document:paper,page:1,quote:'violet balance',offset:14,preference:'',mode:'relevant' as const,policy:{inputCap:12000}};

test('locates the actual proof step under paraphrases and confines it to the requested theorem',()=>{
  for(const question of ['这个性质在后文定理 9 哪里用到？','定理 9 的证明里哪一行得靠它？','Which step in the proof of Theorem 9 needs this condition?']){
    const plan=planReaderContext({...base,question});
    const ref=plan.report.sources.find(s=>s.step)!;
    assert.ok(ref.step);assert.equal(ref.id.split('.')[0],'R3');
    const wire=JSON.parse(plan.messages[2].content).references.find((r:{id:string})=>r.id===ref.id);
    assert.equal(wire.proofStep,passage);assert.ok(wire.text.includes(wire.proofStep));
    const report=readReaderReport(JSON.parse(JSON.stringify(finishReport(plan,'['+ref.id+']','fixture'))));
    assert.equal(evidenceSearchHit(paper,report,ref.id)?.hit.quote,passage);
    assert.equal(report.sources.some(s=>s.use==='proof' && s.id.startsWith('R2.')),false);
  }
});

test('a follow-up can retrieve a later use without an intent keyword; an unknown proof is recorded as missing',()=>{
  const natural=planReaderContext({...base,question:'这个条件起了什么作用？'});
  assert.ok(natural.report.sources.some(s=>s.step));
  const plan=planReaderContext({...base,question:'在后文定理 12 的证明哪里用到它？'});
  assert.ok(plan.report.missing.some(m=>m.includes('未找到')));
  assert.equal(plan.report.sources.some(s=>s.step),false);
});

test('indexed symbols can locate an implicit equation in a proof after the references',()=>{
  const doc=makePaper(['Definition 1. We define v1:t,j as the sequence of measurements.',
    'References\nUsing v1:t,j in an equality is a book title.',
    '3 APPENDIX\nLemma 7. A recurrence.\nProof. Expand the left side.\n= ‖v1:T,j‖² − c²']);
  const plan=planReaderContext({...base,document:doc,quote:'v1:t,j',offset:undefined,question:'哪一步需要这个定义才能完成证明？'});
  const ref=plan.report.sources.find(s=>s.step)!;
  assert.equal(evidenceSearchHit(doc,plan.report,ref.id)?.hit.pageNumber,3);
  assert.match(evidenceSearchHit(doc,plan.report,ref.id)!.hit.quote,/v1:T,j/u);
});

test('an invalid or stale proof range cannot jump into another paragraph; old receipts retain their original target',()=>{
  const plan=planReaderContext({...base,question:'这个性质在后文哪里用到？'}), ref=plan.report.sources.find(s=>s.step)!;
  const change=(start:number,end:number)=>({...plan.report,sources:[{...ref,step:{start,end}}]});
  assert.throws(()=>readReaderReport(change(-1,5)));
  assert.throws(()=>readReaderReport(change(0,8000)));
  assert.equal(evidenceSearchHit(paper,change(9000,9012),ref.id),undefined);
  const old=readReaderReport({...plan.report,sources:[{id:ref.id,use:'proof'}]});
  assert.ok(evidenceSearchHit(paper,old,ref.id));
});
