import test from 'node:test';
import assert from 'node:assert/strict';
import { filterModels, sortDiscoveredModels } from '../src/domain/model-list';
import { modelSuggestions } from '../src/domain/model-presets';
import { discoverModels } from '../src/adapters/model';

test('models sort naturally by API ID, preserving IDs, labels and the provider array', () => {
  const input = [{ id: 'gpt-10', label: 'First display label' }, { id: 'Qwen-12' }, { id: 'gpt-2', label: 'Last display label' }, { id: 'claude-3' }, { id: 'qwen-2' }, { id: 'GPT-1' }];
  const snapshot = structuredClone(input), sorted = sortDiscoveredModels(input);
  assert.deepEqual(sorted.map(model => model.id), ['claude-3', 'GPT-1', 'gpt-2', 'gpt-10', 'qwen-2', 'Qwen-12']);
  assert.deepEqual(input, snapshot); assert.equal(sorted[2], input[2]); assert.equal(sorted[2].label, 'Last display label');
});

test('the model-list adapter returns sorted API IDs rather than replacing them with friendly labels', async () => {
  const original = globalThis.fetch;
  const connection = { id: 'connection', apiFormat: 'openai-chat' as const, baseURL: 'http://127.0.0.1:11434/v1' };
  globalThis.fetch = async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), connection);
    return Response.json({ models: [{ id: 'model-10', label: 'Alpha' }, { id: 'model-2', label: 'Zulu' }] });
  };
  try {
    const form = { ...connection, name: 'Synthetic', model: 'unsaved-model', systemPrompt: 'Unsaved instructions' };
    const models = await discoverModels(form);
    assert.deepEqual(models, [{ id: 'model-2', label: 'Zulu' }, { id: 'model-10', label: 'Alpha' }]);
  } finally { globalThis.fetch = original; }
});

test('offline suggestions follow saved endpoints, loopback templates, and compatible formats', () => {
  for (const [baseURL, expected] of [
    ['https://api.openai.com/v1/responses', 'gpt-6.2-sol'],
    ['https://api.anthropic.com/v1', 'claude-sonnet-5-5'],
    ['https://api.deepseek.com', 'deepseek-flash'],
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.8-flash'],
    ['https://api.moonshot.cn/v1', 'kimi-k3'],
    ['https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.7-plus'],
    ['https://api.x.ai/v1', 'grok-4.7'],
    ['http://[::1]:11434/v1', 'qwen3:8b'],
    ['http://127.0.0.1:1234/v1', 'qwen/qwen3-8b'],
  ]) assert.equal(modelSuggestions(baseURL, 'openai-chat')[0], expected);
  assert.equal(modelSuggestions('http://localhost:13500/v1', 'openai-chat', 'ollama')[0], 'qwen3:8b');
  assert.equal(modelSuggestions('https://relay.example/v1', 'anthropic-messages')[0], 'claude-sonnet-5-5');
  assert.ok(modelSuggestions('', 'openai-chat').includes('gemini-3.8-flash'));
});

test('model filtering tolerates separators and case while selecting exact IDs', () => {
  const models = [{ id: 'Provider/qwen3.8-flash', label: 'Fast Preview' }, { id: 'other/Qwen3.8', label: 'Vision' }, { id: 'ALT-600', label: 'Fast runtime' }];
  assert.deepEqual(filterModels(models, 'QWEN38 fast'), [models[0]]);
  assert.deepEqual(filterModels(models, 'preview provider/qwen'), [models[0]]);
  assert.deepEqual(filterModels(models, 'fast'), [models[0], models[2]]);
  assert.equal(filterModels(models, '  '), models);
});
