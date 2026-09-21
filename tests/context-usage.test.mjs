import test from 'node:test';
import assert from 'node:assert/strict';
import usage from '../packages/agent/dist/context-usage.js';

test('empty context starts at zero', () => {
  assert.equal(usage.contextUsage([]).usedCharacters, 0);
  assert.equal(usage.contextUsage([]).ratio, 0);
});

test('context counts retained tool results as well as visible messages', () => {
  const messages = [{ role: 'user', content: '你好' }, { role: 'tool', content: [{ type: 'tool-result', output: 'a'.repeat(4000) }] }];
  const result = usage.contextUsage(messages);
  assert.equal(result.usedCharacters, JSON.stringify(messages).length);
  assert.equal(result.ratio, result.usedCharacters / usage.CONTEXT_CHARACTER_LIMIT);
  assert.equal(result.compactThreshold, usage.CONTEXT_COMPACT_THRESHOLD);
  assert.ok(usage.contextUsage(messages.slice(0, 1)).ratio < result.ratio);
});

test('overflow preserves the actual count but clamps the ring to one circle', () => {
  const result = usage.contextUsage([{ role: 'user', content: 'a'.repeat(210000) }]);
  assert.ok(result.usedCharacters > result.limitCharacters);
  assert.equal(result.ratio, 1);
});
