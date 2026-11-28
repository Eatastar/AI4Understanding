import type { TokenUsage } from './paper-experiment';
import type { ReaderConnection, ReaderGuard } from '../../shared/reader-budget.mjs';
import { receiptCost } from '../../shared/reader-budget.mjs';
export interface ProofStepRange { start: number; end: number }
export const maxProofStepLength = 192;

export interface ReaderPolicy {
  inputCap: number;
  maxUSD?: number;
  connection?: ReaderConnection & { id?: string | null };
}
export interface BranchRecord { excerpt?:string; mandatory?:boolean; question: string; answer: string; kind: 'answer' | 'note' | 'selection'; hash: string }
export type SourceUse = 'focus' | 'proof' | 'condition' | 'nearby' | 'expanded';
export type SelectionImageStatus = 'sent' | 'budget' | 'unsupported' | 'unavailable';
export interface ReaderReport {
  version: 1;
  requestId: string;
  documentId: string;
  documentVersion: string;
  baseline: 'full' | 'indexed';
  generation: string;
  sources: { id: string; use: SourceUse; step?: ProofStepRange }[];
  cited: string[];
  branches: string[];
  missing: string[];
  dropped: number;
  estimatedInput: number;
  inputCap: number;
  outputCap: number;
  priced: boolean;
  maxEstimateUSD?: number;
  costUSD?: number;
  usage?: TokenUsage;
  model?: string;
  selectionImage?: SelectionImageStatus;
}
export interface ReaderPlan { report: ReaderReport; guard: ReaderGuard; messages: import('./types').InputMessage[] }
export interface AnswerRevision { contextReport?: ReaderReport; hash: string; question: string; answer: string; kind: 'answer' | 'note' }
export const sourceIdPattern = /^R[1-9]\d*\.[1-9]\d*$/u;
const hashPattern = /^[0-9a-f]{64}$/u;

export function finishReport(plan: ReaderPlan | undefined, answer: string, model: string, usage?: TokenUsage, validFullIds?: ReadonlyMap<string, unknown>) {
  if (!plan) return;
  const {report} = plan;
  const supplied = new Set(report.sources.map(item=>item.id));
  const ids = Array.from(answer.matchAll(/\[(R[1-9]\d*\.[1-9]\d*)\]/gu), m=>m[1]);
  const cited = [...new Set(ids.filter(id=>supplied.has(id) || (report.baseline==='full' && validFullIds?.has(id))))];
  const costUSD = report.priced ? receiptCost(usage) : undefined;
  return { ...report, cited, missing:ids.some(id=>!cited.includes(id))?[...report.missing,'回答包含无法在本次材料中核对的来源 ID。']:report.missing, model:model.slice(0,200), ...(usage ? { usage } : {}), ...(costUSD !== undefined ? {costUSD} : {}) };
}

// Persist only small provenance records. No unknown imported field is copied.
export function readReaderReport(raw: unknown): ReaderReport {
  if (!raw || typeof raw!=='object') throw new Error('阅读来源记录无效。');
  const r = raw as Record<string,unknown>;
  const string = (x:unknown,max:number) => typeof x==='string' && x.length<=max;
  const natural = (x:unknown) => typeof x==='number' && Number.isSafeInteger(x) && x>=0;
  const validStep = (step: unknown) => {
    if (!step || typeof step!=='object') return false;
    const {start,end}=step as ProofStepRange;
    return Object.keys(step).every(k=>k==='start'||k==='end') && natural(start) && natural(end) && end>start && end-start<=maxProofStepLength;
  };
  const list = (x:unknown,check:(s:string)=>boolean) => Array.isArray(x) && x.length<=10000 && x.every(v=>typeof v==='string' && check(v));
  const fields = ['version','requestId','documentId','documentVersion','baseline','generation','sources','cited','branches','missing','dropped','estimatedInput','inputCap','outputCap','priced','maxEstimateUSD','costUSD','usage','model','selectionImage'];
  const valid = Object.keys(r).every(k=>fields.includes(k)) && r.version===1 && string(r.requestId,128) && string(r.documentId,256)
    && hashPattern.test(String(r.documentVersion)) && hashPattern.test(String(r.generation)) && ['indexed','full'].includes(String(r.baseline))
    && Array.isArray(r.sources) && r.sources.length<=10000 && r.sources.every(s=>s && typeof s==='object' && Object.keys(s).every(k=>k==='id'||k==='use'||k==='step') && sourceIdPattern.test(s.id) && ['focus','proof','condition','nearby','expanded'].includes(s.use) && (s.step===undefined || s.use==='proof' && validStep(s.step)))
    && (r.selectionImage===undefined || ['sent','budget','unsupported','unavailable'].includes(String(r.selectionImage)))
    && list(r.cited,x=>sourceIdPattern.test(x)) && list(r.branches,x=>hashPattern.test(x)) && list(r.missing,x=>x.length<=500)
    && ['dropped','estimatedInput','inputCap','outputCap'].every(k=>natural(r[k])) && typeof r.priced==='boolean'
    && ['maxEstimateUSD','costUSD'].every(k=>r[k]===undefined || (typeof r[k]==='number' && Number.isFinite(r[k]) && r[k]>=0))
    && (r.model===undefined || string(r.model,200)) && (r.usage===undefined || (!!r.usage && typeof r.usage==='object' && Object.entries(r.usage).every(([k,v])=>['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens'].includes(k) && natural(v))));
  if (!valid) throw new Error('阅读来源记录无效。');
  return raw as ReaderReport;
}
