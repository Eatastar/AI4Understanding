import { hasProofCheckDetails, matchesProofWork, matchesResearchTarget, researchTextKey } from '../shared/research.mjs';

const evidenceScore = { metadata: 0, 'web-summary': 3, snippet: 4, abstract: 5 };
const webProviders = new Set(['Model web search', 'Tavily']);
const majorProblem = /黎曼猜想|哥德巴赫猜想|霍奇猜想|冰雹猜想|孪生素数猜想|千禧年(?:问题|难题)|\b(?:riemann|hodge|goldbach|collatz|twin prime|birch and swinnerton.dyer) (?:hypothesis|conjecture)\b|\bp\s*(?:vs\.?|versus|=|≠)\s*np\b|\bnavier.stokes\b.*\b(?:smoothness|existence)\b/iu;
const proofClaim = /(?:完整|直接|严格|简短|初等|一页|最终|几何|代数|解析)证明|(?:证明|攻克|解决)了|的证明|\b(?:direct|elementary|short|complete|one[- ]page|simple) proofs?\b|\b(?:proofs? of|disproof of|proves?|proving|solved|solution to|resolution of)\b|\bproofs?[\s.!?]*$/iu;
const releaseLanguage = /(?:宣布|声称|发布|宣称).{0,20}(?:证明|突破)|\b(?:announc\w*|claim\w*|releas\w*|post\w*|publish\w*)\b[^.!?\n]{0,130}\b(?:proof|formalization|source archive|lean archive|lean repository|breakthrough)\b|\b(?:proof|breakthrough) (?:announcement|claim)\b/iu;
const commentaryLanguage = /提纲|导读|拆解|证明(?:思路|路线|结构|评述)|同行评(?:论|议)|漏洞分析|\b(?:blueprint|roadmap|outline|exposition|proof (?:sketch|strategy|architecture|structure|breakdown)|reading guide|explainer|critique|commentary|technical review|peer discussion|walkthrough)\b/iu;
const contextLanguage = /综述|导论|讲义|入门|\b(?:survey|lecture notes|tutorial|primer|introduction|handbook|overview|foundations)\b/iu;
const qualifiedTitle = /条件性|部分结果|综述|历史|证明方法|证明思路|\b(?:conditional|partial|approaches|attempts|review|discussion|survey|history|status|prospects|equivalent|consequences|guide|sketch|outline|roadmap|blueprint)\b/iu;
const recognizableVenue = /\b(?:annals of mathematics|journal of the american mathematical society|inventiones mathematicae|acta mathematica|duke mathematical journal|transactions of the american mathematical society|proceedings of the london mathematical society|journal of number theory|international mathematics research notices|siam journal|nature|science|physical review letters|communications of the acm)\b/iu;
const topicStopWords = new Set(['the', 'for', 'and', 'with', 'from', 'this', 'that', 'what', 'about', 'latest', 'proof', 'proving', 'conjecture', 'hypothesis', 'survey', 'overview', 'tutorial', 'research', 'papers', 'paper', 'lecture', 'notes', 'official', 'release', 'verification', 'outline']);

function targetRank(record, targets) {
  if (targets.some(target => matchesResearchTarget(record.authors, target))) return 3;
  if (targets.some(target => matchesResearchTarget(record.title, target))) return 2;
  return record.excerpt && targets.some(target => matchesResearchTarget(record.excerpt, target)) ? 1 : 0;
}

function trustedWebsite(record) {
  const hostname = new URL(record.webUrl).hostname;
  return /(?:^|\.)(?:arxiv\.org|mathoverflow\.net|claymath\.org|quantamagazine\.org|lean-fro\.org)$/u.test(hostname)
    || /\.(?:edu|ac\.uk|edu\.cn)$/u.test(hostname);
}

function mergeRecords(record, other) {
  if (other.excerpt && evidenceScore[other.evidence] > evidenceScore[record.evidence]) {
    record.excerpt = other.excerpt;
    record.evidence = other.evidence;
  }
  for (const field of ['authors', 'year', 'pdfUrl', 'doi', 'mediaType']) {
    if (record[field] === undefined && other[field] !== undefined) record[field] = other[field];
  }
  if (other.venue && (!record.venue || record.venue.startsWith('arXiv · ') && !other.venue.startsWith('arXiv · '))) record.venue = other.venue;
  if (other.citationCount !== undefined && record.citationCount === undefined) {
    record.citationCount = other.citationCount;
    record.citationProvider = other.citationProvider;
  }
}

function mergeCandidates(groups, currentProof) {
  const candidates = [];
  for (const group of groups) for (const candidate of group.records) {
    const existing = candidates.find(entry => candidate.identity.some(key => entry.identity.has(key)
      && (!key.startsWith('title:') || !currentProof
        && !webProviders.has(entry.record.provider) && !webProviders.has(candidate.record.provider)
        && !(entry.record.doi && candidate.record.doi && entry.record.doi !== candidate.record.doi))));
    if (existing) {
      mergeRecords(existing.record, candidate.record);
      for (const key of candidate.identity) existing.identity.add(key);
      if (group.track) existing.tracks.add(group.track);
      existing.publicationType ??= candidate.publicationType;
    } else {
      candidates.push({
        ...candidate, identity: new Set(candidate.identity), record: { ...candidate.record },
        tracks: new Set(group.track ? [group.track] : []), fallback: group.fallback === true,
      });
    }
  }
  return candidates;
}

export function rankResearchCandidates(groups, { target, searchTarget, commentaryTarget, topic, currentProof = false } = {}) {
  const targets = [target, searchTarget].filter(Boolean);
  const keywords = researchTextKey(topic).split(' ').filter(word => word.length >= 3 && !topicStopWords.has(word));
  return mergeCandidates(groups, currentProof).map(candidate => {
    const { record, tracks, publicationType, fallback } = candidate;
    const searchable = [record.title, record.authors, record.excerpt].filter(Boolean).join(' ');
    const match = targetRank(record, targets);
    const topicallyRelated = !keywords.length || keywords.some(word => matchesResearchTarget(searchable, word));
    const web = webProviders.has(record.provider);
    const academic = !web || record.mediaType === 'paper';
    const strongVenue = recognizableVenue.test(record.venue || '');
    const published = strongVenue || Boolean(record.venue && ['journal-article', 'proceedings-article'].includes(publicationType));
    const guide = Boolean(record.excerpt && (tracks.has('commentary') && !currentProof || commentaryLanguage.test(searchable)));
    const check = Boolean(web && record.excerpt && hasProofCheckDetails(record.excerpt) && !guide);
    const release = !guide && !check && releaseLanguage.test(searchable);
    const extraordinary = !qualifiedTitle.test(record.title) && majorProblem.test(record.title) && proofClaim.test(record.title);
    const loneClaim = !guide && !check && (extraordinary
      || tracks.has('primary') && release && (currentProof || /\b(?:claims?|announced|breakthrough)\b|声称|宣称|宣布/iu.test(searchable)));
    const likelyNoise = extraordinary && !strongVenue && !check && !guide && match < 2
      && (web ? !release && !trustedWebsite(record) : !record.citationCount);
    const track = fallback ? 'context' : web && guide && (currentProof || tracks.has('commentary')) ? 'commentary'
      : !loneClaim && !check && (contextLanguage.test(record.title) || currentProof && !release && match < 2) ? 'context' : 'primary';
    const citationBonus = academic && record.citationCount > 0 ? Math.min(5, Math.log10(record.citationCount + 1) * 2) : 0;
    const score = (record.provider === 'Crossref' ? 0 : 2) + evidenceScore[record.evidence] + citationBonus
      + (published ? 3 : 0) + (web && trustedWebsite(record) ? 3 : 0)
      + (release || check ? 3 : 0) + match * 3 + (topicallyRelated ? 1 : -4) - (likelyNoise ? 26 : 0);
    const related = Boolean(match || !targets.length || track === 'context' && topicallyRelated);
    const commentaryMatches = !commentaryTarget || !tracks.has('commentary') || tracks.has('primary') || matchesProofWork(searchable, commentaryTarget);
    const eligible = related && commentaryMatches && score >= 0 && (!fallback || topicallyRelated);
    return {
      record, score, eligible, quality: eligible && (topicallyRelated || match > 0) && Boolean(record.excerpt) && score >= 4,
      assessment: {
        track,
        ...(match >= 2 ? { named: true } : {}),
        ...(loneClaim ? { credibilityFlag: 'unverified_extraordinary_claim' } : {}),
        ...(check ? { proofCheck: true } : {}),
        ...(fallback ? { fallback: true } : {}),
      },
    };
  }).sort((a, b) => b.score - a.score);
}

export function selectResearchCandidates(ranked, limit, { balanced = false, specific = false, currentProof = false } = {}) {
  let crossrefCount = 0;
  const eligible = ranked.filter(item => item.eligible);
  const accepted = [];
  const add = item => {
    if (accepted.length >= limit || accepted.includes(item) || item.record.provider === 'Crossref' && crossrefCount >= 2) return;
    if (item.record.provider === 'Crossref') crossrefCount++;
    accepted.push(item);
  };
  if (balanced) {
    const primary = eligible.filter(item => item.assessment.track === 'primary');
    const commentary = eligible.filter(item => item.assessment.track === 'commentary');
    const context = eligible.filter(item => item.assessment.track === 'context');
    const check = currentProof && primary.find(item => item.assessment.proofCheck);
    const release = currentProof && primary.find(item => item.assessment.credibilityFlag);
    const selectedPrimary = [...new Set([release, check, ...primary].filter(Boolean))];
    selectedPrimary.slice(0, 2).forEach(add);
    commentary.slice(0, 3).forEach(add);
    context.slice(0, 1).forEach(add);
    commentary.slice(3, 5).forEach(add);
    context.slice(1, 2).forEach(add);
    if (!specific) eligible.forEach(add);
  } else eligible.forEach(add);
  return accepted;
}
