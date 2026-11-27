import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import { useEffect, useId, useRef, useState } from 'react';
import { Palette, X } from 'lucide-react';
import { isHexColor, READER_PRESETS, readerContrast } from '../domain/reader';
import type { ReaderAppearance } from '../domain/reader';
import { isEbookKind, type DocumentKind } from '../domain/types';

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  useLocale();
  const [draft, setDraft] = useState(value);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (picker.current && document.activeElement !== picker.current) picker.current.value = value; }, [value]);
  // Do not round-trip RGB values through a controlled native HSV picker while it
  // is open: that resets its hue/saturation position and causes visible jumps.
  return <label className="reader-color-field"><span>{label}</span><input ref={picker} type="color" aria-label={t("{0}选择器", [label])} defaultValue={value} onInput={event => { if (event.currentTarget.value !== value) onChange(event.currentTarget.value); }} onChange={event => { if (event.currentTarget.value !== value) onChange(event.currentTarget.value); }} /><input type="text" aria-label={t("{0}色值", [label])} value={draft} maxLength={7} spellCheck={false} onChange={event => { setDraft(event.target.value); if (isHexColor(event.target.value)) onChange(event.target.value.toLowerCase()); }} onBlur={() => { if (!isHexColor(draft)) setDraft(value); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}
interface AppearanceProps {
  appearance: ReaderAppearance;
  onChange: (appearance: ReaderAppearance) => void;
  saved: boolean;
  kind?: DocumentKind;
}

export function ReaderAppearancePanel({ appearance, onChange, saved, kind }: AppearanceProps) {
  useLocale();
  const showColorPreservation = kind && !isEbookKind(kind);
  return <div className="reader-appearance" aria-label={t(kind ? '阅读配色设置' : '配色')}>
    <div className="reader-theme-presets" role="group" aria-label={t("页面配色预设")}>{READER_PRESETS.map(preset => <button key={preset.id} type="button" aria-pressed={appearance.preset === preset.id} onClick={() => onChange({ preset: preset.id, paper: preset.paper, ink: preset.ink, preserveColors: appearance.preserveColors })}><span style={{ background: preset.paper, color: preset.ink }}>Aa</span>{t(preset.label)}</button>)}</div>
    <div className="reader-color-fields"><ColorField label={t("纸张")} value={appearance.paper} onChange={paper => onChange({ ...appearance, preset: 'custom', paper })} /><ColorField label={t("文字")} value={appearance.ink} onChange={ink => onChange({ ...appearance, preset: 'custom', ink })} />{showColorPreservation && <label className="reader-preserve-colors"><input type="checkbox" checked={appearance.preserveColors} onChange={event => onChange({ ...appearance, preserveColors: event.target.checked })} />{t("保留彩色区域")}</label>}</div>
    <p className="reader-color-help">{t("配色应用到整个软件。")}<span role="status">{saved ? t("配色已记住") : t("设置仅在本次有效")}</span></p>
    {readerContrast(appearance.paper, appearance.ink) < 3 && <p className="reader-contrast-notice" role="status">{t("纸张与文字颜色较接近，可以调深文字或换浅色纸张。")}</p>}
  </div>;
}

export function AppearanceButton({ onOpen }: { onOpen: () => void }) {
  useLocale();
  const label = t('配色');
  return <button type="button" className="document-tool-button appearance-trigger" aria-label={label} title={label} aria-haspopup="dialog" onClick={onOpen}>
    <Palette size={16} aria-hidden="true" /><span>{label}</span>
  </button>;
}

export function AppearanceDialog({ onClose, ...panelProps }: Omit<AppearanceProps, 'kind'> & { onClose: () => void }) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  return <dialog ref={dialog} className="settings-dialog appearance-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="dialog-header">
      <h2 id={title}>{t('配色')}</h2>
      <button type="button" className="icon-button" aria-label={t('关闭')} onClick={close}><X size={19} /></button>
    </header>
    <ReaderAppearancePanel {...panelProps} />
  </dialog>;
}
