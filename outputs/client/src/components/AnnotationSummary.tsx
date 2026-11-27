import { createContext, useEffect, useRef, useState } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { ArrowUpRight, X } from 'lucide-react';
import type { Annotation, Conversation } from '../domain/types';
import { annotationSourceLabel, canReferenceAnnotation } from '../domain/chat-references';
import { t } from '../i18n/locale';
import { NativeSelect } from './NativeSelect';
import { MathMarkdown } from './MathMarkdown';
import './annotation-summary.css';

export const AnnotationChatActions = createContext<{ openTurn: (conversationId: string, turnIds: string[]) => void; collect?: (annotation: Annotation) => void } | null>(null);

export function AnnotationSummaries({ annotation, openTurn }: { annotation: Annotation; openTurn?: (conversationId: string, turnIds: string[]) => void }) {
  return <>{annotation.summaries?.map(summary => <details key={summary.id} className="annotation-chat-summary">
    <summary>{t('聊天总结')} · {new Date(summary.createdAt).toLocaleDateString()}</summary>
    <MathMarkdown>{summary.content}</MathMarkdown>
    {openTurn && <button type="button" className="annotation-text-button" onClick={() => openTurn(summary.conversationId, summary.turnIds)}><ArrowUpRight size={14} />{t('查看来源对话')}</button>}
  </details>)}</>;
}

export function AnnotationSummaryDialog({ conversation, turnCount, suggested, onGenerate, onSave, onClose }: {
  conversation: Conversation; turnCount: number; suggested?: string;
  onGenerate: (id: string, signal: AbortSignal) => Promise<string>;
  onSave: (id: string, content: string) => Promise<void>; onClose: () => void;
}) {
  const available = conversation.annotations.filter(canReferenceAnnotation);
  const [target, setTarget] = useState(available.some(annotation => annotation.id === suggested) ? suggested! : '');
  const [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState<'generate' | 'save' | null>(null), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => controller.current?.abort(); }, []);
  const close = () => { if (busy !== 'save') onClose(); };
  async function generate() {
    const request = new AbortController(); controller.current = request;
    setBusy('generate'); setError('');
    try {
      const content = await onGenerate(target, request.signal);
      if (!content.trim()) throw new Error('模型返回了空回答，请重试。');
      if (!request.signal.aborted) setDraft(content);
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '操作未完成，请重试。');
    } finally { if (!request.signal.aborted) setBusy(null); }
  }
  async function save() {
    if (draft === null) return;
    setBusy('save'); setError('');
    try { await onSave(target, draft); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请重试。'); setBusy(null); }
  }
  return <dialog ref={dialog} className="settings-dialog summary-dialog" aria-labelledby="summary-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="dialog-header"><div><h2 id="summary-title">{t('总结到批注')}</h2><p>{t('仅使用所选 {0} 轮问答与目标批注文字。', [turnCount])}</p></div><button type="button" className="icon-button" aria-label={t('关闭')} disabled={busy === 'save'} onClick={close}><X size={18} /></button></header>
    <label className="project-field">{t('写入批注')}<NativeSelect value={target} disabled={!!busy} onChange={event => { setTarget(event.target.value); setDraft(null); setError(''); }}>
      <option value="">{t('请选择一条已保存的批注。')}</option>
      {available.map(annotation => <option key={annotation.id} value={annotation.id}>{annotationSourceLabel(conversation, annotation)} · {(annotation.note || annotation.question || annotation.quote).slice(0, 100)}</option>)}
    </NativeSelect></label>
    {draft !== null && <label className="project-field">{t('编辑总结')}<textarea className="annotation-textarea" rows={8} disabled={!!busy} value={draft} onChange={event => setDraft(event.target.value)} /></label>}
    {error && <p className="recovery-message" role="alert">{t(error)}</p>}
    <footer className="project-dialog-actions"><button type="button" className="secondary-button" disabled={busy === 'save'} onClick={close}>{t('取消')}</button>
      <button type="button" className={draft === null ? 'primary-button' : 'secondary-button'} {...(draft === null ? confirmShortcut : {})} disabled={!target || !!busy} onClick={() => void generate()}>{t(busy === 'generate' ? '正在生成总结…' : '生成总结')}</button>
      {draft !== null && <button type="button" className="primary-button" {...confirmShortcut} disabled={!!busy || !draft.trim()} onClick={() => void save()}>{t('追加到批注')}</button>}
    </footer>
  </dialog>;
}
