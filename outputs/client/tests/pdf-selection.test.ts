import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestPdfTextBox, pdfCaretOffsets, pdfHighlightBoxes } from '../src/domain/pdf-selection';

test('duplicate native range boxes and tight PDF line spacing do not form darker bands', () => {
  const bounds = { left: 0, top: 0, right: 100, bottom: 100 };
  const first = { left: 8, top: 10, right: 94, bottom: 48 };
  const last = { left: 8, top: 41, right: 66, bottom: 79 };
  const boxes = pdfHighlightBoxes([first, first, last], bounds);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].left, .08);
  assert.equal(boxes[1].right, .66);
  assert(boxes[0].bottom < boxes[1].top);
});

test('highlight geometry stays page-relative under scroll and zoom, with clipping on rotated pages', () => {
  const page = { left: 0, top: 0, right: 100, bottom: 200 };
  const box = { left: 8, top: -3, right: 32, bottom: 74 };
  const scaled = ({ left, top, right, bottom }: typeof box) => ({
    left: left * 2 + 50, right: right * 2 + 50, top: top * 2 - 100, bottom: bottom * 2 - 100,
  });
  const [normal] = pdfHighlightBoxes([box], page, true);
  const [after] = pdfHighlightBoxes([scaled(box)], scaled(page), true);
  assert.equal(normal.top, 0);
  assert(normal.left > .08 && normal.right < .32);
  for (const side of ['left', 'top', 'right', 'bottom'] as const) assert(Math.abs(normal[side] - after[side]) < 1e-12);
});

test('a short final abstract line wins over earlier full lines when the pointer ends just beyond its text', () => {
  // Measured from the reported PDF at fit-to-width: native selection stopped
  // three lines early at a container offset rather than the final text node.
  const boxes = [
    { left: 140.8, top: 432.7, right: 462.5, bottom: 440 },
    { left: 140.8, top: 441.2, right: 462.5, bottom: 448.4 },
    { left: 140.8, top: 449.7, right: 462.5, bottom: 456.9 },
    { left: 140.8, top: 458.1, right: 317.1, bottom: 465.4 },
  ];
  assert.equal(nearestPdfTextBox(boxes, 319, 462), 3);
  assert.equal(nearestPdfTextBox(boxes, 139, 462), 3);
  assert.equal(nearestPdfTextBox(boxes, 240, 445), 1);
});

test('indentation, formula fragments and adjacent columns resolve from geometry rather than DOM order', () => {
  const boxes = [
    { left: 320, top: 100, right: 500, bottom: 110 },
    { left: 100, top: 112, right: 300, bottom: 122 },
    { left: 108, top: 100, right: 300, bottom: 110 },
  ];
  assert.equal(nearestPdfTextBox(boxes, 102, 104), 2);
  assert.equal(nearestPdfTextBox(boxes, 302, 117), 1);
  assert.equal(nearestPdfTextBox(boxes, 322, 104), 0);
  assert.equal(nearestPdfTextBox([], 1, 1), null);
  assert.equal(nearestPdfTextBox([{ left: NaN, top: 0, right: 1, bottom: 1 }], 1, 1), null);
});

test('caret boxes support zoom, scroll offsets and rotated text with zero-height or zero-width caret lines', () => {
  const carets = [0, 1, 2, 3].map(offset => ({ left: 50 + offset * 8, right: 50 + offset * 8, top: 100, bottom: 114 }));
  assert.equal(nearestPdfTextBox(carets, 67, 108), 2);
  const scaled = carets.map(b => ({ left: b.left * 1.5 - 40, right: b.right * 1.5 - 40, top: b.top * 1.5 - 90, bottom: b.bottom * 1.5 - 90 }));
  assert.equal(nearestPdfTextBox(scaled, 67 * 1.5 - 40, 108 * 1.5 - 90), 2);
  const rotated = carets.map(b => ({ left: b.top, right: b.bottom, top: b.left, bottom: b.right }));
  assert.equal(nearestPdfTextBox(rotated, 108, 67), 2);
});

test('caret offsets retain complete Chinese characters, combining marks, emoji and UTF-16 annotation offsets', () => {
  const text = '摘e\u0301要👨‍👩‍👧‍👦𝛿';
  const offsets = pdfCaretOffsets(text);
  assert.deepEqual(offsets.map((end, i) => text.slice(offsets[i - 1] ?? 0, end)).slice(1), ['摘', 'e\u0301', '要', '👨‍👩‍👧‍👦', '𝛿']);
  assert.equal(offsets.at(-1), text.length);
  assert.deepEqual(pdfCaretOffsets(''), [0]);
});
