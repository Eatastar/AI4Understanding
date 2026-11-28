const fs = require('node:fs/promises');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

const ORIGINS = new Set(['qa', 'quote', 'synthesis']);
const MAX_TEXT = 2_000_000;
const invalidCard = () => new Error('知识卡片格式不正确。');

function text(value, max = MAX_TEXT) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalidCard();
  return value.trim();
}

function fields(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.tags)) throw invalidCard();
  const { source, origin } = value;
  if (!origin || !ORIGINS.has(origin.type)) throw invalidCard();
  let document;
  if (source !== undefined) {
    if (!source || (source.page !== undefined && (!Number.isSafeInteger(source.page) || source.page < 1))) throw invalidCard();
    document = {
      docId: text(source.docId, 200), docTitle: text(source.docTitle, 500),
      ...(source.page === undefined ? {} : { page: source.page }),
      ...(source.quote === undefined ? {} : { quote: text(source.quote) }),
    };
    if (source.fingerprint !== undefined) {
      const { size, sha256 } = source.fingerprint || {};
      if (!Number.isSafeInteger(size) || size < 1 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) throw invalidCard();
      document.fingerprint = { size, sha256 };
    }
  }
  return {
    title: text(value.title, 500), content: text(value.content),
    tags: [...new Set(value.tags.map(tag => text(tag, 200)))],
    ...(value.projectId === undefined ? {} : { projectId: value.projectId === null ? null : text(value.projectId, 200) }),
    ...(document ? { source: document } : {}),
    origin: { type: origin.type, ...(origin.chatId === undefined ? {} : { chatId: text(origin.chatId, 200) }) },
  };
}

function parseCards(raw) {
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) throw invalidCard();
  const ids = new Set();
  return entries.map(entry => {
    const card = fields(entry);
    const id = text(entry.id, 200);
    const { createdAt, updatedAt } = entry;
    if (ids.has(id) || ![createdAt, updatedAt].every(time => Number.isSafeInteger(time) && time >= 0)) throw invalidCard();
    ids.add(id);
    return { id, ...card, createdAt, updatedAt };
  });
}

function createKnowledgeStore({ directory, io = fs, now = Date.now }) {
  const primary = join(directory, 'cards.json');
  const backup = join(directory, 'cards.json.bak');
  const temporary = join(directory, 'cards.json.tmp');
  const temporaryBackup = join(directory, 'cards.json.bak.tmp');
  let queue = Promise.resolve();
  const serial = work => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  async function readFile(path) {
    let raw;
    try { raw = await io.readFile(path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try { return { cards: parseCards(raw), raw }; }
    catch { return { cards: null }; }
  }
  async function read() {
    const saved = await readFile(primary);
    if (saved?.cards) return { ...saved, recovered: false };
    const previous = await readFile(backup);
    if (previous?.cards) return { ...previous, recovered: true };
    if (!saved && !previous) return { cards: [], raw: '[]\n', recovered: false };
    throw new Error('知识库文件和备份均无法读取。');
  }
  async function discardTemporary(path) {
    try { await io.unlink(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function stage(path, data) {
    await discardTemporary(path);
    const handle = await io.open(path, 'wx', 0o600);
    try { await handle.writeFile(data, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
  }
  async function commit(cards, previous) {
    await io.mkdir(directory, { recursive: true });
    try {
      await stage(temporary, JSON.stringify(cards, null, 2) + '\n');
      await stage(temporaryBackup, previous.raw);
      await io.rename(temporaryBackup, backup);
      await io.rename(temporary, primary);
      return { cards, recovered: false };
    } finally {
      await Promise.allSettled([discardTemporary(temporary), discardTemporary(temporaryBackup)]);
    }
  }
  return {
    list: () => serial(async () => {
      const { cards, recovered } = await read();
      return { cards, recovered };
    }),
    save: value => serial(async () => {
      const draft = fields(value);
      const previous = await read();
      const id = value.id === undefined ? undefined : text(value.id, 200);
      const current = id === undefined ? undefined : previous.cards.find(card => card.id === id);
      if (id !== undefined && !current) throw new Error('这张知识卡片已不存在。');
      const updatedAt = now();
      const card = { id: current?.id ?? 'kb_' + randomUUID(), ...draft, createdAt: current?.createdAt ?? updatedAt, updatedAt };
      const cards = current ? previous.cards.map(item => item.id === id ? card : item) : [card, ...previous.cards];
      return commit(cards, previous);
    }),
    remove: id => serial(async () => {
      const key = text(id, 200);
      const previous = await read();
      const cards = previous.cards.filter(card => card.id !== key);
      if (cards.length === previous.cards.length) return { cards, recovered: previous.recovered };
      return commit(cards, previous);
    }),
    importCards: raw => serial(async () => {
      let incoming;
      try {
        if (typeof raw !== 'string') throw invalidCard();
        incoming = parseCards(raw);
      } catch { throw new Error('无法导入知识库，请选择有效的卡片 JSON 文件。'); }
      const previous = await read();
      const existing = new Set(previous.cards.map(card => card.id));
      const additions = incoming.filter(card => !existing.has(card.id));
      const next = additions.length ? await commit([...additions, ...previous.cards], previous) : { cards: previous.cards, recovered: previous.recovered };
      return { ...next, added: additions.length, skipped: incoming.length - additions.length };
    }),
    idle: () => queue,
  };
}

module.exports = { createKnowledgeStore, parseCards };
