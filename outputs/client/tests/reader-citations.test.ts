import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MathMarkdown } from '../src/components/MathMarkdown';
import { ReaderCitations } from '../src/components/reader-citations';

test('only validated prose citations become inline source controls; fenced or inline code remains literal',()=>{
  const html=renderToStaticMarkup(createElement(ReaderCitations.Provider,{value:{ids:['R11.5'],open:()=>{}}},
    createElement(MathMarkdown,{children:'One source [R11.5]. Unknown [R77.9]. Code '+String.fromCharCode(96)+'[R11.5]'+String.fromCharCode(96)+'.'})));
  assert.equal((html.match(/data-reader-inline="R11\.5"/gu)??[]).length,1);
  assert.ok(!html.includes('data-reader-inline="R77.9"'));
  assert.ok(html.includes('[R77.9]'));
});
