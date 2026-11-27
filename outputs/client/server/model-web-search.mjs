import { MODEL_WEB_PROVIDER, modelWebSource, responseText, searchFailure } from './inquiry-search.mjs';
import { researchUrlKey } from '../shared/research.mjs';
import { isLocalEndpoint } from './profiles.mjs';
import { endpointURL } from './protocols.mjs';

export const WEB_SEARCH_PROBE = 'Clay Mathematics Institute official Riemann Hypothesis page';

function requestFor(profile, query, { probe, target, proofSince, track, untranslatedTopic }) {
  const base = new URL(profile.baseURL);
  const officialOpenAI = base.origin === 'https://api.openai.com';
  const responses = profile.apiFormat === 'openai-responses' ||
    (officialOpenAI && profile.apiFormat === 'openai-chat' && profile.model !== 'gpt-5-search-api');
  const proof = Boolean(proofSince && !probe && track === 'primary');
  const commentary = track === 'commentary';
  const searchCalls = proof ? 2 : 1;
  const prompt = probe
    ? 'Use your web search tool to find this public page. Give one short sentence with a source citation: ' + query
    : [
      commentary ? [
        'Search in English for independently written outlines, proof sketches, technical breakdowns and substantive critiques of the work in the query. Look for MathOverflow discussions, research blogs, university notes and mathematical community reviews. Prefer commentary written by researchers outside the original author team.',
        'Return individual guides or discussions from multiple distinct authors or websites when available. Cite each guide’s own article, PDF or discussion, with one line naming the kind of guide and a concrete step or question it explains. Keep each source as its own finding. Exclude press coverage, link lists and status pages without substantive discussion.',
        ...(proofSince ? ['Focus on the recent release and cite explainers that discuss that work by author or release name. General literature about the conjecture and older proof attempts belong outside these findings.'] : []),
      ].join(' ') : track === 'context'
        ? 'Find authoritative surveys, published introductions, university lecture notes and substantive discussions of the underlying topic. Use broader terms and present background separately from evidence for any particular new result.'
        : 'Search the web for sources relevant to the query below. For a named work or recent result, prefer the author’s announcement, the original artifact or repository, and independent technical verification over general background or similarly titled claims.',
      'Write up to 4 lines, one short finding and its inline citation per line. Use only sources actually returned by search. Attribute claims to the source and distinguish a claim from a documented check.',
      ...(proof ? [
        'Find documented proof developments since ' + proofSince + '. Search for the original release and use a separate query for an independent team’s own technical verification of the same work. Follow discovery links to the original documents.',
        'Cite first-party publications: the author’s announcement, manuscript or source archive, and a different team’s own record of a completed technical check. Include an attributable original release even if no independent check is available, and describe its status as announced. Name the proof author or precise release identifier on each line. Describe any completed check explicitly.',
        'Use the source body and result tables to distinguish completed checks, cancelled work and checks attributed to other teams. The title alone is insufficient to claim a verification step was completed.',
      ] : []),
      ...(target ? ['Required author or work: ' + target + '. Cite sources that actually identify it and include its name in each finding. If you cannot verify a direct match, omit the finding.'] : []),
      ...(untranslatedTopic ? ['Translate the subject into English and combine it with the commentary search terms. Subject: ' + untranslatedTopic] : []),
      'Search query: ' + query,
    ].join('\n');
  const model = profile.model;
  const bearer = profile.apiKey ? { Authorization: 'Bearer ' + profile.apiKey } : {};
  if (responses) {
    if (officialOpenAI) base.pathname = base.pathname.replace(/\/chat\/completions\/?$/u, '');
    return {
      format: 'responses', url: endpointURL(base.href, 'responses'), headers: bearer,
      body: { model, input: prompt, tools: [{ type: 'web_search' }], tool_choice: 'required', max_tool_calls: searchCalls, max_output_tokens: probe ? 768 : proof ? 2400 : 1400, store: false },
    };
  }
  if (profile.apiFormat === 'anthropic-messages') {
    return {
      format: 'messages', url: endpointURL(base.href, 'messages'),
      headers: { 'anthropic-version': '2023-06-01', ...(profile.apiKey ? { 'x-api-key': profile.apiKey } : {}) },
      body: { model, max_tokens: probe ? 512 : proof ? 1600 : 1024, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: searchCalls }], messages: [{ role: 'user', content: prompt }] },
    };
  }
  return {
    format: 'chat', url: endpointURL(base.href, 'chat/completions'), headers: bearer,
    body: { model, max_completion_tokens: probe ? 768 : proof ? 2400 : 1400, web_search_options: {}, messages: [{ role: 'user', content: prompt }] },
  };
}

const array = value => Array.isArray(value) ? value : [];
const lines = text => typeof text === 'string' && text.length <= 8192 ? text.split('\n') : [];

function annotatedSources(text, annotations, nested = false) {
  const citations = array(annotations).filter(item => item?.type === 'url_citation')
    .map(item => nested ? item.url_citation : item).filter(Boolean).slice(0, 32);
  let offset = 0;
  const citedLines = lines(text).map(line => {
    const start = offset;
    offset += Array.from(line).length + 1;
    return { line, citations: citations.filter(({ start_index, end_index }) =>
      Number.isInteger(start_index) && Number.isInteger(end_index) && start_index >= start && start_index < end_index && end_index < offset) };
  });
  return citations.map(({ url, title }) => {
    // Associate a short finding only when all citations on its line point to this source.
    const found = citedLines.find(item => item.citations.length && item.citations.every(citation => citation.url === url));
    const excerpt = found?.line.replace(/\[[^\]]*\]\([^)]*\)/gu, '').replace(/^\s*(?:[-*]|\d+\.)\s+/u, '').trim();
    return { url, title, excerpt: excerpt?.length <= 600 ? excerpt : undefined, evidence: 'web-summary' };
  });
}

function citationsFrom(format, data) {
  if (format === 'responses') {
    const output = array(data?.output);
    if (!output.some(item => item?.type === 'web_search_call' && item.status === 'completed')) return [];
    return output.filter(item => item?.type === 'message').flatMap(item =>
      array(item.content).flatMap(part => part?.type === 'output_text' ? annotatedSources(part.text, part.annotations) : []));
  }
  if (format === 'messages') {
    const content = array(data?.content);
    const citations = content.flatMap(part => part?.type === 'text' ? array(part.citations)
      .filter(citation => citation?.type === 'web_search_result_location')
      .map(citation => ({ url: citation.url, title: citation.title, excerpt: citation.cited_text, evidence: 'snippet' })) : []);
    const results = content.flatMap(part => part?.type === 'web_search_tool_result' ? array(part.content)
      .filter(result => result?.type === 'web_search_result').map(({ url, title }) => ({ url, title })) : []);
    return [...citations, ...results];
  }
  const message = data?.choices?.[0]?.message;
  return annotatedSources(message?.content, message?.annotations, true);
}

export async function searchModelWeb(profile, query, signal, { fetch: fetchModel = globalThis.fetch, probe = false, target, proofSince, track = 'primary', untranslatedTopic } = {}) {
  signal.throwIfAborted();
  const result = (issue, records = []) => ({ provider: MODEL_WEB_PROVIDER, records, ...(issue ? { issue } : {}) });
  const endpoint = new URL(profile.baseURL);
  if (endpoint.hostname === 'generativelanguage.googleapis.com' || /(^|[.-])aiplatform\.googleapis\.com$/u.test(endpoint.hostname)) {
    return result('grounding-restricted');
  }
  if (!profile.apiKey && !isLocalEndpoint(endpoint)) return result('missing-key');
  try {
    const { format, url, body, headers } = requestFor(profile, query, { probe, target, proofSince, track, untranslatedTopic });
    const response = await fetchModel(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      credentials: 'omit', redirect: 'error', signal,
    });
    const data = JSON.parse(await responseText(response));
    signal.throwIfAborted();
    const records = new Map();
    for (const citation of citationsFrom(format, data)) {
      const source = modelWebSource(citation);
      const key = source && researchUrlKey(source.record.webUrl);
      const previous = records.get(key);
      if (key && (!previous || !previous.record.excerpt && source.record.excerpt)) records.set(key, source);
      if (records.size >= 4) break;
    }
    return records.size ? result(undefined, [...records.values()]) : result('no-citations');
  } catch (error) {
    signal.throwIfAborted();
    if ([400, 404, 405, 422, 501].includes(error?.status)) return result('unsupported');
    return result(searchFailure(error));
  }
}
