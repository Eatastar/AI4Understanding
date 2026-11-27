import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import { desktop } from '../../adapters/desktop';
import { downloadJson } from '../../adapters/download';
import { loadPaperRounds, probeExperimentConnection, runPaperRound, saveRound } from '../../adapters/paper-experiment';
import type { DocumentAttachment, ModelSettings } from '../../domain/types';
import { CATEGORIES, GROUP_NAMES, blindBallots, changeComparison, checkCase, comparisonGroups, newRound, questionAt, trialKey, trialQueue, turnCount, warmupGroups } from '../../domain/paper-experiment';
import type { Comparison, Connection, ExperimentCase, ExperimentRound } from '../../domain/paper-experiment';
import { importProofQuestions } from '../../domain/proof-question-set';
import { parseShadow, shadowText, splitWiki } from '../../domain/experiment-material';
import type { PaperSelection, WikiSlice } from '../../domain/experiment-material';
import { t } from '../../i18n/locale';
import { NativeSelect } from '../NativeSelect';
import { CaseEditor } from './CaseEditor';
import { Results, Review } from './Review';
import './experiment.css';

interface Props {
  source: DocumentAttachment; settings: ModelSettings; page: number; selection?: PaperSelection;
  onClose: () => void; onOpenModels?: () => void;
}
type Tab = 'cases' | 'run' | 'review' | 'results';
const tabLabels: Record<Tab, string> = { cases: '题集与原文', run: '运行对照', review: '匿名盲评', results: '实验结果' };
const comparisons: Record<Comparison, string> = { all: '五组 G0–G4', proof: '全文与证明原文 G1 / G4', classic: '原四组 G0–G3' };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function MaterialEditor({ round, pages, onSave, onCancel }: { round: ExperimentRound; pages: number; onSave: (round: ExperimentRound) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(() => shadowText(round.blocks)), [name, setName] = useState('校订影子层'), [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  async function apply() {
    try {
      const blocks = parseShadow(text, pages);
      for (const item of round.cases) checkCase(item, blocks);
      if (await onSave({ ...round, blocks, material: name })) onCancel();
    } catch (err) { setError(errorMessage(err)); }
  }
  return <section className="experiment-editor"><h3>{t('校订论文影子层')}</h3>
    <p>{t('每段以 PDF 实际页码及唯一坐标开头，例如 [P04 | Def 2.1]。可粘贴校对过的 LaTeX 或 Markdown。')}</p>
    <button onClick={() => picker.current?.click()}>{t('导入带坐标的文本')}</button>
    <input type="file" ref={picker} hidden accept=".md,.markdown,.txt,.tex" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (file) try { setText(await file.text()); setName(file.name); setError(''); } catch (err) { setError(errorMessage(err)); }
    }} />
    <label>{t('论文影子层')}<textarea spellCheck={false} rows={14} value={text} onChange={e => setText(e.target.value)} /></label>
    {error && <p className="experiment-error" role="alert">{t(error)}</p>}
    <footer><button onClick={onCancel}>{t('取消')}</button><button className="experiment-primary" onClick={() => void apply()}>{t('保存影子层')}</button></footer>
  </section>;
}

function exportRound(round: ExperimentRound, blind: boolean) {
  const data = blind ? { title: round.title, ballots: blindBallots(round).filter(b => b.complete).map(({ item, group, label }) => ({
    label, category: item.category, anchor: item.anchor, quote: item.quote,
    turns: Array.from({ length: turnCount(item) }, (_, i) => ({ question: questionAt(item, i + 1), answer: round.answers[trialKey(item, group, i + 1)].text })),
  })) } : { readerVersion: __APP_VERSION__, build: __APP_BUILD__, ...round };
  const stem = round.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 72);
  downloadJson(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), stem + '-' + round.id.slice(0, 8) + (blind ? '-blind.json' : '-results.json'));
}

export default function PaperExperiment({ source, settings, page, selection, onClose, onOpenModels }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null), alive = useRef(true);
  const questionFile = useRef<HTMLInputElement>(null);
  const [rounds, setRounds] = useState<ExperimentRound[]>([]), [id, setId] = useState('');
  const [tab, setTab] = useState<Tab>('cases'), [editor, setEditor] = useState<string | null>(selection ? 'selection' : null);
  const [materialOpen, setMaterialOpen] = useState(false), [slices, setSlices] = useState<WikiSlice[]>([]);
  const [error, setError] = useState(''), [wikiError, setWikiError] = useState(''), [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false), [writing, setWriting] = useState(false), [probing, setProbing] = useState(false);
  const [modelId, setModelId] = useState<string>(), [temperature, setTemperature] = useState<0.2 | null>(0.2);
  const round = rounds.find(item => item.id === id);
  useEffect(() => {
    dialog.current?.showModal(); alive.current = true;
    let active = true;
    void loadPaperRounds(source.id).then(saved => {
      if (!active) return;
      const current = saved.at(-1) ?? newRound(source);
      setRounds(saved.length ? saved : [current]); setId(current.id);
      setTemperature(current.connection?.temperature === null ? null : 0.2);
      const done = Object.keys(current.answers).length;
      if (!selection) setTab(current.revealed ? 'results' : done && done === trialQueue(current).length ? 'review' : done || Object.keys(current.warmups ?? {}).length ? 'run' : 'cases');
      if (selection && current.revealed) setEditor(null);
    }).catch(err => { if (active) setError(errorMessage(err)); });
    const repo = desktop()?.wiki;
    if (repo) void repo.list().then(records => { if (active) setSlices(splitWiki(records)); }).catch(err => { if (active) setWikiError(errorMessage(err)); });
    return () => { active = false; alive.current = false; controller.current?.abort(); };
  }, [source.id]); // A reader instance belongs to one open PDF.

  const queue = useMemo(() => round ? trialQueue(round) : [], [round?.cases, round?.comparison]);
  const completed = round ? Object.keys(round.answers).length : 0;
  const warmCount = Object.keys(round?.warmups ?? {}).length;
  const fixed = completed > 0 || warmCount > 0, allDone = queue.length > 0 && completed === queue.length;
  function adopt(next: ExperimentRound) {
    if (!alive.current) return;
    setRounds(previous => previous.some(r => r.id === next.id) ? previous.map(r => r.id === next.id ? next : r) : [...previous, next]);
    setId(next.id);
  }
  async function persist(next: ExperimentRound) {
    setWriting(true); setError('');
    try { adopt(await saveRound(next)); return true; }
    catch (err) { setError(errorMessage(err)); return false; }
    finally { setWriting(false); }
  }
  function navigate(next: Tab) { setTab(next); setEditor(null); setMaterialOpen(false); setError(''); setNotice(''); }
  const options = settings.profiles.map(profile => ({ key: profile.id, name: profile.name, profileId: profile.id as string | undefined, model: profile.model, baseURL: profile.baseURL, apiFormat: profile.apiFormat }));
  if (settings.mode === 'api' && !settings.activeProfileId) options.push({ key: '_session', name: t('当前连接'), profileId: undefined, model: settings.model, baseURL: settings.baseURL, apiFormat: settings.apiFormat });
  const selectedId = modelId ?? round?.connection?.profileId ?? settings.activeProfileId ?? (options.some(p => p.key === '_session') ? '_session' : options[0]?.key) ?? '';
  const option = options.find(p => p.key === selectedId);
  const connection: Connection | undefined = fixed ? round?.connection : option ? {
    profileId: option.profileId, apiFormat: option.apiFormat, baseURL: option.baseURL, model: option.model, temperature,
  } : undefined;
  async function probe() {
    if (!connection || controller.current) return;
    const request = new AbortController(); controller.current = request; setProbing(true); setError(''); setNotice('');
    try {
      const name = await probeExperimentConnection(connection, request.signal);
      if (alive.current) setNotice(t('模型已完成测试请求 · {0}', [name]));
    } catch (err) { if (alive.current) setError(errorMessage(err)); }
    finally { controller.current = null; if (alive.current) setProbing(false); }
  }
  async function start() {
    if (!round || !connection || controller.current || !queue.length || allDone) return;
    const request = new AbortController(); controller.current = request; setRunning(true); setError(''); setNotice('');
    try {
      for (const item of round.cases) checkCase(item, round.blocks);
      await runPaperRound(round, connection, request.signal, adopt);
      if (alive.current) { setNotice(t('本轮回答已收齐，可以开始盲评。')); setTab('review'); }
    } catch (err) {
      if (alive.current) {
        if (request.signal.aborted) setNotice(t('已暂停。继续运行时会跳过已保存的回答。'));
        else setError(errorMessage(err));
      }
    } finally { controller.current = null; if (alive.current) setRunning(false); }
  }
  async function saveCase(item: ExperimentCase) {
    if (!round) return;
    const cases = round.cases.some(c => c.id === item.id) ? round.cases.map(c => c.id === item.id ? item : c) : [...round.cases, item];
    if (await persist({ ...round, cases })) { setEditor(null); setNotice(t('题目已保存。')); }
  }
  function switchRound(next: ExperimentRound) { setId(next.id); setModelId(undefined); setTemperature(next.connection?.temperature === null ? null : 0.2); navigate(next.revealed ? 'results' : 'cases'); }
  const busy = writing || running || probing;
  return <dialog ref={dialog} className="paper-experiment" aria-label={t('论文对照实验')} onCancel={e => { e.preventDefault(); if (!writing) onClose(); }}>
    <header className="experiment-heading"><FlaskConical size={22} /><div><h2>{t('论文对照实验')}</h2><small>{source.name}</small></div>
      <button aria-label={t('返回阅读')} title={t('返回阅读')} disabled={writing} onClick={onClose}><X size={18} /></button></header>
    {round && <>
      <nav className="experiment-tabs" aria-label={t('实验步骤')}>{(Object.keys(tabLabels) as Tab[]).filter(key => key !== 'results' || round.revealed).map(key =>
        <button key={key} aria-current={tab === key ? 'page' : undefined} disabled={busy && key !== tab} onClick={() => navigate(key)}>{t(tabLabels[key])}</button>)}</nav>
      <div className="experiment-content">
        {error && <p className="experiment-error" role="alert">{t(error)}</p>}{notice && <p role="status">{notice}</p>}
        {tab === 'cases' && (materialOpen ? <MaterialEditor round={round} pages={source.pages.length} onSave={persist} onCancel={() => setMaterialOpen(false)} />
          : editor ? <>{wikiError && <p role="alert">{t('读取个人 Wiki 失败')} · {wikiError}</p>}<CaseEditor key={editor} round={round} existing={round.cases.find(c => c.id === editor)}
            page={page} slices={slices} selection={editor === 'selection' ? selection : undefined} onSave={saveCase} onCancel={() => setEditor(null)} /></> : <>
          <div className="experiment-line"><div><h3>{t('论文原文')}</h3><small>{round.material} · {t('{0} / {1} 页有坐标', [new Set(round.blocks.map(b => b.page)).size, source.pages.length])}</small></div>
            {!fixed && <button onClick={() => setMaterialOpen(true)}>{t('校订或导入影子层')}</button>}</div>
          <div className="experiment-line"><div><h3>{t('精读题集')}</h3><small>{t('首轮目标为 A–E 各 3 题，也可先试跑一道。')}</small></div>
            {!round.revealed && <button onClick={() => setEditor('new')}>{t('从影子层建题')}</button>}</div>
          {!fixed && <><button disabled={busy} onClick={() => questionFile.current?.click()}>{t('导入回归题集')}</button>
            <input hidden ref={questionFile} type="file" accept=".json" onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
              try { const next = importProofQuestions(round, await file.text(), source.pages.length);
                if (await persist(next)) setNotice(t('题集已载入，共 {0} 题。', [next.cases.length]));
              } catch (err) { setError(errorMessage(err)); }
            }} /></>}
          <div className="experiment-counts">{Object.entries(CATEGORIES).map(([key, name]) => <span key={key} title={t(name)}>{key} · {round.cases.filter(c => c.category === key).length}/3</span>)}</div>
          {!round.cases.length && <p>{t('返回论文，划选原文后点“加入实验”，即可保存第一个问题。')}</p>}
          <ol className="experiment-cases">{round.cases.map(item => {
            const started = comparisonGroups(round).some(group => !!round.answers[trialKey(item, group, 1)] || !!round.warmups?.[trialKey(item, group, 1)]);
            return <li key={item.id}><div><small>{item.category} · {t(CATEGORIES[item.category])} · [{item.anchor}]</small><strong>{item.question}</strong></div>
              {!started && <><button onClick={() => setEditor(item.id)}>{t('编辑')}</button><button aria-label={t('移除题目')} disabled={writing} onClick={() => void persist({ ...round, cases: round.cases.filter(c => c.id !== item.id) })}>{t('移除')}</button></>}</li>;
          })}</ol>
          <footer><button onClick={onClose}>{t('返回阅读')}</button><button className="experiment-primary" disabled={!round.cases.length} onClick={() => navigate('run')}>{t('运行对照')}</button></footer>
        </>)}
        {tab === 'run' && <>
          <h3>{t('固定实验条件')}</h3>
          <label>{t('参与对照的组别')}<NativeSelect value={round.comparison ?? 'classic'} disabled={fixed || busy}
            onChange={e => void persist(changeComparison(round, e.target.value as Comparison))}>
            {Object.entries(comparisons).map(([key,name]) => <option key={key} value={key}>{t(name)}</option>)}</NativeSelect></label>
          <div className="experiment-columns">
            <label>{t('实验模型')}{fixed ? <output>{round.connection?.model}</output> : <NativeSelect value={selectedId} disabled={busy} onChange={e => { setModelId(e.target.value); setError(''); setNotice(''); }}>
              {!options.length && <option value="">{t('先配置模型连接')}</option>}{options.map(p => <option key={p.key} value={p.key}>{p.name} · {p.model}</option>)}</NativeSelect>}</label>
            <label>{t('采样温度')}<NativeSelect disabled={fixed || busy} value={(fixed ? round.connection?.temperature : temperature) ?? 'default'}
              onChange={e => { setTemperature(e.target.value === 'default' ? null : 0.2); setError(''); setNotice(''); }}><option value="0.2">0.2</option><option value="default">{t('模型默认')}</option></NativeSelect></label>
          </div><button disabled={busy || !connection} onClick={() => void probe()}>{t(probing ? '正在测试连接…' : '测试实验连接')}</button>
          {onOpenModels && !busy && <button onClick={onOpenModels}>{t('模型与设置')}</button>}
          <ul className="experiment-arms">{comparisonGroups(round).map(group => <li key={group}><strong>{group}</strong> {t(GROUP_NAMES[group])}</li>)}</ul>
          {comparisonGroups(round).includes('G4') && <p className="experiment-hint">{t('G4 发送选区前后各一页，并自动补入匹配的证明段、所属引理和相邻公式。')}</p>}
          <label><input type="checkbox" checked={!!round.preheat} disabled={fixed || busy} onChange={e => void persist({ ...round, preheat: e.target.checked })} /> {t('先预热 {0}', [warmupGroups(round).join(' / ')])}</label>
          {round.preheat && <p role="status">{t('预热已完成 {0} / {1} 次。', [warmCount, round.cases.length * warmupGroups(round).length])}</p>}
          <h3>{t('运行进度')}</h3><progress value={completed} max={queue.length || 1} /><p role="status">{t('已完成 {0} / {1} 次请求', [completed, queue.length])} · {t('{0} 道题', [round.cases.length])}</p>
          <footer>{running ? <button onClick={() => controller.current?.abort()}>{t('暂停实验')}</button> : allDone ? <button className="experiment-primary" onClick={() => navigate(round.revealed ? 'results' : 'review')}>{t(round.revealed ? '查看结果' : '开始盲评')}</button>
            : <button className="experiment-primary" disabled={!connection || !queue.length || busy} onClick={() => void start()}>{t(fixed ? '继续剩余请求' : '开始对照实验')}</button>}</footer>
        </>}
        {tab === 'review' && <Review round={round} onSave={persist} onReveal={() => void persist({ ...round, revealed: true }).then(ok => { if (ok) navigate('results'); })} />}
        {tab === 'review' && allDone && <button onClick={() => exportRound(round, true)}>{t('导出匿名答卷')}</button>}
        {tab === 'results' && round.revealed && <><Results round={round} /><button onClick={() => exportRound(round, false)}>{t('导出完整实验 JSON')}</button></>}
      </div>
      {!editor && !materialOpen && <div className="experiment-rounds">
        <label>{t('实验轮次')}<NativeSelect disabled={busy} value={id} onChange={e => { const next = rounds.find(r => r.id === e.target.value); if (next) switchRound(next); }}>
          {rounds.map((r, i) => <option key={r.id} value={r.id}>{t('第 {0} 轮', [i + 1])} · {new Date(r.createdAt).toLocaleDateString()}</option>)}</NativeSelect></label>
        {fixed && <button disabled={busy} onClick={async () => { const next = newRound(source, round); if (await persist(next)) switchRound(next); }}>{t('复用题集开新一轮')}</button>}
      </div>}
    </>}
    {!round && <p role={error ? 'alert' : 'status'}>{error || t('正在读取实验…')}</p>}
  </dialog>;
}
