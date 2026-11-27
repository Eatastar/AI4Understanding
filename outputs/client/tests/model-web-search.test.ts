import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
// @ts-expect-error The local server uses native JavaScript.
import { createAppServer } from '../server/app.mjs';
// @ts-expect-error The provider adapter uses native JavaScript.
import { searchModelWeb, WEB_SEARCH_PROBE } from '../server/model-web-search.mjs';
// @ts-expect-error The profile manager uses native JavaScript.
import { createProfileManager } from '../server/profiles.mjs';

const url = 'https://institute.example/official';
const finding = 'The institute offers an introduction.';
const annotation = { url, title: 'The institute', start_index: 0, end_index: finding.length };
const responses = () => Response.json({ output: [
  { type: 'web_search_call', status: 'completed' },
  { type: 'message', content: [{ type: 'output_text', text: finding, annotations: [{ type: 'url_citation', ...annotation }] }] },
] });
const profile = { apiFormat: 'openai-chat', baseURL: 'https://api.openai.com/v1/chat/completions', model: 'synthetic-model', apiKey: 'test-model-secret', systemPrompt: 'Private reading preference' };
const signal = () => new AbortController().signal;

async function start(options: Record<string, unknown>) {
  const server: Server = createAppServer({ env: {}, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return {
    async request(path: string, body?: unknown) {
      const result = await fetch(origin + '/api/' + path, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(result.status, 200);
      return result.json();
    },
    async close() {
      if (!server.listening) return;
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

test('a checked connection can power source search after restart using its own key, and Tavily is a separate choice', async t => {
  let snapshot: unknown = null;
  const store = { persistence: 'encrypted', load: () => structuredClone(snapshot), save: (value: unknown) => { snapshot = structuredClone(value); } };
  const prompts: string[] = [];
  let tavilyCalls = 0;
  const inquiryFetch = async (input: URL | string, options: RequestInit) => {
    const endpoint = new URL(input);
    const key = new Headers(options.headers).get('Authorization');
    if (endpoint.hostname === 'api.openai.com') {
      assert.equal(endpoint.pathname, '/v1/responses');
      assert.equal(key, 'Bearer ' + profile.apiKey);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body as string);
      assert.equal(body.store, false);
      assert.deepEqual(body.tools, [{ type: 'web_search' }]);
      assert.equal(body.max_tool_calls, 1);
      assert(!body.input.includes(profile.systemPrompt));
      prompts.push(body.input);
      return responses();
    }
    if (endpoint.hostname === 'api.tavily.com') {
      assert.equal(key, 'Bearer test-tavily-secret');
      tavilyCalls++;
      return Response.json({ results: [{ title: 'An alternate resource', url: 'https://alternate.example/resource' }] });
    }
    assert.equal(key, null);
    if (endpoint.hostname === 'export.arxiv.org') return new Response('<feed></feed>');
    if (endpoint.hostname === 'api.crossref.org') return Response.json({ message: { items: [] } });
    assert.equal(endpoint.hostname, 'api.semanticscholar.org');
    return Response.json({ data: [] });
  };
  const options = { profileStore: store, inquiryFetch, env: { TAVILY_API_KEY: 'test-tavily-secret' } };
  let app = await start(options);
  try {
    const { activeProfileId: id } = await app.request('profiles', { name: 'Search model', ...profile, webSearchVerifiedAt: Date.now() });
    const before = await app.request('inquiry/web-settings');
    assert.deepEqual(before.connections, [{ id, name: 'Search model', model: profile.model }]);
    assert.doesNotMatch(JSON.stringify(before), /test-model-secret|test-tavily-secret|Private reading preference/);
    const search = { queries: ['Synthetic sources'], webSource: 'model:' + id };
    const stale = await app.request('inquiry/search', search);
    assert(stale.issues.some((item: { issue: string }) => item.issue === 'unverified'));
    assert.equal(prompts.length, 0);
    const deadlines = t.mock.method(AbortSignal, 'timeout');
    const checked = await app.request('inquiry/web-check', { id, query: 'Ignored browser input' });
    assert.equal(checked.status, 'verified');
    assert(prompts[0].includes(WEB_SEARCH_PROBE) && !prompts[0].includes('Ignored browser input'));
    await app.request('profiles/select', { profileId: null });

    await app.close();
    app = await start(options);
    const after = await app.request('inquiry/web-settings');
    assert.equal(after.connections[0].webSearchVerifiedAt, checked.verifiedAt);
    const result = await app.request('inquiry/search', search);
    assert.equal(deadlines.mock.callCount(), 0);
    deadlines.mock.restore();
    assert.equal(result.sources[0].webUrl, url);
    assert.equal(result.sources[0].evidence, 'web-summary');
    assert.equal(result.sources[0].excerpt, finding);
    assert(prompts[1].includes(search.queries[0]));
    const focused = await app.request('inquiry/search', { ...search, queries: ['The institute source'], target: 'the institute' });
    assert.equal(focused.sources[0].webUrl, url);
    assert.match(prompts[2], /Required author or work: the institute.*identify it/u);
    assert.match(prompts[2], /original artifact or repository.*independent technical verification/u);
    assert.equal((await app.request('settings')).activeProfileId, null);
    assert.equal(tavilyCalls, 0);
    const alternate = await app.request('inquiry/search', { ...search, webSource: 'tavily' });
    assert.equal(alternate.sources[0].provider, 'Tavily');
    assert.equal(tavilyCalls, 1);
    assert.equal(prompts.length, 3);
  } finally { await app.close(); }
});

test('a current proof search gives the web model separate searches for the primary release and its independent check', async () => {
  const result = await searchModelWeb(profile, 'Synthetic conjecture proof', signal(), {
    proofSince: '2025-11-25',
    fetch: async (_: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      assert.equal(body.max_tool_calls, 2);
      assert.match(body.input, /original release and use a separate query for an independent team’s own technical verification/u);
      assert.match(body.input, /Include an attributable original release even if no independent check is available/u);
      return responses();
    },
  });
  assert.equal(result.records[0]?.record.webUrl, url);
});

test('the commentary prompt asks for distinct third-party guides and retains each cited article separately', async () => {
  const guides = [
    { url: 'https://mathoverflow.net/questions/1', title: 'Technical thread', text: 'A discussion of the finite reduction step in Ada Núñez’s argument.' },
    { url: 'https://notes.example.edu/proof', title: 'Seminar notes', text: 'An outline of the analytic estimates in Ada Núñez’s proof.' },
  ];
  const result = await searchModelWeb(profile, 'Synthetic conjecture proof roadmap', signal(), {
    proofSince: '2025-11-25', track: 'commentary', target: 'Ada Núñez',
    fetch: async (_: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      assert.equal(body.max_tool_calls, 1);
      assert.match(body.input, /Search in English.*MathOverflow.*research blogs/u);
      assert.match(body.input, /multiple distinct authors or websites/u);
      assert.match(body.input, /Required author or work: Ada Núñez/u);
      assert.doesNotMatch(body.input, /Cite first-party publications/u);
      let offset = 0;
      const annotations = guides.map(guide => {
        const citation = { type: 'url_citation', url: guide.url, title: guide.title, start_index: offset, end_index: offset + guide.text.length };
        offset += guide.text.length + 1;
        return citation;
      });
      return Response.json({ output: [
        { type: 'web_search_call', status: 'completed' },
        { type: 'message', content: [{ type: 'output_text', text: guides.map(guide => guide.text).join('\n'), annotations }] },
      ] });
    },
  });
  assert.deepEqual(result.records.map(({ record }: { record: { webUrl: string; excerpt: string } }) => [record.webUrl, record.excerpt]),
    guides.map(guide => [guide.url, guide.text]));
});

test('only structured web citations or tool results verify a compatible connection', async () => {
  const relay = { ...profile, baseURL: 'https://relay.example/gateway' };
  const chat = (annotations: unknown[]) => Response.json({ choices: [{ message: { content: finding, annotations } }] });
  const unverified = await searchModelWeb(relay, 'A test query', signal(), { fetch: async () =>
    Response.json({ choices: [{ message: { content: 'I searched the web: ' + url } }] }) });
  assert.equal(unverified.issue, 'no-citations');
  const verified = await searchModelWeb(relay, 'A test query', signal(), {
    fetch: async (endpoint: string, options: RequestInit) => {
      assert.equal(endpoint, 'https://relay.example/gateway/chat/completions');
      assert.deepEqual(JSON.parse(options.body as string).web_search_options, {});
      return chat([
        { type: 'url_citation', url_citation: { ...annotation, url: 'http://127.0.0.1/test' } },
        { type: 'url_citation', url_citation: annotation },
      ]);
    },
  });
  assert.deepEqual(verified.records.map((item: { record: { webUrl: string } }) => item.record.webUrl), [url]);
  const claude = { ...profile, baseURL: 'https://claude.example/v1', apiFormat: 'anthropic-messages' };
  const retrieved = await searchModelWeb(claude, 'A test query', signal(), { fetch: async (endpoint: string, options: RequestInit) => {
    assert.equal(endpoint, 'https://claude.example/v1/messages');
    assert.equal(new Headers(options.headers).get('x-api-key'), profile.apiKey);
    assert.deepEqual(JSON.parse(options.body as string).tools, [{ name: 'web_search', type: 'web_search_20250305', max_uses: 1 }]);
    return Response.json({ content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url, title: 'The institute' }] },
      { type: 'text', citations: [{ type: 'web_search_result_location', url, title: 'The institute', cited_text: finding }] },
    ] });
  } });
  assert.equal(retrieved.records[0].record.evidence, 'snippet');
  assert.equal(retrieved.records[0].record.excerpt, finding);
});

test('expired or unsupported keys produce safe statuses and abort cancels the probe', async () => {
  const unused = async () => { throw new Error('Unexpected outbound request'); };
  const noKey = await searchModelWeb({ ...profile, apiKey: '' }, 'test', signal(), { fetch: unused });
  assert.equal(noKey.issue, 'missing-key');
  const gemini = await searchModelWeb({ ...profile, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai' }, 'test', signal(), { fetch: unused });
  assert.equal(gemini.issue, 'grounding-restricted');
  for (const [status, issue] of [[401, 'access'], [404, 'unsupported'], [429, 'limited'], [500, 'unavailable'], [504, 'timeout']] as const) {
    const result = await searchModelWeb(profile, 'test', signal(), { fetch: async () => new Response('private upstream diagnostic', { status }) });
    assert.equal(result.issue, issue);
    assert.doesNotMatch(JSON.stringify(result), /private upstream diagnostic/);
  }
  const offline = await searchModelWeb(profile, 'test', signal(), { fetch: async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ERR_INTERNET_DISCONNECTED' } });
  } });
  assert.equal(offline.issue, 'unavailable');
  const controller = new AbortController();
  const pending = searchModelWeb(profile, 'test', controller.signal, { probe: true, fetch: (_: string, options: RequestInit) =>
    new Promise((_, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })) });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('editing a checked credential, endpoint, protocol or model invalidates verification', () => {
  const profiles = createProfileManager({ initialSettings: { ...profile, mode: 'demo' } });
  for (const change of [{ apiKey: 'replacement' }, { baseURL: 'https://changed.example/v1' }, { apiFormat: 'openai-responses' }, { model: 'new-model' }]) {
    const { activeProfileId: id } = profiles.saveProfile({ ...profile, name: 'Search setting' });
    const checked = profiles.savedProfile(id);
    assert(profiles.markWebSearchVerified(checked));
    profiles.saveProfile({ id, name: 'Renamed connection', systemPrompt: 'new preference' });
    assert(profiles.savedProfile(id).webSearchVerifiedAt);
    profiles.updateSettings({ mode: 'demo', ...change });
    assert.equal(profiles.savedProfile(id).webSearchVerifiedAt, undefined);
    assert.equal(profiles.markWebSearchVerified(checked), undefined);
    profiles.deleteProfile(id);
  }
});
