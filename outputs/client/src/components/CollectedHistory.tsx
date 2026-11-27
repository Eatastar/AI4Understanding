import { useContext, useEffect, useRef, useState } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { ArrowUpRight, X } from 'lucide-react';
import type { CollectionChoice } from '../domain/collected-history';
import type { CollectedTurn } from '../domain/types';
import { t } from '../i18n/locale';
import { MathMarkdown } from './MathMarkdown';
import { AnnotationChatActions } from './AnnotationSummary';
import './collected-history.css';

export function CollectHistoryDialog({ choices, onApply, onClose }: {
  choices: CollectionChoice[]; onApply: (ids: string[]) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(() => new Set(choices.filter(item => item.related).map(item => item.id)));
  const [includeOthers, setIncludeOthers] = useState(false), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const visible = includeOthers ? choices : choices.filter(item => item.related);
  const pageCount = Math.max(1, Math.ceil(visible.length / 40)), currentPage = Math.min(page, pageCount - 1);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function apply() {
    setBusy(true); setError('');
    try { await onApply([...selected]); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请重试。'); setBusy(false); }
  }
  return <dialog ref={dialog} className="settings-dialog chat-turn-dialog" aria-labelledby="collect-history-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="dialog-header"><div><h2 id="collect-history-title">{t('整理到新会话')}</h2><p>{t('已勾选相关问答，可调整后按提问时间汇入。')}</p></div><button type="button" className="icon-button" aria-label={t('关闭')} disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {choices.some(item => !item.related) && <label className="collect-history-more"><input type="checkbox" checked={includeOthers} disabled={busy} onChange={event => { setIncludeOthers(event.target.checked); setPage(0); }} />{t('补选项目里的其他轮次')}</label>}
    <div className="chat-turn-list">
      {!visible.length && <p>{t('暂无相关问答。')}</p>}
      {visible.slice(currentPage * 40, (currentPage + 1) * 40).map(item => <label className="chat-annotation-choice" key={item.id}>
        <input type="checkbox" checked={selected.has(item.id)} disabled={busy} onChange={event => setSelected(previous => {
          const next = new Set(previous); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next;
        })} />
        <span><small>{item.fromAnnotation ? t('批注问答') : item.sourceTitle} · {new Date(item.createdAt).toLocaleString()}</small><strong>{item.preview.slice(0, 240)}</strong></span>
      </label>)}
    </div>
    {pageCount > 1 && <nav className="chat-turn-pagination" aria-label={t('对话目录翻页')}><button type="button" className="secondary-button" disabled={busy || !currentPage} onClick={() => setPage(currentPage - 1)}>{t('上一页')}</button><span>{currentPage + 1} / {pageCount}</span><button type="button" className="secondary-button" disabled={busy || currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>{t('下一页')}</button></nav>}
    {error && <p className="recovery-message" role="alert">{t(error)}</p>}
    <footer className="chat-turn-footer"><span>{t('已选 {0} 轮', [selected.size])}</span><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t('取消')}</button><button type="button" className="primary-button" {...confirmShortcut} disabled={busy || !selected.size} onClick={() => void apply()}>{t('整理到新会话')}</button></footer>
  </dialog>;
}

export function CollectedHistory({ turns }: { turns: CollectedTurn[] }) {
  const actions = useContext(AnnotationChatActions);
  const [visible, setVisible] = useState(20);
  return <details className="collected-history" open>
    <summary>{t('整理的问答（{0} 轮）', [turns.length])}</summary>
    {turns.slice(0, visible).map(turn => <article key={turn.turnId || turn.conversationId}>
      <div className="collected-history-source"><time dateTime={new Date(turn.createdAt).toISOString()}>{new Date(turn.createdAt).toLocaleString()}</time>
        {turn.turnId && actions ? <button type="button" className="annotation-text-button" onClick={() => actions.openTurn(turn.conversationId, [turn.turnId!])}>{turn.sourceTitle}<ArrowUpRight size={13} /></button> : <span>{t('批注问答')}</span>}
      </div>
      <p className="annotation-question-text">{turn.question}</p>
      {turn.answers.map((answer, index) => <MathMarkdown key={index}>{answer}</MathMarkdown>)}
    </article>)}
    {visible < turns.length && <button type="button" className="secondary-button" onClick={() => setVisible(current => current + 20)}>{t('显示更多')}</button>}
  </details>;
}
