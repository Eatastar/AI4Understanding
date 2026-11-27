import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
// @ts-expect-error The local network service is native JavaScript.
import { createInquirySearch, downloadInquiryPdf, modelWebSource, requirePublicPdfAddresses } from '../server/inquiry-search.mjs';
// @ts-expect-error Source ranking runs on the server without runtime dependencies.
import { rankResearchCandidates } from '../server/inquiry-rank.mjs';

const atom = '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/2601.01234v1</id>' +
  '<published>2026-01-01T00:00:00Z</published><title>Synthetic &amp; Paper</title>' +
  '<arxiv:primary_category scheme="http://arxiv.org/schemas/atom" term="cs.LG" />' +
  '<author><name>A. Researcher</name></author><summary>An example &#x03B6; abstract.</summary></entry></feed>';
const semantic = { data: [{ title: 'Synthetic & Paper', url: 'https://www.semanticscholar.org/paper/example', externalIds: { ArXiv: '2601.01234' }, year: 2026 },
  { title: 'Another source', url: 'https://www.semanticscholar.org/paper/another' }] };
const noDoi = () => Response.json({ message: { items: [] } });
const signal = () => new AbortController().signal;

test('academic search combines duplicate PDF records, preserves evidence types and respects arXiv request intervals', async () => {
  const visits: string[] = [];
  let time = 14200;
  let publicationVenue: string | undefined;
  const search = createInquirySearch({ now: () => time, fetch: async (url: URL) => {
    visits.push(url.hostname);
    if (url.hostname === 'export.arxiv.org') {
      assert.equal(url.searchParams.get('search_query'), 'all:"Riemann hypothesis" OR all:"zeta zeros"');
      return new Response(atom);
    }
    if (url.hostname === 'api.crossref.org') return noDoi();
    return Response.json({ data: semantic.data.map((record, index) => index === 0 ? { ...record, venue: publicationVenue } : record) });
  } });
  const terms = { queries: ['Riemann hypothesis', 'zeta zeros'] };
  const result = await search(terms, signal());
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].title, 'Synthetic & Paper');
  assert.equal(result.sources[0].excerpt, 'An example ζ abstract.');
  assert.equal(result.sources[0].pdfUrl, 'https://arxiv.org/pdf/2601.01234v1');
  assert.equal(result.sources[0].venue, 'arXiv · cs.LG');
  assert.equal(result.sources[0].mediaType, 'paper');
  assert.equal(result.sources[1].evidence, 'metadata');
  assert.deepEqual(result.issues, []);
  await search(terms, signal());
  assert.equal(visits.filter(host => host === 'export.arxiv.org').length, 1);
  time += 3001;
  publicationVenue = 'Fixture Conference';
  const updated = await search(terms, signal());
  assert.equal(updated.sources[0].venue, publicationVenue);
  assert.equal(visits.filter(host => host === 'export.arxiv.org').length, 2);
});

test('an upstream 429 does not discard usable results, and the rate-limited provider backs off', async () => {
  let limitedRequests = 0;
  const search = createInquirySearch({ fetch: async (url: URL) => {
    if (url.hostname === 'export.arxiv.org') return new Response(atom);
    if (url.hostname === 'api.crossref.org') return Response.json({ message: { items: [{ DOI: '10.0000/synthetic', title: ['Journal article'], abstract: '<jats:p>Journal abstract</jats:p>', issued: { 'date-parts': [[2025]] } }] } });
    limitedRequests++;
    return new Response('', { status: 429 });
  } });
  const first = await search({ queries: ['test'] }, signal());
  assert.equal(first.sources.length, 2);
  assert.equal(first.sources[1].excerpt, 'Journal abstract');
  assert.deepEqual(first.issues, [{ provider: 'Semantic Scholar', issue: 'limited' }]);
  const second = await search({ queries: ['test'] }, signal());
  assert.equal(second.sources[0].provider, 'Crossref');
  assert.equal(limitedRequests, 1);
});

test('an upstream timeout retains successful sources and opt-in web search receives only its own key', async () => {
  const search = createInquirySearch({ webKey: () => 'mock-key', fetch: async (input: URL | string, options: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === 'api.tavily.com') {
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer mock-key');
      return Response.json({ results: [{ title: 'An explainer', content: 'Public excerpt', url: 'https://guide.example.org' }] });
    }
    assert.equal(new Headers(options.headers).has('authorization'), false);
    if (url.hostname === 'export.arxiv.org') return new Response('', { status: 504 });
    if (url.hostname === 'api.crossref.org') return noDoi();
    return Response.json(semantic);
  } });
  const result = await search({ queries: ['test'] }, signal());
  assert.deepEqual(result.issues, [{ provider: 'arXiv', issue: 'timeout' }]);
  assert(result.sources.some((source: { evidence: string }) => source.evidence === 'snippet'));
});

test('aborting source search cancels in-flight requests', async () => {
  const controller = new AbortController();
  let aborts = 0;
  const waitForCancel = (signal?: AbortSignal | null) => new Promise((_, reject) => {
    signal?.addEventListener('abort', () => { aborts++; reject(signal.reason); }, { once: true });
  });
  const search = createInquirySearch({
    fetch: (_: URL, options: RequestInit) => waitForCancel(options.signal),
    modelWebSearch: (_id: string, _query: string, signal: AbortSignal) => waitForCancel(signal),
  });
  const pending = search({
    queries: ['test'], intent: 'specific_work_or_claim', commentaryQuery: 'test proof outline', webSource: 'model:fixture',
  }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(aborts, 4);
});

test('empty responses after the first round was aborted never dispatch a broader search', async () => {
  const controller = new AbortController();
  const tracks: string[] = [];
  const hosts: string[] = [];
  const search = createInquirySearch({
    fetch: async (url: URL) => {
      hosts.push(url.hostname);
      return url.hostname === 'export.arxiv.org' ? new Response('<feed></feed>') : Response.json({ data: [] });
    },
    modelWebSearch: async (_id: string, _query: string, requestSignal: AbortSignal, { track }: { track: string }) => {
      assert.equal(requestSignal, controller.signal);
      tracks.push(track);
      if (track === 'commentary') controller.abort();
      return { provider: 'Model web search', records: [] };
    },
  });
  await assert.rejects(search({
    queries: ['Riemann hypothesis proof'], topic: 'Riemann hypothesis', intent: 'broad_topic',
    commentaryQuery: 'Riemann hypothesis proof outline', webSource: 'model:fixture',
  }, controller.signal), { name: 'AbortError' });
  assert.deepEqual(tracks, ['primary', 'commentary']);
  assert(!hosts.includes('api.crossref.org'));
});

test('chat papers use scholarly providers and web-only lookups contact only the chosen provider', async () => {
  const hosts: string[] = [];
  const search = createInquirySearch({ webKey: () => 'mock-key', fetch: async (input: URL | string) => {
    const url = new URL(input);
    hosts.push(url.hostname);
    if (url.hostname === 'export.arxiv.org') return new Response(atom);
    if (url.hostname === 'api.crossref.org') return noDoi();
    if (url.hostname === 'api.tavily.com') return Response.json({ results: [{ title: 'Current news', url: 'https://example.org/updates', content: 'A public snippet.' }] });
    return Response.json({ data: Array.from({ length: 8 }, (_, index) => ({ title: 'Paper ' + index, url: 'https://scholar.example.org/' + index })) });
  } });
  await assert.rejects(search({ scope: 'papers', queries: ['one', 'two', 'three'] }, signal()));
  await assert.rejects(search({ scope: 'web', queries: ['one', 'two'] }, signal()));
  const papers = await search({ scope: 'papers', queries: ['one', 'two'], webSource: 'tavily' }, signal());
  assert.equal(papers.sources.length, 5);
  assert(!hosts.includes('api.tavily.com'));
  hosts.length = 0;
  const web = await search({ scope: 'web', queries: ['latest'], webSource: 'tavily' }, signal());
  assert.deepEqual(hosts, ['api.tavily.com']);
  assert.equal(web.sources[0].evidence, 'snippet');
});

test('targeted search filters lookalike proof titles before the candidate limit and preserves the exact web query', async () => {
  const calls: string[] = [];
  const note = 'https://author.example.org/remark.pdf';
  const verification = 'https://university.example.org/verification';
  const webQuery = 'Ada Núñez 新公布的证明';
  const search = createInquirySearch({ webKey: () => 'mock-key', fetch: async (input: URL | string, options: RequestInit) => {
    const url = new URL(input);
    calls.push(url.hostname);
    if (url.hostname === 'export.arxiv.org') {
      const expression = url.searchParams.get('search_query') || '';
      assert.match(expression, /all:"Ada" AND all:"Nunez" AND all:"formal" AND all:"proof"/u);
      return new Response('<feed></feed>');
    }
    if (url.hostname === 'api.semanticscholar.org') {
      assert.equal(url.searchParams.get('query'), 'Ada Nunez formal proof');
      return Response.json({ data: Array.from({ length: 8 }, (_, index) => ({
        title: 'Yet another proof of the same conjecture ' + index, url: 'https://papers.example.org/' + index, authors: [{ name: 'Another Person' }],
      })) });
    }
    if (url.hostname === 'api.crossref.org') {
      assert.equal(url.searchParams.get('query.bibliographic'), 'Ada Nunez formal proof');
      return Response.json({ message: { items: [
        { DOI: '10.0000/irrelevant', title: ['A remark'], type: 'journal-article', 'is-referenced-by-count': 890 },
        { DOI: '10.0000/near-name', title: ['Ada Nunezilla paper'], type: 'journal-article' },
      ] } });
    }
    assert.equal(url.hostname, 'api.tavily.com');
    assert.equal(JSON.parse(options.body as string).query, webQuery);
    return Response.json({ results: [
      { title: 'A remark', url: note, content: 'Ada Núñez released the formal proof and its source archive.' },
      { title: 'Independent verification of Ada Nunez’s proof', url: verification, content: 'A university team checked the theorem statement.' },
      { title: 'One-page proof', url: 'https://unrelated.example.org/proof', content: 'An unrelated claim.' },
    ] });
  } });
  const queries = ['Ada Nunez formal proof', webQuery];
  const result = await search({ queries, target: 'Ada Núñez', webQuery }, signal());
  assert.deepEqual(result.sources.map((source: { webUrl: string }) => source.webUrl), [note, verification]);
  assert.equal(result.academicOnly, undefined);
  assert.equal(calls.length, 4);
  calls.length = 0;
  const academic = await search({ queries, target: 'Ada Núñez', webQuery, webSource: 'academic' }, signal());
  assert.deepEqual(academic.sources, []);
  assert.equal(academic.academicOnly, true);
  assert(!calls.includes('api.tavily.com'));
});

test('a current proof lookup requests recent indexing and keeps same-title records separate before corroboration', async () => {
  const title = 'Synthetic conjecture proof';
  const visits: string[] = [];
  const search = createInquirySearch({ now: () => Date.parse('2026-11-25T00:00:00Z'), webKey: () => 'mock-key',
    fetch: async (input: URL | string, options: RequestInit) => {
      const site = new URL(input);
      visits.push(site.hostname);
      if (site.hostname === 'export.arxiv.org') {
        assert.match(site.searchParams.get('search_query') || '', /submittedDate:\[202511250000 TO 202611252359\]/u);
        assert.equal(site.searchParams.get('sortBy'), 'lastUpdatedDate');
        return new Response('<feed></feed>');
      }
      if (site.hostname === 'api.crossref.org') {
        assert.equal(site.searchParams.get('filter'), 'from-pub-date:2025-11-25');
        return Response.json({ message: { items: [{ DOI: '10.0000/one-page', title: [title], type: 'journal-article', 'is-referenced-by-count': 999 }] } });
      }
      if (site.hostname === 'api.semanticscholar.org') {
        assert.equal(site.searchParams.get('year'), '2025-');
        return Response.json({ data: [] });
      }
      const body = JSON.parse(options.body as string);
      assert.equal(body.time_range, 'year');
      assert.match(body.query, /latest proof.*independent verification/u);
      return Response.json({ results: [
        { url: 'https://author.example.net/proof.pdf', title, content: 'Ada Núñez released the original proof.', published_date: '2026-11-20' },
        { url: 'https://university.example.edu/check', title: 'Independent check', content: 'Our team independently compiled the release by Ada Núñez.' },
      ] });
    },
  });
  const { sources } = await search({ scope: 'project', queries: ['Synthetic conjecture proof'], currentProof: true }, signal());
  assert.equal(visits.length, 4);
  assert.deepEqual(sources.map((source: { title: string }) => source.title), [title, 'Independent check', title]);
  assert.equal(sources[0].year, 2026);
  assert.equal(new Set(sources.map((source: { id: string }) => source.id)).size, 3);
});

test('proof candidates leave room for a web release without a year alongside repeated claimed proofs from an index', async () => {
  const original = 'https://author.example.net/release.pdf';
  const search = createInquirySearch({ webKey: () => 'mock-key', fetch: async (input: URL | string) => {
    const host = new URL(input).hostname;
    if (host === 'export.arxiv.org') return new Response('<feed></feed>');
    if (host === 'api.semanticscholar.org') return Response.json({ data: [] });
    if (host === 'api.crossref.org') return Response.json({ message: { items: Array.from({ length: 5 }, (_, index) => ({
      DOI: '10.0000/claimed-v' + index, title: ['A synthetic claimed proof'], abstract: 'We claim a proof.',
      issued: { 'date-parts': [[2026]] },
    })) } });
    assert.equal(host, 'api.tavily.com');
    return Response.json({ results: [
      ...['one', 'two', 'three'].map(name => ({
        url: 'https://' + name + '.example.org/check', title: 'Independent check ' + name,
        content: 'Our team independently compiled the release by Ada Núñez.',
      })),
      { url: original, title: 'Original release', content: 'Ada Núñez published the formal proof archive.' },
    ] });
  } });
  const { sources } = await search({ scope: 'project', queries: ['Synthetic conjecture proof'], currentProof: true }, signal());
  assert.equal(sources.length, 6);
  assert.equal(sources[0].webUrl, original);
  assert.equal(sources[0].year, undefined);
});

test('Crossref caps its records and demotes anonymous extraordinary claims while preserving explicitly named work', async () => {
  const noise = {
    DOI: '10.0000/direct', title: ['One-page proof of the Riemann hypothesis'],
    author: [{ given: 'Ada', family: 'Example' }], type: 'posted-content', 'is-referenced-by-count': 0,
    abstract: '<jats:p>We claim an elementary proof of the Riemann hypothesis.</jats:p>',
  };
  const trusted = Array.from({ length: 3 }, (_, index) => ({
    DOI: '10.0000/journal' + index, title: ['Riemann hypothesis survey ' + index], type: 'journal-article',
    abstract: '<jats:p>A survey on the Riemann hypothesis and associated bounds.</jats:p>',
    'container-title': ['Journal of Number Theory'], 'is-referenced-by-count': 10 + index,
  }));
  const search = createInquirySearch({ fetch: async (url: URL) => {
    if (url.hostname === 'export.arxiv.org') return new Response('<feed></feed>');
    if (url.hostname === 'api.crossref.org') return Response.json({ message: { items: [noise, ...trusted] } });
    return Response.json({ data: [] });
  } });
  const terms = { queries: ['Riemann hypothesis proof'], topic: 'Riemann hypothesis', currentProof: true, webSource: 'academic' };
  const { sources } = await search({ ...terms, intent: 'broad_topic' }, signal());
  assert.equal(sources.length, 2);
  assert(sources.every((item: { citationCount: number }) => item.citationCount > 0));
  const named = await search({ ...terms, intent: 'specific_work_or_claim', target: 'Ada Example' }, signal());
  const claim = named.sources.find((item: { doi: string }) => item.doi === noise.DOI);
  assert(claim);
  assert.equal(named.assessments[claim.id].credibilityFlag, 'unverified_extraordinary_claim');
});

test('named search reserves room for the release and independent English guides and skips Crossref when scholarly evidence is sufficient', async () => {
  const requestSignal = signal();
  const hosts: string[] = [];
  const tracks: string[] = [];
  const title = 'Third-party proof outline for Levent’s work on the Riemann hypothesis';
  const guide = (host: string) => modelWebSource({
    url: 'https://' + host + '/example-outline', title,
    excerpt: 'This proof sketch for Levent’s Riemann hypothesis announcement explains how the intermediate estimates fit together.',
    evidence: 'snippet',
  });
  const release = modelWebSource({
    url: 'https://author.example.org/announcement', title: 'Levent’s proof announcement',
    excerpt: 'Levent released the proof and formal artefact for the Riemann hypothesis.', evidence: 'snippet',
  });
  const search = createInquirySearch({
    fetch: async (url: URL, { signal: usedSignal }: RequestInit) => {
      assert.equal(usedSignal, requestSignal);
      hosts.push(url.hostname);
      assert.doesNotMatch(String(url.search), /%E9%BB%8E/u);
      const query = url.searchParams.get(url.hostname === 'export.arxiv.org' ? 'search_query' : 'query');
      assert.doesNotMatch(query ?? '', /\p{Script=Han}|outline/iu);
      if (url.hostname === 'export.arxiv.org') return new Response('<feed></feed>');
      assert.equal(url.hostname, 'api.semanticscholar.org');
      return Response.json({ data: Array.from({ length: 6 }, (_, index) => ({
        title: 'Riemann hypothesis work by Levent ' + index, url: 'https://academic.example.org/' + index,
        authors: [{ name: 'Levent Example' }], abstract: 'A substantive report on the mathematical setting.',
      })) });
    },
    modelWebSearch: async (_id: string, query: string, usedSignal: AbortSignal, { track }: { track: string }) => {
      assert.equal(usedSignal, requestSignal);
      tracks.push(track);
      if (track === 'commentary') assert.match(query, /outline.*MathOverflow/u);
      return { provider: 'Model web search', records: track === 'primary' ? [release] : [
        guide('mathoverflow.net'), guide('seminar.example.edu'), guide('mathematician.example.org'), guide('mathoverflow.net'),
      ] };
    },
  });
  const result = await search({
    queries: ['Levent Riemann hypothesis proof', '黎曼猜想'],
    target: 'Levent', topic: 'Riemann hypothesis', currentProof: true, intent: 'specific_work_or_claim',
    commentaryQuery: 'Levent Riemann hypothesis proof outline OR MathOverflow', webSource: 'model:fixture',
  }, requestSignal);
  assert.deepEqual(tracks, ['primary', 'commentary']);
  assert.deepEqual(hosts.sort(), ['api.semanticscholar.org', 'export.arxiv.org']);
  assert(result.sources.some((item: { webUrl: string }) => item.webUrl === release.record.webUrl));
  const guides = result.sources.filter((item: { id: string }) => result.assessments[item.id].track === 'commentary');
  assert.equal(guides.length, 3);
  assert(guides.every((item: { citationCount?: number }) => item.citationCount === undefined));
});

test('web commentary is scored on its evidence without a citation count requirement', () => {
  const outline = modelWebSource({
    url: 'https://research.example.edu/seminar', title: 'Researcher’s outline of the Riemann hypothesis proof',
    excerpt: 'The outline explains the analytic reduction and enumerates the intermediate lemmas.', evidence: 'snippet',
  });
  const records = [outline, {
    ...outline, identity: ['different-guide'],
    record: { ...outline.record, webUrl: 'https://research.example.edu/notes', citationCount: 0 },
  }];
  const [withoutCount, zeroCount] = rankResearchCandidates([{ track: 'commentary', records }], { currentProof: true });
  assert.equal(withoutCount.score, zeroCount.score);
  assert(withoutCount.quality && zeroCount.quality);
});

test('a thin first round broadens exactly once with the same signal and returns the relevant context', async () => {
  const requestSignal = signal();
  const tracks: string[] = [];
  const reference = modelWebSource({
    url: 'https://lectures.example.edu/riemann', title: 'University lecture notes on the Riemann hypothesis',
    excerpt: 'These notes place the Riemann hypothesis in the context of prime number estimates and zeta zeros.', evidence: 'snippet',
  });
  const search = createInquirySearch({
    fetch: async (url: URL) => url.hostname === 'export.arxiv.org' ? new Response('<feed></feed>')
      : url.hostname === 'api.crossref.org' ? noDoi() : Response.json({ data: [] }),
    modelWebSearch: async (_id: string, query: string, usedSignal: AbortSignal, { track, target }: { track: string; target?: string }) => {
      assert.equal(usedSignal, requestSignal);
      tracks.push(track);
      if (track === 'context') {
        assert.doesNotMatch(query, /Levent/u);
        assert.equal(target, undefined);
      }
      return { provider: 'Model web search', records: track === 'context' ? [reference] : [] };
    },
  });
  const response = await search({
    queries: ['Levent Riemann hypothesis proof'], target: 'Levent', topic: 'Riemann hypothesis',
    intent: 'specific_work_or_claim', commentaryQuery: 'Levent Riemann hypothesis proof outline', webSource: 'model:fixture',
  }, requestSignal);
  assert.deepEqual(tracks, ['primary', 'commentary', 'context']);
  assert.equal(response.sources.length, 1);
  assert.equal(response.sources[0].webUrl, reference.record.webUrl);
  assert.equal(response.assessments[response.sources[0].id].fallback, true);
});

test('a current web search checks that commentary describes the discovered release before classifying it as a guide', async () => {
  const record = (url: string, title: string, excerpt: string) => modelWebSource({ url, title, excerpt, evidence: 'snippet' });
  const release = record('https://author.example.org/announcement', 'Original announcement',
    'Ada Núñez announced the original Lean proof of the Riemann hypothesis.');
  const context = record('https://notes.example.edu/old-attempts', 'A guide to older claimed proofs of the Riemann hypothesis',
    'The lecture describes an old line of attack using positive operators.');
  const outline = record('https://guide.example.org/new-work', 'An outline of the new Lean proof',
    'This proof sketch discusses Núñez’s descent argument and the key estimates.');
  const search = createInquirySearch({
    fetch: async (url: URL) => url.hostname === 'export.arxiv.org' ? new Response('<feed></feed>')
      : url.hostname === 'api.crossref.org' ? noDoi() : Response.json({ data: [] }),
    modelWebSearch: async (_id: string, _query: string, _signal: AbortSignal, { track }: { track: string }) =>
      ({ provider: 'Model web search', records: track === 'primary' ? [release] : [context, outline] }),
  });
  const response = await search({
    queries: ['Riemann hypothesis proof'], topic: 'Riemann hypothesis', currentProof: true, intent: 'broad_topic',
    commentaryQuery: 'Riemann hypothesis outline MathOverflow', webSource: 'model:fixture',
  }, signal());
  assert.deepEqual(response.sources.map((item: { webUrl: string }) => item.webUrl), [release.record.webUrl, outline.record.webUrl]);
  assert.equal(response.assessments[outline.record.id].track, 'commentary');
});

test('a web-only proof retry keeps the freshness window and skips the scholarly providers', async () => {
  const visited: string[] = [];
  const search = createInquirySearch({ webKey: () => 'mock-key', fetch: async (input: URL | string, options: RequestInit) => {
    const site = new URL(input);
    visited.push(site.hostname);
    const request = JSON.parse(options.body as string);
    assert.equal(request.time_range, 'year');
    assert.match(request.query, /Ada Núñez proof.*independent verification/u);
    return Response.json({ results: [
      { url: 'https://author.example.org/remark', title: 'Ada Núñez’s proof', content: 'The original announcement.' },
    ] });
  } });
  const result = await search({ scope: 'web', currentProof: true, target: 'Ada Núñez', webSource: 'tavily', queries: ['Ada Núñez proof'] }, signal());
  assert.deepEqual(visited, ['api.tavily.com']);
  assert.equal(result.sources[0].webUrl, 'https://author.example.org/remark');
});

test('bibliography providers expose existing venue and citation fields with their provenance', async () => {
  const search = createInquirySearch({ fetch: async (url: URL) => {
    if (url.hostname === 'export.arxiv.org') return new Response('<feed></feed>');
    if (url.hostname === 'api.crossref.org') {
      assert.match(url.searchParams.get('select') || '', /is-referenced-by-count/u);
      return Response.json({ message: { items: [
        { DOI: '10.0000/review', title: ['Reference review'], type: 'journal-article', 'container-title': ['Journal of Reviews'], 'is-referenced-by-count': 4 },
        { DOI: '10.0000/handbook', title: ['Synthetic handbook'], type: 'book' },
      ] } });
    }
    assert.match(url.searchParams.get('fields') || '', /venue,citationCount/u);
    return Response.json({ data: [{ title: 'Conference fixture', url: 'https://scholar.example.org/fixture', venue: 'Example Conference', citationCount: 0 },
      { title: 'Only a title', url: 'https://scholar.example.org/another', citationCount: -1 }] });
  } });
  const { sources } = await search({ scope: 'project', queries: ['fixture'], webSource: 'academic' }, signal());
  const conference = sources.find((item: { title: string }) => item.title === 'Conference fixture');
  const crossref = sources.find((item: { title: string }) => item.title === 'Reference review');
  const missing = sources.find((item: { title: string }) => item.title === 'Only a title');
  const handbook = sources.find((item: { title: string }) => item.title === 'Synthetic handbook');
  assert.deepEqual([conference.venue, conference.citationCount, conference.citationProvider, conference.mediaType], ['Example Conference', 0, 'Semantic Scholar', 'paper']);
  assert.deepEqual([crossref.venue, crossref.citationCount, crossref.citationProvider, crossref.mediaType], ['Journal of Reviews', 4, 'Crossref', 'paper']);
  assert.equal(missing.citationCount, undefined);
  assert.equal(missing.venue, undefined);
  assert.equal(handbook.citationCount, undefined);
  assert.equal(handbook.venue, undefined);
  assert.equal(handbook.mediaType, undefined);
});

test('web results distinguish videos, repos and papers with the same title using their source links', async () => {
  const title = 'Synthetic & Paper';
  const videoUrl = 'https://www.youtube.com/watch?v=fixture';
  const search = createInquirySearch({ webKey: () => 'mock-key', fetch: async (request: URL | string) => {
    const url = new URL(request);
    if (url.hostname === 'export.arxiv.org') {
      return new Response(atom.replace('</entry>', '<arxiv:journal_ref>Example Transactions</arxiv:journal_ref></entry>'));
    }
    if (url.hostname === 'api.semanticscholar.org') return Response.json(semantic);
    if (url.hostname === 'api.crossref.org') return noDoi();
    assert.equal(url.hostname, 'api.tavily.com');
    return Response.json({ results: [
      { url: videoUrl, title, content: 'An introductory video.' },
      { url: 'https://github.com/example/fixture', title, content: 'The example code.' },
      { url: videoUrl + '&utm_medium=search', title, content: 'A duplicate.' },
      { url: 'https://github.com/topics/fictional-term', title: 'A GitHub topic page', content: 'A list of repos.' },
    ] });
  } });
  const { sources } = await search({ queries: ['fixture'] }, signal());
  const representations = sources.filter((source: { title: string }) => source.title === title);
  assert.deepEqual(representations.map((source: { mediaType: string }) => source.mediaType), ['paper', 'video_course', 'repo']);
  assert.equal(new Set(representations.map((source: { id: string }) => source.id)).size, 3);
  assert.equal(representations[0].venue, 'Example Transactions');
  assert.equal(representations[1].pdfUrl, undefined);
  assert.equal(sources.find((source: { title: string }) => source.title === 'A GitHub topic page').mediaType, 'web');
  assert.equal(modelWebSource({ url: 'https://www.bilibili.com/bangumi/play/ep123', title }).record.mediaType, 'video_course');
  assert.equal(modelWebSource({ url: 'https://ocw.mit.edu/courses/synthetic-course/', title }).record.mediaType, 'video_course');
  assert.equal(modelWebSource({ url: 'https://example.org/paper.pdf', title }).record.mediaType, 'paper');
  assert.equal(modelWebSource({ url: 'https://example.org/blog/video-theory', title }).record.mediaType, 'web');
});

function mockResponse(chunks: string[], statusCode = 200, headers: Record<string, string> = {}) {
  return Object.assign(Readable.from(chunks.map(chunk => Buffer.from(chunk))), { statusCode, headers });
}

test('PDF download checks the streamed file signature even across chunks and bounds its size', async () => {
  const url = 'https://arxiv.org/pdf/2601.01234';
  const bytes = await downloadInquiryPdf(url, signal(), { open: async () => mockResponse(['%P', 'DF-1.7\n', 'PDF body']) });
  assert.equal(bytes.toString(), '%PDF-1.7\nPDF body');
  await assert.rejects(downloadInquiryPdf(url, signal(), { open: async () => mockResponse(['<html>403</html>']) }), { status: 422 });
  await assert.rejects(downloadInquiryPdf(url, signal(), { open: async () => mockResponse(['%PDF-1.7 excess']), byteLimit: 6 }), { status: 413 });
  await assert.rejects(downloadInquiryPdf(url, signal(), { open: async () => mockResponse([], 403) }), { status: 502 });
});

test('repository PDFs can use the desktop proxy while other hosts still require the public connector', async () => {
  let indexed = 0, direct = 0;
  const options = {
    trustedFetch: async (url: URL, request: RequestInit) => {
      indexed++;
      assert.equal(url.hostname, 'arxiv.org');
      assert.equal(request.redirect, 'error');
      return new Response('%PDF-1.7\nrepository');
    },
    open: async () => { direct++; return mockResponse(['%PDF-1.7\npublisher']); },
  };
  await downloadInquiryPdf('https://arxiv.org/pdf/2601.01234v2', signal(), options);
  await downloadInquiryPdf('https://publisher.example.org/test.pdf', signal(), options);
  assert.deepEqual({ indexed, direct }, { indexed: 1, direct: 1 });
});

test('Alpöge’s public announcement uses the desktop proxy with redirects and credentials disabled', async () => {
  const url = 'https://alpo.ge/remark.pdf?utm_source=openai';
  const bytes = await downloadInquiryPdf(url, signal(), {
    open: async () => { throw new Error('The direct network cannot resolve the proxied domain to a public address'); },
    trustedFetch: async (input: URL, request: RequestInit) => {
      assert.equal(input.href, url);
      assert.equal(request.redirect, 'error');
      assert.equal(request.credentials, 'omit');
      return new Response('%PDF-1.7\nAuthor’s announcement');
    },
  });
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
});

test('reserved proxy DNS addresses have a distinct download message and remain blocked', () => {
  const surrogate = { address: '198.18.0.18', family: 4 };
  const external = { address: '93.184.215.14', family: 4 };
  assert.throws(() => requirePublicPdfAddresses([surrogate]), { status: 400, message: /解析到了保留地址/u });
  assert.throws(() => requirePublicPdfAddresses([external, surrogate]), { status: 400, message: /公开网站/u });
  assert.deepEqual(requirePublicPdfAddresses([external]), [external]);
});

test('PDF download validates redirects and reports a time limit or user cancellation', async () => {
  const url = 'https://example.org/sample.pdf';
  const seen: string[] = [];
  const bytes = await downloadInquiryPdf(url, signal(), { open: async (input: URL) => {
    seen.push(input.href);
    return input.href === url ? mockResponse([], 302, { location: '/new.pdf' }) : mockResponse(['%PDF-1.4']);
  } });
  assert.deepEqual(seen, [url, 'https://example.org/new.pdf']);
  assert.equal(bytes.toString(), '%PDF-1.4');
  await assert.rejects(downloadInquiryPdf(url, signal(), { open: async () => mockResponse([], 302, { location: 'http://example.org/new.pdf' }) }), { status: 400 });
  const controller = new AbortController();
  const open = (_: URL, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  const pending = downloadInquiryPdf(url, controller.signal, { open });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const keepAlive = setInterval(() => {}, 100);
  try { await assert.rejects(downloadInquiryPdf(url, signal(), { open, timeoutMs: 10 }), { status: 504 }); }
  finally { clearInterval(keepAlive); }
});
