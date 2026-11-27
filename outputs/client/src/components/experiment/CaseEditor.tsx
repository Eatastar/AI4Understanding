import { useMemo, useState } from 'react';
import { t } from '../../i18n/locale';
import { NativeSelect } from '../NativeSelect';
import { CATEGORIES, blindOrder, checkCase, comparisonGroups } from '../../domain/paper-experiment';
import type { Category, ExperimentCase, ExperimentRound } from '../../domain/paper-experiment';
import { locateSelection, suggestPointers, suggestWiki } from '../../domain/experiment-material';
import type { PaperSelection, Pointer, WikiSlice } from '../../domain/experiment-material';

interface Props {
  round: ExperimentRound; existing?: ExperimentCase; selection?: PaperSelection; page: number; slices: WikiSlice[];
  onSave: (item: ExperimentCase) => Promise<void>; onCancel: () => void;
}
export function CaseEditor({ round, existing, selection: incoming, page, slices, onSave, onCancel }: Props) {
  const selection = existing?.selection ?? incoming;
  const choices = useMemo(() => selection ? round.blocks.filter(b => b.page === selection.page) : round.blocks, [round.blocks, selection]);
  const initial = existing?.anchor ?? (selection ? locateSelection(choices, selection) : (choices.find(b => b.page === page) ?? choices[0])?.anchor) ?? '';
  const [anchor, setAnchor] = useState(initial);
  const [quote, setQuote] = useState(existing?.quote ?? selection?.quote ?? choices.find(b => b.anchor === initial)?.text ?? '');
  const [question, setQuestion] = useState(existing?.question ?? '');
  const [category, setCategory] = useState<Category>(existing?.category ?? (Object.keys(CATEGORIES) as Category[]).find(key => round.cases.filter(item => item.category === key).length < 3) ?? 'A');
  const [correction, setCorrection] = useState(existing?.correction ?? ''), [falsified, setFalsified] = useState(existing?.falsified ?? '');
  const [followUp, setFollowUp] = useState(existing?.followUp ?? ''), [fresh, setFresh] = useState(existing?.fresh ?? '');
  const [customPointers, setPointers] = useState<Pointer[] | undefined>(existing?.pointerMode === 'auto' ? undefined : existing?.pointers);
  const [customWiki, setWiki] = useState<WikiSlice[] | undefined>(existing?.wiki);
  const [filter, setFilter] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const query = quote + ' ' + question;
  const pointers = useMemo(() => customPointers ?? suggestPointers(round.blocks, anchor, query, quote), [round.blocks, anchor, query, quote, customPointers]);
  const wiki = useMemo(() => customWiki ?? suggestWiki(slices, query), [slices, query, customWiki]);
  const wikiOptions = useMemo(() => {
    const search = filter.trim().toLowerCase();
    return [...wiki, ...slices.filter(s => !wiki.some(selected => selected.id === s.id))]
      .filter(s => !search || (s.title + ' ' + s.text).toLowerCase().includes(search));
  }, [wiki, slices, filter]);
  function selectAnchor(value: string) {
    setAnchor(value); setPointers(undefined);
    if (!selection) setQuote(choices.find(b => b.anchor === value)?.text ?? '');
  }
  async function save() {
    if (saving) return;
    setError(''); setSaving(true);
    try {
      const item: ExperimentCase = { id: existing?.id ?? crypto.randomUUID(), blindOrder: existing?.blindOrder ?? blindOrder(comparisonGroups(round)),
        category, anchor, quote, question: question.trim(), selection, pointers, pointerMode: customPointers ? 'manual' : 'auto', wiki, correction, falsified, followUp, fresh };
      checkCase(item, round.blocks);
      await onSave(item);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  }
  const focus = choices.find(block => block.anchor === anchor);
  return <form className="experiment-editor" onSubmit={e => { e.preventDefault(); void save(); }}>
    <h3>{t(existing ? '编辑实验题' : '从选区建题')}</h3>
    <div className="experiment-columns">
      <label>{t('题型')}<NativeSelect value={category} onChange={e => setCategory(e.target.value as Category)}>
        {Object.entries(CATEGORIES).map(([key, name]) => <option key={key} value={key}>{key} · {t(name)}</option>)}
      </NativeSelect></label>
      <label>{t('影子层坐标')}<NativeSelect value={anchor} onChange={e => selectAnchor(e.target.value)}>
        <option value="">{t('选择与原文对应的段落')}</option>
        {choices.map(b => <option key={b.anchor} value={b.anchor}>[{b.anchor}] {b.text.slice(0, 75)}</option>)}
      </NativeSelect></label>
    </div>
    {selection ? <div className="experiment-quote"><small>{t('PDF 原文选区')} · P{selection.page}</small><blockquote>{quote}</blockquote></div>
      : <label>{t('选区原文')}<textarea rows={2} value={quote} onChange={e => setQuote(e.target.value)} /></label>}
    {!anchor && selection && <p role="status">{t('请核对本页的影子层坐标。若本页缺少正文，可先编辑论文原文。')}</p>}
    {focus && selection && <details><summary>{t('核对所在段落')}</summary><p className="experiment-pre">{focus.text}</p></details>}
    <label>{t('精读问题')}<textarea required rows={2} autoFocus value={question} onChange={e => setQuestion(e.target.value)} /></label>
    {category === 'C' && <fieldset><legend>{t('分支追问')}</legend>
      <label>{t('第 2 轮 · 明确纠错')}<textarea rows={2} value={correction} onChange={e => setCorrection(e.target.value)} /></label>
      <label>{t('第 2 轮 · 已否定的推导')}<input value={falsified} onChange={e => setFalsified(e.target.value)} /></label>
      <label>{t('第 3 轮 · 同分支追问')}<input value={followUp} onChange={e => setFollowUp(e.target.value)} /></label>
      <label>{t('新分支 · 独立提问')}<input value={fresh} onChange={e => setFresh(e.target.value)} /></label>
    </fieldset>}
    <details><summary>{t('文内指针')} · {pointers.length}</summary>
      <p className="experiment-hint">{t('G2 和 G3 共用这些坐标。可核对自动推荐、添加坐标或移除误匹配。')}</p>
      <button type="button" disabled={!anchor || customPointers === undefined} onClick={() => setPointers(undefined)}>{t('重新自动推荐')}</button>
      {pointers.map(p => {
        const target = round.blocks.find(b => b.anchor === p.anchor);
        return <div className="experiment-pointer" key={p.anchor}>
          <div><strong>[{p.anchor}]</strong><small>{target?.text.slice(0, 140)}</small></div>
          <NativeSelect aria-label={t('指针依据')} value={p.confidence} onChange={e => setPointers(pointers.map(other => other === p ? { ...p, confidence: e.target.value as Pointer['confidence'] } : other))}>
            <option value="explicit">{t('显式引用')}</option><option value="inferred">{t('相关线索')}</option>
          </NativeSelect><button type="button" onClick={() => setPointers(pointers.filter(other => other !== p))}>{t('移除')}</button>
        </div>;
      })}
      <label>{t('添加指针')}<NativeSelect value="" onChange={e => { if (e.target.value) setPointers([...pointers, { anchor: e.target.value, confidence: 'inferred' }]); }}>
        <option value="">{t('选择原文坐标')}</option>{round.blocks.filter(b => b.anchor !== anchor && !pointers.some(p => p.anchor === b.anchor)).map(b =>
          <option value={b.anchor} key={b.anchor}>[{b.anchor}] {b.text.slice(0, 75)}</option>)}
      </NativeSelect></label>
    </details>
    <details open={category === 'D' || undefined}><summary>{t('个人 Wiki 小节')} · {wiki.length}</summary>
      <p className="experiment-hint">{t('勾选的小节仅随 G3 发送，保存题目时固定正文和修订号。')}</p>
      <label>{t('搜索 Wiki 小节')}<input type="search" value={filter} onChange={e => setFilter(e.target.value)} /></label>
      <div className="experiment-slices">{wikiOptions.map(s => {
        const selected = wiki.some(other => other.id === s.id);
        return <label key={s.id}><input type="checkbox" checked={selected} onChange={() => setWiki(selected ? wiki.filter(other => other.id !== s.id) : [...wiki, s])} />
          <span><strong>{s.title}</strong> · r{s.revision}<small>{s.text}</small></span></label>;
      })}</div>
      {!wikiOptions.length && <p>{t('暂无匹配小节。可在阅读器的个人知识库中整理笔记后返回。')}</p>}
    </details>
    {error && <p className="experiment-error" role="alert">{t(error)}</p>}
    <footer><button type="button" onClick={onCancel} disabled={saving}>{t('取消')}</button><button className="experiment-primary" disabled={saving}>{t('保存题目')}</button></footer>
  </form>;
}
