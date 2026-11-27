import { BoundedCache } from './bounded-cache';
import { retrieveProofEvidence } from './proof-evidence';
import type { SourceBlock } from './reader-evidence';
import { maxProofStepLength, type ProofStepRange } from './reader-report';
type Line = { block: number; start: number; end: number; owner: number; ownerName: string; part: number; inside: boolean };
export interface ReaderEvidence { target: SourceBlock; blocks: SourceBlock[]; step?: ProofStepRange }

const statement = /(?:\b(theorem|thm|lemma|proposition|prop|corollary|claim)\b\.?|(定理|引理|命题|推论|命題|推論))\s*([0-9]+(?:\.[0-9]+)*[a-z]?)/iu;
const kinds: Record<string,string> = { thm:'theorem',定理:'theorem',引理:'lemma',prop:'proposition',命题:'proposition',命題:'proposition',推论:'corollary',推論:'corollary' };
function statementId(text: string) {
  const match = statement.exec(text);
  if (!match) return '';
  const name = (match[1] || match[2]).toLowerCase();
  return (kinds[name] ?? name)+' '+match[3].toLowerCase();
}
const clean = (s: string) => s.normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[‐‑–−]/gu,'-').replace(/\s+/gu,' ').trim();
const stop = new Set('this that which then there here from into with that only using used where such which an and any are for has its let one our the for two all have function defined define definition holds proof step condition quantity theorem lemma proposition inequality equality property satisfies follows consider suppose given over value we'.split(' '));
function terms(s: string) {
  return [...new Set((clean(s).match(/[a-z]{3,}(?:-[a-z0-9]+)*|[\p{Script=Han}]{2,8}/gu) ?? []).filter(w=>!stop.has(w)))];
}
const useCue = /\b(?:by|using|uses?|used|applying|applied|since|follows? from|gives?|yields?|hence|therefore|implies|according to|recall|from which)\b|(?:由|代入|利用|根据|从而)/iu;
const mathCue = /[=≤≥∈∑∫√‖〈〈]|\\(?:leq|geq|sum|frac|int|norm)\b/u;
const linkCue = /\b(?:equality|inequality|substitut\w*|identity|bound|step)\b|等[式号]|不等式/iu;
// These operations only break ties between steps that independently matched
// the selection. A common operation alone provides no evidence of a use.
const operations = [
  /归纳|递推|induct\w*|recurr\w*/iu, /范数|norm|‖/iu, /期望|expect\w*|\bE[\[({]/iu,
  /求和|加权|sum\b|weighted|[∑Σ]/iu, /积分|integral|∫/iu,
  /内积|inner product|[〈〈]/iu, /界|不等式|bound|inequalit\w*|[≤≥]/iu,
  /概率|分布|probabilit\w*|distribution/iu, /等号|等式|equalit\w*|identity/iu,
];
const proofStart = /^(?:proof\b|demonstration\b|证明|證明|\\begin\{proof\})/iu;
const sectionEnd = /^(?:references|bibliography|参考文献)\s*[.:：]?$/iu;
const heading = /^(?:(?:theorem|thm|lemma|proposition|prop|corollary|claim)\.?\s*|定理\s*|引理\s*|命题\s*|推论\s*)\d+(?:\.\d+)*[a-z]?(?:\s*[.:(（：]|\s+(?:let|given|assume|suppose|if|for|we|consider|under)\b|$)/iu;
const linesCache = new BoundedCache<string,Line[]>(6*1024*1024,3);
function proofLines(blocks: readonly SourceBlock[], version: string) {
  const cached=linesCache.get(version);
  if (cached) return cached;
  const lines: Line[]=[], owners=new Map<string,number>();
  let owner=-1, ownerName='', part=-1, inside=false, bibliography=false;
  for (const [i,b] of blocks.entries()) {
    if (b.label==='Appendix') bibliography=false;
    if (/^(?:Sec |Appendix|Def |References)/u.test(b.label)) { owner=-1; ownerName=''; part=-1; inside=false; }
    for (const m of b.text.matchAll(/[^\r\n]+/gu)) {
      const text=m[0].trim();
      if (!text) continue;
      if (sectionEnd.test(text)) bibliography=true;
      if (/^(?:[\d.]+\s+)?(?:appendix\b|附录)/iu.test(text)) bibliography=false;
      if (bibliography) continue;
      if (heading.test(text)) { owner=i; ownerName=statementId(text); part=-1; inside=false; owners.set(ownerName,i); continue; }
      const continued = /[-‐]\s*$/u.test(text) ? text.slice(0,-1)+b.text.slice(m.index+m[0].length).trimStart().split('\n',1)[0] : text;
      const proofOf=/(?:proof\s+of|to\s+prove|prove|proving)\s+(?:of\s+|the\s+)?((?:theorem|lemma|proposition|corollary|claim)\s+\d+(?:\.\d+)*)/iu.exec(continued);
      if (proofOf) { ownerName=statementId(proofOf[1]); owner=owners.get(ownerName) ?? -1; part=-1; inside=true; }
      if (proofStart.test(text)) inside=true;
      if (/^(?:case|subcase|情形)\s*[\dA-Z一二三]/iu.test(text)) part=i;
      if (inside || owner>=0) lines.push({block:i,start:m.index+m[0].indexOf(text),end:m.index+m[0].indexOf(text)+text.length,owner,ownerName,part,inside});
      if (/[∎□⊓]\s*$/u.test(text) || /\\end\{proof\}/u.test(text)) { owner=-1; ownerName=''; part=-1; inside=false; }
    }
  }
  linesCache.set(version,lines,lines.length*96);
  return lines;
}

function symbols(text: string) {
  const compact=clean(text).replace(/\s+/gu,'');
  // Indexed quantities, norms and parameterized Greek symbols are more
  // discriminating than a single variable or common arithmetic operator.
  return [...new Set(compact.match(/[a-z]\d+:[a-z0-9]+(?:,[a-z])?|[α-ω](?:\([a-z]\)|[a-z][0-9]?|\d+)|‖[a-z][^‖]{0,10}‖/gu) ?? [])];
}
function lineRange(block: SourceBlock, start: number, end: number, matchAt: number): ProofStepRange {
  if (end-start>maxProofStepLength) {
    start=Math.max(start,Math.min(end-maxProofStepLength,start+matchAt-55));
    end=start+maxProofStepLength;
  }
  // A PDF may put the two sides of an equality or a formula's indices on
  // separate physical lines. Include adjacent fragments of that same step.
  for (let i=0;i<4 && end<block.text.length;i++) {
    const next=block.text.indexOf('\n',end+1);
    const stopAt=next<0?block.text.length:next;
    const continuation=block.text.slice(end,stopAt).trim();
    if (!continuation || stopAt-start>maxProofStepLength || /^[A-Z][a-z]{2,}\b/u.test(continuation)) break;
    end=stopAt;
  }
  if (/[\udc00-\udfff]/u.test(block.text.charAt(start))) start++;
  if (/[\ud800-\udbff]/u.test(block.text.charAt(end-1))) end--;
  return {start:block.start+start,end:block.start+end};
}

export function readerProofSteps(blocks: readonly SourceBlock[], focus: SourceBlock, quote: string, question: string, version: string): ReaderEvidence[] {
  const first=blocks.indexOf(focus), legacy=retrieveProofEvidence(blocks,focus.anchor,quote,question);
  const old=new Map(legacy.map(h=>[h.target,h]));
  const byAnchor=new Map(blocks.map(b=>[b.anchor,b]));
  const named=statementId(question), wantedOwner=named!==statementId(focus.label)?named:'';
  const wantedOperations=operations.filter(op=>op.test(question));
  const name=clean(quote), words=terms(quote);
  const at=focus.text.indexOf(quote);
  const definition=at<0 ? quote : focus.text.slice(Math.max(0,at-60),at+quote.length+120);
  const next=blocks[first+1];
  const formula=next?.page===focus.page && /^Eq /u.test(next.label) ? next : undefined;
  const explicit=/^(Def|Lemma|Theorem|Proposition|Eq) (\d+(?:\.\d+)*)$/u.exec(focus.label);
  const stem=explicit && (explicit[1]==='Def'?'def(?:inition)?':explicit[1]==='Eq'?'eq(?:uation)?':explicit[1]);
  const reference=explicit ? new RegExp('\\b'+stem+'\\.?\\s*\\(?'+explicit[2].replaceAll('.','\\.')+'(?!\\d|\\.\\d)','iu') : null;
  const eqs=[focus,formula].flatMap(b=>b?.label.match(/^Eq (\d+(?:\.\d+)*)$/u)?.[1] ?? []);
  const directSymbols=symbols(quote), nearbySymbols=symbols(definition+' '+(formula?.text.slice(0,100)??''));
  const scored=new Map<number,{line:Line;score:number;at:number}>();
  for (const line of proofLines(blocks,version)) {
    if (line.block<=first) continue;
    const block=blocks[line.block], legacyHit=old.get(block.anchor);
    if (wantedOwner && line.ownerName!==wantedOwner) continue;
    const raw=block.text.slice(line.start,line.end), value=clean(raw), compact=value.replace(/\s+/gu,'');
    const exact=name.length>2 && value.includes(name), explicitHit=reference?.test(raw);
    const equation=eqs.some(n=>value.includes('('+n+')') && !value.endsWith('('+n+')'));
    const lexical=words.filter(w=>value.includes(w)).length;
    const direct=directSymbols.find(s=>compact.includes(s)), nearby=nearbySymbols.find(s=>compact.includes(s));
    const cue=useCue.test(raw), math=mathCue.test(raw);
    const namedUse=(exact && words.length>0 || lexical>=2 && lexical/words.length>=.66) && (cue || linkCue.test(raw));
    const symbolic=math && (direct || (wantedOwner && nearby));
    if (!explicitHit && !equation && !namedUse && !symbolic) continue;
    if (!line.inside && !(legacyHit && cue)) continue;
    const operationScore=Math.min(3,wantedOperations.filter(op=>op.test(raw)).length);
    const score=(explicitHit?12:0)+(equation?10:0)+(namedUse?8:0)+(exact?3:0)+(direct?6:nearby?2:0)
      +(cue?3:0)+(linkCue.test(raw)?2:0)+(line.inside?2:0)+(legacyHit?2:0)+Math.min(lexical,3)+operationScore;
    const previous=scored.get(line.block);
    if (!previous || score>previous.score) {
      const hint=exact?value.indexOf(name):explicitHit?raw.search(reference!):Math.max(0,raw.search(mathCue));
      scored.set(line.block,{line,score,at:hint});
    }
  }
  const results: ReaderEvidence[]=[];
  for (const {line,at:hint} of [...scored.values()].sort((a,b)=>b.score-a.score || a.line.block-b.line.block).slice(0,2)) {
    const target=blocks[line.block], previous=old.get(target.anchor);
    const context=new Set<SourceBlock>(previous?.anchors.flatMap(a=>byAnchor.get(a)??[])??[]);
    if (line.owner>=0) context.add(blocks[line.owner]);
    if (line.part>=0) context.add(blocks[line.part]);
    context.add(target);
    for (const neighbor of [blocks[line.block-1],blocks[line.block+1]]) {
      if (neighbor?.page===target.page && /^Eq /u.test(neighbor.label)) context.add(neighbor);
    }
    results.push({target,blocks:[...context],step:lineRange(target,line.start,line.end,hint)});
  }
  if (!wantedOwner) for (const hit of legacy) {
    if (results.length>=2) break;
    const target=byAnchor.get(hit.target);
    if (target && !results.some(r=>r.target===target)) results.push({target,blocks:hit.anchors.map(a=>byAnchor.get(a)!)});
  }
  return results;
}
