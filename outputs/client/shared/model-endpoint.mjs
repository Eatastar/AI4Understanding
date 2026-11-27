/** Shared pure URL helper; contains no server or desktop dependencies. */
export function isLocalEndpoint(url) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function modelListEndpoint(baseURL) {
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid model endpoint');
  const path = url.pathname.replace(/\/+$/, '');
  const resource = /\/(?:chat\/completions|responses|messages|models)$/.test(path);
  const defaultPrefix = url.hostname === 'api.deepseek.com' ? '' : '/v1';
  const prefix = resource ? path.replace(/\/(?:chat\/completions|responses|messages|models)$/, '') : path || defaultPrefix;
  url.pathname = `${prefix}/models`;
  return url;
}
