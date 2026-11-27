import { parseShadow, suggestPointers } from './experiment-material';
import { blindOrder, checkCase, comparisonGroups } from './paper-experiment';
import type { ExperimentCase, ExperimentRound } from './paper-experiment';

// Portable regression questions contain source and prompts only. Never import
// a proposed answer, target, manual pointer, grade, or provider configuration.
export function importProofQuestions(round: ExperimentRound, raw: string, pageCount: number): ExperimentRound {
  if (round.revealed || Object.keys(round.answers).length || Object.keys(round.warmups ?? {}).length) throw new Error('本轮已有请求记录。请复用题集开新一轮。');
  const data = JSON.parse(raw.replace(/^\uFEFF/u,''));
  if (data?.paper !== round.title || !Array.isArray(data.questions) || !data.questions.length)
    throw new Error('题集必须属于当前 PDF，且包含 questions 数组。');
  const blocks = data.shadow === undefined ? round.blocks : parseShadow(data.shadow, pageCount);
  if (round.cases.length && data.shadow !== undefined && JSON.stringify(blocks) !== JSON.stringify(round.blocks))
    throw new Error('已有题目的影子层与导入文件不同。');
  const cases = [...round.cases];
  const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/gu, '');
  for (const q of data.questions) {
    const { anchor, quote, question, category = 'A' } = q ?? {};
    if (typeof anchor !== 'string' || typeof quote !== 'string' || typeof question !== 'string' || !['A','B','E'].includes(category))
      throw new Error('回归题需要题型 A、B 或 E，以及 anchor、quote、question。');
    const focus = blocks.find(b => b.anchor === anchor);
    if (!focus || !normalize(focus.text).includes(normalize(quote))) throw new Error('题集的选文与原文坐标不匹配。');
    if (cases.some(c => c.anchor === anchor && c.quote === quote && c.question === question.trim())) continue;
    const item: ExperimentCase = { id: crypto.randomUUID(), category, anchor, quote, question: question.trim(),
      blindOrder: blindOrder(comparisonGroups(round)), pointerMode: 'auto', pointers: suggestPointers(blocks,anchor,quote+' '+question,quote),
      wiki: [], correction:'', falsified:'', followUp:'', fresh:'' };
    checkCase(item, blocks); cases.push(item);
  }
  return { ...round, blocks, cases, material: data.shadow === undefined ? round.material : '题集校订影子层', proofEvidence: undefined };
}
