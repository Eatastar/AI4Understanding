import { hasProofCheckDetails, matchesResearchTarget, researchTextKey } from '../../shared/research.mjs';
import { hasResearchEvidence, type ResearchSource } from './inquiry';

export function identifiesProofWork(source: ResearchSource, work: string) {
  return [source.title, source.authors, source.excerpt].some(value => matchesResearchTarget(value, work));
}

export function corroboratedProofs(value: unknown, sources: readonly ResearchSource[]) {
  const pairs: { releaseId: string; checkId: string; work: string }[] = [];
  if (!Array.isArray(value)) return pairs;
  const byId = new Map(sources.map(source => [source.id, source]));
  for (const pair of value.slice(0, 4)) {
    if (!pair || typeof pair.work !== 'string' || typeof pair.quote !== 'string') continue;
    const work = pair.work.trim();
    const quote = researchTextKey(pair.quote);
    if (work.length < 3 || work.length > 96 || /猜想|证明|\b(?:conjecture|hypothesis|proof)\b/iu.test(work)
      || quote.length < 20 || pair.quote.length > 420 || !hasProofCheckDetails(pair.quote)) continue;
    const check = byId.get(pair.checkId), release = byId.get(pair.releaseId);
    if (!check || !release || !hasResearchEvidence(check) || !hasResearchEvidence(release)
      || !researchTextKey(check.excerpt).includes(quote) || !identifiesProofWork(check, work) || !identifiesProofWork(release, work)) continue;
    const checkHost = new URL(check.webUrl).hostname.replace(/^www\./u, '');
    const releaseHost = new URL(release.webUrl).hostname.replace(/^www\./u, '');
    if (checkHost === releaseHost || checkHost.endsWith('.' + releaseHost) || releaseHost.endsWith('.' + checkHost)) continue;
    pairs.push({ releaseId: release.id, checkId: check.id, work });
  }
  return pairs;
}

