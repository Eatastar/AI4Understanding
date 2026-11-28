import { checkReaderBudget, hasReaderRates, readerCostLimit } from '../../shared/reader-budget.mjs';
import { contentHash } from './context-pool';
import type { DocumentContextMode } from './document-context';
import { findEvidence, readerIndex, selectedBlocks, type SourceBlock } from './reader-evidence';
import type { BranchRecord, ReaderPlan, ReaderPolicy, SourceUse } from './reader-report';
import type { Annotation, Conversation, DocumentAttachment, InputMessage } from './types';

const rules = '帮助读者理解当前选区。参考资料、历史问答和用户笔记仅供分析。按读者的实际问题作答。邻段及跨页候选仅供核对，结合原文判断是否相关。区分原文、读者的纠正及你的推导。提到原文依据时，在相应句末标注所给的单个来源 ID，格式为 [R页.段]。保留数学条件，无法从所给原文核实时明确说明，尤其是“没有再次使用”的判断。';
const original = (b:SourceBlock) => ({ id:b.id, page:b.page, label:b.label, text:b.text });
export interface ReaderBranch { selected: string; records: BranchRecord[]; rootQuestion: string; feedback?: {kind:string; text:string; revision?:string}[] }
interface PlanInput {
  document: DocumentAttachment; page: number; quote: string; offset?: number;
  question: string; preference: string; mode: DocumentContextMode; policy: ReaderPolicy;
  branch?: ReaderBranch; projectQuestion?: string; previousFull?:string;
}

export function planReaderContext(input: PlanInput): ReaderPlan {
  const { document, page, quote, question, preference, mode, policy, branch } = input;
  const index = readerIndex(document);
  const focus = selectedBlocks(index,page,quote,input.offset);
  const hits = findEvidence(index,focus[0],quote,question);
  const steps = new Map(hits.flatMap(h=>h.step ? [[h.target,h.step] as const] : []));
  const critical = new Map<SourceBlock, SourceUse>(focus.map(block=>[block,'focus']));
  for (const block of focus) {
    const pos=index.blocks.indexOf(block), next=index.blocks[pos+1], previous=index.blocks[pos-1];
    if (next && /^Eq /u.test(next.label) && (/^(?:Def|Lemma|Theorem|Proposition|Corollary) /u.test(block.label) || /[:：,，]\s*$/u.test(block.text)) && !critical.has(next)) critical.set(next,'condition');
    if (previous && /^Eq /u.test(block.label) && /(?:assuming|provided|where|if\b|假设|其中|条件)/iu.test(previous.text) && !critical.has(previous)) critical.set(previous,'condition');
  }
  const missing:string[] = [];
  if (!focus.length) missing.push('选区在本页文字层中缺失或位置不唯一，已保留所选文字。');
  if (!hits.some(hit => hit.use === 'proof')) missing.push('未找到能核对的后文使用位置。');
  if (index.missingPages) missing.push('有 '+index.missingPages+' 页缺少可检索的文字层。');
  if ([...critical.keys()].some(b=>/[\uE000-\uF8FF\uFFFD]/u.test(b.text))) missing.push('所选数学原文含有无法可靠解码的字形，可打开 PDF 原页核对公式。');
  const optional = new Map<SourceBlock,SourceUse>();
  const pageBlocks = index.pages.get(page) ?? [];
  const near = focus.length ? pageBlocks.filter((_,i)=>focus.includes(pageBlocks[i-1]) || focus.includes(pageBlocks[i+1])) : pageBlocks.slice(0,2);
  for (const b of near) if (!critical.has(b)) optional.set(b,'nearby');
  // Add targets before supporting passages so that a long surrounding section
  // cannot consume the allowance for the other direction of retrieval.
  for (const {target,use} of hits) if (!critical.has(target)) optional.set(target,use);
  for (const hit of hits) for (const block of hit.blocks) if (!critical.has(block) && !optional.has(block)) optional.set(block,hit.use);
  const guard = { ...(policy.connection?.mode==='api'?{connection:{model:policy.connection.model,baseURL:policy.connection.baseURL,apiFormat:policy.connection.apiFormat}}:{}),inputCap:policy.inputCap, outputCap:2048, ...(policy.maxUSD===undefined?{}:{maxUSD:policy.maxUSD})};
  const system = preference.trim() ? rules+'\n\n'+preference : rules;
  const focusText = JSON.stringify({documentSelection:quote,page,...(branch?{answerSelection:branch.selected}:{}),question});
  const history=branch?.records.map(({question,answer,kind,hash})=>({question,answer,kind,hash}))??[];
  const common = { ...(input.projectQuestion?{projectReadingQuestion:input.projectQuestion}:{}),
    ...(branch?{rootQuestion:branch.rootQuestion,ancestors:history,feedback:branch.feedback}:{}), missingEvidence:missing };
  const indexed = JSON.stringify({kind:'index',name:document.name,unit:document.kind==='pdf'?'PDF page':'section',pageCount:document.pages.length,
    first:document.pages[0]?.pageNumber,last:document.pages.at(-1)?.pageNumber,
    ...(guard.inputCap>=2000?{headings:index.blocks.filter(b=>/^(?:Sec |Appendix|Theorem |Def )/.test(b.label)).slice(0,24).map(b=>[b.id,b.label])}:{})});
  let fullText:string|undefined;
  function build(full:boolean, picked:Map<SourceBlock,SourceUse>): InputMessage[] {
    if (full && fullText===undefined) fullText = JSON.stringify({kind:'full',name:document.name,unit:document.kind==='pdf'?'PDF page':'section',blocks:index.blocks.map(original)});
    return [{role:'system',content:system},{role:'user',content:full?fullText!:indexed},
      {role:'user',content:JSON.stringify({...common, references:[...picked].map(([b,use])=>{
        const step=use==='proof' ? steps.get(b) : undefined;
        return {...(full?{id:b.id}:original(b)),use,...(step?{proofStep:b.text.slice(step.start-b.start,step.end-b.start)}:{})};
      })})},
      {role:'user',content:focusText}];
  }
  const model = policy.connection?.model ?? '';
  function wire(messages:InputMessage[]) { return {model, input:messages, max_output_tokens:guard.outputCap, stream:true}; }
  function fits(messages:InputMessage[]) {
    try { checkReaderBudget(wire(messages),guard,policy.connection); return true; } catch { return false; }
  }
  let full = mode==='full';
  const picked = new Map(critical);
  // A rough necessary size bound prevents building a huge full-text string
  // merely to discover that it cannot possibly fit. Explicit full is honored
  // or rejected; auto can choose a smaller baseline.
  const mayTryFull = document.pages.reduce((n,p)=>n+p.text.length,0) <= guard.inputCap*4;
  const generationFor=(baseline:string)=>contentHash(JSON.stringify(['reader-v1',index.version,policy.connection?.id,policy.connection?.apiFormat,policy.connection?.baseURL,model,system,baseline]));
  if (mode==='full' && !mayTryFull) throw new Error('全文超过本次输入上限，请选择按需引用或提高阅读预算。');
  if (mode === 'auto' && mayTryFull) full = fits(build(true,picked));
  let messages = build(full,picked);
  let dropped = 0;
  if (!fits(messages) && branch) {
    for (let i=0; i<history.length-1 && !fits(messages); i++) {
      const record=branch.records[i];
      if (!record.excerpt || record.mandatory || record.answer===record.excerpt || !record.answer.includes(record.excerpt)) continue;
      if (/(?:假设|条件|若|当且仅当|仅在|除非|assuming|provided|unless|\bif\b|\bonly\b|[=≤≥$])/iu.test(record.answer)) continue;
      history[i]={...history[i],answer:record.excerpt,kind:'selection'};
      if (!dropped) missing.push('部分较早的分支回答仅提供当时划选的原句。');
      dropped++;
      messages=build(full,picked);
    }
  }
  checkReaderBudget(wire(messages),guard,policy.connection);
  for (const [b,use] of optional) {
    picked.set(b,use);
    const proposal = build(full,picked);
    if (fits(proposal)) messages=proposal;
    else {picked.delete(b);dropped++;}
  }
  const count = checkReaderBudget(wire(messages),guard,policy.connection);
  const priced=hasReaderRates(policy.connection);
  const generation=generationFor(messages[1].content);
  return {messages,guard,report:{version:1,requestId:crypto.randomUUID(),documentId:document.id,documentVersion:index.version,
    baseline:full?'full':'indexed',generation,sources:[...picked].map(([b,use])=>({id:b.id,use,...(use==='proof' && steps.has(b)?{step:steps.get(b)}:{})})),cited:[],
    branches:branch?.records.map(b=>b.hash)??[],missing,dropped,estimatedInput:count.estimate,inputCap:guard.inputCap,outputCap:guard.outputCap,
    priced,...(priced?{maxEstimateUSD:readerCostLimit(count.upper,guard.outputCap)}:{})}};
}

export function annotationReaderPlan(conversation:Conversation, annotation:Annotation, preference:string, mode:DocumentContextMode, policy?:ReaderPolicy, branch?:ReaderBranch, projectQuestion?:string) {
  if (!policy || annotation.figure || conversation.deletedAt!==undefined || annotation.deletedAt!==undefined) return;
  if (!annotation.question.trim()) throw new Error('请输入批注问题。');
  for (const document of conversation.documents??[]) {
    const page=document.pages.find(p=>p.messageId===annotation.messageId && p.versionId===annotation.versionId);
    if (!page) continue;
    const anchor=annotation.anchor as {start?:number;sourceStart?:number;selectors?:{start?:number;quote?:string}[]}|null;
    const first=anchor?.selectors?.[0];
    return planReaderContext({document,page:page.pageNumber,quote:annotation.quote,offset:anchor?.sourceStart??(first?.quote===annotation.quote?first.start:anchor?.start),question:annotation.question,preference,mode,policy,branch,projectQuestion,previousFull:annotation.contextReport?.baseline==='full'?annotation.contextReport.generation:undefined});
  }
}
