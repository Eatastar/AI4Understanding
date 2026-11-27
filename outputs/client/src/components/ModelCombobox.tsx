import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react';
import { discoverModels, type DiscoveredModel, type ModelDiscoveryInput } from '../adapters/model';
import { filterModels } from '../domain/model-list';
import { modelSuggestions } from '../domain/model-presets';
import { t } from '../i18n/locale';
// @ts-expect-error Pure URL helpers shared with the local server.
import { isLocalEndpoint, modelListEndpoint } from '../../shared/model-endpoint.mjs';
import './model-combobox.css';

type Option = DiscoveredModel & { key: string; custom?: boolean };
type Feedback = { message: string; unavailable?: boolean };
type Connection = Pick<ModelDiscoveryInput, 'id' | 'baseURL' | 'apiFormat'>;
const emptyList: DiscoveredModel[] = [];
const missingAddress = '请先填写 API 地址。';
const manualHelp = '仍可选择预设或手动输入。';

export function ModelCombobox({ value, connection, template, apiKey, retainedKey, clearApiKey, disabled, onChange }: {
  value: string; connection: Connection; template?: string; apiKey: string; retainedKey: boolean; clearApiKey: boolean;
  disabled: boolean; onChange: (value: string) => void;
}) {
  const id = useId(), listId = id + '-list', statusId = id + '-status';
  const root = useRef<HTMLDivElement>(null), anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const modelValue = useRef(value);
  modelValue.current = value;
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string>();
  const [models, setModels] = useState(emptyList);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const { id: profileId, baseURL, apiFormat } = connection;
  const key = apiKey.trim();
  const presets = modelSuggestions(baseURL, apiFormat, template);
  const available = useMemo(() => {
    const detected = new Set(models.map(model => model.id));
    return {
      detected: models.map(model => ({ ...model, key: 'detected-' + model.id })),
      presets: presets.filter(model => !detected.has(model)).map(model => ({ id: model, key: 'preset-' + model })),
      ids: new Set([...presets, ...detected]),
    };
  }, [models, presets]);
  const customValue = value.trim();
  const custom = customValue && !available.ids.has(customValue) ? { id: customValue, key: 'custom', custom: true } : undefined;
  const detected = filterModels(available.detected, query);
  const suggested = filterModels(available.presets, query);
  const options: Option[] = [...detected, ...suggested, ...(custom ? [custom] : [])];
  const activeIndex = options.findIndex(option => option.key === highlight);

  function stopRequest() {
    request.current?.abort();
    request.current = null;
  }
  // A result belongs to the exact connection and credentials used to fetch it.
  // The list lives only in this form and is reusable while editing the model ID.
  useLayoutEffect(() => {
    setModels(emptyList); setFeedback(undefined); setLoading(false); setOpen(false);
    setHighlight(undefined); setQuery('');
    return stopRequest;
  }, [profileId, baseURL, apiFormat, key, retainedKey, clearApiKey, template]);
  useLayoutEffect(() => {
    if (disabled) { stopRequest(); setLoading(false); setOpen(false); }
  }, [disabled]);

  useLayoutEffect(() => {
    const panel = list.current, field = anchor.current, wrapper = root.current;
    if (!open || !panel || !field || !wrapper) return;
    const sheet = wrapper.closest('dialog');
    const place = () => {
      const bounds = field.getBoundingClientRect(), outer = wrapper.getBoundingClientRect();
      const dialogBounds = sheet?.getBoundingClientRect();
      if (dialogBounds && (bounds.bottom <= dialogBounds.top || bounds.top >= dialogBounds.bottom)) {
        setOpen(false); return;
      }
      const below = window.innerHeight - outer.bottom - 8, above = bounds.top - 8;
      const dropDown = below >= Math.min(248, panel.scrollHeight) || below >= above;
      panel.style.left = bounds.left + 'px';
      panel.style.width = bounds.width + 'px';
      panel.style.maxHeight = Math.min(248, Math.max(0, dropDown ? below : above)) + 'px';
      panel.style.top = dropDown ? outer.bottom + 4 + 'px' : 'auto';
      panel.style.bottom = dropDown ? 'auto' : window.innerHeight - bounds.top + 4 + 'px';
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.contains(event.target)) setOpen(false);
    };
    const observer = new ResizeObserver(place);
    if (typeof panel.showPopover === 'function') {
      panel.showPopover();
      place();
      observer.observe(wrapper);
      window.addEventListener('resize', place);
      sheet?.addEventListener('scroll', place, { passive: true });
    }
    document.addEventListener('pointerdown', outside, true);
    return () => {
      if (typeof panel.hidePopover === 'function' && panel.matches(':popover-open')) panel.hidePopover();
      observer.disconnect();
      window.removeEventListener('resize', place);
      sheet?.removeEventListener('scroll', place);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open && activeIndex >= 0) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, activeIndex]);

  function showAll(first?: string) {
    setQuery(''); setHighlight(first); setOpen(true);
    if (list.current) list.current.scrollTop = 0;
  }
  function commit(model: string) {
    onChange(model.trim()); setOpen(false); setHighlight(undefined); setQuery('');
  }
  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(open && activeIndex >= 0 ? options[activeIndex].id : value);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (!open) {
      const all = [...available.detected, ...available.presets, ...(custom ? [custom] : [])];
      showAll((event.key === 'ArrowDown' ? all[0] : all.at(-1))?.key);
      return;
    }
    if (!options.length) return;
    const next = event.key === 'ArrowDown' ? (activeIndex + 1) % options.length
      : activeIndex > 0 ? activeIndex - 1 : options.length - 1;
    setHighlight(options[next].key);
  }

  async function refresh() {
    if (disabled || request.current) return;
    let endpoint: URL;
    try { endpoint = modelListEndpoint(baseURL.trim()); }
    catch {
      setFeedback({ message: baseURL.trim() ? 'API 地址格式不正确，请填写完整地址。' : missingAddress, unavailable: true });
      return;
    }
    const local = isLocalEndpoint(endpoint);
    if (!local && endpoint.protocol !== 'https:') {
      setFeedback({ message: '远程 API 地址请使用 HTTPS；本机服务可以使用 HTTP。', unavailable: true });
      return;
    }
    if (!local && !key && !retainedKey) {
      setFeedback({ message: '先填写 API 密钥再获取远程列表。', unavailable: true });
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setFeedback(undefined);
    try {
      const result = await discoverModels({
        id: profileId, baseURL, apiFormat, apiKey: key || undefined, clearApiKey: clearApiKey && !key,
      }, controller.signal);
      if (controller.signal.aborted) return;
      setModels(result);
      if (root.current?.contains(document.activeElement) || document.activeElement === document.body) {
        input.current?.focus({ preventScroll: true });
        showAll(!modelValue.current.trim() && result[0] ? 'detected-' + result[0].id : undefined);
      }
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({
        message: error instanceof Error && !(error instanceof TypeError) ? error.message : '无法获取模型列表。',
        unavailable: true,
      });
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }

  const status = loading ? t('正在获取模型…') : feedback
    ? t(feedback.message) + (feedback.unavailable ? ' ' + t(manualHelp) : '')
    : models.length ? t('已获取 {0} 个模型', [models.length]) : t('可选择预设或输入模型名。获取列表会查询当前连接。');
  const renderOption = (option: Option, index: number) => <div key={option.key} id={id + '-option-' + index} role="option"
    className="model-option" aria-selected={index === activeIndex}
    onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus({ preventScroll: true }); commit(option.id); }}>
    <div>
      <bdi>{option.custom ? t('使用自定义模型「{0}」', [option.id]) : option.id}</bdi>
      {option.label && option.label !== option.id && <small><bdi>{option.label}</bdi></small>}
    </div>
    {value === option.id && !option.custom && <Check size={14} aria-hidden="true" />}
  </div>;

  return <div className="model-field" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label className="field-label" htmlFor={id}>{t('调用模型')}</label>
    <div className="model-field-row">
      <div className="model-combobox" ref={anchor}>
        <input ref={input} id={id} className="field-input" role="combobox" aria-autocomplete="list" aria-expanded={open}
          aria-controls={open ? listId : undefined} aria-activedescendant={open && activeIndex >= 0 ? id + '-option-' + activeIndex : undefined}
          aria-describedby={statusId} value={value} maxLength={200} autoComplete="off" spellCheck={false} required
          placeholder={t('选择或输入模型名')} disabled={disabled}
          onFocus={() => showAll()} onClick={() => { if (!open) showAll(); }} onKeyDown={navigate}
          onChange={event => { const text = event.currentTarget.value; onChange(text); setQuery(text); setHighlight(undefined); setOpen(true); if (list.current) list.current.scrollTop = 0; }} />
        <button type="button" className="model-combobox-toggle" tabIndex={-1} disabled={disabled}
          aria-label={t(open ? '收起模型选项' : '展开模型选项')} aria-expanded={open} aria-controls={open ? listId : undefined}
          onMouseDown={event => event.preventDefault()} onClick={() => {
            if (open) setOpen(false);
            else { input.current?.focus({ preventScroll: true }); showAll(); }
          }}><ChevronDown size={17} aria-hidden="true" /></button>
      </div>
      <button type="button" className="model-fetch-button" disabled={disabled || loading} aria-busy={loading}
        title={t('获取当前连接的模型列表')} onClick={() => void refresh()}>
        {loading ? <LoaderCircle className="model-fetch-spinner" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
        <span>{t('获取列表')}</span>
      </button>
    </div>
    <div className="model-field-feedback">
      <p id={statusId} role="status">{status}</p>
      {loading && <button type="button" className="profile-text-button" onClick={() => {
        stopRequest(); setLoading(false); setFeedback({ message: '已取消获取模型列表。' });
      }}>{t('取消')}</button>}
    </div>
    {open && <div ref={list} id={listId} className="model-options" role="listbox" aria-label={t('模型选项')} popover="manual">
      {!!detected.length && <div role="group" aria-labelledby={id + '-detected'}>
        <div className="model-option-group" id={id + '-detected'}>{t('已从接口获取（{0} 个）', [models.length])}</div>
        {detected.map(renderOption)}
      </div>}
      {!!suggested.length && <div role="group" aria-labelledby={id + '-presets'}>
        <div className="model-option-group" id={id + '-presets'}>{t('常用预设模型')}</div>
        {suggested.map((option, index) => renderOption(option, detected.length + index))}
      </div>}
      {custom && renderOption(custom, detected.length + suggested.length)}
    </div>}
  </div>;
}
