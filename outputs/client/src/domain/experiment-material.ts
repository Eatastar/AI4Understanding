import type { DocumentPage } from './types';
import { documentSearchTerms } from './document-context';
import { wikiText } from '../knowledge/wiki-document';
import type { WikiRecord } from '../knowledge/wiki-types';

export interface PaperBlock { anchor: string; page: number; text: string; start?: number }
export interface PaperSelection { page: number; quote: string; start?: number; end?: number; messageId?: string; versionId?: string }
export interface Pointer { anchor: string; confidence: 'explicit' | 'inferred' }
export interface WikiSlice { id: string; title: string; text: string; revision: number }

export function blocksFromPdf(pages: readonly DocumentPage[]): PaperBlock[] {
  return pages.flatMap(({ pageNumber: page, text }) => {
    let start = 0;
    const blocks: PaperBlock[] = [];
    for (const paragraph of text.split(/\n[ \t]*\n+/)) {
      const body = paragraph.trim();
      if (!body) continue;
      start = text.indexOf(body, start);
      blocks.push({ anchor: `P${String(page).padStart(2, '0')} | ¶${blocks.length + 1}`, page, text: body, start });
      start += body.length;
    }
    return blocks;
  });
}

export const shadowText = (blocks: readonly PaperBlock[]) =>
  blocks.map(block => `[${block.anchor}] ${block.text}`).join('\n\n');

export function parseShadow(text: string, pageCount: number): PaperBlock[] {
  const blocks: PaperBlock[] = [];
  const anchors = new Set<string>();
  let current: PaperBlock | undefined;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const tag = /^\s*\[P(\d+)\s*\|\s*([^\]\r\n]+)\]\s*(.*)$/u.exec(line);
    if (!tag) {
      if (current) current.text += '\n' + line;
      else if (line.trim()) throw new Error('请在每段原文前加上页码与坐标，例如 [P04 | Def 2.1]。');
      continue;
    }
    const page = Number(tag[1]), label = tag[2].trim();
    if (!label || page < (current?.page ?? 1) || page > pageCount) throw new Error('影子层页码须按 PDF 实际页序排列，坐标名称不能为空。');
    const anchor = `P${String(page).padStart(2, '0')} | ${label}`;
    if (anchors.has(anchor)) throw new Error(`重复的原文坐标 [${anchor}]`);
    current = { anchor, page, text: tag[3] };
    blocks.push(current);
    anchors.add(anchor);
  }
  for (const block of blocks) {
    block.text = block.text.trim();
    if (!block.text) throw new Error(`原文坐标 [${block.anchor}] 缺少正文`);
  }
  if (!blocks.length) throw new Error('请添加至少一段带坐标的原文。');
  return blocks;
}

const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '');

export function locateSelection(blocks: readonly PaperBlock[], selection: PaperSelection) {
  const page = blocks.filter(block => block.page === selection.page);
  const quote = normalized(selection.quote);
  if (!quote) return undefined;
  if (selection.start !== undefined) {
    for (const block of page) {
      if (block.start === undefined) continue;
      const offset = selection.start - block.start;
      if (offset >= 0 && block.text.startsWith(selection.quote, offset)) return block.anchor;
    }
  }
  const matches = page.filter(block => normalized(block.text).includes(quote));
  return matches.length === 1 ? matches[0].anchor : undefined;
}

export function splitWiki(records: readonly WikiRecord[]): WikiSlice[] {
  const slices: WikiSlice[] = [];
  for (const { page } of records) {
    let heading = '', section = '', parts: string[] = [];
    const add = (key: string, label: string, text: string) => {
      if (text.trim()) slices.push({ id: page.id + '/' + key, title: [page.title, label].filter(Boolean).join(' / '), text: text.trim(), revision: page.revision });
    };
    const flush = () => { if (parts.length) add(section, heading, parts.join('\n')); parts = []; };
    (page.body.content ?? []).forEach((node, index) => {
      const text = wikiText(node), key = String(node.attrs?.blockId || index);
      if (node.type === 'heading') { flush(); heading = text; section = key; }
      else if (section) { if (text) parts.push(text); }
      else add(key, '', text);
    });
    flush();
    if (page.personalUnderstanding) add('personal', '个人理解', page.personalUnderstanding);
  }
  return slices;
}

function matches(query: string, contents: readonly string[]) {
  const wanted = new Set(documentSearchTerms(query));
  const terms = contents.map(content => new Set(documentSearchTerms(content)));
  const counts = new Map<string, number>();
  for (const words of terms) for (const word of words) {
    if (wanted.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return terms.map(words => {
    let score = 0;
    for (const word of wanted) {
      if (!words.has(word)) continue;
      const frequency = counts.get(word)!;
      if (frequency === contents.length && contents.length > 1) continue;
      score += Math.log2(1 + contents.length / frequency);
    }
    return score;
  });
}

function cites(source: string, target: PaperBlock) {
  if (source.includes('[' + target.anchor + ']')) return true;
  for (const label of target.text.matchAll(/\\label\{([^}]+)\}/g)) {
    for (const ref of source.matchAll(/\\(?:eqref|ref|cref|Cref|autoref)\{([^}]+)\}/g)) {
      if (ref[1].split(',').some(key => key.trim() === label[1])) return true;
    }
  }
  const label = target.anchor.split(' | ')[1];
  const citation = /^(Def(?:inition)?|Eq(?:uation)?|Lemma|Th(?:eore)?m|Prop(?:osition)?|Fig(?:ure)?|Sec(?:tion)?)\.?\s*([\d]+(?:\.[\d]+)*)$/i.exec(label);
  if (!citation) return false;
  const stem = citation[1].toLowerCase();
  const names = stem.startsWith('def') ? 'def(?:inition)?' : stem.startsWith('eq') ? 'eq(?:uation)?' :
    stem.startsWith('th') ? 'th(?:eore)?m' : stem.startsWith('prop') ? 'prop(?:osition)?' :
    stem.startsWith('sec') ? 'sec(?:tion)?' : stem.startsWith('fig') ? 'fig(?:ure)?' : 'lemma';
  const number = citation[2].replaceAll('.', '\\.');
  return new RegExp(`\\b(?:${names})\\.?\\s*\\(?${number}(?![\\d.]\\d|\\d)\\)?`, 'i').test(source);
}

const searchableProse = (s: string) => s.normalize('NFKC').toLowerCase()
  .replace(/\\(?:emph|text(?:bf|it|rm)?|operatorname)\{([^{}]+)\}/gu, '$1')
  .replace(/[‐‑‒–—]/gu, '-').replace(/\s+/gu, ' ').trim();

// Score language attached to the selected concept. A proof elsewhere in the
// paragraph, or a heading that merely names the concept, is weaker evidence.
function useOfConcept(text: string, terms: readonly string[]): number {
  let best = 0;
  for (const term of terms) {
    for (let start = text.indexOf(term); start >= 0; start = text.indexOf(term, start + term.length)) {
      const end = start + term.length;
      // A short name must not match the start or end of a different Latin word.
      if (/[a-z0-9]/i.test(term[0]) && /[a-z0-9]/i.test(text.charAt(start - 1)) ||
          /[a-z0-9]/i.test(term.at(-1)!) && /[a-z0-9]/i.test(text.charAt(end))) continue;
      const before = text.slice(Math.max(0, start - 120), start).split(/[.;!?。；！？]/u).at(-1)!;
      const after = text.slice(end, end + 100).split(/[.;!?。；！？]/u)[0];
      if (/^\s*[,，:]?\s*(?:in|for|gives?|yields?|justifies?)\s+(?:the |this )?(?:\w+[- ]){0,3}(?:equality|inequality|identity|bound|step)\b/u.test(after) ||
          /^(?:条件|性质)?[，、\s]*(?:得到|可得|推出|代入|用于|保证)/u.test(after)) return 2;
      if (/\b(?:by|using|used|appl(?:y|ied|ying)|follows? from|by virtue of)\b[^,;:]{0,95}$/u.test(before) ||
          /(?:利用|根据|应用|代入|由)[^，。；：]{0,32}$/u.test(before)) best = 1;
    }
  }
  return best;
}

export function rankPointerCandidates(blocks: readonly PaperBlock[], anchor: string, query: string, quote = '') {
  const index = blocks.findIndex(block => block.anchor === anchor);
  if (index < 0) return [];
  const focus = blocks[index];
  const scores = matches(query, blocks.map(block => block.text));
  const focusText = searchableProse(focus.text);
  const heading = /^(?:definition|def|lemma|theorem|proposition)\.?\s*[\d.]+\s*[\[(]([^\]\)\n]{2,100})[\])]/iu.exec(focusText)?.[1];
  const names = [...new Set([searchableProse(quote || query), heading ?? ''])].filter(name =>
    name.length >= 2 && name.length <= 120 && documentSearchTerms(name).length > 0 && focusText.includes(name));
  return blocks.flatMap((block, i) => {
    if (i === index) return [];
    const explicit = i < index ? cites(focus.text, block) : cites(block.text, focus);
    const use = i > index && names.length ? useOfConcept(searchableProse(block.text), names) : 0;
    if (!explicit && !use && scores[i] < 2) return [];
    return [{ index: i, score: scores[i], explicit, use, anchor: block.anchor, page: block.page }];
  }).sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.use - a.use || b.score - a.score || a.index - b.index);
}

type Candidate = ReturnType<typeof rankPointerCandidates>[number];
export function firstForwardUses(forward: Candidate[]) {
  const [first, second] = forward;
  // Among equally supported uses, cover a distinct page before repeating a location.
  const otherPage = second && forward.find(item => item.page !== first.page &&
    item.explicit === second.explicit && item.use === second.use && item.score === second.score);
  return [...forward.slice(0, 1), ...(second ? [otherPage ?? second] : [])];
}

export function suggestPointers(blocks: readonly PaperBlock[], anchor: string, query: string, quote = ''): Pointer[] {
  const index = blocks.findIndex(block => block.anchor === anchor);
  const candidates = rankPointerCandidates(blocks, anchor, query, quote);
  return [...candidates.filter(item => item.index < index).slice(0, 2), ...firstForwardUses(candidates.filter(item => item.index > index))]
    .map(item => ({ anchor: item.anchor, confidence: item.explicit ? 'explicit' : 'inferred' }));
}

export function suggestWiki(slices: readonly WikiSlice[], query: string): WikiSlice[] {
  const scores = matches(query, slices.map(item => item.title + ' ' + item.text));
  return slices.map((slice, index) => ({ slice, score: scores[index] })).filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score).slice(0, 2).map(item => item.slice);
}
