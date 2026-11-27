import { useState } from 'react';
import { t } from '../../i18n/locale';
import { NativeSelect } from '../NativeSelect';
import { MathMarkdown } from '../MathMarkdown';
import { CATEGORIES, GROUP_NAMES, blindBallots, comparisonGroups, gradeComplete, gradeKey, questionAt, trialKey, turnCount, uncachedInput, warmupGroups } from '../../domain/paper-experiment';
import type { Category, ExperimentRound, Grade, Group } from '../../domain/paper-experiment';

const ratingFields = { core: '核心命中', depth: '深度匹配', evidence: '坐标溯源' } as const;
type Ballot = ReturnType<typeof blindBallots>[number];

function BallotForm({ round, ballot, onGrade }: { round: ExperimentRound; ballot: Ballot; onGrade: (grade: Grade) => Promise<void> }) {
  const { item, group, key } = ballot;
  const [grade, setGrade] = useState<Grade>(round.grades[key] ?? { core: -1, depth: -1, evidence: -1 });
  const [saving, setSaving] = useState(false);
  return <section className="experiment-ballot">
    <div className="experiment-quote"><small>{item.category} · {t(CATEGORIES[item.category])} · [{item.anchor}]</small><blockquote>{item.quote}</blockquote></div>
    {Array.from({ length: turnCount(item) }, (_, i) => <section className="experiment-turn" key={i}>
      <h4>{t(i === 3 ? '新分支' : '第 {0} 轮', [i + 1])}</h4><p>{questionAt(item, i + 1)}</p>
      <MathMarkdown>{round.answers[trialKey(item, group, i + 1)].text}</MathMarkdown>
    </section>)}
    {round.revealed ? <p>{t('揭盲前评分')} · {grade.core} / {grade.depth} / {grade.evidence}</p> : <form onSubmit={async e => {
      e.preventDefault(); if (saving) return;
      setSaving(true);
      try { await onGrade(grade); } finally { setSaving(false); }
    }}>
      <fieldset><legend>{t('盲评打分')}</legend>
        <p className="experiment-hint">{t('核心命中看回答是否点破难点，深度匹配看是否照顾已有知识，坐标溯源看证据与作用域。')}</p>
        <div className="experiment-grades">{(Object.keys(ratingFields) as (keyof typeof ratingFields)[]).map(field =>
          <label key={field}>{t(ratingFields[field])}<NativeSelect required value={grade[field] < 0 ? '' : grade[field]} onChange={e => setGrade({ ...grade, [field]: e.target.value === '' ? -1 : Number(e.target.value) })}>
            <option value="">{t('待评分')}</option>{[0, 1, 2].map(n => <option value={n} key={n}>{n} · {t(['未达到', '部分达到', '达到'][n])}</option>)}
          </NativeSelect></label>)}</div>
        {item.category === 'C' && <div className="experiment-columns">{(['sameBranch', 'freshBranch'] as const).map(field =>
          <label key={field}>{t(field === 'sameBranch' ? '同分支纠错' : '新分支隔离')}<NativeSelect required value={grade[field] === undefined ? '' : String(grade[field])} onChange={e => setGrade({ ...grade, [field]: e.target.value === '' ? undefined : e.target.value === 'true' })}>
            <option value="">{t('待评分')}</option><option value="true">{t('通过')}</option><option value="false">{t('未通过')}</option>
          </NativeSelect></label>)}</div>}
        <label>{t('达到理解的追问轮数（可选）')}<input type="number" min="0" step="1" value={grade.followUps ?? ''} onChange={e => setGrade({ ...grade, followUps: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
      </fieldset>
      <footer><button className="experiment-primary" disabled={saving || !gradeComplete(item, grade)}>{t('保存评分并继续')}</button></footer>
    </form>}
  </section>;
}

export function Review({ round, onSave, onReveal }: { round: ExperimentRound; onSave: (round: ExperimentRound) => Promise<boolean>; onReveal: () => void }) {
  const all = blindBallots(round);
  const ballots = all.filter(b => !all.some(other => other.item.id === b.item.id && !other.complete));
  const [selected, choose] = useState('');
  const ballot = ballots.find(b => b.label === selected) ?? ballots.find(b => !round.grades[b.key]) ?? ballots[0];
  const graded = all.filter(b => gradeComplete(b.item, round.grades[b.key])).length;
  if (!ballot) return <p>{t('同一道题的各组回答收齐后，可在这里匿名评分。')}</p>;
  return <>
    <div className="experiment-line"><label>{t('匿名答卷')}<NativeSelect value={ballot.label} onChange={e => choose(e.target.value)}>
      {ballots.map(b => <option key={b.key} value={b.label}>{b.label} {round.grades[b.key] ? '✓' : ''}</option>)}
    </NativeSelect></label><span>{t('已评分 {0} / {1}', [graded, all.length])}</span>
    {!round.revealed && <button disabled={graded !== all.length} onClick={onReveal}>{t('揭盲并查看结果')}</button>}</div>
    <BallotForm key={ballot.key} round={round} ballot={ballot} onGrade={async grade => {
      const next = { ...round, grades: { ...round.grades, [ballot.key]: grade } };
      if (await onSave(next)) choose(ballots.find(b => !next.grades[b.key])?.label ?? ballot.label);
    }} />
  </>;
}

const average = (ns: readonly number[]) => ns.length ? ns.reduce((sum, n) => sum + n, 0) / ns.length : undefined;
const display = (n?: number, digits = 1) => n === undefined ? '—' : n.toFixed(digits);
export function Results({ round }: { round: ExperimentRound }) {
  const groups = comparisonGroups(round);
  const answers = (group: Group) => round.cases.flatMap(item =>
    Array.from({ length: turnCount(item) }, (_, i) => round.answers[trialKey(item, group, i + 1)]));
  const meanGrade = (category: Category, group: Group, field: keyof Pick<Grade, 'core' | 'depth' | 'evidence'>) =>
    average(round.cases.filter(item => item.category === category).map(item => round.grades[gradeKey(item, group)][field]));
  return <div className="experiment-results">
    <h3>{t('对照结果')}</h3><p>{round.connection?.model} · {round.cases.length} {t('题')} · {Object.keys(round.answers).length} {t('次请求')}</p>
    <div className="experiment-table"><table><caption>{t('各题型平均分 · 核心 / 深度 / 溯源（满分各 2 分）')}</caption>
      <thead><tr><th>{t('题型')}</th>{groups.map(g => <th key={g}>{g}<small>{t(GROUP_NAMES[g])}</small></th>)}</tr></thead>
      <tbody>{(Object.keys(CATEGORIES) as Category[]).map(category => <tr key={category}><th>{category} · {t(CATEGORIES[category])} ({round.cases.filter(item => item.category === category).length})</th>
        {groups.map(group => <td key={group}>{(['core', 'depth', 'evidence'] as const).map(f => display(meanGrade(category, group, f))).join(' / ')}</td>)}</tr>)}</tbody>
    </table></div>
    <div className="experiment-table"><table><caption>{t('实测用量与延迟')}</caption><thead><tr>
      {['组别', '平均首字 ms', '平均总耗时 ms', '输入 tokens', '输出 tokens', '缓存读取 tokens', '未缓存输入 tokens', '缓存写入 tokens', '纠错 / 隔离通过数', '平均追问轮数'].map(s => <th key={s}>{t(s)}</th>)}
    </tr></thead><tbody>{groups.map(group => {
      const rows = answers(group), cCases = round.cases.filter(item => item.category === 'C');
      const totals = (field: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'uncached') => {
        const values = rows.map(r => field === 'uncached' ? uncachedInput(r) : r[field]).filter((n): n is number => n !== undefined);
        return values.length ? `${values.reduce((a, b) => a + b, 0)} (${values.length}/${rows.length})` : '—';
      };
      return <tr key={group}><th>{group}</th><td>{display(average(rows.map(r => r.firstTextMs)), 0)}</td><td>{display(average(rows.map(r => r.elapsedMs)), 0)}</td>
        <td>{totals('inputTokens')}</td><td>{totals('outputTokens')}</td><td>{totals('cacheReadTokens')}</td><td>{totals('uncached')}</td><td>{totals('cacheWriteTokens')}</td>
        <td>{cCases.length ? (['sameBranch', 'freshBranch'] as const).map(f => `${cCases.filter(i => round.grades[gradeKey(i, group)][f]).length}/${cCases.length}`).join(' · ') : '—'}</td>
        <td>{display(average(round.cases.flatMap(item => round.grades[gradeKey(item, group)].followUps ?? [])))}</td></tr>;
    })}</tbody></table></div>
    <p className="experiment-hint">{t('括号表示服务商回报该用量的请求数 / 总请求数。横线表示无记录。')}</p>
    {round.preheat && <details><summary>{t('预热记录')}</summary><div className="experiment-table"><table>
      <thead><tr>{['题', '组别', '输入 tokens', '缓存读取 tokens', '未缓存输入 tokens', '缓存写入 tokens', '输出 tokens'].map(s => <th key={s}>{t(s)}</th>)}</tr></thead>
      <tbody>{round.cases.flatMap((item, i) => warmupGroups(round).map(group => {
        const key = trialKey(item, group, 1), receipt = round.warmups?.[key];
        return <tr key={key}><th>{i + 1}</th><td>{group}</td><td>{receipt?.inputTokens ?? '—'}</td><td>{receipt?.cacheReadTokens ?? '—'}</td>
          <td>{uncachedInput(receipt) ?? '—'}</td><td>{receipt?.cacheWriteTokens ?? '—'}</td><td>{receipt?.outputTokens ?? '—'}</td></tr>;
      }))}</tbody></table></div></details>}
    {groups.includes('G4') && <details><summary>{t('逐题定位与证明原文')}</summary>{round.cases.map((item,i) =>
      <section key={item.id}><h4>{i + 1}. {item.question}</h4>
        <table><thead><tr>{['组别','坐标溯源','首轮未缓存输入 tokens'].map(s => <th key={s}>{t(s)}</th>)}</tr></thead><tbody>
          {(['G1','G4'] as const).map(group => <tr key={group}><th>{group}</th><td>{round.grades[gradeKey(item,group)]?.evidence} / 2</td>
            <td>{uncachedInput(round.answers[trialKey(item,group,1)]) ?? '—'}</td></tr>)}</tbody></table>
        {round.proofEvidence?.[item.id]?.length ? round.proofEvidence[item.id].map(hit => <details key={hit.target}>
          <summary>{[hit.owner,hit.part,hit.target].filter(Boolean).join(' · ')}</summary>
          {hit.anchors.map(a => <p className="experiment-pre" key={a}>[{a}] {round.blocks.find(b => b.anchor === a)?.text}</p>)}</details>)
          : <p>{t('未找到符合条件的后文证明段。')}</p>}</section>)}</details>}
    <details><summary>{t('匿名编号与分组')}</summary>{round.cases.map((item, i) =>
      <p key={item.id}>{i + 1}. {item.question} · {item.blindOrder.map((group, slot) => String.fromCharCode(65 + slot) + ' = ' + group).join('　')}</p>)}</details>
  </div>;
}
