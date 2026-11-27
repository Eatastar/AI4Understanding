import { t } from '../i18n/locale';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { useLocale } from '../i18n/react';
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';
import type { Conversation, Workspace } from '../domain/types';
import { recycleBin, type TrashTarget } from '../domain/trash';

export function TrashDialog({ workspace, busy, onClose, onRestore, onPurge }: {
  workspace: Workspace; busy: boolean; onClose: () => void;
  onRestore: (target: Exclude<TrashTarget, { kind: 'all' }>) => Promise<void>;
  onPurge: (target: TrashTarget) => Promise<void>;
}) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<{ target: TrashTarget; label: string }>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const disabled = busy || working;
  const { projects, conversations, annotations, count } = recycleBin(workspace);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const run = async (action: () => Promise<void>) => {
    setWorking(true); setError('');
    try { await action(); setPending(undefined); }
    catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请重试。'); }
    finally { setWorking(false); }
  };
  function entry(record: Conversation) {
    const target = { kind: record.isProject ? 'project' as const : 'conversation' as const, id: record.id };
    const members = record.isProject ? workspace.conversations.filter(c => c.projectId === record.id) : [];
    const attachmentCount = members.reduce((total, c) => total + (c.documents?.length || 0), record.documents?.length || 0);
    return <article className="trash-entry" key={record.id}>
      <div className="trash-entry-text">
        <strong title={record.title}>{record.title}</strong>
        <span>{record.isProject ? t('{0} 条对话 · {1} 份附件', [members.length, attachmentCount])
          : <>{record.messages.length}{t('条消息 ·')}{record.annotations.length}{t('条批注 ·')}{attachmentCount}{t('份附件')}</>}</span>
      </div>
      <div className="trash-entry-actions">
        <button className="secondary-button" disabled={disabled} aria-label={t(record.isProject ? '恢复项目「{0}」' : '恢复对话：{0}', [record.title])}
          onClick={() => void run(() => onRestore(target))}><RotateCcw size={13} />{t('恢复')}</button>
        <button className="trash-delete-button" disabled={disabled} aria-label={t(record.isProject ? '永久删除项目「{0}」' : '永久删除对话：{0}', [record.title])}
          onClick={() => setPending({ target, label: record.title })}><Trash2 size={13} />{t('永久删除')}</button>
      </div>
    </article>;
  }
  return <dialog ref={dialog} className="settings-dialog trash-dialog" aria-labelledby="trash-title" onCancel={event => { event.preventDefault(); if (disabled) return; if (pending) setPending(undefined); else onClose(); }}>
    <header className="dialog-header"><div><span className="eyebrow">RECYCLE BIN</span><h2 id="trash-title">{t("回收站")}</h2></div><button className="icon-button" aria-label={t("关闭回收站")} disabled={disabled} onClick={onClose}><X size={19} /></button></header>
    {pending ? <div className="trash-confirmation">
      <h3>{t(pending.target.kind === 'all' ? '清空回收站？' : pending.target.kind === 'project' ? '永久删除这个项目？' : '永久删除这条记录？')}</h3>
      <p className="trash-confirm-label">{pending.label}</p>
      <p>{t(pending.target.kind === 'project'
        ? '项目及其对话、批注和应用内附件副本将被清理。硬盘上的原文件仍保存在原处。'
        : '这些记录将从回收站永久移除，相关的应用内附件副本也会清理。')}</p>
      <p className="trash-backup-note">{t("以前的自动备份和导出备份仍可能保留这些内容。")}</p>
      <div className="trash-confirm-actions"><button className="secondary-button" disabled={disabled} onClick={() => { setPending(undefined); setError(''); }}>{t("取消")}</button><button className="danger-button" {...confirmShortcut} disabled={disabled} onClick={() => void run(() => onPurge(pending.target))}><Trash2 size={14} />{working ? t("正在删除…") : pending.target.kind === 'all' ? t("确认清空") : t("确认永久删除")}</button></div>
    </div> : <>
      <div className="trash-toolbar"><p>{count ? t("{0} 条已删除记录，可恢复或永久删除。", [count]) : t("回收站是空的。")}</p><button className="trash-delete-button" disabled={disabled || !count} onClick={() => setPending({ target: { kind: 'all' }, label: `共 ${count} 条记录` })}><Trash2 size={14} />{t("清空回收站")}</button></div>
      <div className="trash-list">
        {projects.length > 0 && <h3>{t('项目')}</h3>}
        {projects.map(entry)}
        {conversations.length > 0 && <h3>{t("对话")}</h3>}
        {conversations.map(entry)}
        {annotations.length > 0 && <h3>{t("批注")}</h3>}
        {annotations.map(({ conversation: c, annotation: a }) => <article className="trash-entry" key={a.id}><div className="trash-entry-text"><strong title={a.quote}>{a.mode === 'note' ? a.note || a.quote : a.question || a.quote}</strong><span>{c.title} · {a.quote.slice(0, 50)}</span></div><div className="trash-entry-actions"><button className="secondary-button" disabled={disabled} aria-label={t("恢复批注：{0}", [a.quote])} onClick={() => void run(() => onRestore({ kind: 'annotation', conversationId: c.id, id: a.id }))}><RotateCcw size={13} />{t("恢复")}</button><button className="trash-delete-button" disabled={disabled} aria-label={t("永久删除批注：{0}", [a.quote])} onClick={() => setPending({ target: { kind: 'annotation', conversationId: c.id, id: a.id }, label: a.quote })}><Trash2 size={13} />{t("永久删除")}</button></div></article>)}
      </div>
    </>}
    {error && <p className="recovery-message" role="alert">{t(error)}</p>}
  </dialog>;
}
