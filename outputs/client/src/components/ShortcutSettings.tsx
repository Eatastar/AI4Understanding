import { useEffect, useId, useRef, useState } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { X } from 'lucide-react';
import { t } from '../i18n/locale';
import { DEFAULT_FIGURE_SHORTCUT, DEFAULT_TRANSLATION_SHORTCUT, sameShortcut, shortcutFromEvent, shortcutLabel, type TranslationPreferences, type TranslationShortcut } from '../domain/translation';

export function ShortcutField({ label, value, onChange, onError }: { label: string; value: TranslationShortcut; onChange: (value: TranslationShortcut) => void; onError: (message: string) => void }) {
  const [recording, setRecording] = useState(false);
  return <label className="field-label">{label}<input className="field-input translation-shortcut" aria-label={label} data-recording-shortcut={recording || undefined} readOnly value={recording ? t('请按组合键…') : shortcutLabel(value)}
    onClick={() => { setRecording(true); onError(''); }} onBlur={() => setRecording(false)} onKeyDown={event => {
      if (event.key === 'Tab') return;
      if (event.key === 'Escape' && !recording) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { setRecording(false); return; }
      setRecording(true);
      if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return;
      const shortcut = shortcutFromEvent(event);
      if (!shortcut || event.getModifierState('AltGraph')) { onError('此组合键与常用操作冲突，请使用 Alt、Ctrl 或 ⌘ 加字母或数字。'); return; }
      onChange(shortcut);
      setRecording(false);
      onError('');
    }} /></label>;
}

export function ShortcutSettings({ value, onSave, onClose }: { value: TranslationPreferences; onSave: (value: TranslationPreferences) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId();
  const [draft, setDraft] = useState(value), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="settings-dialog shortcut-settings" aria-labelledby={title} onCancel={onClose}>
    <header className="dialog-header"><h2 id={title}>{t('快捷键')}</h2><button type="button" className="icon-button" aria-label={t('关闭')} onClick={onClose}><X size={18} /></button></header>
    <form onSubmit={event => {
      event.preventDefault();
      if (sameShortcut(draft.shortcut, draft.figureShortcut)) { setError('划词翻译和框选提问需要使用不同的快捷键。'); return; }
      onSave(draft);
      onClose();
    }}>
      <ShortcutField label={t('翻译快捷键')} value={draft.shortcut} onChange={shortcut => setDraft(previous => ({ ...previous, shortcut }))} onError={setError} />
      <p className="field-help">{t('选中文字后按快捷键翻译。')}</p>
      <ShortcutField label={t('框选提问快捷键')} value={draft.figureShortcut} onChange={figureShortcut => setDraft(previous => ({ ...previous, figureShortcut }))} onError={setError} />
      <p className="field-help">{t('阅读 PDF 原排版或桌面版电子书时，按快捷键开始框选。')}</p>
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      <footer className="dialog-footer"><button type="button" className="profile-text-button" onClick={() => { setDraft({ ...draft, shortcut: DEFAULT_TRANSLATION_SHORTCUT, figureShortcut: DEFAULT_FIGURE_SHORTCUT }); setError(''); }}>{t('恢复默认快捷键')}</button><button type="submit" className="primary-button" {...confirmShortcut}>{t('保存')}</button></footer>
    </form>
  </dialog>;
}
