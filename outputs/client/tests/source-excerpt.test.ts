import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceFormulas } from '../src/adapters/source-math';
import { pdfExcerptGeometry } from '../src/adapters/pdf-excerpt';
import { hasSelectionBar, selectionLayout } from '../src/adapters/pdf-selection-layout';

test('source math retains literal offsets for prose, inline math, display matrices, superscripts and conjugates', () => {
  const text = '原文  $a_i$ and \\(\\bar z\\).\n\\[M=\\begin{pmatrix}1&1+\\lambda^{-1}\\\\1&1+\\lambda\\end{pmatrix}\\]\n$$x^2$$';
  const formulas = sourceFormulas(text);
  assert.deepEqual(formulas.map(f => text.slice(f.start, f.end)), ['$a_i$', '\\(\\bar z\\)', text.split('\n')[1], '$$x^2$$']);
  assert.match(formulas[2].html, /<mtable\b/);
  assert.match(formulas[2].html, /<msup>/);
  assert.match(formulas[1].html, /<mover/);
  assert.match(formulas[3].html, /katex-display/);
  const environment = '\\begin{aligned}u &= \\begin{pmatrix}x\\\\y\\end{pmatrix}\\end{aligned}';
  const bare = sourceFormulas(environment);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].end, environment.length);
  assert.match(bare[0].html, /<mtable\b/);
});

test('literal source text survives currency, code, escaped, invalid and unterminated math', () => {
  const tick = String.fromCharCode(96);
  for (const text of ['$5 and $10', '\\$5', tick + '$x$ \\(y\\)' + tick, '~~~\n\\[x\\]\n~~~',
    '\\\\(not math\\\\)', '$\\unknownSourceCommand{x}$', '$$\nunclosed', 'PDF: ( 1 1 + λ−1 )']) assert.deepEqual(sourceFormulas(text), [], text);
  const text = '<img src="x" onerror="alert(1)"> $x$';
  assert.deepEqual(sourceFormulas(text).map(f => text.slice(f.start, f.end)), ['$x$']);
});

const run = (str: string, x: number, y: number) => ({ str, dir: 'ltr', transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10, fontName: 'text', hasEOL: true });
const viewport = { width: 240, height: 300, transform: [1, 0, 0, -1, 0, 300] } as Parameters<typeof pdfExcerptGeometry>[1];
const items = [run('First z', 20, 260), run('1 + x', 55, 230), run('First z', 20, 160), run('1 + x', 55, 130)];
const content: Parameters<typeof pdfExcerptGeometry>[0] = { items, styles: { text: { ascent: .8, descent: -.2, vertical: false, fontFamily: 'serif' } }, lang: null };
const page = 'First z\n1 + x\nFirst z\n1 + x';
const measure = (s: string) => s.length * 5;

test('native PDF crops keep the anchored occurrence and the highlighted step even when selection loses line breaks', () => {
  const start = page.lastIndexOf('First');
  const found = pdfExcerptGeometry(content, viewport, page, 'First z1 + x', start, [7, 12], measure);
  assert.ok(found);
  assert.ok(found.rect.y > .4 && found.rect.y < .5);
  assert.equal(found.marks.length, 1);
  assert.ok(found.marks[0].y > .5);
  assert.equal(pdfExcerptGeometry(content, viewport, page, 'First z1 + x', undefined, undefined, measure), undefined);
  assert.equal(pdfExcerptGeometry(content, viewport, page.replace('First', 'Other'), 'First z', start, undefined, measure), undefined);
});

test('a selection inside one text run crops only the chosen characters', () => {
  const row = { ...content, items: [run('prefix alpha suffix', 10, 150)] };
  const found = pdfExcerptGeometry(row, viewport, 'prefix alpha suffix', 'alpha', undefined, undefined, measure);
  assert.ok(found);
  assert.ok(found.rect.x * 240 > 35 && found.rect.x * 240 < 45);
  assert.ok(found.width < 45);
});

test('only the selected geometry distinguishes scripts and aligned columns from ordinary wrapped text', () => {
  const plain = [run('This paragraph mentions a matrix and a fraction.',10,100),run('Its next line contains ordinary prose.',10,87)];
  assert.equal(selectionLayout(plain).stacked,false);
  assert.equal(selectionLayout([run('x',10,100),{...run('2',15,105),height:7,transform:[7,0,0,7,15,105]}]).stacked,true);
  assert.equal(selectionLayout([run('a',10,100),run('b',35,100),run('c',10,86),run('d',35,86)]).stacked,true);
  assert.equal(selectionLayout([run('a',10,100),run('b',10,86)]).stacked,false);
});

test('a separate overbar is evidence only when it overlaps a selected glyph in transformed PDF coordinates', () => {
  const names={save:1,restore:2,transform:3,constructPath:4,paintFormXObjectBegin:5,paintFormXObjectEnd:6,endPath:7};
  const ops={fnArray:[1,3,4,2],argsArray:[[],[1,0,0,1,50,100],[10,[],[0,7,6,7]],[]]} as Parameters<typeof hasSelectionBar>[1];
  assert.equal(hasSelectionBar(selectionLayout([run('z',50,100)]),ops,names),true);
  assert.equal(hasSelectionBar(selectionLayout([run('z',70,100)]),ops,names),false);
});

test('automatic capture declines a rectangle containing text outside the selected reading sequence', () => {
  const cols = {...content,items:[run('a',10,150),run('b',100,100),run('other column',30,125)]};
  assert.ok(pdfExcerptGeometry(cols,viewport,'a b other column','a b',0,undefined,measure));
  assert.equal(pdfExcerptGeometry(cols,viewport,'a b other column','a b',0,undefined,measure,true),undefined);
});
