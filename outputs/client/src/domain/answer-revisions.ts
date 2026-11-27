import { contentHash } from './context-pool';
import { readReaderReport, type ReaderReport, type AnswerRevision } from './reader-report';

interface AnswerOwner { contextReport?:ReaderReport; question:string; answer:string; note?:string; answerRevisions?:AnswerRevision[] }
export const answerRevisionId=(kind:'answer'|'note',question:string,text:string)=>contentHash(JSON.stringify([kind,question,text]));
export function previousRevision(source:AnswerOwner, nextText:string,nextQuestion=source.question) {
  const text=source.note??source.answer;
  if (!text || (text===nextText && source.question===nextQuestion)) return source.answerRevisions;
  const hash=contentHash(text);
  if (source.answerRevisions?.some(r=>r.hash===hash && r.question===source.question)) return source.answerRevisions;
  return [...(source.answerRevisions??[]),{hash,question:source.question,answer:text,...(source.contextReport?{contextReport:source.contextReport}:{}),kind:source.note===undefined?'answer' as const:'note' as const}];
}
export function readRevisions(value:unknown):AnswerRevision[] {
  if (!Array.isArray(value) || !value.every(r=>r && typeof r==='object' && Object.keys(r).every(k=>['hash','question','answer','kind','contextReport'].includes(k)) && typeof r.answer==='string' && r.answer && typeof r.question==='string' && ['note','answer'].includes(r.kind) && contentHash(r.answer)===r.hash)) throw new Error('历史回答版本无效。');
  for (const r of value) if (r.contextReport!==undefined) readReaderReport(r.contextReport);
  return value;
}
