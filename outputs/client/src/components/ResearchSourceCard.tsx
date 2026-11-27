import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { SearchStep } from '../adapters/inquiry';
import { hasResearchEvidence, type InquirySource, type MediaType, type ReadingBucket } from '../domain/inquiry';
import { textPreview } from '../domain/text-preview';
import { t } from '../i18n/locale';

export const readingBucketText: Record<ReadingBucket, string> = { overview: '综述粗读', deep_dive: '推导精读', brief: '动态扫读' };
export const researchStepText: Record<SearchStep, string> = { planning: '正在拆解检索词…', searching: '正在检索相关资料…', organizing: '正在整理文献卡片…' };
const evidenceText = { abstract: '依据摘要', snippet: '依据网页摘录', 'web-summary': '依据联网模型综述', metadata: '仅有书目信息' };
const legacyLevels = { introduction: '入门', intermediate: '进阶', advanced: '深入' };
const bucketLabels: Record<ReadingBucket, string> = {
  overview: '综述 / 入门 · 建议粗读', deep_dive: '技术 · 建议精读', brief: '简报 · 建议扫读',
};
const mediaLabels: Record<MediaType, string> = { paper: '论文 / PDF', web: '网页资料', video_course: '视频 / 网课', repo: '代码仓库' };

export function ResearchSourceCard({ source, map, number, readingActions, children }: {
  source: InquirySource; map?: boolean; number?: number; readingActions?: ReactNode; children?: ReactNode;
}) {
  const descriptive = hasResearchEvidence(source);
  const summary = descriptive ? source.decisionSummary : undefined;
  const bucket = descriptive && source.readingBucket;
  const legacyLabel = descriptive && [source.category, source.difficulty && t(legacyLevels[source.difficulty])].filter(Boolean).join(' · ');
  const metadata = [source.authors, source.year, source.venue ?? t(source.provider)].filter(Boolean).join(' · ');
  const video = source.mediaType === 'video_course';
  const watchFirst = video && !source.pdfUrl;
  const videoNote = video && t('请在原网站观看。可关联本地 PDF 讲义。');
  const depth = descriptive ? summary?.depth : t('暂无法判断内容深度。');
  const caveat = [
    descriptive ? summary?.caveat : t('缺少摘要或正文片段，可先打开来源确认。'), videoNote,
  ].filter(Boolean).join(' ');
  const openSource = <a className={'document-tool-button' + (watchFirst ? ' research-watch-button' : '')}
    href={source.webUrl} target="_blank" rel="noreferrer noopener"><ArrowUpRight size={14} />{t(video ? '打开观看' : '打开原文')}</a>;

  return <article className="inquiry-source" id={map ? 'inquiry-' + source.id : undefined} tabIndex={map ? -1 : undefined}>
    <div className="research-source-labels">
      {source.proofMaterial === 'guide' ? <span className="research-bucket">{t('证明导读')}</span>
        : bucket ? <span className="research-bucket">{t(bucketLabels[bucket])}</span> : <span>{legacyLabel || t('未分类')}</span>}
      <small>{t(evidenceText[descriptive ? source.evidence : 'metadata'])}</small>
    </div>
    <h3 title={source.title}>{number !== undefined && <span className="research-card-number">{t('资料 {0}', [number])} · </span>}{source.title}</h3>
    <div className="inquiry-source-meta research-source-meta">
      <span className="research-publication" title={metadata}>{metadata}</span>
      {source.mediaType && <span>· {t(mediaLabels[source.mediaType])}</span>}
      {source.citationCount !== undefined && <span title={t('{0} 引用 {1}', [source.citationProvider || source.provider, source.citationCount])}>
        · {t('引用 {0}', [source.citationCount])}
      </span>}
    </div>
    {descriptive && !summary && <p>{source.coverage || textPreview(source.excerpt || '', 280)}</p>}
    {(summary || depth || caveat) && <dl className="research-decision">
      {summary && <div><dt>{t('切入')}</dt><dd>{summary.angle}</dd></div>}
      {depth && <div><dt>{t('深度')}</dt><dd>{depth}</dd></div>}
      {caveat && <div><dt>{t('注意')}</dt><dd>{caveat}</dd></div>}
    </dl>}
    {map && source.note && <p className="inquiry-source-note">{source.note}</p>}
    <div className="inquiry-source-actions">
      {watchFirst && openSource}
      {children}
      {!watchFirst && openSource}
    </div>
    {readingActions && <div className="research-reading-actions">{readingActions}</div>}
  </article>;
}
