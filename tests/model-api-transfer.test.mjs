import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import transfer from '../apps/desktop/dist/main/model-api-transfer.js';

const source = { arkBaseUrl: 'https://ark.example/v3', arkImageModel: '自定义图像模型', arkVideoModel: 'ep-video',
  arkApiKey: 'ark-secret', agentBaseUrl: 'https://api.deepseek.com', agentModel: 'deepseek-chat', agentApiKey: 'agent-secret',
  tosAccessKeyId: 'tos-id', tosAccessKeySecret: 'tos-secret', tosBucket: 'bucket', tosRegion: 'cn-beijing', tosEndpoint: 'https://tos.example' };

test('portable export omits all credentials by default, excludes machine/runtime data, and preserves target keys on merge', () => {
  const serialized = transfer.serializeModelApiSettings({ ...source, ffmpegPath: 'C:/ffmpeg.exe', agentRuntime: 'secret-runtime' }, false);
  const imported = transfer.parseModelApiSettings(serialized);
  for (const key of ['arkApiKey', 'agentApiKey', 'tosAccessKeyId', 'tosAccessKeySecret', 'ffmpegPath', 'agentRuntime']) assert.ok(!(key in imported));
  assert.equal(imported.arkImageModel, source.arkImageModel);
  assert.equal({ agentApiKey: 'target-key', ...imported }.agentApiKey, 'target-key');
  assert.ok(!serialized.includes('secret'));
});

test('explicit credential export round-trips without machine encryption and retains custom IDs and empty values', () => {
  assert.deepEqual(transfer.parseModelApiSettings('\uFEFF' + transfer.serializeModelApiSettings(source, true)), source);
  assert.deepEqual(transfer.parseModelApiSettings(transfer.serializeModelApiSettings({ agentApiKey: '' }, true)), { agentApiKey: '' });
});

test('untrusted files reject unsupported versions, arrays, encrypted settings, unknown keys, oversized and malformed values', () => {
  const wrap = settings => JSON.stringify({ format: 'canvas-cut-model-api', version: 1, settings });
  for (const invalid of ['not json', 'null', '[]', '{}', JSON.stringify({ format: 'canvas-cut-model-api', version: 2, settings: source }),
    wrap([]), wrap({}), wrap({ agentModel: 1 }), wrap({ agentModel: 'a'.repeat(8193) }), wrap({ agentApiKey: 'encrypted:v1:old-machine' }),
    wrap({ agentModel: 'x', ffmpegPath: '/arbitrary' }), wrap(JSON.parse('{"__proto__":{"polluted":true}}')), ' '.repeat(256 * 1024 + 1)]) {
    assert.throws(() => transfer.parseModelApiSettings(invalid));
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => transfer.serializeModelApiSettings({ agentApiKey: 'omitted' }, false), /没有可导出/);
  assert.throws(() => transfer.serializeModelApiSettings(Object.fromEntries(Object.keys(source).map(key => [key, '界'.repeat(8192)])), true), /256 KB/);
});

test('file dialogs cancel without I/O; export/import use the selected file and reject invalid/oversized files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-cut-api-transfer-'));
  try {
    const filePath = join(directory, 'portable.json');
    const dialogs = { save: async () => filePath, open: async () => filePath };
    const cancelled = { save: async () => undefined, open: async () => undefined };
    assert.deepEqual(await transfer.exportModelApiSettings(cancelled, source, true), { cancelled: true });
    assert.deepEqual(await transfer.importModelApiSettings(cancelled), { cancelled: true });
    await transfer.exportModelApiSettings(dialogs, source, true);
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')).settings, source);
    assert.deepEqual(await transfer.importModelApiSettings(dialogs), { cancelled: false, settings: source });
    await writeFile(filePath, '{broken');
    await assert.rejects(transfer.importModelApiSettings(dialogs), /JSON/);
    await writeFile(filePath, ' '.repeat(256 * 1024 + 1));
    await assert.rejects(transfer.importModelApiSettings(dialogs), /256 KB/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
