import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import core from '../packages/core/dist/index.js';
import workerModule from '../apps/desktop/dist/main/job-worker.js';
import jobsModule from '../apps/desktop/dist/main/job-store.js';
import daemonModule from '../apps/desktop/dist/main/daemon.js';

test('white model catalog advertises local rendering and validates scene/output limits', () => {
  const definition = core.nodeTypeCatalog().types.find(type => type.type === 'white-model-video');
  assert.deepEqual(definition.inputs, []);
  assert.deepEqual(definition.outputs, [{ id: 'video', type: 'video' }]);
  assert.equal(definition.generationType, undefined);
  const validate = new Ajv({ strict: false }).compile(definition.paramsSchema);
  assert.equal(validate(definition.exampleParams), true);
  const request = core.buildWhiteModelRequest(definition.exampleParams);
  assert.equal(request.frameCount, 150);
  assert.equal(request.objects.length, 3);
  assert.equal(core.buildWhiteModelRequest({ durationMs: 1050, fps: 24 }).frameCount, 25);
  for (const params of [
    { width: 1279 }, { width: 1920, height: 1920 }, { fps: 0 }, { fps: 30.5 }, { durationMs: 30001 },
    { objects: [] }, { objects: [{ shape: 'script' }] }, { objects: [{ shape: 'box', size: [0, 1, 1] }] },
    { objects: [{ shape: 'sphere', position: [NaN, 0, 0] }] }, { camera: { start: [0, 1, 0], target: [0, 1, 0] } },
    { background: 'url(texture)' }
  ]) assert.throws(() => core.buildWhiteModelRequest(params), /Invalid white-model-video/);
});

test('white model video can feed video-to-video with no prompt required for local rendering', async () => {
  const graph = core.createCanvas('white-flow');
  const local = core.addNode(graph, 'white-model-video', {}, 'local');
  const edit = core.addNode(graph, 'video-to-video', { prompt: 'A cinematic city' }, 'edit');
  const output = core.addNode(graph, 'output', {}, 'output');
  core.connectEdge(graph, local.id, 'video', edit.id, 'video');
  core.connectEdge(graph, edit.id, 'video', output.id, 'video');
  const settings = { width: 1280, height: 720, fps: 30 };
  const plan = await core.buildCanvasRenderPlan(graph, settings, {});
  assert.deepEqual(plan.childJobs.map(step => step.providerJobType), [null, 'video-to-video']);
  const whiteAsset = { id: 'white', path: 'white.mp4', type: 'video', sizeBytes: 1 };
  const editedAsset = { ...whiteAsset, id: 'edited' };
  const seen = [];
  const result = await core.executeCanvasPlan(plan, graph, settings, {
    execute: async (node, request) => {
      seen.push(node.type);
      if (node.type === 'white-model-video') { assert.equal(request.frameCount, 150); return whiteAsset; }
      assert.deepEqual(request.video, whiteAsset);
      assert.equal(request.prompt, 'A cinematic city');
      return editedAsset;
    }, renderCanvasReference: async () => { throw Error('Unexpected canvas reference'); }
  });
  assert.deepEqual(seen, ['white-model-video', 'video-to-video']);
  assert.equal(result.output, editedAsset);
});

async function project(t) {
  const dir = await mkdtemp(join(tmpdir(), 'white-model-test-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));
  const store = new core.ProjectStore(dir);
  await store.init('White model');
  const graph = core.createCanvas('white');
  core.addNode(graph, 'white-model-video', core.defaultWhiteModelParams(), 'local');
  core.addNode(graph, 'output', {}, 'output');
  core.connectEdge(graph, 'local', 'video', 'output', 'video');
  await store.writeCanvas(graph);
  const jobs = new jobsModule.InMemoryJobStore();
  return { dir, store, jobs };
}

test('worker renders without provider credentials, persists result and reuses cache unless forced', async t => {
  const { dir, store, jobs } = await project(t);
  let renders = 0;
  const asset = { id: 'white-video', path: join(store.paths.assetsDir, 'white.mp4'), type: 'video', sizeBytes: 1, width: 1280, height: 720, durationMs: 5000 };
  await writeFile(asset.path, 'x');
  const worker = new workerModule.JobWorker(store, jobs, { renderWhiteModel: async (request, context) => {
    renders++;
    assert.equal(request.frameCount, 150);
    assert.equal(context.signal.aborted, false);
    context.onProgress(40);
    assert.equal(jobs.list({ status: 'running' }).find(job => job.type === 'canvas.node').progress, 40);
    return asset;
  } });
  worker.createProvider = async () => { throw Error('Local rendering must not create a provider'); };
  const daemon = new daemonModule.DaemonService();
  daemon.getContext = async () => ({ store, jobStore: jobs, worker, activeCanvasRenders: new Map() });
  for (const force of [false, false, true]) {
    const submitted = await daemon.submitJob(dir, { type: 'canvas.render', canvasId: 'white', force });
    await worker.process(jobs.get(submitted.jobId));
    const parent = jobs.get(submitted.jobId);
    assert.equal(parent.status, 'succeeded', parent.error);
    assert.equal(jobs.get(submitted.childJobIds[0]).status, 'succeeded');
  }
  assert.equal(renders, 2);
  const saved = await store.readCanvas('white');
  assert.deepEqual(saved.nodes.find(node => node.id === 'output').cachedResult, asset);
});

test('cancelling a white model job aborts the renderer and leaves no successful cached output', async t => {
  const { dir, store, jobs } = await project(t);
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const worker = new workerModule.JobWorker(store, jobs, { renderWhiteModel: async (_request, { signal }) => {
    started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('Cancelled')), { once: true }));
  } });
  worker.createProvider = async () => { throw Error('Unexpected provider'); };
  const daemon = new daemonModule.DaemonService();
  daemon.getContext = async () => ({ store, jobStore: jobs, worker, activeCanvasRenders: new Map() });
  const submitted = await daemon.submitJob(dir, { type: 'canvas.render', canvasId: 'white' });
  const running = worker.process(jobs.get(submitted.jobId));
  await ready;
  await daemon.cancelJob(dir, submitted.jobId);
  await running;
  assert.equal(jobs.get(submitted.jobId).status, 'cancelled');
  assert.equal(jobs.get(submitted.childJobIds[0]).status, 'cancelled');
  assert.equal((await store.readCanvas('white')).nodes.find(node => node.id === 'output').cachedResult, undefined);
});

test('canvas editing rejects invalid white model scene parameters', async t => {
  const { dir } = await project(t);
  const operations = new core.CanvasOperations();
  await assert.rejects(operations.call('canvas.node.set-param', dir, { canvasId: 'white', nodeId: 'local', params: { width: 1919 } }), /Invalid/);
  await assert.rejects(operations.call('canvas.node.set-param', dir, { canvasId: 'white', nodeId: 'local', params: { width: 1920, height: 1920 } }), /Invalid/);
  assert.equal((await operations.call('canvas.node.set-param', dir, { canvasId: 'white', nodeId: 'local', params: { durationMs: 2000 } })).node.params.durationMs, 2000);
});
