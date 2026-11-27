import { useEffect, useRef, useState } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { KeyRound, Search } from 'lucide-react';
import { t } from '../i18n/locale';
import { checkWebSearch, getWebSearchSource, loadWebSearch, saveWebSearch, setWebSearchSource, type WebSearchCheckStatus, type WebSearchSettings, type WebSearchSource } from '../adapters/inquiry';
import type { ModelSettings } from '../domain/types';
import { KnowledgeDialog } from './KnowledgeBase';
import { NativeSelect } from './NativeSelect';

const REMINDER_KEY = 'learn-something.api-setup-reminder.v1';
export function shouldRemindAboutApi(settings: ModelSettings) {
  try { if (localStorage.getItem(REMINDER_KEY) === 'dismissed') return false; } catch { /* The prompt can be dismissed for this window. */ }
  return ![settings, ...settings.profiles].some(profile => {
    if (!profile.model) return false;
    if (profile.hasApiKey) return true;
    try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.baseURL).hostname); }
    catch { return false; }
  });
}

export function ApiSetupPrompt({ onClose, onConfigure }: { onClose: () => void; onConfigure: () => void }) {
  const [suppress, setSuppress] = useState(false);
  function dismiss(next: () => void) {
    if (suppress) try { localStorage.setItem(REMINDER_KEY, 'dismissed'); } catch { /* The current prompt still closes. */ }
    next();
  }
  return <KnowledgeDialog title={t('配置 AI 模型')} onClose={() => dismiss(onClose)} actions={<>
    <button type="button" className="secondary-button" onClick={() => dismiss(onClose)}>{t('稍后')}</button>
    <button type="button" className="primary-button" {...confirmShortcut} onClick={() => dismiss(onConfigure)}><KeyRound size={16} />{t('去配置 API')}</button>
  </>}>
    <div className="knowledge-dialog-body inquiry-setup-body">
      <p>{t('连接模型后可以生成资料导读，也可以在阅读和对话时向 AI 提问。现在就能打开本地文献和检索学术资料。')}</p>
      <label className="inquiry-checkbox"><input type="checkbox" checked={suppress} onChange={event => setSuppress(event.currentTarget.checked)} />{t('以后不再提醒')}</label>
    </div>
  </KnowledgeDialog>;
}

type CheckState = WebSearchCheckStatus | 'queued' | 'checking' | 'unchecked';
const checkLabels: Record<CheckState, string> = {
  unchecked: '未检测', queued: '等待检测', checking: '检测中…', verified: '已验证',
  'missing-key': '缺少 API 密钥', unsupported: '接口拒绝搜索请求', 'no-citations': '未返回可验证的出处',
  'grounding-restricted': 'Gemini 搜索结果不适用于可保存的资料地图',
  access: '密钥或搜索权限受限', limited: '检索限流', timeout: '连接超时', unavailable: '暂不可用',
  busy: '此连接正在检测', changed: '连接已修改，请重新检测',
};
const connectionSource = (id: string): WebSearchSource => `model:${id}`;

export function WebSearchDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<WebSearchSettings>();
  const [source, setSource] = useState<WebSearchSource>('academic');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const checkRequest = useRef<AbortController | null>(null);
  const connections = settings?.connections || [];
  const verified = connections.filter(connection => connection.webSearchVerifiedAt);
  const invalidSource = source.startsWith('model:') && !verified.some(connection => connectionSource(connection.id) === source);
  const checking = Boolean(progress && progress.done < progress.total);
  useEffect(() => {
    const controller = new AbortController();
    loadWebSearch(controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setSettings(value);
      setSource(getWebSearchSource() ?? (value.configured ? 'tavily' : 'academic'));
    }).catch(() => { if (!controller.signal.aborted) setStatus('网页检索配置暂不可用。'); });
    return () => { controller.abort(); checkRequest.current?.abort(); };
  }, []);

  async function checkConnections() {
    if (!connections.length || checkRequest.current) return;
    const controller = new AbortController();
    checkRequest.current = controller;
    setStatus('');
    setChecks(Object.fromEntries(connections.map(({ id }) => [id, 'queued'])));
    setProgress({ done: 0, total: connections.length });
    const pending = connections.values();
    async function run() {
      for (const { id } of pending) {
        if (controller.signal.aborted) break;
        setChecks(current => ({ ...current, [id]: 'checking' }));
        const result = await checkWebSearch(id, controller.signal).catch(() => ({ status: 'unavailable' as const, verifiedAt: undefined }));
        if (controller.signal.aborted) break;
        const { status: outcome, verifiedAt } = result;
        if (outcome === 'verified' && verifiedAt) setSettings(current => current && ({
          ...current, connections: current.connections.map(connection => connection.id === id ? { ...connection, webSearchVerifiedAt: verifiedAt } : connection),
        }));
        setChecks(current => ({ ...current, [id]: outcome }));
        setProgress(current => current && ({ ...current, done: current.done + 1 }));
      }
    }
    await Promise.all([run(), run()]);
    if (checkRequest.current === controller) checkRequest.current = null;
  }

  function cancelChecks() {
    checkRequest.current?.abort();
    checkRequest.current = null;
    setChecks(current => Object.fromEntries(Object.entries(current).filter(([, value]) => value !== 'queued' && value !== 'checking')));
    setProgress(undefined);
    setStatus('已取消检测。');
  }

  async function save(remove = false) {
    setBusy(true);
    setStatus('');
    try {
      if (remove || source === 'tavily' && key.trim()) {
        setSettings(await saveWebSearch(remove ? '' : key.trim()));
        setKey('');
      }
      if (remove) {
        if (getWebSearchSource() === 'tavily') setWebSearchSource('academic');
        setSource('academic');
      } else {
        setWebSearchSource(source);
        onClose();
      }
    }
    catch (error) { setStatus(error instanceof Error ? error.message : '网页检索配置未能保存。'); }
    finally { setBusy(false); }
  }
  const canSave = settings && !busy && !checking && !invalidSource && (source !== 'tavily' || settings.configured || key.trim());
  return <KnowledgeDialog title={t('网页检索')} busy={busy} onClose={onClose} actions={<>
    {source === 'tavily' && settings?.configured && <button type="button" className="secondary-button" disabled={busy || checking} onClick={() => void save(true)}>{t('移除密钥')}</button>}
    <button type="submit" form="web-search-settings" className="primary-button" {...confirmShortcut} disabled={!canSave}>{t('保存')}</button>
  </>}>
    <form id="web-search-settings" className="knowledge-dialog-body inquiry-text-form web-search-settings" onSubmit={event => { event.preventDefault(); if (canSave) void save(); }}>
      <label>{t('网页来源')}
        <NativeSelect value={source} disabled={busy || !settings} onChange={event => setSource(event.currentTarget.value as WebSearchSource)}>
          <option value="academic">{t('仅检索学术资料')}</option>
          <option value="tavily">{t('Tavily（备选）')}</option>
          {invalidSource && <option disabled value={source}>{t('上次选择的连接需要重新检测')}</option>}
          {!!verified.length && <optgroup label={t('已验证的模型连接')}>
            {verified.map(({ id, name, model }) => <option key={id} value={connectionSource(id)}>{name === model ? model : t('{0} · {1}', [name, model])}</option>)}
          </optgroup>}
        </NativeSelect>
      </label>
      {invalidSource && <p className="field-help">{t('请重新检测该连接，或选择其他来源。')}</p>}
      {source === 'tavily' && <>
        <label>Tavily API Key<input type="password" autoComplete="off" spellCheck={false} value={key} maxLength={400} onChange={event => setKey(event.currentTarget.value)} disabled={busy} /></label>
        {settings && <p className="field-help">{t(settings.configured ? '已保存 Tavily 密钥。' : '请输入 Tavily 密钥。')} {t(settings.persistent ? '密钥由系统加密保存。' : '密钥仅在本次运行有效。')}</p>}
      </>}
      <div className="web-search-check">
        <button type="button" className="secondary-button" disabled={busy || !connections.length}
          onClick={() => { if (checking) cancelChecks(); else void checkConnections(); }}>
          <Search size={15} />{t(checking ? '取消检测' : '检测联网能力')}
        </button>
        <span aria-live="polite" className="field-help">{progress ? t('已检测 {0}/{1}', [progress.done, progress.total]) : t(connections.length ? '每个连接会发送一条简短的搜索请求。' : '请先保存模型连接。')}</span>
      </div>
      {!!connections.length && <ul className="web-search-connections" aria-label={t('模型连接检测结果')}>
        {connections.map(({ id, name, model, webSearchVerifiedAt }) => {
          const state = checks[id] || (webSearchVerifiedAt ? 'verified' : 'unchecked');
          return <li key={id}>
            <div className="web-search-connection-name"><strong>{name}</strong>{model !== name && <small>{model}</small>}</div>
            <span className={state === 'verified' ? 'web-search-verified' : ''}>
              {t(checkLabels[state])}
              {webSearchVerifiedAt && state !== 'verified' && <small>{t('保留上次验证')}</small>}
            </span>
          </li>;
        })}
      </ul>}
      {status && <p role="status">{t(status)}</p>}
    </form>
  </KnowledgeDialog>;
}
