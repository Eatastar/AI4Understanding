import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, BookOpen, Library } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import type { KnowledgeCard } from '../domain/knowledge';
import type { Workspace } from '../domain/types';
import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import { WikiHome } from './WikiHome';
import { WikiPageView, wikiError } from './WikiPageView';
import type { ReferenceItem, SourceCitation, WikiRecord, WikiRepository } from './wiki-types';
import './wiki.css';

type Screen = { kind: 'home' } | { kind: 'page'; material?: ReferenceItem; id?: string; blockId?: string; key: number };
interface Props {
  workspace: Workspace;
  cards: readonly KnowledgeCard[];
  repository: WikiRepository;
  resumeId?: string;
  incoming?: ReferenceItem;
  onRemember: (id?: string) => void;
  flushRef: RefObject<(() => Promise<void>) | null>;
  onExit: () => void;
  onChanged: () => void;
  onLegacy?: () => void;
  onOpenSource: (citation: SourceCitation) => Promise<boolean> | boolean;
}

export default function WikiWorkspace({ workspace, cards, repository, resumeId, incoming, onRemember, flushRef, onExit, onChanged, onLegacy, onOpenSource }: Props) {
  useLocale();
  const [records, setRecords] = useState<WikiRecord[]>();
  const [screen, setScreen] = useState<Screen>(() => resumeId && !incoming ? { kind: 'page', id: resumeId, key: 0 } : { kind: 'home' });
  const [pendingMaterial,setPendingMaterial] = useState(incoming);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const serial = useRef(0);
  const scroll = useRef<HTMLElement>(null);
  const pending = useRef(false);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    let active = true;
    repository.list().then(list => { if (active) setRecords(list); })
      .catch(failure => { if (active) setError(wikiError(failure)); });
    return () => { active = false; };
  }, [repository, attempt]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [screen.kind, screen.kind === 'page' ? screen.key : undefined]);

  const transition = async (run: () => Promise<void> | void) => {
    if (pending.current) return;
    pending.current = true;
    setNavigating(true); setError('');
    try { await flushRef.current?.(); await run(); }
    catch (failure) { setError(wikiError(failure)); }
    finally { pending.current = false; setNavigating(false); }
  };
  const openEntry = (id: string, blockId?: string, material?: ReferenceItem) => void transition(() => {
    if (!records?.some(record => record.page.id === id)) throw new Error('知识库条目已不存在。');
    onRemember(id);
    setScreen({ kind: 'page', id, blockId, material, key: ++serial.current });
    setPendingMaterial(undefined);
  });
  const showHome = () => void transition(() => { onRemember(undefined); setScreen({ kind: 'home' }); });
  const update = (record: WikiRecord) => {
    onChanged();
    setRecords(previous => [record, ...(previous ?? []).filter(item => item.page.id !== record.page.id)]);
    if (screen.kind === 'page' && !screen.id) {
      setScreen({ ...screen, id: record.page.id });
      onRemember(record.page.id);
    }
  };
  const entry = screen.kind === 'page' && screen.id ? records?.find(record => record.page.id === screen.id) : undefined;
  const article = screen.kind === 'page' && (!screen.id || entry);
  return <section className="wiki-shell" data-testid="wiki-workspace" aria-label={t('个人知识库')}>
    <header className="wiki-topbar">
      <div className="wiki-topbar-nav">
        <button type="button" className="wiki-action" onClick={() => void transition(onExit)} disabled={navigating}
          aria-label={t('返回阅读器')} title={t('返回阅读器')}><ArrowLeft size={17} /><span>{t('返回阅读器')}</span></button>
        <button type="button" className="wiki-nav-current" onClick={showHome} disabled={navigating}
          aria-label={t('个人知识库首页')}><BrandLogo size={37.5} />{t('个人知识库')}</button>
      </div>
      {onLegacy && <button type="button" className="wiki-action" disabled={navigating} onClick={() => void transition(onLegacy)}><Library size={16} /><span>{t('知识卡片')}</span></button>}
    </header>
    <main className="wiki-scroll" ref={scroll}>
      {error && <div className="wiki-column wiki-load-error" role="alert"><p>{error}</p>
        {!records && <button type="button" className="wiki-action" onClick={() => { setError(''); setAttempt(value => value + 1); }}>{t('重新加载')}</button>}
      </div>}
      {records && (article ? <WikiPageView key={screen.key} entry={entry} blockId={screen.blockId} incoming={screen.material}
        records={records} workspace={workspace} cards={cards} repository={repository} flushRef={flushRef}
        onStore={update} onOpenEntry={openEntry} onOpenCitation={citation => void transition(async () => {
          if (!await onOpenSource(citation)) throw new Error('来源暂不可用。请导入包含原始资料的完整备份。');
        })} /> : <WikiHome records={records} choosing={!!pendingMaterial} onOpen={id=>openEntry(id,undefined,pendingMaterial)}
        onCreate={() => {setScreen({ kind: 'page', material:pendingMaterial, key: ++serial.current });setPendingMaterial(undefined);}} />)}
      {!records && !error && <p className="wiki-column wiki-muted wiki-loading" role="status">{t('正在打开个人知识库…')}</p>}
    </main>
  </section>;
}
