import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import core from '../packages/core/dist/index.js';

const {
  addNode,
  buildCanvasRenderPlan,
  buildFfmpegArgs,
  buildRenderPlan,
  connectEdge,
  createCanvas,
  createNode,
  disconnectEdge,
  executeCanvasPlan,
  FileNodeCacheStore,
  ProjectStore,
  addTrack,
  addMediaClip,
  addSubtitleClip,
  timelineDurationMs,
  computeGraphHash,
  topologicalSort,
  validateGraph,
  splitClip,
  moveClip,
  removeNode,
  setNodeParams,
  CanvasCutError,
  VolcengineProvider,
  FileAssetDownloader
} = core;

async function tempDir(prefix = 'canvas-cut-test-') {
  return mkdtemp(join(tmpdir(), prefix));
}

test('graphHash is deterministic and ignores node order', () => {
  const a = createCanvas('same-id');
  const b = createCanvas('same-id');

  const ta = createNode('text-input', { text: 'hello' }, 'text');
  const tia = createNode('text-to-image', { prompt: 'hello' }, 'gen');
  const oa = createNode('output', {}, 'out');
  a.nodes = [ta, tia, oa];
  a.edges = [
    { id: 'e1', source: 'text', sourcePort: 'text', target: 'gen', targetPort: 'text' },
    { id: 'e2', source: 'gen', sourcePort: 'image', target: 'out', targetPort: 'image' }
  ];

  const tb = createNode('text-input', { text: 'hello' }, 'text');
  const tib = createNode('text-to-image', { prompt: 'hello' }, 'gen');
  const ob = createNode('output', {}, 'out');
  b.nodes = [ob, tib, tb];
  b.edges = [
    { id: 'e2', source: 'gen', sourcePort: 'image', target: 'out', targetPort: 'image' },
    { id: 'e1', source: 'text', sourcePort: 'text', target: 'gen', targetPort: 'text' }
  ];

  assert.equal(computeGraphHash(a), computeGraphHash(b));
});

test('graph validation detects cycles and missing required inputs', () => {
  const graph = createCanvas('cycle');
  const a = addNode(graph, 'text-to-image', { prompt: 'hello' }, 'a');
  const b = addNode(graph, 'image-to-image', { prompt: 'world' }, 'b');
  const output = addNode(graph, 'output', {}, 'out');
  graph.edges.push(
    { id: 'e1', source: 'a', sourcePort: 'image', target: 'b', targetPort: 'image' },
    { id: 'e2', source: 'b', sourcePort: 'image', target: 'a', targetPort: 'text' },
    { id: 'e3', source: 'b', sourcePort: 'image', target: 'out', targetPort: 'image' }
  );
  assert.throws(() => validateGraph(graph), (error) => error instanceof CanvasCutError);

  const missing = createCanvas('missing');
  const gen = addNode(missing, 'text-to-image', {}, 'gen');
  addNode(missing, 'output', {}, 'out');
  missing.edges.push({ id: 'e', source: 'gen', sourcePort: 'image', target: 'out', targetPort: 'image' });
  assert.throws(() => validateGraph(missing), /requires a connected text input/);
});

test('connectEdge validates ports and prevents duplicate target input', () => {
  const graph = createCanvas('ports');
  const text = addNode(graph, 'text-input', { text: 'x' }, 'text');
  const image = addNode(graph, 'image-input', { asset: { id: 'a', path: 'a.png', type: 'image', sizeBytes: 1 } }, 'img');
  const gen = addNode(graph, 'image-to-image', { prompt: 'x' }, 'gen');
  addNode(graph, 'output', {}, 'out');

  assert.throws(() => connectEdge(graph, 'text', 'text', 'gen', 'image'), /Port type mismatch/);
  connectEdge(graph, 'img', 'image', 'gen', 'image');
  assert.throws(() => connectEdge(graph, 'img', 'image', 'gen', 'image'), /already connected/);
});

test('canvas mutations update graphHash and remove nodes/edges', () => {
  const graph = createCanvas('mutations');
  const text = addNode(graph, 'text-input', { text: 'x' }, 'text');
  const gen = addNode(graph, 'text-to-image', { prompt: 'x' }, 'gen');
  const out = addNode(graph, 'output', {}, 'out');
  const edge = connectEdge(graph, 'text', 'text', 'gen', 'text');
  connectEdge(graph, 'gen', 'image', 'out', 'image');
  const hashBefore = computeGraphHash(graph);
  setNodeParams(graph, 'gen', { prompt: 'changed' });
  assert.notEqual(computeGraphHash(graph), hashBefore);
  disconnectEdge(graph, edge.id);
  assert.equal(graph.edges.length, 1);
  removeNode(graph, 'text');
  assert.equal(graph.nodes.length, 2);
});

test('buildCanvasRenderPlan creates one child job and topological order', async () => {
  const graph = createCanvas('plan');
  const text = addNode(graph, 'text-input', { text: 'hello' }, 'text');
  const gen = addNode(graph, 'text-to-image', { prompt: 'hello' }, 'gen');
  const out = addNode(graph, 'output', {}, 'out');
  connectEdge(graph, 'text', 'text', 'gen', 'text');
  connectEdge(graph, 'gen', 'image', 'out', 'image');
  const plan = await buildCanvasRenderPlan(graph, { width: 1024, height: 1024, fps: 24, previewResolution: '720p' }, {});
  assert.deepEqual(plan.topologicalOrder, ['text', 'gen', 'out']);
  assert.equal(plan.childJobs.length, 1);
  assert.equal(plan.childJobs[0].type, 'text-to-image');
  assert.equal(plan.childJobs[0].cacheHit, false);
});

test('executeCanvasPlan respects force and calls executor instead of cache', async () => {
  const graph = createCanvas('force-plan');
  const text = addNode(graph, 'text-input', { text: 'hello' }, 'text');
  const gen = addNode(graph, 'text-to-image', { prompt: 'hello' }, 'gen');
  const out = addNode(graph, 'output', {}, 'out');
  connectEdge(graph, 'text', 'text', 'gen', 'text');
  connectEdge(graph, 'gen', 'image', 'out', 'image');

  const cachedAsset = { id: 'cached', path: 'cached.png', type: 'image', sizeBytes: 3 };
  const plan = await buildCanvasRenderPlan(
    graph,
    { width: 1024, height: 1024, fps: 24, previewResolution: '720p' },
    { force: true },
    { get: async () => cachedAsset }
  );

  let calls = 0;
  const result = await executeCanvasPlan(
    plan,
    graph,
    { width: 1024, height: 1024, fps: 24, previewResolution: '720p' },
    {
      execute: async () => {
        calls += 1;
        return cachedAsset;
      },
      renderCanvasReference: async () => cachedAsset
    },
    { get: async () => cachedAsset }
  );

  assert.equal(calls, 1);
  assert.equal(result.output.id, 'cached');
});

test('timeline operations split, trim, move and calculate duration', () => {
  const timeline = { schemaVersion: 1, id: 't', tracks: [] };
  const track = addTrack(timeline, 'video', 'V1');
  const asset = { id: 'v1', path: 'v1.mp4', type: 'video', durationMs: 10_000, sizeBytes: 1 };
  const clip = addMediaClip(track, asset, 0, 10_000);
  const result = splitClip(timeline, clip.id, 5000);
  assert.equal(result.left.durationMs, 5000);
  assert.equal(result.right.startMs, 5000);
  const moved = moveClip(timeline, result.right.id, 7000);
  assert.equal(moved.startMs, 7000);
  assert.equal(timelineDurationMs(timeline), 12_000);
});

test('render plan and ffmpeg args for a single video clip', () => {
  const timeline = { schemaVersion: 1, id: 't', tracks: [] };
  const track = addTrack(timeline, 'video', 'V1');
  addMediaClip(
    track,
    { id: 'v1', path: 'C:/tmp/in.mp4', type: 'video', durationMs: 5000, sizeBytes: 1 },
    0,
    5000
  );
  const plan = buildRenderPlan(timeline, {
    outputPath: 'C:/tmp/out.mp4',
    projectRoot: 'C:/tmp',
    settings: { width: 1920, height: 1080, fps: 24, previewResolution: '720p' }
  });
  const args = buildFfmpegArgs(plan);
  assert.ok(args.includes('C:/tmp/in.mp4'));
  assert.ok(args.includes('-filter_complex'));
  assert.ok(args.some((arg) => arg.endsWith('out.mp4')));
});

test('FileNodeCacheStore persists and retrieves assets', async () => {
  const dir = await tempDir();
  try {
    const cache = new FileNodeCacheStore(dir);
    const asset = { id: 'a1', path: join(dir, 'a.png'), type: 'image', sizeBytes: 3 };
    await writeFile(asset.path, 'abc');
    await cache.put('key-1', asset);
    assert.deepEqual(await cache.get('key-1'), asset);
    assert.equal(await cache.get('missing'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ProjectStore init, config and asset import', async () => {
  const dir = await tempDir();
  try {
    const store = new ProjectStore(dir);
    const project = await store.init('Demo');
    assert.equal(project.name, 'Demo');
    const config = await store.readConfig();
    assert.equal(config.provider.default, 'volcengine');
    config.tos.bucket = 'test-bucket';
    await store.writeConfig(config);
    const updatedConfig = await store.readConfig();
    assert.equal(updatedConfig.tos.bucket, 'test-bucket');
    await writeFile(join(dir, 'source.png'), Buffer.from('fake-png'));
    const asset = await store.importAsset(join(dir, 'source.png'));
    assert.equal(asset.type, 'image');
    assert.equal(asset.sizeBytes, 8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('VolcengineProvider text-to-image parses and downloads URL response', async () => {
  const dir = await tempDir();
  try {
    const downloader = new FileAssetDownloader(dir);
    const provider = new VolcengineProvider(
      { baseUrl: 'https://example.com', imageModel: 'model-image', videoModel: 'model-video', timeoutMs: 5000 },
      'test-key',
      downloader
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('/images/generations')) {
        return new Response(
          JSON.stringify({ data: [{ url: 'data:image/png;base64,aGVsbG8=' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (String(url).startsWith('data:')) {
        return new Response(Buffer.from('aGVsbG8=', 'base64'), { status: 200 });
      }
      throw new Error(`Unexpected fetch URL ${String(url)}`);
    };
    try {
      const job = await provider.textToImage({ prompt: 'hello', width: 1024, height: 1024 });
      assert.equal(job.status, 'succeeded');
      assert.equal(job.result.type, 'image');
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('canvas deletion protects timeline and graph references and preserves assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-delete-'));
  try {
    const store = new ProjectStore(dir);
    await store.init('Delete test');
    const canvas = createCanvas('to-delete');
    await store.writeCanvas(canvas);
    const assetPath = join(store.paths.assetsDir, 'keep.txt');
    await writeFile(assetPath, 'keep');
    const timeline = await store.readTimeline();
    const track = addTrack(timeline, 'video', 'V1');
    core.addCanvasClip(track, canvas, 0, 1000);
    await store.writeTimeline(timeline);
    await assert.rejects(store.removeCanvas(canvas.id), /时间线/);
    assert.equal((await store.readCanvas(canvas.id)).id, canvas.id);
    track.clips = [];
    await store.writeTimeline(timeline);
    const other = createCanvas('referrer');
    addNode(other, 'canvas-reference', { canvasId: canvas.id });
    await store.writeCanvas(other);
    await assert.rejects(store.removeCanvas(canvas.id), /referenced/);
    await store.removeCanvas(other.id);
    await store.removeCanvas(canvas.id);
    assert.equal((await store.listCanvasFiles()).length, 0);
    assert.equal(await (await import('node:fs/promises')).readFile(assetPath, 'utf8'), 'keep');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
