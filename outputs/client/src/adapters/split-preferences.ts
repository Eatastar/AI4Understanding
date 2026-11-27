import { DEFAULT_SPLIT_RATIO } from '../domain/split-layout';

const SPLIT_RATIO_KEY = 'learn-something.reader.split-ratio.v1';

export function loadSplitRatio(storage?: Pick<Storage, 'getItem'>): number {
  try {
    const ratio: unknown = JSON.parse((storage ?? localStorage).getItem(SPLIT_RATIO_KEY) ?? 'null');
    if (typeof ratio === 'number' && ratio > 0 && ratio < 1) return ratio;
  } catch { /* Restricted or invalid preferences use the default split. */ }
  return DEFAULT_SPLIT_RATIO;
}

export function saveSplitRatio(ratio: number, storage?: Pick<Storage, 'setItem'>) {
  try { (storage ?? localStorage).setItem(SPLIT_RATIO_KEY, JSON.stringify(ratio)); }
  catch { /* The current layout can still be adjusted for this session. */ }
}
