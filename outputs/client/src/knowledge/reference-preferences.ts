import { referenceKinds, type ReferenceKind } from './wiki-types';

export const REFERENCE_PREFERENCES_KEY = 'ai-paper-pdf-reader.wiki-reference.v1';
export const REFERENCE_BATCH = 30;
export type ReferenceFilter = 'all' | ReferenceKind;
export type ReferenceMode = 'solid' | 'translucent';
export interface ReferenceFrame { left: number; top: number; width: number; height: number }
export interface ReferencePreferences {
  frame?: ReferenceFrame;
  mode: ReferenceMode;
  filter: ReferenceFilter;
  query: string;
  scroll: number;
  limit: number;
  expanded?: string;
}

type Size = { width: number; height: number };
const MARGIN = 8;
const cap = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max));

export function clampReferenceFrame(frame: ReferenceFrame, viewport: Size): ReferenceFrame {
  const openWidth = Math.max(1, viewport.width - MARGIN * 2);
  const openHeight = Math.max(1, viewport.height - MARGIN * 2);
  const width = cap(frame.width, Math.min(265, openWidth), openWidth);
  const height = cap(frame.height, Math.min(180, openHeight), openHeight);
  return {
    width, height, left: cap(frame.left, MARGIN, viewport.width - width - MARGIN),
    top: cap(frame.top, MARGIN, viewport.height - height - MARGIN),
  };
}

export function referenceFrame(fraction: ReferenceFrame | undefined, viewport: Size) {
  return clampReferenceFrame(fraction ? {
    left: fraction.left * viewport.width, top: fraction.top * viewport.height,
    width: fraction.width * viewport.width, height: fraction.height * viewport.height,
  } : { left: viewport.width - 371, top: 142, width: 345, height: Math.min(518, viewport.height * .66) }, viewport);
}

export function referenceFraction(frame: ReferenceFrame, viewport: Size): ReferenceFrame {
  return { left: frame.left / viewport.width, top: frame.top / viewport.height,
    width: frame.width / viewport.width, height: frame.height / viewport.height };
}

export function loadReferencePreferences(): ReferencePreferences {
  const empty: ReferencePreferences = { mode: 'translucent', filter: 'all', query: '', scroll: 0, limit: REFERENCE_BATCH };
  try {
    const source = JSON.parse(localStorage.getItem(REFERENCE_PREFERENCES_KEY) ?? '{}');
    const rect = source.frame;
    const frame = rect && (['left', 'top', 'width', 'height'] as const).every(key => Number.isFinite(rect[key]) && rect[key] >= 0 && rect[key] <= 1)
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined;
    return {
      ...empty, frame,
      mode: source.mode === 'solid' ? 'solid' : 'translucent',
      filter: referenceKinds.find(kind => kind === source.filter) ?? 'all',
      query: typeof source.query === 'string' ? source.query.slice(0, 200) : '',
      scroll: Number.isFinite(source.scroll) ? Math.max(0, source.scroll) : 0,
      limit: Number.isSafeInteger(source.limit) ? cap(source.limit, REFERENCE_BATCH, 3_000) : REFERENCE_BATCH,
      expanded: typeof source.expanded === 'string' ? source.expanded : undefined,
    };
  } catch { return empty; }
}
export function saveReferencePreferences(preferences: ReferencePreferences) {
  try { localStorage.setItem(REFERENCE_PREFERENCES_KEY, JSON.stringify(preferences)); }
  catch { /* Layout preferences are optional. */ }
}
