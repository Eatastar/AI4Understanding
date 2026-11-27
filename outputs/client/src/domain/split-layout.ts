export const DEFAULT_SPLIT_RATIO = 0.5;
export const SPLIT_DIVIDER_WIDTH = 10;
const MIN_PANE_WIDTH = 360;

export function splitRatioBounds(width: number) {
  const min = width > 0 ? Math.min(MIN_PANE_WIDTH / width, 0.45) : 0.45;
  return { min, max: 1 - min };
}

export function clampSplitRatio(ratio: number, width: number) {
  const { min, max } = splitRatioBounds(width);
  return Number.isFinite(ratio) ? Math.max(min, Math.min(max, ratio)) : DEFAULT_SPLIT_RATIO;
}
