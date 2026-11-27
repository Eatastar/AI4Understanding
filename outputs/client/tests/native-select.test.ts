import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('new JSX screens use NativeSelect for consistent arrows and focus styling', () => {
  const source = fileURLToPath(new URL('../src/', import.meta.url));
  const directSelects = readdirSync(source, { encoding: 'utf8', recursive: true })
    .filter(file => file.endsWith('.tsx') && /<select[\s>]/.test(readFileSync(join(source, file), 'utf8')))
    .map(file => file.replaceAll('\\', '/'));
  assert.deepEqual(directSelects, ['components/NativeSelect.tsx']);
});
