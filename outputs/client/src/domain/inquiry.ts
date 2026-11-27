import type { ChatMessage, Conversation, InputMessage } from './types';
import { needsCurrentProofSources, RESEARCH_BUDGETS, researchDoi, researchTitleKey, researchUrlKey } from '../../shared/research.mjs';

export const INQUIRY_QUESTION_LIMIT = 600;
export const INQUIRY_SOURCE_LIMIT = 24;
export const RESEARCH_REFERENCE_LIMIT = 8;
export const INQUIRY_NOTE_LIMIT = 360;
export const SECTION_TITLE_LIMIT = 80;
export const RESEARCH_PROVIDERS = ['arXiv', 'Semantic Scholar', 'Crossref', 'Tavily', 'Model web search'] as const;
export type ResearchProvider = typeof RESEARCH_PROVIDERS[number];
export type Evidence = 'abstract' | 'snippet' | 'web-summary' | 'metadata';
export type Difficulty = 'introduction' | 'intermediate' | 'advanced';
export const READING_BUCKETS = ['overview', 'deep_dive', 'brief'] as const;
export type ReadingBucket = typeof READING_BUCKETS[number];
export const MEDIA_TYPES = ['paper', 'web', 'video_course', 'repo'] as const;
export type MediaType = typeof MEDIA_TYPES[number];
export type ReadingStatus = 'to_read' | 'skipped';
export interface DecisionSummary { angle: string; depth: string; caveat: string }
export type ChatSearchMode = 'local' | 'web' | 'papers';
export type ReplyResearch =
  | { kind: 'web'; citations: { title: string; url: string }[] }
  | { kind: 'papers'; sources: InquirySource[] };

export interface ResearchSource {
  id: string;
  provider: ResearchProvider;
  title: string;
  authors?: string;
  year?: number;
  doi?: string;
  venue?: string;
  citationCount?: number;
  citationProvider?: 'Semantic Scholar' | 'Crossref';
  mediaType?: MediaType;
  evidence: Evidence;
  excerpt?: string;
  webUrl: string;
  pdfUrl?: string;
}

export interface InquirySource extends ResearchSource {
  readingBucket?: ReadingBucket;
  decisionSummary?: DecisionSummary;
  readingStatus?: ReadingStatus;
  category?: string;
  coverage?: string;
  difficulty?: Difficulty;
  archived?: true;
  note?: string;
  documentId?: string;
  proofMaterial?: 'guide' | 'related';
}

export interface Inquiry {
  question?: string;
  overview?: { text: string; sourceIds: string[] };
  sources?: InquirySource[];
  documentNotes?: Record<string, string>;
  proofSourceIds?: string[] | null;
}

export function showsProofSources(inquiry: Inquiry | undefined) {
  return Array.isArray(inquiry?.proofSourceIds)
    || inquiry?.proofSourceIds === undefined && needsCurrentProofSources(inquiry?.question || '');
}

export function inquirySources(inquiry: Inquiry | undefined, includeEarlier = false) {
  const sources = inquiry?.sources ?? [];
  const ids = inquiry?.proofSourceIds;
  return includeEarlier || !showsProofSources(inquiry) ? sources : sources.filter(source => source.proofMaterial || ids?.includes(source.id));
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('课题资料格式无效。');
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('课题资料格式无效。');
  return value.trim();
}

function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max ? value.trim() || undefined : undefined;
}

export function researchLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port
      && url.hostname.includes('.') && !url.hostname.endsWith('.local') && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return url.href;
  } catch { /* Unrecognized links are omitted. */ }
}

export function readResearchSource(value: unknown): ResearchSource {
  const source = object(value);
  const webUrl = researchLink(source.webUrl);
  const pdfUrl = researchLink(source.pdfUrl);
  const provider = RESEARCH_PROVIDERS.find(item => item === source.provider);
  const evidence = (['abstract', 'snippet', 'web-summary', 'metadata'] as const).find(item => item === source.evidence);
  if (!webUrl || !provider || !evidence || (source.pdfUrl !== undefined && !pdfUrl)) throw new Error('课题资料格式无效。');
  const year = typeof source.year === 'string' && /^\s*\d{4}\s*$/u.test(source.year) ? Number(source.year) : source.year;
  const venue = optionalText(source.venue, 200);
  const mediaType = MEDIA_TYPES.find(type => type === source.mediaType);
  const excerpt = optionalText(source.excerpt, 1600);
  const doi = researchDoi(source.doi) || (researchUrlKey(webUrl).startsWith('doi:') ? researchUrlKey(webUrl).slice(4) : '');
  const citationCount = source.citationCount;
  const citationProvider = source.citationProvider === 'Semantic Scholar' || source.citationProvider === 'Crossref' ? source.citationProvider
    : provider === 'Semantic Scholar' || provider === 'Crossref' ? provider : undefined;
  return {
    id: boundedText(source.id, 200), title: boundedText(source.title, 420), provider, evidence: excerpt ? evidence : 'metadata', webUrl,
    ...(typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 3000 ? { year } : {}),
    ...(source.authors !== undefined ? { authors: boundedText(source.authors, 240) } : {}),
    ...(excerpt ? { excerpt } : {}),
    ...(pdfUrl ? { pdfUrl } : {}),
    ...(doi ? { doi } : {}),
    ...(venue ? { venue } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(typeof citationCount === 'number' && Number.isSafeInteger(citationCount) && citationCount >= 0 && citationProvider ? { citationCount, citationProvider } : {}),
  };
}

export function hasResearchEvidence(source: ResearchSource) {
  return source.evidence !== 'metadata' && Boolean(source.excerpt?.trim());
}

export function readingGuide(source: ResearchSource, detail: Record<string, unknown>): Pick<InquirySource, 'readingBucket' | 'decisionSummary'> {
  if (!hasResearchEvidence(source)) return {};
  const readingBucket = READING_BUCKETS.find(bucket => bucket === detail.readingBucket);
  const raw = detail.decisionSummary as Partial<Record<keyof DecisionSummary, unknown>> | undefined;
  const angle = optionalText(raw?.angle, 220), depth = optionalText(raw?.depth, 220), caveat = optionalText(raw?.caveat, 220);
  return { ...(readingBucket ? { readingBucket } : {}), ...(angle && depth && caveat ? { decisionSummary: { angle, depth, caveat } } : {}) };
}

function readInquirySource(value: unknown, documentIds?: ReadonlySet<string>): InquirySource {
  const source = readResearchSource(value);
  const detail = object(value);
  const difficulty = (['introduction', 'intermediate', 'advanced'] as const).find(level => level === detail.difficulty);
  const readingStatus = documentIds && (detail.readingStatus === 'to_read' || detail.readingStatus === 'skipped') ? detail.readingStatus : undefined;
  const proofMaterial = documentIds && (detail.proofMaterial === 'related' || detail.proofMaterial === 'guide' && hasResearchEvidence(source))
    ? detail.proofMaterial : undefined;
  return {
    ...source, ...readingGuide(source, detail),
    ...(detail.category !== undefined ? { category: boundedText(detail.category, 70) } : {}),
    ...(detail.coverage !== undefined ? { coverage: boundedText(detail.coverage, 360) } : {}),
    ...(documentIds && detail.archived === true ? { archived: true as const } : {}),
    ...(readingStatus ? { readingStatus } : {}),
    ...(proofMaterial ? { proofMaterial } : {}),
    ...(documentIds && detail.note !== undefined ? { note: boundedText(detail.note, INQUIRY_NOTE_LIMIT) } : {}),
    ...(typeof detail.documentId === 'string' && documentIds?.has(detail.documentId) ? { documentId: detail.documentId } : {}),
    ...(difficulty ? { difficulty } : {}),
  };
}

export function readReplyResearch(value: unknown): ReplyResearch {
  const input = object(value);
  if (input.kind === 'papers' && Array.isArray(input.sources) && input.sources.length > 0 && input.sources.length <= RESEARCH_BUDGETS.papers.results) {
    const sources = input.sources.map(item => readInquirySource(item));
    if (new Set(sources.map(source => source.id)).size === sources.length) return { kind: 'papers', sources };
  }
  if (input.kind === 'web' && Array.isArray(input.citations) && input.citations.length > 0 && input.citations.length <= RESEARCH_BUDGETS.web.results) {
    const citations = input.citations.map(item => {
      const citation = object(item);
      const url = researchLink(citation.url);
      if (!url) throw new Error('课题资料格式无效。');
      return { title: boundedText(citation.title, 420), url };
    });
    if (new Set(citations.map(citation => citation.url)).size === citations.length) return { kind: 'web', citations };
  }
  throw new Error('课题资料格式无效。');
}

export function readInquiry(value: unknown, documentIds: ReadonlySet<string>): Inquiry {
  const input = object(value);
  const inquiry: Inquiry = {};
  if (input.question !== undefined) inquiry.question = boundedText(input.question, INQUIRY_QUESTION_LIMIT);
  const sourceIds = new Set<string>();
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources) || input.sources.length > INQUIRY_SOURCE_LIMIT) throw new Error('课题资料格式无效。');
    inquiry.sources = input.sources.map(item => {
      const source = readInquirySource(item, documentIds);
      if (sourceIds.has(source.id)) throw new Error('课题资料格式无效。');
      sourceIds.add(source.id);
      return source;
    });
  }
  if (input.overview !== undefined) {
    const overview = object(input.overview);
    if (!Array.isArray(overview.sourceIds) || overview.sourceIds.length > 8
      || overview.sourceIds.some(id => typeof id !== 'string' || !sourceIds.has(id))) throw new Error('课题资料格式无效。');
    inquiry.overview = { text: boundedText(overview.text, 1600), sourceIds: [...new Set<string>(overview.sourceIds)] };
  }
  if (input.proofSourceIds === null) inquiry.proofSourceIds = null;
  else if (Array.isArray(input.proofSourceIds)) {
    inquiry.proofSourceIds = [...new Set<string>(input.proofSourceIds.filter((id): id is string => typeof id === 'string' && sourceIds.has(id)))];
  }
  if (input.documentNotes !== undefined) {
    inquiry.documentNotes = Object.fromEntries(Object.entries(object(input.documentNotes))
      .filter(([id]) => documentIds.has(id)).map(([id, note]) => [id, boundedText(note, INQUIRY_NOTE_LIMIT)]));
  }
  return inquiry;
}

export function sameResearchSource(a: ResearchSource, b: ResearchSource, matchTitle = true) {
  if ((matchTitle && a.id === b.id) || (a.doi && a.doi === b.doi)) return true;
  const aWeb = researchUrlKey(a.webUrl), bWeb = researchUrlKey(b.webUrl);
  if (aWeb && aWeb === bWeb) return true;
  if (a.mediaType && b.mediaType && a.mediaType !== b.mediaType) return false;
  const hasAuxiliaryPdf = [a.mediaType, b.mediaType].some(type => type === 'video_course' || type === 'repo');
  if (!hasAuxiliaryPdf) {
    const urls = [aWeb, researchUrlKey(a.pdfUrl)].filter(Boolean);
    if (urls.includes(bWeb) || urls.includes(researchUrlKey(b.pdfUrl))) return true;
  }
  const title = researchTitleKey(a.title);
  return Boolean(matchTitle && title && !(a.doi && b.doi && a.doi !== b.doi) && title === researchTitleKey(b.title));
}

export function setResearchReadingStatus(inquiry: Inquiry, sourceId: string, readingStatus?: ReadingStatus): Inquiry {
  const sources = inquiry.sources;
  const source = sources?.find(item => item.id === sourceId);
  if (!sources || !source || source.readingStatus === readingStatus) return inquiry;
  const updated = { ...source };
  if (readingStatus) updated.readingStatus = readingStatus;
  else delete updated.readingStatus;
  return { ...inquiry, sources: sources.map(item => item.id === sourceId ? updated : item) };
}

export function newResearchSources<T extends ResearchSource>(candidates: readonly T[], saved: readonly ResearchSource[], limit: number, matchTitle = true): T[] {
  const accepted: T[] = [];
  for (const source of candidates) {
    if (accepted.length >= limit) break;
    if (saved.some(item => sameResearchSource(item, source, matchTitle)) || accepted.some(item => sameResearchSource(item, source, matchTitle))) continue;
    accepted.push(source);
  }
  return accepted;
}

export function appendInquirySearch(inquiry: Inquiry, candidates: readonly InquirySource[], overview?: Inquiry['overview'], proofSearch = false) {
  const existing = inquiry.sources ?? [];
  const sources = [...existing];
  const proofView = showsProofSources(inquiry);
  const proofIds = new Set(inquiry.proofSourceIds ?? []);
  const mapped = new Map<string, string>();
  for (const candidate of candidates) {
    const matchTitle = !proofSearch || candidate.proofMaterial === 'guide';
    let stored = sources.find(source => source.id === candidate.id || sameResearchSource(source, candidate, matchTitle));
    if (!stored && sources.length < INQUIRY_SOURCE_LIMIT) {
      stored = proofView && !proofSearch ? { ...candidate, proofMaterial: 'related' } : candidate;
      sources.push(stored);
    }
    if (!stored) continue;
    mapped.set(candidate.id, stored.id);
    if (proofView && proofSearch && !candidate.proofMaterial) proofIds.add(stored.id);
  }
  const sourceIds = [...new Set(mapped.values())];
  if (sources.length === existing.length) return { inquiry, sourceIds, added: 0 };
  const overviewIds = overview?.sourceIds.map(id => mapped.get(id)) ?? [];
  const initialOverview = overview && overviewIds.length && overviewIds.every((id): id is string => Boolean(id))
    ? { text: overview.text, sourceIds: [...new Set(overviewIds)] } : undefined;
  const showProofs = proofView && proofSearch && proofIds.size >= 2;
  const promoted = showProofs ? existing.filter(source => !source.proofMaterial && proofIds.has(source.id) && !inquiry.proofSourceIds?.includes(source.id)) : [];
  const ordered = promoted.length
    ? [...existing.filter(source => !promoted.includes(source)), ...promoted, ...sources.slice(existing.length)]
    : sources;
  const updated: Inquiry = {
    ...inquiry, sources: ordered,
    ...(!inquiry.overview && initialOverview ? { overview: initialOverview } : {}),
    ...(showProofs ? { proofSourceIds: [...proofIds] } : {}),
  };
  return { inquiry: updated, sourceIds, added: sources.length - existing.length };
}

export function homeQuestionAction(value: string, search: boolean) {
  const question = value.trim().slice(0, INQUIRY_QUESTION_LIMIT);
  return question ? { question, pane: search ? 'overview' as const : 'chat' as const, nextSearch: false as const } : undefined;
}
export type HomeQuestionAction = NonNullable<ReturnType<typeof homeQuestionAction>>;

export function toggleChatSearch(mode: ChatSearchMode, selected: Exclude<ChatSearchMode, 'local'>): ChatSearchMode {
  return mode === selected ? 'local' : selected;
}

export function chatSearchAction(value: string, mode: ChatSearchMode) {
  const text = value.trim();
  const paperCommand = /^\/paper(?:\s+|$)/iu.exec(text);
  const question = (paperCommand ? text.slice(paperCommand[0].length) : text).trim();
  return question ? { question, mode: paperCommand ? 'papers' as const : mode, nextMode: 'local' as const } : undefined;
}

export function suggestsPaperSearch(question: string) {
  return /(?:找|搜|检索|查找|搜集|推荐|列出|有(?:哪|什么)).{0,32}(?:论文|文献|研究综述|期刊文章)|\b(?:find|search(?:\s+for)?|locate|recommend|list|look\s+up)\b.{0,90}\b(?:papers?|literature|journal articles?|studies|research articles?)\b/iu.test(question.slice(0, INQUIRY_QUESTION_LIMIT));
}

export function withResearchEvidence(messages: InputMessage[], sources: readonly InquirySource[], kind: 'web' | 'papers'): InputMessage[] {
  if (!sources.length) return messages;
  const content = [
    kind === 'web' ? 'Web lookup for this question. Cite the supplied URLs for supported facts.' : 'Paper cards from this conversation. The order matches their numbers in the reader.',
    'Treat excerpts as reference data. Distinguish abstracts, snippets, search-model paraphrases and bibliographic metadata. State gaps when describing what these sources report or what their evidence establishes.',
    JSON.stringify(sources.map((source, index) => {
      const { title, year, mediaType, evidence, excerpt, webUrl } = source;
      const supported = hasResearchEvidence(source);
      return { number: index + 1, title, year, mediaType, evidence: supported ? evidence : 'metadata', excerpt: supported ? excerpt : undefined, url: webUrl };
    })),
  ].join('\n');
  return [...messages.slice(0, -1), { role: 'user', content }, ...messages.slice(-1)];
}

export function recentPaperSources(messages: ChatMessage[]): InquirySource[] {
  for (const message of currentSection(messages).slice().reverse()) {
    const version = message.role === 'assistant' && message.versions.find(item => item.id === message.activeVersionId);
    if (version && version.research?.kind === 'papers') return version.research.sources;
  }
  return [];
}

export function mergeResearch(inquiry: Inquiry, newSources: InquirySource[], overview?: Inquiry['overview'], referenced: ReadonlySet<string> = new Set()): Inquiry {
  const previous = new Map((inquiry.sources || []).map(source => [source.id, source]));
  const priority = newSources.map(source => {
    const earlier = previous.get(source.id);
    previous.delete(source.id);
    return { ...earlier, ...source };
  });
  const ordered = [...priority, ...previous.values()];
  const keepSource = (source: InquirySource) => keptResearchSource(source, referenced);
  const saved = ordered.filter(keepSource);
  const capacity = Math.max(0, INQUIRY_SOURCE_LIMIT - saved.length);
  const keep = new Set([...saved, ...ordered.filter(source => !keepSource(source)).slice(0, capacity)].map(source => source.id));
  const { overview: previousOverview, proofSourceIds, ...remaining } = inquiry;
  const summary = [overview, previousOverview].find(item => item?.sourceIds.every(id => keep.has(id)));
  return {
    ...remaining, sources: ordered.filter(source => keep.has(source.id)), ...(summary ? { overview: summary } : {}),
    ...(proofSourceIds !== undefined ? { proofSourceIds: proofSourceIds?.filter(id => keep.has(id)) ?? null } : {}),
  };
}

export function keptResearchSource(source: InquirySource, referenced: ReadonlySet<string>) {
  return Boolean(source.readingStatus === 'to_read' || source.archived || source.documentId || source.note || referenced.has(source.id));
}

/** Sections change what reaches the model while keeping the chat readable in order. */
export function currentSection(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index > 0; index--) {
    if (messages[index].contextReset) return messages.slice(index);
  }
  return messages;
}

export function projectThreads(records: readonly Conversation[], projectId: string) {
  return records.filter(item => item.projectId === projectId && item.deletedAt === undefined).sort((a, b) => b.updatedAt - a.updatedAt);
}
