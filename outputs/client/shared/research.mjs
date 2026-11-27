export const RESEARCH_BUDGETS = Object.freeze({
  project: Object.freeze({ queries: 3, candidates: 10, results: 8 }),
  papers: Object.freeze({ queries: 2, candidates: 5, results: 5 }),
  web: Object.freeze({ queries: 1, candidates: 4, results: 4 }),
});
export const RESEARCH_TARGET_LIMIT = 96;
export const PAPER_RESEARCH_MS = 15_000;

export function isEnglishResearchQuery(value) {
  return typeof value === 'string' && /\p{Script=Latin}/u.test(value)
    && !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(value);
}

export function needsCurrentProofSources(question, focus) {
  const request = [question, focus].filter(Boolean).join(' ');
  const selected = focus || question;
  const historical = /历史|历年|早期|经典|\b(?:history|historical|classical|earliest)\b|(?:19\d{2}|20\d{2})\s*年(?:的|以前)/iu;
  const recent = /最新|近期|最近|目前|现在|是否已|\b(?:latest|recent|current|as of|has .* been (?:proved|solved))\b/iu;
  if (historical.test(selected) && !recent.test(selected)) return false;
  return /猜想|千禧年|\b(?:conjecture|hypothesis|millennium problem)\b/iu.test(request)
    && /证明|证伪|解决|核验|攻克|\b(?:proof|prove|proved|proven|solved|verification)\b/iu.test(request);
}

export function hasProofCheckDetails(value) {
  if (typeof value !== 'string' || /\b(?:not yet checked|not yet verified|awaiting verification|could not reproduce|(?:failed to|could not) (?:re)?build|not match(?:ed|ing)?)\b|尚未核验|待独立验证|未能复现|构建失败/iu.test(value)) return false;
  const rebuilt = /\b(?:successfully (?:re)?(?:built|building)|independently (?:re)?built|(?:re)?build (?:passed|succeeded))\b|成功(?:重新构建|重建)|(?:重新构建|重建)成功/iu.test(value);
  const matchedStatement = /\b(?:theorems?|statements?)\b[^.!?\n]{0,120}\bmatch(?:es|ed)\b/iu.test(value);
  return rebuilt || matchedStatement || /(?:\b(?:reproduc\w*|compil\w*|kernels?|proof checkers?|compared|statement match\w*|independently (?:reviewed|verified|checked))\b|独立复核|独立核验|重新编译|定理陈述|证明检查器|内核验)/iu.test(value);
}

export function researchTextKey(value) {
  return typeof value === 'string'
    ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    : '';
}

export function matchesResearchTarget(value, target) {
  const text = researchTextKey(value), key = researchTextKey(target);
  if (!key) return false;
  return /\p{Script=Han}/u.test(key) ? text.includes(key) : (' ' + text + ' ').includes(' ' + key + ' ');
}

const nameInRelease = /(?:^|[^\p{L}\p{M}])(\p{Lu}[\p{Ll}\p{M}-]{2,}(?: \p{Lu}[\p{Ll}\p{M}-]{2,}){0,2})(?:[’']s (?:Lean |formal |claimed |announced )*(?:proof|formalization|release)| (?:released|announced|posted|published) [^.!?\n]{0,80}(?:proof|Lean|archive))/gu;
const genericWorkName = /\b(?:the|lean|claude|riemann|hypothesis|conjecture|proof|project|team|university|technical|formalization)\b/iu;

export function matchesProofWork(value, work) {
  if (matchesResearchTarget(value, work)) return true;
  const names = work.trim().split(/\s+/u);
  const last = names.at(-1);
  return names.length >= 2 && names.length <= 3 && last.length >= 4
    && names.every(name => /^\p{Lu}[\p{Ll}\p{M}-]+$/u.test(name)) && !genericWorkName.test(work)
    && matchesResearchTarget(value, last);
}

export function proofWorkHint(sources, minimumMatches = 2) {
  const evidence = sources.map(({ title, authors, excerpt }) => [title, authors, excerpt].filter(Boolean).join(' '));
  const names = evidence.flatMap(value => [...value.matchAll(nameInRelease)].map(match => match[1]));
  return [...new Set(names)].filter(name => !genericWorkName.test(name) && evidence.filter(value => matchesProofWork(value, name)).length >= minimumMatches)
    .sort((a, b) => b.split(' ').length - a.split(' ').length)[0];
}

export function targetedResearchQuery(query, target) {
  return target && !matchesResearchTarget(query, target) ? (target + ' ' + query).slice(0, 240).trimEnd() : query;
}

export function researchTitleKey(title) {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function researchDoi(value) {
  if (typeof value !== 'string' || value.length > 500) return '';
  let doi = value.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, '');
  try { doi = decodeURIComponent(doi); } catch { /* A DOI can contain a literal percent sign. */ }
  return /^10\.\d{4,9}\/\S+$/iu.test(doi) ? doi.toLowerCase() : '';
}

export function researchUrlKey(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const doi = /^((dx\.)?doi\.org)$/iu.test(url.hostname) && researchDoi(url.href.split(/[?#]/u)[0]);
    if (doi) return 'doi:' + doi;
    const arxiv = url.hostname === 'arxiv.org' && /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/u.exec(url.pathname);
    if (arxiv) return 'arxiv:' + arxiv[1].toLowerCase().replace(/v\d+$/u, '');
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.*|fbclid|gclid|mc_cid|mc_eid)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return 'url:' + url.hostname.replace(/^www\./u, '') + url.pathname.replace(/\/$/u, '') + url.search;
  } catch { return ''; }
}
