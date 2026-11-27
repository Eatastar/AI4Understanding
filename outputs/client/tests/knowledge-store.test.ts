import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import test from 'node:test';
import type { KnowledgeDraft, KnowledgeImport, KnowledgeLibrary } from '../src/domain/knowledge';

type Store = {
  list(): Promise<KnowledgeLibrary>;
  save(draft: KnowledgeDraft): Promise<KnowledgeLibrary>;
  remove(id: string): Promise<KnowledgeLibrary>;
  importCards(raw: string): Promise<KnowledgeImport>;
};
const { createKnowledgeStore } = createRequire(import.meta.url)('../desktop/knowledge-store.cjs') as {
  createKnowledgeStore(options: { directory: string; io?: typeof fs; now?: () => number }): Store;
};
const draft: KnowledgeDraft = {
  title: '合成结论', content: '结论的依据 🌱', tags: ['模拟', '模拟', '物理'],
  source: { docId: 'synthetic-pdf', docTitle: 'Synthetic paper.pdf', page: 2, quote: 'Synthetic paragraph' },
  origin: { type: 'qa', chatId: 'synthetic-chat' },
};

test('knowledge JSON saves, edits and deletes atomically while retaining the previous array', async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'margin-knowledge-crud-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const primary = join(directory, 'cards.json');
  const backup = join(directory, 'cards.json.bak');
  let time = 2;
  const store = createKnowledgeStore({ directory, now: () => time });
  assert.deepEqual(await store.list(), { cards: [], recovered: false });
  assert.deepEqual(await fs.readdir(directory), []);
  const [saved] = (await store.save(draft)).cards;
  assert.deepEqual(saved.tags, ['模拟', '物理']);
  assert.deepEqual(saved.source, draft.source);
  assert.deepEqual(JSON.parse(await fs.readFile(backup, 'utf8')), []);
  const original = await fs.readFile(primary, 'utf8');

  time += 1;
  const [edited] = (await store.save({ ...saved, title: '修订结论' })).cards;
  assert.equal(edited.id, saved.id);
  assert.equal(edited.createdAt, saved.createdAt);
  assert.equal(edited.updatedAt, 3);
  assert.equal(await fs.readFile(backup, 'utf8'), original);
  assert.deepEqual((await createKnowledgeStore({ directory }).list()).cards, [edited]);

  await store.remove(saved.id);
  assert.deepEqual((await store.list()).cards, []);
  assert.deepEqual(JSON.parse(await fs.readFile(backup, 'utf8')), [edited]);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['cards.json', 'cards.json.bak']);
  await assert.rejects(store.save({ ...edited, title: 'Stale editor' }), /已不存在/);
});

test('corrupt knowledge JSON recovers a valid backup and preserves files if neither copy can be read', async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'margin-knowledge-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const primary = join(directory, 'cards.json');
  const backup = join(directory, 'cards.json.bak');
  const store = createKnowledgeStore({ directory });
  const first = await store.save(draft);
  await store.save({ ...draft, title: 'Later card' });
  await fs.writeFile(primary, 'malformed', 'utf8');
  assert.deepEqual(await store.list(), { cards: first.cards, recovered: true });
  assert.equal(await fs.readFile(primary, 'utf8'), 'malformed');
  const saved = await store.save({ ...draft, title: 'Recovered write' });
  assert.equal(saved.recovered, false);
  assert.equal(saved.cards.length, 2);

  await fs.writeFile(primary, '[{}]');
  await fs.writeFile(backup, '{"invalid":true}');
  await assert.rejects(store.save(draft), /文件和备份均无法读取/);
  assert.equal(await fs.readFile(primary, 'utf8'), '[{}]');
  assert.equal(await fs.readFile(backup, 'utf8'), '{"invalid":true}');
});

test('knowledge writes serialize concurrent changes and a failed replace keeps the last valid main file', async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'margin-knowledge-atomic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const primary = join(directory, 'cards.json');
  let fail = false;
  const store = createKnowledgeStore({ directory, io: {
    ...fs, rename: async (from, target) => {
      if (fail && target === primary) throw new Error('synthetic rename failure');
      await fs.rename(from, target);
    },
  } });
  await Promise.all([store.save(draft), store.save({ ...draft, title: 'Concurrent card' })]);
  const before = await fs.readFile(primary, 'utf8');
  assert.equal(JSON.parse(before).length, 2);
  fail = true;
  await assert.rejects(store.save({ ...draft, title: 'Uncommitted card' }), /synthetic rename failure/);
  assert.equal(await fs.readFile(primary, 'utf8'), before);
  assert.equal(await fs.readFile(join(directory, 'cards.json.bak'), 'utf8'), before);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['cards.json', 'cards.json.bak']);
  fail = false;
  assert.equal((await store.save({ ...draft, title: 'Retried card' })).cards.length, 3);
});

test('knowledge import is additive, idempotent and validates the full file before changing the library', async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'margin-knowledge-import-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createKnowledgeStore({ directory });
  const [local] = (await store.save(draft)).cards;
  const previous = await fs.readFile(join(directory, 'cards.json'), 'utf8');
  const incoming = {
    ...local, id: 'imported-card', title: 'Imported', createdAt: 12, updatedAt: 15,
    source: { ...draft.source!, fingerprint: { size: 100, sha256: 'a'.repeat(64) } },
  };
  const exportText = JSON.stringify([{ ...local, title: 'Keep local edit' }, incoming]);
  const first = await store.importCards(exportText);
  assert.deepEqual([first.added, first.skipped], [1, 1]);
  assert.deepEqual(first.cards, [incoming, local]);
  const second = await store.importCards(exportText);
  assert.deepEqual([second.added, second.skipped], [0, 2]);
  assert.equal(await fs.readFile(join(directory, 'cards.json.bak'), 'utf8'), previous);
  await assert.rejects(store.importCards(JSON.stringify([{ ...incoming, id: 'another' }, {}])), /卡片 JSON/);
  assert.deepEqual((await store.list()).cards, first.cards);
});
