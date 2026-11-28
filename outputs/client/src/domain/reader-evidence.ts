import type { DocumentAttachment, DocumentPage } from './types';
import type { PaperBlock } from './experiment-material';
import { rankPointerCandidates } from './experiment-material';
import { readerProofSteps, type ReaderEvidence } from './reader-proof-steps';
import { BoundedCache } from './bounded-cache';
import { contentHash } from './context-pool';
import { buildDocumentSearch, foldSearchText, searchDocument } from './reader-navigation';
import type { ReaderReport } from './reader-report';

export interface SourceBlock extends PaperBlock {
  id: string;
  start: number;
  end: number;
  versionId: string;
  label: string;
}
export interface ReaderIndex {
  version: string;
  blocks: SourceBlock[];
  byId: Map<string, SourceBlock>;
  byAnchor: Map<string, SourceBlock>;
  pages: Map<number, SourceBlock[]>;
  missingPages: number;
}
const cache = new BoundedCache<DocumentAttachment, ReaderIndex>(16 * 1024 * 1024, 4);
const names: Record<string,string> = { lemma:'Lemma', theorem:'Theorem', proposition:'Proposition', definition:'Def', corollary:'Corollary', claim:'Claim', 引理:'Lemma', 定理:'Theorem', 定义:'Def', 命题:'Proposition', 推论:'Corollary' };
const heading = /^(definition|lemma|theorem|proposition|corollary|claim|定义|引理|定理|命题|推论)\s*(\d+(?:\.\d+)*)(?=\s*[.:(（：。]|$)/iu;
const caseHeading = /^(?:case|subcase|情形|情况)\s*([0-9A-Za-z]+|[一二三四五六七八九十]+)(?=\s*[:.()（：。]|$)/iu;
const equationNumber = /\((\d+(?:\.\d+)*[a-z]?)\)\s*$/iu;

function lineLabel(line: string): string {
  const statement = heading.exec(line);
  if (statement) return names[statement[1].toLowerCase()] + ' ' + statement[2];
  const part = caseHeading.exec(line);
  if (part) return 'Case ' + part[1];
  if (/^(?:proof\b[. :]|证明[：。:]|證明[：。:])/iu.test(line)) return 'Proof';
  if (/^(?:references|bibliography|参考文献)\s*$/iu.test(line)) return 'References';
  if (/^(?:appendix|附录)\b/iu.test(line) || /^\d+\s+APPENDIX$/u.test(line)) return 'Appendix';
  if (/^\d+(?:\.\d+)*\s+[A-Z][A-Z A-Z’-]{3,}$/u.test(line)) return 'Sec ' + line.split(/\s/)[0];
  return '';
}

function pageBlocks(page: DocumentPage): SourceBlock[] {
  const { text, pageNumber, versionId } = page;
  const list: SourceBlock[] = [], labels = new Set<string>();
  let start = -1, end = 0, label = '';
  const flush = () => {
    if (start < 0) return;
    const number = list.length + 1;
    let tag = label || '¶' + number;
    if (labels.has(tag)) tag += ' · ' + number;
    labels.add(tag);
    list.push({ id:'R'+pageNumber+'.'+number, page:pageNumber, start, end, versionId, label:tag,
      anchor:'P'+String(pageNumber).padStart(2,'0')+' | '+tag, text:text.slice(start,end) });
    start = -1; label = '';
  };
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    const line = match[0].trim();
    if (!line) { flush(); continue; }
    const from = match.index + match[0].indexOf(line);
    const leading=/^\((\d+(?:\.\d+)*[a-z]?)\)\s+(?=\S)/iu.exec(line);
    const only=/^\((\d+(?:\.\d+)*[a-z]?)\)$/iu.exec(line);
    const beginsDisplay=only && start>=0 && /[,:：，]\s*$/u.test(text.slice(start,end));
    const tag = lineLabel(line) || (leading ? 'Eq '+leading[1] : beginsDisplay ? 'Eq '+only[1] : '');
    const math=/^[=Σ∑∏∫√≤≥Φαβλθ]|^[^\s]{1,20}\s*[:=≤≥∈⊂]/u.test(line);
    if (start>=0 && label && !label.startsWith('Eq ') && math) flush();
    if (start>=0 && label.startsWith('Eq ') && /^[A-Z][a-z]+\s+[a-z]{2,}/u.test(line)) flush();
    // Preserve exact contiguous source offsets. Split long prose at a sentence
    // boundary only; a long indivisible formula can legitimately exceed a budget.
    if (tag || (start >= 0 && end-start > 450 && /[.?!。！？]\s*$/u.test(text.slice(Math.max(start,end-4),end)))) flush();
    if (start < 0) { start = from; label = tag; }
    end = from + line.length;
    const eq = equationNumber.exec(line);
    if (eq && !tag && !/[A-Za-z]\(\d+(?:\.\d+)*[a-z]?\)\s*$/u.test(line) && (/[=≤≥≡∈∑∏→]/u.test(text.slice(start,end)) || line === eq[0] || /^[^a-zA-Z]{1,12}/u.test(line) && !/[a-z]{4}\s+[a-z]{4}/iu.test(line))) {
      // PDF text often places the printed equation number on a separate line.
      if (!label) label = 'Eq ' + eq[1];
      flush();
    }
  }
  return list;
}

const partial=new WeakMap<DocumentAttachment, {pages:Map<number,SourceBlock[]>; hashes:string[]; next:number}>();
function buildPages(document:DocumentAttachment, maxPages:number) {
  let state=partial.get(document);
  if (!state) {state={pages:new Map(),hashes:[],next:0};partial.set(document,state);}
  const until=Math.min(document.pages.length,state.next+maxPages);
  for (;state.next<until;state.next++) {
    const p=document.pages[state.next];
    state.pages.set(p.pageNumber,pageBlocks(p));
    state.hashes.push(contentHash(p.text));
  }
  return state;
}
function finishIndex(document:DocumentAttachment, state:ReturnType<typeof buildPages>):ReaderIndex {
  const {pages,hashes}=state;
  const blocks = [...pages.values()].flat();
  const version = contentHash(JSON.stringify(['reader-extract-1',...document.pages.map((p,i) => [p.pageNumber,p.versionId,hashes[i]])]));
  const index = { version, pages, blocks, byId:new Map(blocks.map(b=>[b.id,b])), byAnchor:new Map(blocks.map(b=>[b.anchor,b])),
    missingPages:[...pages.values()].filter(p=>!p.length).length };
  cache.set(document,index,blocks.reduce((n,b)=>n+256+2*b.text.length,128*pages.size));
  partial.delete(document);
  return index;
}
export function readerIndex(document:DocumentAttachment):ReaderIndex {
  return cache.get(document)??finishIndex(document,buildPages(document,document.pages.length));
}
export const readerIndexBytes=()=>cache.bytes;
export function warmReaderIndex(document:DocumentAttachment) {
  if (cache.get(document)) return ()=>{};
  let timer=0;
  const run=()=>{
    if (cache.get(document)) return;
    const state=buildPages(document,2);
    if (state.next===document.pages.length) finishIndex(document,state);
    else timer=window.setTimeout(run,12);
  };
  timer=window.setTimeout(run,80);
  return ()=>{clearTimeout(timer);partial.delete(document);};
}

export function evidenceSearchHit(document:DocumentAttachment, report:ReaderReport, id:string) {
  const index=readerIndex(document), block=index.byId.get(id);
  if (!block || document.id!==report.documentId || index.version!==report.documentVersion ||
      (report.baseline!=='full' && !report.sources.some(s=>s.id===id))) return;
  const pageIndex=document.pages.findIndex(p=>p.pageNumber===block.page && p.versionId===block.versionId);
  if (pageIndex<0) return;
  const search=buildDocumentSearch(document.pages);
  const step=report.sources.find(s=>s.id===id)?.step;
  if (step && (step.start<block.start || step.end>block.end || step.end<=step.start)) return;
  const start=step?.start ?? block.start;
  const query=step ? block.text.slice(start-block.start,step.end-block.start) : Array.from(block.text).slice(0,96).join('').trimEnd();
  const hit=searchDocument(search,query,Math.max(1,start+1),pageIndex,pageIndex+1).hits.find(h=>h.start>=start && h.start<=start+2 && h.end<=(step?.end??block.end));
  return hit?{hit,query}:undefined;
}

export function selectedBlocks(index: ReaderIndex, page: number, quote: string, offset?: number) {
  const list = index.pages.get(page) ?? [];
  const term = foldSearchText(quote);
  if (!term) return [];
  if (offset !== undefined) {
    const i = list.findIndex(b=>offset>=b.start && offset<b.end);
    if (i>=0) {
      let matched='';
      for (let j=i;j<list.length && matched.length<term.length;j++) {
        matched+=foldSearchText(j===i?list[j].text.slice(offset-list[j].start):list[j].text);
        if (matched.startsWith(term)) return list.slice(i,j+1);
      }
    }
  }
  const folded = list.map(b=>foldSearchText(b.text));
  const joined = folded.join('');
  const at = joined.indexOf(term);
  if (at < 0 || joined.indexOf(term,at+1)>=0) return [];
  let cursor = 0;
  return list.filter((_,i)=>{const previous=cursor; cursor+=folded[i].length; return previous<at+term.length && cursor>at;});
}

export function findEvidence(index: ReaderIndex, focus: SourceBlock | undefined, quote: string, question: string, direction?: 'forward'): (ReaderEvidence & {use:'condition'|'proof'|'expanded'})[] {
  if (!focus) return [];
  const { blocks } = index;
  const proof = readerProofSteps(blocks, focus, quote, question, index.version).map(hit => ({...hit, use:'proof' as const}));
  if (direction === 'forward') return proof;
  const pivot = blocks.indexOf(focus);
  const ranked = rankPointerCandidates(blocks, focus.anchor, quote + ' ' + question, quote);
  const earlier = ranked.filter(hit => hit.index < pivot).slice(0, 2);
  const later = ranked.filter(hit => hit.index > pivot && !proof.some(p => p.target === blocks[hit.index])).slice(0, Math.max(0, 2 - proof.length));
  return [...proof, ...[...earlier, ...later].map(hit => {
    const target = blocks[hit.index], next = blocks[hit.index + 1];
    const neighbors = next?.page === target.page && /^Eq /u.test(next.label) ? [target,next] : [target];
    return { target, blocks:neighbors, use:hit.index < pivot ? 'condition' as const : 'expanded' as const };
  })];
}
