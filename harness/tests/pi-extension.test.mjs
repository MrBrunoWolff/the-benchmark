import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureBenchmark, isBudgetAbort } from '../pi-extension.mjs';

function fixture(t, config = {}) {
  const handlers = new Map(), logs = [];
  const originalFetch = globalThis.fetch;
  t.mock.method(console, 'log', line => logs.push(JSON.parse(line)));
  t.after(() => { globalThis.fetch = originalFetch; });
  configureBenchmark({ on: (name, handler) => handlers.set(name, handler) },
    { maxTurns: 2, reasoning: 'none', ...config });
  return { handlers, logs };
}

test('a turn limit explicitly marks its abort after completed tool work', t => {
  const { handlers, logs } = fixture(t);
  const end = handlers.get('turn_end');
  let aborted = 0;
  const event = { message: { role: 'assistant', stopReason: 'toolUse' } };
  const ctx = { abort: () => aborted++ };
  end(event, ctx); assert.equal(aborted, 0);
  end(event, ctx); assert.equal(aborted, 1);
  assert.deepEqual(logs, [{ type: 'benchmark_budget', maxTurns: 2, termination: 'abort' }]);
});

test('natural completion or a provider error on the last turn is not called a turn-cap stop', t => {
  const { handlers, logs } = fixture(t);
  const end = handlers.get('turn_end');
  end({ message: { role: 'assistant', stopReason: 'toolUse' } }, {});
  assert.equal(end({ message: { role: 'assistant', stopReason: 'stop' } }), undefined);
  assert.deepEqual(logs, []);
});

test('only the pinned cancellation after an explicit cap is an expected abort', () => {
  assert.equal(isBudgetAbort('This operation was aborted', 'abort'), true);
  assert.equal(isBudgetAbort('Connection reset', 'abort'), false);
  assert.equal(isBudgetAbort('This operation was aborted', null), false);
});

test('explicit reasoning controls reach the final provider payload without logging prompts', t => {
  const { handlers, logs } = fixture(t);
  const payload = { messages: [{ content: 'private fixture' }], max_tokens: 8192, reasoning_effort: 'high' };
  const sent = handlers.get('before_provider_request')({ payload });
  assert.equal(sent.reasoning_effort, 'none');
  assert.equal(sent.max_tokens, 8192);
  assert.equal(payload.reasoning_effort, 'high');
  assert.deepEqual(logs, [{ type: 'benchmark_request', reasoningEffort: 'none', maxTokens: 8192 }]);
});

test('server-default reasoning is not replaced with off', t => {
  const { handlers } = fixture(t, { reasoning: 'default' });
  const sent = handlers.get('before_provider_request')({ payload: { max_tokens: 4096 } });
  assert.equal(Object.hasOwn(sent, 'reasoning_effort'), false);
});

test('transport errors stay observable and propagate', async t => {
  const error = new Error('fixture transport failure');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw error; };
  const { logs } = fixture(t);
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(globalThis.fetch('http://fixture.invalid'), error);
  assert.equal(logs[0].type, 'benchmark_transport_error');
});
