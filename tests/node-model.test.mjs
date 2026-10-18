import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import core from '../packages/core/dist/index.js';
import workerModule from '../apps/desktop/dist/main/job-worker.js';
import jobsModule from '../apps/desktop/dist/main/job-store.js';
import daemonModule from '../apps/desktop/dist/main/daemon.js';
const settings = { width: 1280, height: 720, fps: 24, previewResolution: '720p' };
const defaults = { imageModel: 'image-default', videoModel: 'video-default' };
const image = { id: 'input-image', path: 'https://example.test/image.png', type: 'image', sizeBytes: 1 };
const video = { id: 'input-video', path: 'https://example.test/video.mp4', type: 'video', sizeBytes: 1 };
const types = ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'video-to-video'];

test('model catalog filters provider and generation capability without restricting custom IDs', () => {
  for (const type of types) {
    const listed = core.listGenerationModels('volcengine', type);
    assert.equal(listed.length, type.endsWith('-to-video') ? 4 : 2);
    assert.equal(new Set(listed.map(model => model.id)).size, listed.length);
    for (const model of listed) {
      const wrongType = type.endsWith('-to-video') ? 'text-to-image' : 'video-to-video';
      assert.ok(!core.listGenerationModels('volcengine', wrongType).some(other => other.id === model.id));
    }
    const node = core.createNode(type, { prompt: 'test', model: 'ep-unlisted-custom', asset: type === 'video-to-video' ? video : image });
    assert.equal(core.buildProviderRequest(node, {}, settings, defaults).model, 'ep-unlisted-custom');
  }
  for (const type of ['white-model-video', 'text-input', 'output', 'unknown']) assert.deepEqual(core.listGenerationModels('volcengine', type), []);
  assert.deepEqual(core.listGenerationModels('unknown-provider', 'text-to-image'), []);
  assert.ok(core.listGenerationModels('volcengine', 'text-to-video').some(model => model.id === core.createDefaultConfigFile().provider.volcengine.videoModel));
});

test('all cloud node requests resolve independent models, blanks restore defaults, white model stays local', () => {
  for (const type of types) {
    const node = core.createNode(type, { prompt: 'hello', model: `  ${type}-custom  `, asset: type === 'video-to-video' ? video : image });
    assert.equal(core.buildProviderRequest(node, {}, settings, defaults).model, `${type}-custom`);
    for (const model of [undefined, null, '', '   ']) {
      node.params.model = model;
      assert.equal(core.buildProviderRequest(node, {}, settings, defaults).model, type.endsWith('-to-video') ? defaults.videoModel : defaults.imageModel);
    }
    node.params.model = 123;
    assert.throws(() => core.buildProviderRequest(node, {}, settings, defaults), /model must be a string/);
  }
  assert.equal(core.buildProviderRequest(core.createNode('white-model-video'), {}, settings, defaults).model, undefined);
});

test('effective model isolates caches; pinned overrides survive default changes and empty forms share a key', () => {
  const inherited = core.createNode('text-to-image', { prompt: 'test' });
  const key = core.nodeCacheKey(inherited, {}, settings, defaults);
  assert.notEqual(key, core.nodeCacheKey(inherited, {}, settings, { ...defaults, imageModel: 'other' }));
  for (const model of [null, '', ' ']) {
    inherited.params.model = model;
    assert.equal(key, core.nodeCacheKey(inherited, {}, settings, defaults));
  }
  inherited.params.model = 'fixed';
  const fixed = core.nodeCacheKey(inherited, {}, settings, defaults);
  assert.equal(fixed, core.nodeCacheKey(inherited, {}, settings, { imageModel: 'other', videoModel: 'other' }));
  const local = core.createNode('white-model-video');
  assert.equal(core.nodeCacheKey(local, {}, settings), core.nodeCacheKey(local, {}, settings, defaults));
});

test('provider HTTP bodies use each request model for all five methods without leaking between calls', async () => {
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(String(url).includes('/images/generations')
      ? { data: [{ url: 'https://example.test/result.png' }] } : { id: 'video-task', status: 'queued' }), { status: 200 });
  };
  try {
    const provider = new core.VolcengineProvider({ baseUrl: 'https://example.test', ...defaults }, 'mock-key',
      { download: async () => image });
    const calls = [
      ['textToImage', { prompt: 'test' }], ['imageToImage', { prompt: 'test', image }],
      ['textToVideo', { prompt: 'test' }], ['imageToVideo', { prompt: 'test', image, durationMs: 5000 }],
      ['videoToVideo', { prompt: 'test', video, mode: 'edit' }]
    ];
    for (const [method, request] of calls) {
      await provider[method]({ ...request, model: ` ${method}-custom ` });
      assert.equal(bodies.at(-1).model, `${method}-custom`);
      await provider[method]({ ...request, model: ' ' });
      assert.equal(bodies.at(-1).model, method.endsWith('Image') ? defaults.imageModel : defaults.videoModel);
    }
    assert.equal(bodies.at(-1).omni_reference_task_type, 'edit');
  } finally { globalThis.fetch = originalFetch; }
});

test('canvas editor validates and persists per-node model through the shared API', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'node-model-edit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new core.ProjectStore(dir); await store.init('Models');
  const ops = new core.CanvasOperations();
  const { canvasId } = await ops.call('canvas.create', dir, {});
  const { nodeId } = await ops.call('canvas.node.add', dir, { canvasId, type: 'text-to-image', params: { prompt: 'test', model: 'image-custom' } });
  await ops.call('canvas.node.set-param', dir, { canvasId, nodeId, params: { model: null } });
  assert.equal((await store.readCanvas(canvasId)).nodes[0].params.model, null);
  await assert.rejects(ops.call('canvas.node.set-param', dir, { canvasId, nodeId, params: { model: 12 } }), /Invalid.*parameters/);
  for (const type of types) assert.deepEqual(core.nodeParamsSchema(type).properties.model.type, ['string', 'null']);
});

test('worker executes a mixed-model image/video graph, reuses unchanged nodes and invalidates inherited model on config change', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'node-model-worker-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new core.ProjectStore(dir); await store.init('Models');
  const config = await store.readConfig(); Object.assign(config.provider.volcengine, defaults); await store.writeConfig(config);
  const graph = core.createCanvas('models');
  core.addNode(graph, 'text-input', { text: 'test' }, 'text');
  core.addNode(graph, 'text-to-image', { model: 'image-a' }, 'a');
  core.addNode(graph, 'text-to-image', { model: 'image-b' }, 'b');
  core.addNode(graph, 'image-to-video', { model: 'video-custom', durationMs: 5000 }, 'v');
  core.addNode(graph, 'output', {}, 'out');
  for (const id of ['a', 'b', 'v']) core.connectEdge(graph, 'text', 'text', id, 'text');
  core.connectEdge(graph, 'a', 'image', 'v', 'image'); core.connectEdge(graph, 'v', 'video', 'out', 'video');
  await store.writeCanvas(graph);
  const calls = [];
  async function result(request, type) {
    calls.push({ type, model: request.model });
    const asset = { id: `${request.model}-${type}`, path: join(store.paths.assetsDir, `${request.model}.${type==='image'?'png':'mp4'}`), type, sizeBytes: 1 };
    await writeFile(asset.path, 'x');
    return { jobId: 'done', providerId: 'fake', type, status: 'succeeded', result: asset };
  }
  const jobs = new jobsModule.InMemoryJobStore();
  const worker = new workerModule.JobWorker(store, jobs);
  worker.createProvider = async () => ({ textToImage: request => result(request, 'image'), imageToVideo: request => result(request, 'video') });
  const daemon = new daemonModule.DaemonService();
  daemon.getContext = async () => ({ store, jobStore: jobs, worker, activeCanvasRenders: new Map() });
  async function render() {
    const submitted = await daemon.submitJob(dir, { type: 'canvas.render', canvasId: 'models' });
    await worker.process(jobs.get(submitted.jobId));
    assert.equal(jobs.get(submitted.jobId).status, 'succeeded', jobs.get(submitted.jobId).error);
  }
  await render(); assert.equal(calls.length, 3);
  assert.deepEqual(new Set(calls.map(c=>c.model)), new Set(['image-a','image-b','video-custom']));
  await render(); assert.equal(calls.length, 3, 'Unchanged render reuses cache');
  let saved = await store.readCanvas('models'); core.setNodeParams(saved, 'b', { model: 'image-c' }); await store.writeCanvas(saved);
  await render(); assert.equal(calls.length, 4); assert.equal(calls.at(-1).model, 'image-c');
  saved = await store.readCanvas('models'); core.setNodeParams(saved, 'b', { model: '' }); await store.writeCanvas(saved);
  await render(); assert.equal(calls.at(-1).model, defaults.imageModel);
  config.provider.volcengine.imageModel = 'image-new-default'; await store.writeConfig(config);
  await render(); assert.equal(calls.at(-1).model, 'image-new-default'); assert.equal(calls.length, 6);
});
