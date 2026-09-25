import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import agent from '../packages/agent/dist/index.js';
import chat from '../apps/desktop/dist/renderer/chat-history.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'conversations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { storageDir: join(root, 'sessions'), configure: async () => ({ apiKey: 'test' }), createHost: () => { throw new Error('unused'); }, skillDirectories: () => [] };
  return { root, options, service: new agent.AgentSessionService(options) };
}
test('conversation CRUD is persistent, project isolated and soft-deleted history is recoverable', async t => {
  const { root, service, options } = await fixture(t);
  assert.equal((await service.list(root))[0].conversationId, 'default');
  const created = await service.create(root);
  await service.manage(root, created.conversationId, 'rename', '我的对话');
  await service.manage(root, created.conversationId, 'archive');
  const restarted = new agent.AgentSessionService(options);
  const list = await restarted.list(root);
  assert.equal(list.length, 2);
  assert.equal(list.find(item => item.conversationId === created.conversationId).title, '我的对话');
  await assert.rejects(restarted.start(root, 'hello', created.conversationId), /恢复/);
  assert.deepEqual((await restarted.list(join(root, 'other'))).map(item => item.conversationId), ['default']);
  const before = await restarted.history(root, created.conversationId);
  await restarted.manage(root, created.conversationId, 'delete');
  assert.equal((await restarted.list(root)).length, 1);
  await assert.rejects(restarted.history(root, created.conversationId), /deleted/);
  const disk = JSON.parse(await readFile(join(options.storageDir, `${before.id}.json`), 'utf8'));
  assert.ok(disk.deletedAt);
  await restarted.manage(root, created.conversationId, 'restore');
  assert.deepEqual((await restarted.history(root, created.conversationId)).messages, before.messages);
  await assert.rejects(restarted.manage(root, created.conversationId, 'rename', '  '), /Title/);
});
test('legacy default history survives metadata operations and deletion does not resurrect it', async t => {
  const { root, service, options } = await fixture(t);
  const legacy = await service.history(root);
  legacy.messages = [{ role: 'user', content: 'existing history' }];
  await service.list(root);
  await writeFile(join(options.storageDir, `${legacy.id}.json`), JSON.stringify(legacy));
  const restarted = new agent.AgentSessionService(options);
  await restarted.list(root);
  await restarted.manage(root, 'default', 'rename', '旧对话');
  assert.deepEqual((await restarted.history(root)).messages, legacy.messages);
  await restarted.manage(root, 'default', 'delete');
  assert.deepEqual(await new agent.AgentSessionService(options).list(root), []);
});
test('management cannot race a starting run', async t => {
  const { root, options } = await fixture(t);
  let release;
  options.configure = () => new Promise(resolve => { release = resolve; });
  const service = new agent.AgentSessionService(options);
  const start = service.start(root, 'hello');
  await assert.rejects(service.manage(root, 'default', 'delete'), /停止/);
  await assert.rejects(service.manage(root, 'default', 'archive'), /停止/);
  release({ apiKey: '' });
  await assert.rejects(start, /API key/);
});

test('switching to a running conversation restores partial streamed text without completed duplicates', () => {
  const session = { run: { id: 'run', status: 'running' }, messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'first step' }], events: [
    { runId: 'old', type: 'assistant-delta', data: { messageId: 'old', text: 'ignore' } },
    { runId: 'run', type: 'assistant-delta', data: { messageId: 'one', text: 'first step' } },
    { runId: 'run', type: 'assistant', data: { messageId: 'one', text: 'first step' } },
    { runId: 'run', type: 'assistant-delta', data: { messageId: 'two', text: '正在' } },
    { runId: 'run', type: 'assistant-delta', data: { messageId: 'two', text: '处理' } }
  ] };
  assert.deepEqual(chat.restoreChatMessages(session), [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'first step' }, { id: 'two', role: 'assistant', text: '正在处理' }]);
  session.messages.push({ role: 'assistant', content: '正在处理' });
  assert.equal(chat.restoreChatMessages(session).length, 3);
  session.run.status = 'completed';
  assert.equal(chat.restoreChatMessages(session).length, 3);
});
