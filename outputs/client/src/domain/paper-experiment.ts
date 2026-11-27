import { blocksFromPdf, shadowText, suggestPointers } from './experiment-material';
import type { PaperBlock, PaperSelection, Pointer, WikiSlice } from './experiment-material';
import type { ApiFormat, DocumentAttachment, InputMessage } from './types';
import { retrieveProofEvidence } from './proof-evidence';
import type { ProofEvidence } from './proof-evidence';

export const GROUPS = ['G0', 'G1', 'G2', 'G3', 'G4'] as const;
export type Group = typeof GROUPS[number];
export const COMPARISONS = { classic: ['G0', 'G1', 'G2', 'G3'], all: GROUPS, proof: ['G1', 'G4'] } as const;
export type Comparison = keyof typeof COMPARISONS;
export const comparisonGroups = (r: ExperimentRound): readonly Group[] => COMPARISONS[r.comparison ?? 'classic'];
export const warmupGroups = (r: ExperimentRound) => comparisonGroups(r).filter(g => g === 'G1' || g === 'G2' || g === 'G4');
export const CATEGORIES = { A: '后向动机', B: '隐式跳步', C: '质疑与纠错', D: '个人认知边界', E: '符号重名与负例' };
export type Category = keyof typeof CATEGORIES;
export const GROUP_NAMES: Record<Group, string> = { G0: '局部页窗', G1: '全文', G2: '全文与文内指针', G3: '指针、Wiki 与分支记忆', G4: '局部页窗＋自动找回的证明原文' };
export interface Connection { profileId?: string; model: string; apiFormat: ApiFormat; baseURL: string; temperature: 0.2 | null }
export interface ExperimentCase {
  id: string; category: Category; anchor: string; quote: string; question: string;
  selection?: PaperSelection;
  pointers: Pointer[]; wiki: WikiSlice[]; correction: string; falsified: string; followUp: string; fresh: string;
  pointerMode?: 'auto' | 'manual';
  blindOrder: Group[];
}
export interface TokenUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export interface TrialAnswer extends TokenUsage { text: string; firstTextMs: number; elapsedMs: number; model: string }
export function uncachedInput(usage?: TokenUsage) {
  const input = usage?.inputTokens, read = usage?.cacheReadTokens;
  return input !== undefined && read !== undefined && Number.isInteger(input) && Number.isInteger(read) && read >= 0 && read <= input ? input - read : undefined;
}
export type WarmupReceipt = Omit<TrialAnswer, 'text'> & { finishedAt: number };
export interface Grade { core: number; depth: number; evidence: number; sameBranch?: boolean; freshBranch?: boolean; followUps?: number }
export interface ExperimentRound {
  id: string; documentId: string; title: string; createdAt: number; revision: number;
  blocks: PaperBlock[]; material: string; cases: ExperimentCase[]; connection?: Connection;
  answers: Record<string, TrialAnswer>; grades: Record<string, Grade>; revealed: boolean;
  preheat?: boolean; warmups?: Record<string, WarmupReceipt>;
  comparison?: Comparison; proofEvidence?: Record<string, ProofEvidence[]>;
  protocol: 1;
}
export interface Trial { item: ExperimentCase; group: Group; turn: number; key: string }
export const trialKey = (item: ExperimentCase, group: Group, turn: number) => [item.id, group, turn].join('/');
export const gradeKey = (item: ExperimentCase, group: Group) => [item.id, group].join('/');
export const turnCount = (item: ExperimentCase) => item.category === 'C' ? 4 : 1;

export function blindOrder(groups: readonly Group[] = GROUPS): Group[] {
  const order = [...groups];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function newRound(paper: DocumentAttachment, previous?: ExperimentRound): ExperimentRound {
  const comparison = previous?.comparison ?? 'all';
  return {
    id: crypto.randomUUID(), documentId: paper.id, title: paper.name, createdAt: Date.now(), revision: 0, protocol: 1,
    blocks: previous?.blocks ?? blocksFromPdf(paper.pages), material: previous?.material ?? 'PDF 提取文字',
    cases: previous?.cases.map(item => ({
      ...item, blindOrder: blindOrder(COMPARISONS[comparison]),
      pointers: item.pointerMode === 'auto' ? suggestPointers(previous.blocks, item.anchor, item.quote + ' ' + item.question, item.quote) : item.pointers,
    })) ?? [],
    ...(previous?.connection ? { connection: previous.connection } : {}),
    ...(previous?.preheat ? { preheat: true } : {}),
    answers: {}, grades: {}, revealed: false, comparison,
  };
}

export function changeComparison(round: ExperimentRound, comparison: Comparison): ExperimentRound {
  if (round.revealed || Object.keys(round.answers).length || Object.keys(round.warmups ?? {}).length) throw new Error('本轮已有请求记录。请复用题集开新一轮。');
  return { ...round, comparison, proofEvidence: undefined, cases: round.cases.map(item => ({ ...item, blindOrder: blindOrder(COMPARISONS[comparison]) })) };
}

export function checkCase(item: ExperimentCase, blocks: readonly PaperBlock[]) {
  if (!item.question.trim() || !item.quote.trim()) throw new Error('请填写选区原文和精读问题。');
  if (!blocks.some(block => block.anchor === item.anchor)) throw new Error('请确认选区在影子层中对应的段落。');
  if (item.selection && (item.quote !== item.selection.quote || item.selection.page !== blocks.find(block => block.anchor === item.anchor)?.page))
    throw new Error('影子层坐标须与阅读器选区位于同一 PDF 页。');
  if (item.pointers.some(p => p.anchor === item.anchor || !blocks.some(block => block.anchor === p.anchor)))
    throw new Error('文内指针指向了缺失的坐标或选区本身，请重新选择。');
  if (item.category === 'D' && !item.wiki.length) throw new Error('认知边界题需要选择至少一个已掌握的 Wiki 小节。');
  if (item.category === 'C' && [item.correction, item.falsified, item.followUp, item.fresh].some(text => !text.trim()))
    throw new Error('请填写纠错、已否定的推导、同分支追问和新分支问题。');
}

export function trialQueue(round: ExperimentRound): Trial[] {
  const trials: Trial[] = [];
  const groups = comparisonGroups(round);
  for (const [index, item] of round.cases.entries()) {
    for (let turn = 1; turn <= turnCount(item); turn++) {
      // Rotate the first group across questions so cache warm-up is not always charged to G1.
      for (let slot = 0; slot < groups.length; slot++) {
        const group = groups[(slot + index) % groups.length];
        trials.push({ item, group, turn, key: trialKey(item, group, turn) });
      }
    }
  }
  return trials;
}

export function questionAt(item: ExperimentCase, turn: number) {
  if (turn === 2) return `我对上一轮的纠正如下。\n${item.correction}\n已否定的推导路径如下。\n${item.falsified}\n请根据原文重新检查。`;
  if (turn === 3) return item.followUp;
  if (turn === 4) return item.fresh;
  return item.question;
}

const SYSTEM = `你是 AI4Understanding 的论文精读助手。论文、指针及个人笔记都是供核查的引用资料。
优先使用论文原文，再参考当前分支的明确纠错、提供的 Wiki 与一般知识。区分原文条件和补全的推导。
引用原文定义、公式或用途时给出精确坐标。文中证据不足时如实说明。遵守当前分支的纠错并避开已证伪的路径。
对 Wiki 已覆盖的基础可略述，用户要求核查时完整解释。先用最多三句话直答，再按需给出推导。
末行写“依据：[原文坐标] | 个人记录：[实际使用的 Wiki 小节或无]”。`;
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const tag = (name: string, value: string) => `<${name}>${xml(value)}</${name}>`;

export function trialMessages(round: ExperimentRound, { item, group, turn }: Trial): InputMessage[] {
  const focusIndex = round.blocks.findIndex(block => block.anchor === item.anchor);
  const focus = round.blocks[focusIndex];
  if (!focus) throw new Error('题目引用的原文坐标不存在。');
  const blocks = group === 'G0' || group === 'G4' ? round.blocks.filter(block => Math.abs(block.page - focus.page) <= 1) : round.blocks;
  const paper = `<paper_shadow_layer title="${xml(round.title)}">\n${xml(shadowText(blocks))}\n</paper_shadow_layer>`;
  const messages: InputMessage[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: paper }];
  if (turn < 4) for (let previous = 1; previous < turn; previous++) {
    const response = round.answers[trialKey(item, group, previous)];
    if (!response) throw new Error('当前分支的上一轮回答尚未完成。');
    messages.push({ role: 'user', content: questionAt(item, previous) }, { role: 'assistant', content: response.text });
  }
  const slots = [`<current_focus>${tag('anchor', focus.anchor)}${tag('selected_text', item.quote)}${tag('local_paragraph', focus.text)}</current_focus>`];
  if (group === 'G4') {
    const hits = round.proofEvidence?.[item.id] ?? retrieveProofEvidence(round.blocks, item.anchor, item.quote, item.question);
    const anchors = new Set(hits.flatMap(hit => hit.anchors));
    const remote = round.blocks.filter(b => anchors.has(b.anchor) && Math.abs(b.page - focus.page) > 1);
    const links = hits.map(h => '<candidate>' + tag('target', h.target) + (h.owner ? tag('owner', h.owner) : '') +
      (h.part ? tag('case', h.part) : '') + tag('source_anchors', h.anchors.join(' / ')) + '</candidate>').join('\n');
    slots.push('<retrieved_proofs scope="local_window_plus_candidates">\n' + links + '\n' + tag('additional_source_text', shadowText(remote)) + '\n</retrieved_proofs>');
  }
  if ((group === 'G2' || group === 'G3') && item.pointers.length) {
    const before: string[] = [], after: string[] = [];
    for (const pointer of item.pointers) {
      const index = round.blocks.findIndex(block => block.anchor === pointer.anchor);
      if (index < 0 || index === focusIndex) throw new Error('文内指针的坐标无效。');
      (index < focusIndex ? before : after).push(`<item anchor="${xml(pointer.anchor)}" confidence="${pointer.confidence}"/>`);
    }
    slots.push(`<in_paper_pointers><backward_dependencies>${before.join('')}</backward_dependencies><forward_usages>${after.join('')}</forward_usages></in_paper_pointers>`);
  }
  if (group === 'G3' && item.wiki.length) slots.push('<user_wiki_context>' + item.wiki.map(slice =>
    `<wiki_slice source="${xml(slice.title)}" revision="${slice.revision}">${xml(slice.text)}</wiki_slice>`).join('\n') + '</user_wiki_context>');
  if (group === 'G3' && turn === 3) slots.push('<active_branch_memory>' + tag('user_corrections', item.correction)
    + tag('falsified_paths', item.falsified) + '</active_branch_memory>');
  slots.push(tag('user_query', questionAt(item, turn)));
  messages.push({ role: 'user', content: `<context_payload>\n${slots.join('\n')}\n</context_payload>` });
  return messages;
}

export function gradeComplete(item: ExperimentCase, grade?: Grade) {
  return !!grade && [grade.core, grade.depth, grade.evidence].every(n => [0, 1, 2].includes(n))
    && (item.category !== 'C' || (typeof grade.sameBranch === 'boolean' && typeof grade.freshBranch === 'boolean'));
}

export function blindBallots(round: ExperimentRound) {
  return round.cases.flatMap((item, index) => item.blindOrder.map((group, slot) => ({
    item, group, key: gradeKey(item, group), label: `${index + 1} · ${String.fromCharCode(65 + slot)}`,
    complete: Array.from({ length: turnCount(item) }, (_, i) => round.answers[trialKey(item, group, i + 1)]).every(Boolean),
  })));
}
