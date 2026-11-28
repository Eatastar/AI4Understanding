const fs = require('node:fs/promises');
const { randomUUID, createHash } = require('node:crypto');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { gzip, gunzip } = require('node:zlib');

const compress = promisify(gzip), decompress = promisify(gunzip);
const pageIdPattern = /^wiki_[a-f0-9-]{36}$/u;
const revisionName = /^r([1-9]\d*)-(\d+)\.json\.gz$/u;
const MAX_BYTES = 8_000_000;
const MAX_TEXT = 2_000_000;
const blockTypes = new Set(['paragraph', 'heading', 'inlineMath', 'blockMath', 'wikiLink']);
const nodeTypes = new Set(['doc', 'text', 'hardBreak', 'horizontalRule', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'sourceCite', ...blockTypes]);
const markTypes = new Set(['bold', 'italic', 'strike', 'code']);
const relations = new Set(['related', 'depends_on', 'explains', 'extends']);
const invalid = () => new Error('知识库条目格式无效。');

function text(value, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw invalid();
  return value;
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  return value;
}
function integer(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw invalid();
  return value;
}
function pageId(value) {
  if (typeof value !== 'string' || !pageIdPattern.test(value)) throw invalid();
  return value;
}

function cleanLocator(value) {
  const raw = object(value), locator = {};
  for (const key of ['documentId', 'conversationId', 'messageId', 'versionId', 'annotationId', 'subAnnotationId']) {
    if (raw[key] !== undefined) locator[key] = text(raw[key], 512);
  }
  if (raw.start !== undefined) locator.start = integer(raw.start);
  if (raw.page !== undefined) locator.page = integer(raw.page, 1);
  if (raw.quote !== undefined) locator.quote = text(raw.quote, MAX_TEXT);
  if (raw.bbox !== undefined) {
    if (!Array.isArray(raw.bbox) || raw.bbox.length !== 4 || !raw.bbox.every(Number.isFinite)) throw invalid();
    locator.bbox = raw.bbox.slice();
  }
  if (raw.url !== undefined) {
    let url;
    try { url = new URL(text(raw.url, 2_000)); } catch { throw invalid(); }
    if (url.protocol !== 'https:' || url.username || url.password) throw invalid();
    locator.url = url.href;
  }
  return locator;
}

function cleanBody(raw, createIds) {
  const seen = new Set();
  let count = 0, chars = 0;
  function node(value, depth) {
    const input = object(value);
    if (++count > 30_000 || depth > 60 || !nodeTypes.has(input.type) || (input.type === 'doc') !== (depth === 0)) throw invalid();
    const result = { type: input.type };
    const attrs = input.attrs == null ? {} : object(input.attrs);
    const known = {};
    if (blockTypes.has(input.type)) {
      let id = attrs.blockId;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id) || seen.has(id)) {
        if (!createIds) throw invalid();
        id = randomUUID();
      }
      seen.add(id);
      known.blockId = id;
    }
    switch (input.type) {
      case 'text':
        result.text = text(input.text, MAX_TEXT, true);
        chars += result.text.length;
        if (!result.text.length || chars > MAX_TEXT) throw invalid();
        break;
      case 'heading':
        known.level = integer(attrs.level ?? 2, 1);
        if (known.level > 6) throw invalid();
        break;
      case 'orderedList': known.start = integer(attrs.start ?? 1, 1); break;
      case 'codeBlock':
        if (typeof attrs.language === 'string') known.language = text(attrs.language, 80);
        break;
      case 'blockMath':
      case 'inlineMath': known.latex = text(attrs.latex, 100_000); break;
      case 'wikiLink':
        known.pageId = pageId(attrs.pageId);
        known.label = text(attrs.label, 512);
        known.relation = relations.has(attrs.relation) ? attrs.relation : 'related';
        if (attrs.toBlockId != null) known.toBlockId = text(attrs.toBlockId, 128);
        break;
      case 'sourceCite':
        known.refId = text(attrs.refId, 2_000);
        known.sourceId = text(attrs.sourceId, 2_000);
        known.label = text(attrs.label, 512);
        known.locator = cleanLocator(attrs.locator || {});
        break;
    }
    if (Object.keys(known).length) result.attrs = known;
    if (input.marks !== undefined) {
      if (!Array.isArray(input.marks) || input.marks.length > markTypes.size) throw invalid();
      result.marks = input.marks.map(mark => {
        if (!markTypes.has(object(mark).type)) throw invalid();
        return { type: mark.type };
      });
    }
    if (input.content !== undefined) {
      if (!Array.isArray(input.content) || input.content.length > 30_000) throw invalid();
      result.content = input.content.map(child => node(child, depth + 1));
    }
    return result;
  }
  const body = node(raw, 0);
  if (!body.content?.length) {
    if (!createIds) throw invalid();
    body.content = [{ type: 'paragraph', attrs: { blockId: randomUUID() } }];
  }
  return body;
}

function cleanDraft(raw, createIds) {
  const input = object(raw);
  if (!Array.isArray(input.domains) || input.domains.length > 32) throw invalid();
  return {
    title: text(input.title, 240).trim(),
    domains: [...new Set(input.domains.map(item => text(item, 80).trim()))],
    body: cleanBody(input.body, createIds),
    ...(input.personalUnderstanding !== undefined ? { personalUnderstanding: text(input.personalUnderstanding, MAX_TEXT, true) } : {}),
  };
}

function withLinks(page) {
  const links = [];
  function visit(node, enclosing) {
    const attrs = node.attrs;
    if (node.type === 'wikiLink') {
      links.push({
        id: page.id + ':' + attrs.blockId,
        fromPageId: page.id, toPageId: attrs.pageId, relation: attrs.relation,
        ...(enclosing ? { fromBlockId: enclosing } : {}),
        ...(attrs.toBlockId ? { toBlockId: attrs.toBlockId } : {}),
        source: 'user', status: 'accepted',
      });
    }
    for (const child of node.content ?? []) visit(child, attrs?.blockId ?? enclosing);
  }
  visit(page.body);
  return { page, links };
}

/** Each revision is an immutable, atomically published snapshot of one page. */
function createWikiStore({ directory, io = fs, now = Date.now }) {
  const pages = join(directory, 'pages');
  let queue = Promise.resolve();
  const serial = work => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  async function entries(path) {
    try { return await io.readdir(path, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function versions(id) {
    const directory = join(pages, pageId(id));
    const dir = await io.lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (dir && !dir.isDirectory()) throw invalid();
    const files = await entries(directory);
    const found = new Set();
    return files.flatMap(file => {
      const match = file.isFile() && revisionName.exec(file.name);
      if (!match) return [];
      const revision = integer(Number(match[1]), 1), updatedAt = integer(Number(match[2]));
      if (found.has(revision)) throw invalid();
      found.add(revision);
      return [{ revision, updatedAt, file: file.name }];
    }).sort((a, b) => b.revision - a.revision);
  }
  async function read(id, version) {
    if (!version) throw new Error('知识库版本不存在。');
    const bytes = await io.readFile(join(pages, pageId(id), version.file));
    if (bytes.length > MAX_BYTES) throw invalid();
    const { schemaVersion, ...raw } = object(JSON.parse((await decompress(bytes, { maxOutputLength: MAX_BYTES })).toString('utf8')));
    if (schemaVersion !== 1 || raw.id !== id || raw.revision !== version.revision || raw.updatedAt !== version.updatedAt) throw invalid();
    return {
      id, ...cleanDraft(raw, false), revision: version.revision,
      createdAt: integer(raw.createdAt), updatedAt: version.updatedAt,
    };
  }
  async function append(id, draft, head, expectedRevision) {
    if ((head?.revision ?? 0) !== integer(expectedRevision)) throw new Error('知识库条目已有更新，请重新打开后再保存。');
    const updatedAt = integer(Math.max(now(), head?.updatedAt ?? 0));
    const page = { id, ...draft, createdAt: head?.createdAt ?? updatedAt, updatedAt, revision: (head?.revision ?? 0) + 1 };
    const data = Buffer.from(JSON.stringify({ schemaVersion: 1, ...page }), 'utf8');
    if (data.length > MAX_BYTES) throw new Error('知识库条目过大，请拆成多个条目。');
    const dir = join(pages, id);
    await io.mkdir(dir, { recursive: true });
    const destination = join(dir, 'r' + page.revision + '-' + updatedAt + '.json.gz');
    const temporary = join(dir, '.write-' + randomUUID() + '.tmp');
    try {
      const bytes = await compress(data);
      const handle = await io.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      await io.rename(temporary, destination);
    } finally {
      await io.unlink(temporary).catch(() => {});
    }
    return withLinks(page);
  }
  async function exportHistory() {
    const history = [];
    for (const dir of await entries(pages)) {
      if (!dir.isDirectory() || !pageIdPattern.test(dir.name)) continue;
      for (const version of (await versions(dir.name)).reverse()) history.push(await read(dir.name, version));
    }
    return history;
  }
  async function importHistory(raw) {
    if (!Array.isArray(raw)) throw invalid();
    const groups = new Map();
    for (const item of raw) {
      const id = pageId(object(item).id);
      const page = { id, ...cleanDraft(item, false), revision: integer(item.revision, 1),
        createdAt: integer(item.createdAt), updatedAt: integer(item.updatedAt) };
      const revisions = groups.get(id) ?? [];
      revisions.push(page); groups.set(id, revisions);
    }
    const existing = new Set();
    let conflict = false;
    for (const [id, revisions] of groups) {
      revisions.sort((a,b) => a.revision - b.revision);
      if (revisions.some((p,i) => p.revision !== i + 1 || p.createdAt !== revisions[0].createdAt || p.updatedAt < (revisions[i-1]?.updatedAt ?? p.createdAt))) throw invalid();
      const local = await versions(id);
      if (!local.length) continue;
      existing.add(id);
      for (const page of revisions) {
        const previous = local.find(v => v.revision === page.revision);
        if (!previous || JSON.stringify(await read(id, previous)) !== JSON.stringify(page)) { conflict = true; break; }
      }
    }
    const copies = new Map();
    if (conflict) {
      const digest = createHash('sha256');
      for (const id of [...groups.keys()].sort()) digest.update(JSON.stringify(groups.get(id)));
      const stamp = digest.digest('hex');
      // A conflict forks the whole imported set so internal links and repeated imports stay stable.
      for (const id of groups.keys()) {
        const hex = createHash('sha256').update(stamp + id).digest('hex').slice(0,32);
        copies.set(id, 'wiki_' + [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-'));
      }
    }
    function mapLinks(node) {
      if (node.type === 'wikiLink' && copies.has(node.attrs.pageId)) node.attrs.pageId = copies.get(node.attrs.pageId);
      for (const child of node.content ?? []) mapLinks(child);
    }
    await io.mkdir(pages, { recursive: true });
    const staged = [], published = [];
    try {
      for (const [id, revisions] of groups) {
        if (!conflict && existing.has(id)) continue;
        const target = copies.get(id) ?? id;
        for (const page of revisions) { page.id = target; mapLinks(page.body); }
        const local = await versions(target);
        if (local.length) {
          for (const page of revisions) {
            const old = local.find(v => v.revision === page.revision);
            if (!old || JSON.stringify(await read(target, old)) !== JSON.stringify(page)) throw new Error('本地条目已有其他修订，原有内容已保留。');
          }
          continue;
        }
        const temp = await io.mkdtemp(join(pages, '.import-'));
        staged.push({ temp, destination: join(pages, target) });
        for (const page of revisions) {
          const bytes = Buffer.from(JSON.stringify({schemaVersion: 1, ...page}));
          if (bytes.length > MAX_BYTES) throw invalid();
          await io.writeFile(join(temp, 'r' + page.revision + '-' + page.updatedAt + '.json.gz'), await compress(bytes), { flag: 'wx', mode: 0o600 });
        }
      }
      for (const item of staged) { await io.rename(item.temp, item.destination); published.push(item); }
      return staged.length;
    } catch (error) {
      for (const item of published.reverse()) await io.rename(item.destination, item.temp);
      throw error;
    } finally {
      for (const item of staged) await io.rm(item.temp, { recursive: true, force: true });
    }
  }
  return {
    exportHistory: () => serial(exportHistory),
    importHistory: raw => serial(() => importHistory(raw)),
    list: () => serial(async () => {
      const records = [];
      for (const dir of await entries(pages)) {
        if (!dir.isDirectory() || !pageIdPattern.test(dir.name)) continue;
        const [latest] = await versions(dir.name);
        if (latest) records.push(withLinks(await read(dir.name, latest)));
      }
      return records.sort((a, b) => b.page.updatedAt - a.page.updatedAt);
    }),
    save: raw => serial(async () => {
      const input = object(raw), id = input.id === undefined ? 'wiki_' + randomUUID() : pageId(input.id);
      const draft = cleanDraft(input.draft, true);
      const [version] = await versions(id);
      if (input.id !== undefined && !version) throw new Error('知识库条目已不存在。');
      return append(id, draft, version && await read(id, version), input.expectedRevision);
    }),
    history: id => serial(async () => (await versions(id)).map(({ revision, updatedAt }) => ({ revision, updatedAt }))),
    revision: raw => serial(async () => {
      const { id, revision } = object(raw);
      const selected = (await versions(id)).find(version => version.revision === integer(revision, 1));
      return read(id, selected);
    }),
    restore: raw => serial(async () => {
      const { id, revision, expectedRevision } = object(raw);
      const list = await versions(id);
      const selected = await read(id, list.find(version => version.revision === integer(revision, 1)));
      return append(id, cleanDraft(selected, false), await read(id, list[0]), expectedRevision);
    }),
    idle: () => queue,
  };
}

module.exports = { createWikiStore };
