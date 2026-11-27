import { useDeferredValue, useMemo, useState } from 'react';
import { ArrowUpRight, Plus, Search } from 'lucide-react';
import { getLocale, t } from '../i18n/locale';
import { wikiText } from './wiki-document';
import { textPreview } from '../domain/text-preview';
import type { WikiRecord } from './wiki-types';

export function WikiHome({ records, onCreate, onOpen }: {
  records: readonly WikiRecord[]; onCreate: () => void; onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const needle = useDeferredValue(query).trim().toLowerCase();
  const index = useMemo(() => records.map(({ page }) => {
    const body = wikiText(page.body);
    return {
      page, preview: textPreview(body || page.personalUnderstanding || '', 150),
      search: [page.title, ...page.domains, body, page.personalUnderstanding || ''].join('\n').toLowerCase(),
    };
  }), [records]);
  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { page } of records) for (const name of page.domains) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b, getLocale()));
  }, [records]);
  const shown = index.filter(item => (!domain || item.page.domains.includes(domain)) && (!needle || item.search.includes(needle)));
  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' });
  return <section className="wiki-home wiki-column" aria-labelledby="wiki-home-title">
    <header className="wiki-home-heading"><h1 id="wiki-home-title">{t('个人知识库')}</h1>
      <button type="button" className="wiki-action wiki-action-primary" onClick={onCreate}><Plus size={17} />{t('新建条目')}</button>
    </header>
    <label className="wiki-search"><Search size={18} aria-hidden="true" />
      <input type="search" value={query} aria-label={t('搜索知识库条目')} placeholder={t('搜索标题、领域或正文')} onChange={event => setQuery(event.target.value)} />
    </label>
    {domains.length > 0 && <div className="wiki-domains" role="group" aria-label={t('领域')}>
      <button type="button" aria-pressed={!domain} onClick={() => setDomain('')} className="wiki-domain"><span>{t('全部')}</span></button>
      {domains.map(([name, count]) => <button type="button" aria-pressed={domain === name} onClick={() => setDomain(domain === name ? '' : name)} className="wiki-domain" key={name}>
        <span>{name}</span><small>{count}</small>
      </button>)}
    </div>}
    <section className="wiki-recent" aria-labelledby="wiki-recent-title">
      <h2 id="wiki-recent-title">{t(needle || domain ? '匹配条目' : '最近编辑')}</h2>
      {!shown.length && <p className="wiki-muted">{t(records.length ? '没有匹配的条目。' : '还没有知识库条目。')}</p>}
      {shown.map(({ page, preview }) => <button type="button" className="wiki-entry-row" onClick={() => onOpen(page.id)} key={page.id}>
        <span className="wiki-entry-row-copy">
          <strong>{page.title}</strong>
          {preview && <span>{preview}</span>}
          {!!page.domains.length && <small>{page.domains.join(' · ')}</small>}
        </span>
        <time dateTime={new Date(page.updatedAt).toISOString()}>{date.format(page.updatedAt)}</time>
        <ArrowUpRight size={15} aria-hidden="true" />
      </button>)}
    </section>
  </section>;
}
