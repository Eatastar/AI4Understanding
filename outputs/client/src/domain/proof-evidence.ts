import { firstForwardUses, rankPointerCandidates } from './experiment-material';
import type { PaperBlock } from './experiment-material';

export interface ProofEvidence {
  target: string;
  owner?: string;
  part?: string;
  anchors: string[];
}

const label = (b: PaperBlock) => b.anchor.split(' | ')[1] || '';
const statement = /^(lemma|theorem|thm|proposition|prop|corollary|claim|引理|定理|命题|推论)\.?\s*(\d+(?:\.\d+)*[a-z]?)/iu;
const proof = /^(?:proof\b|demonstration\b|证明|證明|\\begin\{proof\})/iu;
const partition = /^(?:case|subcase|情形|情况)\s*(?:\d+|[a-z]\b|[一二三四五六七八九十（(])/iu;
const boundary = /^(?:section|sec|appendix|definition|def|remark|example|第.{1,6}[章节]|附录|定义|例)\.?(?:\s+\S|$)/iu;
const equation = (b: PaperBlock) => /^(?:eq(?:uation)?\.?\s*[\d(]|式\s*\d)/iu.test(label(b)) ||
  /^\s*(?:\\\[|\\begin\{(?:align\*?|equation\*?|gather\*?)\}|\$\$)/u.test(b.text);
const statementKey = (m: RegExpMatchArray) => m[1].toLowerCase().replace(/^thm$/,'theorem').replace(/^prop$/,'proposition') + '/' + m[2].toLowerCase();

// Look up explicit "Proof of Lemma N" headings as well as proofs immediately
// following a statement. Page breaks alone do not end a proof or a case.
function proofScopes(blocks: readonly PaperBlock[]) {
  const owners = new Map<string, number>();
  const declarations = blocks.map(b => {
    const named = label(b).match(statement), inText = b.text.trimStart().match(statement);
    return named ?? (inText && /^[\s]*[.:(\[]/u.test(b.text.trimStart().slice(inText[0].length)) ? inText : null);
  });
  declarations.forEach((m,i) => { if (m) owners.set(statementKey(m),i); });
  let owner = -1, part = -1, inside = false, section = 0, bibliography = false;
  return blocks.map((b,i) => {
    const name = label(b), text = b.text.trimStart();
    const header = declarations[i];
    const caseStart = partition.test(name) || partition.test(text);
    const sectionBreak = boundary.test(name) || /^(?:(?:Definition|Remark|Example)\s+\d+(?:\.\d+)*[.:(]|#{1,4}\s)/iu.test(text);
    if (/^(?:references|bibliography|参考文献)\s*[:.]?$/iu.test(text) || /^(?:references|bibliography|参考文献)$/iu.test(name)) bibliography = true;
    if (/^(?:appendix|附录)\b/iu.test(name) || /^appendix\s+[A-Z]\b/u.test(text)) bibliography = false;
    if (header || sectionBreak) {
      owner = header ? i : -1; part = -1; inside = false; section++;
    }
    if (proof.test(text) || /^proof\b/iu.test(name)) {
      const referenced = text.replace(/^proof\s+of\s+(?:the\s+)?/iu,'').match(statement);
      if (referenced) owner = owners.get(statementKey(referenced)) ?? -1;
      inside = true; part = -1; section++;
    }
    if (caseStart) { part = i; section++; }
    const scope = { owner, part, section, inside, bibliography, header: !!header || sectionBreak || caseStart };
    if (/(?:\\end\{proof\}|\\qed(?:here)?|[∎□])\s*[.}]?\s*$/u.test(text)) {
      owner = part = -1; inside = false; section++;
    }
    return scope;
  });
}

export function retrieveProofEvidence(blocks: readonly PaperBlock[], anchor: string, quote: string, question: string): ProofEvidence[] {
  const focus = blocks.findIndex(b => b.anchor === anchor);
  if (focus < 0) return [];
  const scopes = proofScopes(blocks);
  const candidates = rankPointerCandidates(blocks, anchor, quote + ' ' + question, quote).filter(hit => {
    const s = scopes[hit.index];
    return hit.index > focus && !s.bibliography && !s.header &&
      (hit.use > 0 || (hit.explicit && (s.inside || s.owner >= 0)));
  });
  return firstForwardUses(candidates).map(hit => {
    const i = hit.index, scope = scopes[i];
    const indices = new Set([i, scope.owner, scope.part].filter(j => j >= 0));
    // Include contiguous displayed derivations on both sides of the author's
    // use sentence. Never walk into the next case, statement or proof.
    for (const direction of [-1, 1]) {
      let found = 0;
      for (let j = i + direction; j >= 0 && j < blocks.length && Math.abs(i-j) <= 6; j += direction) {
        if (scopes[j].section !== scope.section || scopes[j].header) break;
        if (equation(blocks[j])) {
          indices.add(j);
          if (++found === 4) break;
        } else if (!found && Math.abs(j-i) === 1 && (equation(blocks[i]) || blocks[j].text.length <= 160)) {
          indices.add(j);
        } else break;
      }
    }
    return { target: hit.anchor, owner: blocks[scope.owner]?.anchor, part: blocks[scope.part]?.anchor,
      anchors: [...indices].sort((a,b) => a-b).map(j => blocks[j].anchor) };
  });
}
