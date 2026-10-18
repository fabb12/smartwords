import test from 'node:test';
import assert from 'node:assert/strict';
import { readTokens, providerRequest } from '../lib/providers.ts';
import { assistStream } from '../lib/assist-stream.ts';
import { addTokenUsage, finalizeUsage, parseUsageEvent, readTokenHistory, recordTokenUsage, sanitizeTokenHistory, summarizeTokenUsage, tokenUsageKey } from '../lib/token-usage.ts';

function sse(events) {
  const bytes = new TextEncoder().encode(events.map(e => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\r\n\r\n').join(''));
  return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
}
async function read(events, provider = 'openai') {
  let text = '', usage = {};
  for await (const token of readTokens(sse(events), provider, u => { usage = { ...usage, ...u }; })) text += token;
  return { text, usage };
}
const prose = { choices: [{ delta: { content: 'È una frase.' }, finish_reason: 'stop' }] };

test('OpenAI compatible streams preserve trailing usage-only frames and cached input without doubling totals', async () => {
  const { text, usage } = await read([prose, { choices: [], usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128, prompt_tokens_details: { cached_tokens: 40 } } }, '[DONE]']);
  assert.equal(text, 'È una frase.');
  assert.deepEqual(finalizeUsage(usage, '', '', text), { inputTokens: 120, outputTokens: 8, cachedInputTokens: 40, totalTokens: 128, estimated: false });
  for (const provider of ['openai', 'gemini', 'groq', 'mistral', 'deepseek', 'openrouter']) assert.equal(providerRequest(provider, 'model', 'key', '', '').body.stream_options.include_usage, true);
});

test('Anthropic combines initial input, cache reads/writes and cumulative output updates once', async () => {
  const { usage } = await read([
    { type: 'message_start', message: { usage: { input_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 50, output_tokens: 1 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'La risposta' } },
    { type: 'message_delta', usage: { output_tokens: 3 } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  ], 'anthropic');
  assert.deepEqual(finalizeUsage(usage, '', '', ''), { inputTokens: 100, outputTokens: 7, cachedInputTokens: 50, totalTokens: 107, estimated: false });
  assert.equal(providerRequest('anthropic', 'model', 'key', '', '').body.stream_options, undefined);
});

test('interrupted Anthropic output never treats the provisional initial count as final usage', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Una risposta parziale abbastanza lunga' } },
  ];
  const result = await new Response(assistStream(sse(events), 'anthropic', { provider: 'anthropic', model: 'haiku', system: '', prompt: '' }, () => {})).text();
  const frames = result.trim().split('\n').map(JSON.parse), usage = frames.find(f => f.usage).usage;
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.estimated, true);
  assert.ok(usage.outputTokens > 1);
  assert.ok(frames.at(-1).error);
});

test('shared cloud/browser/device wire format sends usage before terminal events, with explicit estimates when absent', async () => {
  let cleanups = 0;
  const meta = { provider: 'ollama', model: 'qwen3', system: '1234', prompt: '1234' };
  const body = assistStream(sse([prose, '[DONE]']), 'openai', meta, () => { cleanups++; });
  const frames = (await new Response(body).text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(frames.at(-2).usage, { ...finalizeUsage({}, meta.system, meta.prompt, 'È una frase.'), provider: 'ollama', model: 'qwen3' });
  assert.equal(frames.at(-1).done, true); assert.equal(cleanups, 1);
  const reported = assistStream(sse([prose, { usage: { prompt_tokens: 9, completion_tokens: 4 } }, '[DONE]']), 'openai', meta, () => {});
  const wire = (await new Response(reported).text()).trim().split('\n').map(JSON.parse);
  assert.equal(wire.at(-2).usage.estimated, false);
  assert.equal(wire.at(-2).usage.totalTokens, 13);
});

const now = Date.parse('2026-10-17T12:00:00Z');
const event = { provider: 'anthropic', model: 'haiku', ...finalizeUsage({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 30 }, '', '', '') };
test('statistics aggregate by day and actual provider/model with period filters and bounded history', () => {
  let history = addTokenUsage([], event, false, now - 8 * 86400000);
  history = addTokenUsage(history, event, false, now);
  history = addTokenUsage(history, { ...event, model: 'sonnet', estimated: true, outputTokens: 30 }, true, now);
  history = addTokenUsage(history, { ...event, provider: 'openrouter' }, false, now);
  const today = summarizeTokenUsage(history, 1, now);
  assert.equal(today.requests, 3); assert.equal(today.totalTokens, 370);
  assert.equal(today.estimatedRequests, 1); assert.equal(today.interruptedRequests, 1);
  assert.equal(today.models.length, 3); assert.equal(today.cachedInputTokens, 90);
  assert.equal(summarizeTokenUsage(history, 7, now).requests, 3);
  assert.equal(summarizeTokenUsage(history, 30, now).requests, 4);
  assert.equal(summarizeTokenUsage(history, 1, now + 90 * 86400000).requests, 0);
  assert.deepEqual(sanitizeTokenHistory([{ ...history[0], day: '2026-02-30' }, { ...history[0], requests: -1 }, null], now), []);
  assert.equal(parseUsageEvent({ ...event, inputTokens: -1 }), null);
});

test('recording persists without text or credentials, separates users and tolerates malformed storage or full storage', t => {
  const data = new Map();
  globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  t.after(() => delete globalThis.localStorage);
  assert.equal(recordTokenUsage('alice', event), true);
  assert.equal(recordTokenUsage('alice', { ...event, model: 'sonnet' }, true), true);
  assert.equal(readTokenHistory('alice').length, 2);
  assert.equal(summarizeTokenUsage(readTokenHistory('alice')).requests, 2);
  assert.deepEqual(readTokenHistory('bob'), []);
  assert.ok(!data.get(tokenUsageKey('alice')).includes('prompt'));
  data.set(tokenUsageKey('bob'), '{bad'); assert.deepEqual(readTokenHistory('bob'), []);
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  assert.equal(recordTokenUsage('alice', event), false);
});
