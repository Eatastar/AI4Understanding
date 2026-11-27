import Dexie, { type Table } from 'dexie';
import { streamExperimentReply } from './model';
import { comparisonGroups, warmupGroups, trialKey, trialMessages, trialQueue } from '../domain/paper-experiment';
import { retrieveProofEvidence } from '../domain/proof-evidence';
import type { Connection, ExperimentRound, TrialAnswer } from '../domain/paper-experiment';
import type { InputMessage } from '../domain/types';

const database = new Dexie('ai4u-paper-experiments') as Dexie & { rounds: Table<ExperimentRound, string> };
database.version(1).stores({ rounds: 'id,documentId' });

export const loadPaperRounds = (documentId: string) => database.rounds.where('documentId').equals(documentId).sortBy('createdAt');

export async function saveRound(round: ExperimentRound): Promise<ExperimentRound> {
  const next = { ...round, revision: round.revision + 1 };
  await database.transaction('rw', database.rounds, async () => {
    const previous = await database.rounds.get(round.id);
    if ((previous?.revision ?? 0) !== round.revision) throw new Error('另一窗口已更新本轮实验，请重新打开实验后继续。');
    await database.rounds.put(next);
  });
  return next;
}

async function measureReply(messages: InputMessage[], connection: Connection, signal: AbortSignal, send: typeof streamExperimentReply): Promise<TrialAnswer> {
  signal.throwIfAborted();
  const started = performance.now();
  let firstTextMs: number | undefined, text = '';
  const result = await send(messages, connection, delta => {
    if (!delta) return;
    firstTextMs ??= Math.round(performance.now() - started);
    text += delta;
  }, signal);
  if (firstTextMs === undefined || !text.trim()) throw new Error('模型返回空白回答，本轮可继续重试。');
  return { text, model: result.modelLabel, ...result.usage, firstTextMs, elapsedMs: Math.round(performance.now() - started) };
}

export async function probeExperimentConnection(connection: Connection, signal: AbortSignal) {
  const reply = await measureReply([
    { role: 'system', content: '按要求简短作答。' }, { role: 'user', content: '连接测试。' }, { role: 'user', content: '请只回复 OK。' },
  ], connection, signal, streamExperimentReply);
  return reply.model;
}

export async function runPaperRound(round: ExperimentRound, connection: Connection, signal: AbortSignal,
  onSaved: (round: ExperimentRound) => void, send = streamExperimentReply) {
  await navigator.locks.request('ai4u-paper-experiment/' + round.id, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('本轮实验已在另一窗口运行。');
    signal.throwIfAborted();
    if (round.connection && (Object.keys(round.answers).length || Object.keys(round.warmups ?? {}).length) &&
      (['profileId', 'model', 'apiFormat', 'baseURL', 'temperature'] as const).some(key => round.connection![key] !== connection[key]))
      throw new Error('实验使用的连接已变更。请恢复原模型、接口格式和地址，或新建一轮实验。');
    const proofEvidence = { ...round.proofEvidence };
    if (comparisonGroups(round).includes('G4')) for (const item of round.cases) {
      proofEvidence[item.id] ??= retrieveProofEvidence(round.blocks, item.anchor, item.quote, item.question);
    }
    let current = await saveRound({ ...round, connection, ...(comparisonGroups(round).includes('G4') ? { proofEvidence } : {}) });
    onSaved(current);
    for (const trial of trialQueue(current)) {
      if (current.answers[trial.key]) continue;
      if (current.preheat && trial.turn === 1) {
        for (const group of warmupGroups(current)) {
          const key = trialKey(trial.item, group, 1);
          if (current.warmups?.[key]) continue;
          const prefix = trialMessages(current, { ...trial, group, key });
          prefix.push({ role: 'user', content: '仅预热上述请求的缓存。请只回复 OK。' });
          const { text: _discarded, ...receipt } = await measureReply(prefix, connection, signal, send);
          current = await saveRound({ ...current, warmups: { ...current.warmups, [key]: { ...receipt, finishedAt: Date.now() } } });
          onSaved(current);
        }
      }
      const answer = await measureReply(trialMessages(current, trial), connection, signal, send);
      current = await saveRound({ ...current, answers: { ...current.answers, [trial.key]: answer } });
      onSaved(current);
    }
  });
}
