import { t } from '../i18n/locale';
import { confirmationScope, confirmShortcut } from '../hooks/confirmation-shortcut';
import { useLocale } from '../i18n/react';
import { useEffect, useId, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS, normalizeHighlightColor } from '../domain/highlight-colors';

export function HighlightColorPicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  useLocale();
  const [draft, setDraft] = useState(color);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setDraft(color); setError(''); }, [color]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function apply(value: string, dismiss = true) {
    try {
      onChange(normalizeHighlightColor(value));
      setError('');
      if (dismiss) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : '颜色未能保存。');
    }
  }

  const swatch = (item: typeof HIGHLIGHT_COLORS[number]) => <button
    type="button"
    key={item.value}
    style={{ background: item.value }}
    aria-label={t(item.name)}
    title={t(item.name)}
    aria-pressed={color.toLowerCase() === item.value}
    onClick={() => apply(item.value)}
  />;

  return <div className="highlight-color-picker" ref={pickerRef} onKeyDown={event => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }}>
    <button ref={triggerRef} type="button" className="highlight-color-trigger" aria-label={t('高亮颜色')} title={t('高亮颜色')} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <span className="annotation-color-dot" style={{ background: color }} />
    </button>
    {open && <div id={id} className="highlight-color-popover" {...confirmationScope}>
      <div className="highlight-color-options" role="group" aria-label={t('预设高亮颜色')}>{HIGHLIGHT_COLORS.slice(0, 5).map(swatch)}</div>
      <details className="highlight-extra-colors">
        <summary>{t('更多颜色')}</summary>
        <div className="highlight-color-options" role="group" aria-label={t('预设高亮颜色')}>{HIGHLIGHT_COLORS.slice(5).map(swatch)}</div>
        <div className="highlight-custom-color">
          <label>{t('自定义颜色')}<input type="color" aria-label={t('自定义高亮颜色')} value={color.slice(0, 7)} onChange={event => apply(event.target.value, false)} /></label>
          <input aria-label={t('颜色代码')} value={draft} maxLength={9} placeholder="#RRGGBB" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); apply(draft); } }} />
          <button type="button" className="annotation-text-button" {...confirmShortcut} onClick={() => apply(draft)}>{t('应用')}</button>
        </div>
        {error && <p className="annotation-footnote" role="alert">{t(error)}</p>}
      </details>
    </div>}
  </div>;
}
