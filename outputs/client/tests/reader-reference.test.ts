import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceLineBoxes } from '../src/adapters/reader-search';

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

test('a reference over math on two lines produces one band per line, including a subscript', () => {
  const first = box(10, 10, 48, 24);
  const subscript = box(49, 18, 54, 28);
  const second = box(10, 27, 48, 41);
  assert.deepEqual(referenceLineBoxes([first, first, subscript, box(54, 10, 100, 24), second, box(50, 27, 95, 41)]),
    [box(10, 10, 100, 28), box(10, 27, 95, 41)]);
});

test('a reference preserves the first text position and leaves gaps between columns unpainted', () => {
  const rightColumn = box(130, 20, 194, 36);
  const leftColumn = box(8, 20, 61, 36);
  assert.deepEqual(referenceLineBoxes([rightColumn, leftColumn, box(0, 0, 0, 20), box(8, 37, 61, 53)]),
    [rightColumn, leftColumn, box(8, 37, 61, 53)]);
});
