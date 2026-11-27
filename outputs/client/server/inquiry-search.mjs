import { createHash } from 'node:crypto';
import { lookup } from 'node:dns';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { errorDetails } from './diagnostics.mjs';
import { isEnglishResearchQuery, proofWorkHint, RESEARCH_BUDGETS, RESEARCH_TARGET_LIMIT, researchDoi, researchTextKey, researchTitleKey, researchUrlKey, targetedResearchQuery } from '../shared/research.mjs';
import { rankResearchCandidates, selectResearchCandidates } from './inquiry-rank.mjs';

const PDF_MS = 30000;
const PDF_LIMIT = 50 * 1024 * 1024;
const PDF_SIGNATURE = Buffer.from('%PDF-');
const USER_AGENT = 'AI4Understanding';
export const MODEL_WEB_PROVIDER = 'Model web search';

export class InquiryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return;
  try {
    const url = new URL(value.replace(/^http:\/\//i, 'https://'));
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.hostname.includes('.') && !url.hostname.endsWith('.local') && !isIP(url.hostname)) return url;
  } catch { /* Omit invalid URLs returned by an index. */ }
}

function xmlText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (token, name) => {
    if (name[0] !== '#') return entities[name] || token;
    const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : token;
  });
}

const clean = (value, limit) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, limit).trim() : '';
const arxivId = value => typeof value === 'string' && /^[A-Za-z.-]+\/\d{7}(v\d+)?$|^\d{4}\.\d{4,6}(v\d+)?$/u.test(value) ? value : '';
const arxivPath = url => url?.hostname === 'arxiv.org' ? arxivId(url.pathname.replace(/^\/(?:abs|pdf)\//, '').replace(/\.pdf$/i, '')) : '';
const repositoryHosts = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);
const repositorySections = new Set(['apps', 'codespaces', 'collections', 'explore', 'groups', 'marketplace', 'orgs', 'settings', 'sponsors', 'topics', 'users']);

function linkedMediaType(url) {
  const host = url.hostname.replace(/^www\./u, '');
  const path = url.pathname;
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if ((path === '/watch' && url.searchParams.has('v')) || (path === '/playlist' && url.searchParams.has('list'))
      || /^\/(?:shorts|live)\/[\w-]+/u.test(path)) return 'video_course';
  }
  if (host === 'youtu.be' && /^\/[\w-]+\/?$/u.test(path)
    || host === 'bilibili.com' && /^\/(?:video|bangumi\/play)\/[\w-]+/u.test(path)
    || (host === 'vimeo.com' || host === 'player.vimeo.com') && /^\/(?:video\/)?\d+\/?$/u.test(path)
    || host === 'coursera.org' && /^\/(?:learn|specializations)\/[^/]+/u.test(path)
    || (host === 'edx.org' || host === 'ocw.mit.edu') && /^\/courses?\/[^/]+/u.test(path)) return 'video_course';
  const repository = repositoryHosts.has(host) && /^\/([\w.-]+)\/([\w.-]+)\/?$/u.exec(path);
  if (repository && !repositorySections.has(repository[1].toLowerCase())) return 'repo';
  if (arxivPath(url) || /\.pdf$/iu.test(path)) return 'paper';
}

function source(provider, { title, authors, year, excerpt, url, pdf, doi, arxiv, evidence, venue, citationCount, mediaType }) {
  title = clean(title, 420);
  const webUrl = publicUrl(url);
  if (!title || !webUrl) return;
  const pdfUrl = publicUrl(pdf);
  mediaType ??= linkedMediaType(webUrl) ?? (provider === 'Tavily' || provider === MODEL_WEB_PROVIDER ? 'web' : undefined);
  const pdfIdentity = mediaType === 'video_course' || mediaType === 'repo' ? undefined : pdfUrl;
  const arxivKey = (arxivId(arxiv) || arxivPath(webUrl) || arxivPath(pdfIdentity)).replace(/v\d+$/u, '');
  const normalizedDoi = researchDoi(doi) || researchDoi(webUrl.href);
  const titleKey = researchTitleKey(title);
  const identity = [
    arxivKey && 'arxiv:' + arxivKey.toLowerCase(), normalizedDoi && 'doi:' + normalizedDoi,
    researchUrlKey(webUrl.href), researchUrlKey(pdfIdentity?.href), titleKey && 'title:' + (mediaType ?? '') + ':' + titleKey,
  ].filter(Boolean);
  const id = 'source-' + createHash('sha256').update(identity[0]).digest('hex').slice(0, 24);
  const byline = clean(authors, 240);
  const description = clean(excerpt, 1600);
  const publicationYear = Number(year);
  const publicationVenue = clean(venue, 200);
  return {
    identity,
    record: {
      id, provider, title, webUrl: webUrl.href,
      evidence: description ? evidence || (provider === 'Tavily' ? 'snippet' : 'abstract') : 'metadata',
      ...(description ? { excerpt: description } : {}),
      ...(byline ? { authors: byline } : {}),
      ...(Number.isInteger(publicationYear) && publicationYear >= 1000 && publicationYear <= 3000 ? { year: publicationYear } : {}),
      ...(pdfUrl ? { pdfUrl: pdfUrl.href } : {}),
      ...(normalizedDoi ? { doi: normalizedDoi } : {}),
      ...(publicationVenue ? { venue: publicationVenue } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(Number.isSafeInteger(citationCount) && citationCount >= 0 ? { citationCount, citationProvider: provider } : {}),
    },
  };
}

function arxivResults(atom) {
  if (!/<feed(?:\s|>)/u.test(atom)) throw new Error('Invalid Atom response');
  const tag = (entry, name) => xmlText(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'u').exec(entry)?.[1] || '');
  return [...atom.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gu)].slice(0, 8).flatMap(([, entry]) => {
    const id = arxivPath(publicUrl(tag(entry, 'id')));
    if (!id) return [];
    const category = /<arxiv:primary_category\b[^>]*\bterm=["']([a-z][a-zA-Z0-9.-]{0,31})["']/u.exec(entry)?.[1];
    const result = source('arXiv', {
      arxiv: id, doi: tag(entry, 'arxiv:doi'), title: tag(entry, 'title'),
      authors: [...entry.matchAll(/<author>([\s\S]*?)<\/author>/gu)].slice(0, 6).map(([, author]) => tag(author, 'name')).join(', '),
      year: tag(entry, 'published').slice(0, 4), excerpt: tag(entry, 'summary'),
      url: 'https://arxiv.org/abs/' + id, pdf: 'https://arxiv.org/pdf/' + id,
      venue: tag(entry, 'arxiv:journal_ref').trim() || (category ? 'arXiv · ' + category : undefined),
      mediaType: 'paper',
    });
    return result ? [result] : [];
  });
}

function semanticResults(data) {
  if (!data || !Array.isArray(data.data)) throw new Error('Invalid Academic Graph response');
  return data.data.slice(0, 8).flatMap(paper => {
    if (!paper || typeof paper !== 'object') return [];
    const arxiv = arxivId(paper.externalIds?.ArXiv);
    const result = source('Semantic Scholar', {
      title: paper.title, authors: Array.isArray(paper.authors) ? paper.authors.slice(0, 6).map(author => clean(author?.name, 120)).filter(Boolean).join(', ') : '',
      year: paper.year, excerpt: paper.abstract, arxiv, doi: paper.externalIds?.DOI,
      url: paper.url || (arxiv ? 'https://arxiv.org/abs/' + arxiv : undefined),
      pdf: arxiv ? 'https://arxiv.org/pdf/' + arxiv : paper.openAccessPdf?.url,
      venue: paper.venue, citationCount: paper.citationCount, mediaType: 'paper',
    });
    return result ? [result] : [];
  });
}

function crossrefResults(data) {
  if (!Array.isArray(data?.message?.items)) throw new Error('Invalid Crossref response');
  return data.message.items.slice(0, 5).flatMap(work => {
    if (!work || !researchDoi(work.DOI) || !Array.isArray(work.title)) return [];
    const result = source('Crossref', {
      title: work.title[0], doi: work.DOI,
      url: 'https://doi.org/' + work.DOI.split('/').map(encodeURIComponent).join('/'),
      authors: Array.isArray(work.author) ? work.author.slice(0, 6).map(author => [author?.given, author?.family].filter(Boolean).join(' ')).filter(Boolean).join(', ') : '',
      year: work.issued?.['date-parts']?.[0]?.[0],
      excerpt: typeof work.abstract === 'string' ? xmlText(work.abstract.replace(/<[^>]*>/gu, ' ')) : undefined,
      venue: Array.isArray(work['container-title']) ? work['container-title'][0] : undefined,
      citationCount: work['is-referenced-by-count'],
      mediaType: ['journal-article', 'proceedings-article', 'posted-content'].includes(work.type) ? 'paper' : undefined,
    });
    return result ? [{ ...result, publicationType: work.type }] : [];
  });
}

function tavilyResults(data) {
  if (!data || !Array.isArray(data.results)) throw new Error('Invalid web search response');
  return data.results.slice(0, 4).flatMap(item => {
    const url = publicUrl(item?.url);
    const result = url && source('Tavily', {
      title: item.title, excerpt: item.content, url: url.href,
      year: typeof item.published_date === 'string' ? /^(\d{4})-\d{2}-\d{2}/u.exec(item.published_date)?.[1] : undefined,
      pdf: /\.pdf$/i.test(url.pathname) || url.hostname === 'arxiv.org' && url.pathname.startsWith('/pdf/') ? url.href : undefined,
      venue: url.hostname,
    });
    return result ? [result] : [];
  });
}

export function modelWebSource({ url, title, excerpt, evidence }) {
  const link = publicUrl(url);
  if (!link) return;
  const arxiv = arxivPath(link);
  return source(MODEL_WEB_PROVIDER, {
    url: link.href, title: clean(title, 420) || link.hostname, excerpt, evidence,
    pdf: arxiv ? 'https://arxiv.org/pdf/' + arxiv : /\.pdf$/i.test(link.pathname) ? link.href : undefined,
    venue: link.hostname,
  });
}

export async function responseText(response) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new InquiryError(response.status, 'Search provider rejected the request');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing search response');
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error('Search response too large');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function searchFailure(error) {
  if (error?.status === 429) return 'limited';
  if (error?.status === 401 || error?.status === 403) return 'access';
  if (error?.status === 408 || error?.status === 504 || error?.name === 'TimeoutError') return 'timeout';
  const { code } = errorDetails(error);
  return /(?:_TIMEOUT|_TIMED_OUT|^ETIMEDOUT)$/u.test(code) ? 'timeout' : 'unavailable';
}

export function createInquirySearch({ fetch: fetchSource = globalThis.fetch, now = Date.now, webKey = () => '', modelWebSearch } = {}) {
  let arxivInFlight = false;
  const nextRequest = new Map();
  return async (input, signal) => {
    signal.throwIfAborted();
    const scope = input?.scope ?? 'project';
    if (typeof scope !== 'string' || !Object.hasOwn(RESEARCH_BUDGETS, scope)) throw new InquiryError(400, '请选择有效的检索范围。');
    const budget = RESEARCH_BUDGETS[scope];
    const commentaryQuery = scope === 'project' ? clean(input?.commentaryQuery, 240) : '';
    if (!Array.isArray(input?.queries) || !input.queries.length || input.queries.length + Number(Boolean(commentaryQuery)) > budget.queries ||
      input.queries.some(query => typeof query !== 'string' || !query.trim() || query.length > 240)) throw new InquiryError(400, '请输入有效的检索词。');
    const target = input.target === undefined ? undefined : clean(input.target, RESEARCH_TARGET_LIMIT + 1);
    if (target !== undefined && (target.length > RESEARCH_TARGET_LIMIT || researchTextKey(target).length < 2)) {
      throw new InquiryError(400, '请输入有效的检索词。');
    }
    const searchTarget = target && isEnglishResearchQuery(input.searchTarget) ? clean(input.searchTarget, RESEARCH_TARGET_LIMIT) : undefined;
    const commentaryTarget = scope === 'project' && clean(input.commentaryTarget, RESEARCH_TARGET_LIMIT) || undefined;
    const topic = clean(input.topic, 200);
    const planned = input.intent === 'specific_work_or_claim' || input.intent === 'broad_topic';
    const specific = input.intent === 'specific_work_or_claim' || Boolean(target);
    const webOnly = scope === 'web' || scope === 'project' && input.webOnly === true;
    const academicTarget = isEnglishResearchQuery(target) ? target : searchTarget;
    const queries = input.queries.map(query => query.trim());
    const webQuery = targetedResearchQuery(queries.includes(input.webQuery) ? input.webQuery : queries[0], searchTarget || target);
    const academicQueries = queries.filter(isEnglishResearchQuery).map((query, index) => index === 0 ? targetedResearchQuery(query, academicTarget) : query);
    const currentProof = input.currentProof === true;
    const proofSince = currentProof ? new Date(now() - 365 * 86400000).toISOString().slice(0, 10) : undefined;
    const arxivText = text => clean(text.replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' '), 160);
    const atomTerm = value => 'all:"' + value + '"';
    const dateRange = proofSince && 'submittedDate:[' + proofSince.replaceAll('-', '') + '0000 TO '
      + new Date(now()).toISOString().slice(0, 10).replaceAll('-', '') + '2359]';
    const arxivQuery = academicQueries.map(arxivText).filter(Boolean).map((term, index) => {
      const expression = specific || currentProof || planned ? term.split(' ').slice(0, 8).map(atomTerm).join(' AND ') : atomTerm(term);
      return dateRange && (index === 0 || !planned) ? '((' + expression + ') AND ' + dateRange + ')' : expression;
    }).join(' OR ');
    const arxivUrl = new URL('https://export.arxiv.org/api/query');
    const limit = String(Math.min(8, budget.results));
    arxivUrl.search = new URLSearchParams({
      search_query: arxivQuery, max_results: limit, sortBy: proofSince ? 'lastUpdatedDate' : 'relevance',
      ...(proofSince ? { sortOrder: 'descending' } : {}),
    }).toString();
    const academicUrl = (query, recent) => {
      const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
      url.search = new URLSearchParams({
        query, limit, fields: 'title,authors,year,abstract,url,openAccessPdf,externalIds,venue,citationCount',
        ...(recent && proofSince ? { year: proofSince.slice(0, 4) + '-' } : {}),
      }).toString();
      return url;
    };
    const crossrefUrl = new URL('https://api.crossref.org/v1/works');
    crossrefUrl.search = new URLSearchParams({
      'query.bibliographic': academicQueries[0] || '', rows: '5', select: 'DOI,title,author,issued,abstract,container-title,is-referenced-by-count,type',
      ...(proofSince ? { filter: 'from-pub-date:' + proofSince } : {}),
    }).toString();
    const web = scope === 'papers' ? 'academic' : input.webSource;
    if (web !== undefined && web !== 'academic' && web !== 'tavily' && (typeof web !== 'string' || !/^model:[A-Za-z0-9_-]{1,80}$/u.test(web))) {
      throw new InquiryError(400, '请选择有效的网页检索来源。');
    }
    const key = web === undefined || web === 'tavily' ? webKey() : '';
    const modelId = typeof web === 'string' && web.startsWith('model:') ? web.slice(6) : '';
    const request = async (provider, url, parse, options = {}) => {
      signal.throwIfAborted();
      const issues = issue => ({ provider, issue, records: [] });
      if ((nextRequest.get(provider) || 0) > now() || provider === 'arXiv' && arxivInFlight) return issues('limited');
      if (provider === 'arXiv') {
        arxivInFlight = true;
        nextRequest.set(provider, now() + 3000);
      }
      try {
        const response = await fetchSource(url, { ...options, redirect: 'error', signal, headers: { 'User-Agent': USER_AGENT, ...options.headers } });
        return { provider, records: parse(await responseText(response)) };
      } catch (error) {
        signal.throwIfAborted();
        const issue = searchFailure(error);
        if (issue === 'limited') nextRequest.set(provider, now() + 30_000);
        return issues(issue);
      } finally { if (provider === 'arXiv') arxivInFlight = false; }
    };
    const scholarly = (query, recent = true) =>
      request('Semantic Scholar', academicUrl(query, recent), text => semanticResults(JSON.parse(text)));
    const rank = (groups, work = commentaryTarget) => rankResearchCandidates(groups, {
      target, searchTarget, topic, currentProof, commentaryTarget: searchTarget || target || work,
    });
    const searchAcademic = async () => {
      if (webOnly || !academicQueries.length) return [];
      const results = await Promise.all([
        ...(arxivQuery ? [request('arXiv', arxivUrl, arxivResults)] : []),
        scholarly(academicQueries[0]),
      ]);
      signal.throwIfAborted();
      if (rank(results).filter(item => item.quality).length < 3) {
        results.push(await request('Crossref', crossrefUrl, text => crossrefResults(JSON.parse(text))));
      }
      return results;
    };
    const searchWeb = async (query, track) => {
      signal.throwIfAborted();
      const subject = track === 'context' ? undefined : searchTarget || target || (track === 'commentary' ? commentaryTarget : undefined);
      const since = track === 'context' ? undefined : proofSince;
      const untranslatedTopic = track === 'commentary' && !isEnglishResearchQuery(webQuery) ? webQuery : undefined;
      let result;
      if (modelId) {
        try {
          result = await modelWebSearch?.(modelId, query, signal, { track, target: subject, proofSince: since, untranslatedTopic })
            ?? { provider: MODEL_WEB_PROVIDER, records: [], issue: 'unverified' };
        } catch (error) {
          signal.throwIfAborted();
          result = { provider: MODEL_WEB_PROVIDER, records: [], issue: searchFailure(error) };
        }
      } else if (key) {
        const phrase = since && track === 'primary' ? query.slice(0, 245) + ' latest proof original release independent verification'
          : [untranslatedTopic, query].filter(Boolean).join(' ').slice(0, 320);
        result = await request('Tavily', 'https://api.tavily.com/search', text => tavilyResults(JSON.parse(text)), {
          method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: phrase, max_results: 4, search_depth: 'basic', include_answer: false, include_raw_content: false, auto_parameters: false,
            ...(since ? { time_range: 'year', include_published_date: true } : {}),
          }),
        });
      } else result = { provider: 'Tavily', records: [], issue: 'missing-key' };
      return { ...result, track };
    };
    const hasWeb = Boolean(key || modelId);
    const [academic, webResults] = await Promise.all([
      searchAcademic(),
      Promise.all([
        ...(hasWeb || web === 'tavily' || webOnly ? [searchWeb(webQuery, 'primary')] : []),
        ...(hasWeb && commentaryQuery ? [searchWeb(commentaryQuery, 'commentary')] : []),
      ]),
    ]);
    signal.throwIfAborted();
    const results = [...academic, ...webResults];
    const work = commentaryTarget || (currentProof ? proofWorkHint(webResults.find(result => result.track === 'primary')?.records.map(item => item.record) ?? [], 1) : undefined);
    let ranked = rank(results, work);
    if (scope === 'project' && planned && ranked.filter(item => item.quality).length < 2) {
      signal.throwIfAborted();
      const background = (topic || academicQueries[0] || queries[0]).slice(0, 192) + ' survey lecture notes background';
      const broader = hasWeb ? await searchWeb(background, 'context')
        : !webOnly && isEnglishResearchQuery(background) ? await scholarly(background, false) : undefined;
      signal.throwIfAborted();
      if (broader) {
        results.push({ ...broader, track: 'context', fallback: true });
        ranked = rank(results, work);
      }
    }
    const selected = selectResearchCandidates(ranked, budget.candidates, { balanced: scope === 'project', specific, currentProof });
    const issues = results.flatMap(({ provider, issue }) => issue ? [{ provider, issue }] : []);
    return {
      sources: selected.map(item => item.record),
      assessments: Object.fromEntries(selected.map(item => [item.record.id, item.assessment])),
      issues: issues.filter((item, index) => issues.findIndex(other => other.provider === item.provider && other.issue === item.issue) === index),
      ...(scope !== 'web' && !hasWeb ? { academicOnly: true } : {}),
    };
  };
}

const nonPublic = new BlockList();
for (const [network, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) nonPublic.addSubnet(network, bits);
for (const [network, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) nonPublic.addSubnet(network, bits, 'ipv6');
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');
const proxyDnsRange = new BlockList();
proxyDnsRange.addSubnet('198.18.0.0', 15);

export function requirePublicPdfAddresses(addresses) {
  if (addresses.length && addresses.every(({ address, family }) => family === 4 && proxyDnsRange.check(address))) {
    throw new InquiryError(400, '当前网络把这个域名解析到了保留地址。可打开原文，在浏览器下载后关联本地 PDF。');
  }
  const isPublic = ({ address, family }) => family === 4 ? !nonPublic.check(address)
    : family === 6 && globalIPv6.check(address, 'ipv6') && !nonPublic.check(address, 'ipv6');
  if (!addresses.length || !addresses.every(isPublic)) throw new InquiryError(400, '资料链接需指向公开网站。');
  return addresses;
}

function pinnedPublicLookup(host, options, callback) {
  lookup(host, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    try { requirePublicPdfAddresses(addresses); }
    catch (failure) { return callback(failure); }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

function openPublicPdf(url, signal) {
  return new Promise((resolve, reject) => {
    get(url, { signal, agent: false, lookup: pinnedPublicLookup, headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf, application/octet-stream' } }, resolve).once('error', reject);
  });
}

function canUsePdfProxy(url) {
  return url.origin === 'https://alpo.ge' && url.pathname === '/remark.pdf'
    || url.hostname === 'arxiv.org' && url.pathname.startsWith('/pdf/') && arxivPath(url)
    || url.hostname === 'pdfs.semanticscholar.org' && /^\/[0-9a-f]{4}\/[0-9a-f]{36}\.pdf$/iu.test(url.pathname);
}

async function openProxiedPdf(url, signal, fetchSource) {
  const response = await fetchSource(url, {
    signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf, application/octet-stream' },
  });
  return Object.assign(response.body ? Readable.fromWeb(response.body) : Readable.from([]), {
    statusCode: response.status, headers: Object.fromEntries(response.headers),
  });
}

export async function downloadInquiryPdf(value, signal, { open = openPublicPdf, trustedFetch, timeoutMs = PDF_MS, byteLimit = PDF_LIMIT } = {}) {
  if (typeof value !== 'string' || !value.startsWith('https://')) throw new InquiryError(400, '资料链接需指向公开网站。');
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = AbortSignal.any([signal, deadline]);
  let url = publicUrl(value);
  for (let redirects = 0; url && redirects <= 4; redirects++) {
    let response;
    try {
      requestSignal.throwIfAborted();
      // The system proxy is available to supported repositories and approved
      // public documents. Other publishers use DNS pinned to the TLS connection.
      response = trustedFetch && canUsePdfProxy(url) ? await openProxiedPdf(url, requestSignal, trustedFetch) : await open(url, requestSignal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && typeof response.headers.location === 'string') {
        const next = new URL(response.headers.location, url);
        url = next.protocol === 'https:' ? publicUrl(next.href) : undefined;
        continue;
      }
      if (response.statusCode !== 200) throw new InquiryError(502, '无法下载开放 PDF，请打开原文或关联本地文件。');
      const tooLarge = () => new InquiryError(413, '在线 PDF 超过 50 MB，可以下载后从本地打开。');
      if (Number(response.headers['content-length']) > byteLimit) throw tooLarge();
      const chunks = [];
      let size = 0, header = Buffer.alloc(0);
      for await (const chunk of response) {
        requestSignal.throwIfAborted();
        size += chunk.length;
        if (size > byteLimit) throw tooLarge();
        if (header.length < PDF_SIGNATURE.length) {
          header = Buffer.concat([header, chunk.subarray(0, PDF_SIGNATURE.length - header.length)]);
          if (!PDF_SIGNATURE.subarray(0, header.length).equals(header)) throw new InquiryError(422, '链接返回的内容不是 PDF。');
        }
        chunks.push(chunk);
      }
      if (!header.equals(PDF_SIGNATURE)) throw new InquiryError(422, '链接返回的内容不是 PDF。');
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (deadline.aborted) throw new InquiryError(504, '下载超时，请重试或关联本地文件。');
      if (error instanceof InquiryError) throw error;
      throw new InquiryError(502, '无法下载开放 PDF，请打开原文或关联本地文件。');
    } finally { response?.destroy(); }
  }
  throw new InquiryError(400, '资料链接需指向公开网站。');
}
