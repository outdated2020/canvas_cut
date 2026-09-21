import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import core from '../packages/core/dist/index.js';
import workerModule from '../apps/desktop/dist/main/job-worker.js';
import storeModule from '../apps/desktop/dist/main/job-store.js';
import daemonModule from '../apps/desktop/dist/main/daemon.js';
import playback from '../apps/desktop/dist/renderer/timelinePlayback.js';

const settings = { width: 640, height: 360, fps: 24, previewResolution: '720p' };
const asset = { id: 'video', path: 'test.mp4', type: 'video', durationMs: 10000, sizeBytes: 1 };
function timeline() { return { schemaVersion: 1, id: 't', tracks: [] }; }

test('speed, split and trim preserve source positions for media and canvas clips', () => {
  for (const kind of ['media', 'canvas']) {
    const tl = timeline();
    const track = core.addTrack(tl, 'video', 'V1');
    const clip = kind === 'media' ? core.addMediaClip(track, asset, 5000) : core.addCanvasClip(track, core.createCanvas('c'), 5000, 10000, asset);
    core.setClipSpeed(tl, clip.id, 2);
    assert.equal(track.clips[0].durationMs, 5000);
    const { left, right } = core.splitClip(tl, clip.id, 7000);
    assert.equal(left.outMs, 4000);
    assert.equal(right.inMs, 4000);
    assert.equal(playback.sourceTimeMs(right, 8000), 6000);
    const trimmed = core.trimClip(tl, right.id, 5000, 9000);
    assert.equal(trimmed.durationMs, 2000);
    assert.equal(playback.sourceTimeMs(trimmed, 7500), 6000);
  }
});

test('paused timeline selection uses clip ranges and leaves gaps empty', () => {
  const tl = timeline();
  core.addMediaClip(core.addTrack(tl, 'video', 'V1'), asset, 5000, 1000);
  assert.equal(playback.activeTimelineClips(tl, 4999).length, 0);
  assert.equal(playback.activeTimelineClips(tl, 5000).length, 1);
  assert.equal(playback.activeTimelineClips(tl, 6000).length, 0);
});

test('export preserves full duration, transforms, CRF and original audio', () => {
  const tl = timeline();
  const track = core.addTrack(tl, 'video', 'V1');
  core.addMediaClip(track, asset, 2000, 2000, 'first');
  const last = core.addMediaClip(track, asset, 7000, 3000, 'last');
  last.transform = { x: 30, y: 20, scale: 0.5, rotation: 45 };
  last.opacity = 0.4;
  const plan = core.buildRenderPlan(tl, { settings, outputPath: 'out.mp4', projectRoot: '.', crf: 27 });
  const args = core.buildFfmpegArgs(plan, new Set(['test.mp4']));
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /color=c=black:s=640x360:r=24:d=10/);
  assert.match(graph, /scale=320:180/);
  assert.match(graph, /colorchannelmixer=aa=0.4/);
  assert.match(graph, /x=\(W-w\)\/2\+30/);
  assert.match(graph, /amix=inputs=2/);
  assert.equal(args[args.indexOf('-crf') + 1], '27');
  assert.equal(args[args.indexOf('-t') + 1], '10');
  assert.throws(() => core.buildRenderPlan(tl, { settings: { ...settings, width: 641 }, outputPath: 'out.mp4', projectRoot: '.' }));
});

test('FFmpeg process is stopped by cancellation', async () => {
  const controller = new AbortController();
  const task = core.runFfmpeg(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(task);
});

test('worker schedules only root jobs and preserves cancelled state on failure', async () => {
  const store = new storeModule.InMemoryJobStore();
  const worker = new workerModule.JobWorker({}, store);
  for (const [id, parent_id] of [['root', null], ['child', 'root']]) {
    store.insert({ id, parent_id, type: id === 'root' ? 'generate.text-to-image' : 'canvas.node', status: 'pending', created_at: 1, updated_at: 1 });
  }
  worker.processGeneration = async (job) => { store.update(job.id, { status: 'cancelled' }); throw new Error('aborted'); };
  await worker.tick();
  await Promise.all([...worker.active]);
  assert.equal(store.get('root').status, 'cancelled');
  assert.equal(store.get('child').status, 'pending');
});

test('worker resumes known remote jobs without submitting generation twice', async () => {
  const store = new storeModule.InMemoryJobStore();
  store.insert({ id: 'root', type: 'generate.text-to-video', status: 'running', provider_task_id: 'remote', created_at: 1, updated_at: 1 });
  const worker = new workerModule.JobWorker({}, store);
  await worker.reconcile();
  assert.equal(store.get('root').status, 'pending');
  let polls = 0;
  worker.createProvider = async () => ({ getJob: async (id) => { assert.equal(id, 'remote'); polls++; return { jobId: id, status: 'succeeded', result: asset }; } });
  await worker.process(store.get('root'));
  assert.equal(polls, 1);
  assert.equal(store.get('root').status, 'succeeded');
});

test('idempotency survives daemon recreation and rejects conflicting requests', async () => {
  const jobStore = new storeModule.InMemoryJobStore();
  const context = { jobStore, activeCanvasRenders: new Map() };
  const first = new daemonModule.DaemonService();
  first.getContext = async () => context;
  const payload = { type: 'generate.text-to-image', request: { prompt: 'hello' } };
  const [a, b] = await Promise.all([first.submitJob('p', payload, 'key'), first.submitJob('p', payload, 'key')]);
  assert.equal(a.jobId, b.jobId);
  const second = new daemonModule.DaemonService();
  second.getContext = async () => context;
  assert.equal((await second.submitJob('p', payload, 'key')).jobId, a.jobId);
  await assert.rejects(second.submitJob('p', { ...payload, request: { prompt: 'different' } }, 'key'));
  assert.equal(jobStore.list().length, 1);
});

test('canvas resolution preserves trims and does not mutate the timeline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-audit-'));
  try {
    const store = new core.ProjectStore(dir);
    await store.init('test');
    const canvas = core.createCanvas('canvas');
    const output = core.addNode(canvas, 'output', {});
    output.cachedResult = asset;
    output.status = 'succeeded';
    await store.writeCanvas(canvas);
    const tl = timeline();
    const clip = core.addCanvasClip(core.addTrack(tl, 'video', 'V1'), canvas, 0, 2000);
    const resolved = await core.resolveCanvasClipsInTimeline(dir, tl);
    assert.equal(resolved.tracks[0].clips[0].durationMs, 2000);
    assert.equal(clip.renderedAsset, undefined);
    await store.writeTimeline(tl);
    core.addNode(canvas, 'text-input', { text: 'change' });
    await store.writeCanvas(canvas);
    assert.equal((await store.readTimeline()).tracks[0].clips[0].status, 'stale');
    assert.equal(canvas.nodes.find((node) => node.type === 'output').cachedResult, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
