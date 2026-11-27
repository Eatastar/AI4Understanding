import { useMemo, useState } from 'react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { searchKnowledgeCards, type KnowledgeCard } from '../domain/knowledge';
import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import { KnowledgeDialog, knowledgePreview, knowledgeSourceLabel } from './KnowledgeBase';

export function KnowledgeCardPicker({ cards, selected, loading, loadError, onClose, onApply }: {
  cards: KnowledgeCard[]; selected: string[]; loading: boolean; loadError: boolean;
  onClose: () => void; onApply: (ids: string[]) => void;
}) {
  useLocale();
  const [query, setQuery] = useState('');
  const [ids, setIds] = useState(selected);
  const [limit, setLimit] = useState(40);
  const matches = useMemo(() => searchKnowledgeCards(cards, query), [cards, query]);
  const available = ids.filter(id => cards.some(card => card.id === id));

  return <KnowledgeDialog title={t('引用知识卡片')} onClose={onClose} actions={<>
    <span className="knowledge-selection-count" aria-live="polite">{t('已选 {0} 张卡片', [available.length])}</span>
    <button type="button" className="secondary-button" onClick={onClose}>{t('取消')}</button>
    <button type="button" className="primary-button" {...confirmShortcut} disabled={loading || loadError} onClick={() => onApply(available)}>{t('确定')}</button>
  </>}>
    <div className="knowledge-dialog-body knowledge-picker">
      <input data-knowledge-focus type="search" aria-label={t('搜索标题、正文或标签')} placeholder={t('搜索标题、正文或标签')} value={query} onChange={event => { setQuery(event.target.value); setLimit(40); }} />
      {loading ? <p className="knowledge-status" role="status">{t('正在读取知识库…')}</p>
        : loadError ? <p className="knowledge-error" role="alert">{t('无法读取知识库，请重试。')}</p>
        : !matches.length && <p className="knowledge-status">{t(cards.length ? '没有匹配的知识卡片。' : '还没有知识卡片，可从 AI 回答收藏。')}</p>}
      {matches.slice(0, limit).map(card => <label className="knowledge-choice" key={card.id}>
        <input type="checkbox" checked={ids.includes(card.id)} disabled={loading || loadError} onChange={event => {
          const checked = event.target.checked;
          setIds(value => checked ? [...value, card.id] : value.filter(id => id !== card.id));
        }} />
        <span><strong>{card.title}</strong><small>{knowledgePreview(card.content, 120)}</small>
          {card.source && <small>{knowledgeSourceLabel(card.source)}</small>}
        </span>
      </label>)}
      {matches.length > limit && <button type="button" className="secondary-button knowledge-more" onClick={() => setLimit(value => value + 40)}>{t('显示更多卡片')}</button>}
    </div>
  </KnowledgeDialog>;
}
