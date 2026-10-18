import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import core from '../packages/core/dist/index.js';

test('shared canvas operations validate, merge parameters, invalidate cache and preserve concurrent edits', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-ops-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new core.ProjectStore(dir); await store.init('Canvas operations');
  const changes = [], operations = new core.CanvasOperations(change => changes.push(change));
  const call = (method, input = {}) => operations.call(method, dir, input);
  const created = await call('canvas.create'); const canvasId = created.canvasId;
  assert.equal(created.version, 1);
  const input = await call('canvas.node.add', { canvasId, type: 'text-input', params: { text: 'initial', extension: 7 } });
  const output = await call('canvas.node.add', { canvasId, type: 'output' });
  const original = await store.readCanvas(canvasId);
  for (const node of original.nodes) { node.status = 'succeeded'; node.cachedResult = { id: 'cached', path: 'cached.png', type: 'image', sizeBytes: 1 }; }
  await store.writeCanvas(original);
  const changed = await call('canvas.node.set-param', { canvasId, nodeId: input.nodeId, params: { text: '中文修改' } });
  assert.deepEqual(changed.node.params, { text: '中文修改', extension: 7 });
  const refreshed = await store.readCanvas(canvasId);
  assert.notEqual(refreshed.graphHash, original.graphHash); assert.equal(refreshed.version, original.version + 1);
  for (const node of refreshed.nodes) { assert.equal(node.status, 'idle'); assert.equal(node.cachedResult, undefined); }
  await Promise.all([0, 1, 2, 3].map(i => call('canvas.node.add', { canvasId, type: 'text-input', params: { text: 'parallel-' + i } })));
  const graph = await store.readCanvas(canvasId);
  assert.equal(graph.nodes.length, 6); assert.equal(graph.version, changed.version + 4);
  const before = JSON.stringify(graph), notifications = changes.length;
  await assert.rejects(call('canvas.node.set-param', { canvasId, nodeId: input.nodeId, params: { text: 42 } }), /Invalid.*parameters/);
  await assert.rejects(call('canvas.node.add', { canvasId, type: 'invented' }), /Invalid/);
  await assert.rejects(call('canvas.node.add', { canvasId, type: 'text-input', params: [] }), /Invalid/);
  await assert.rejects(call('canvas.get', { canvasId: '../project' }), /Invalid/);
  await assert.rejects(call('canvas.edge.connect', { canvasId, source: input.nodeId, sourcePort: 'text', target: output.nodeId, targetPort: 'video' }), /mismatch/);
  await assert.rejects(call('canvas.node.remove', { canvasId, nodeId: 'missing' }), /not found/i);
  assert.equal(JSON.stringify(await store.readCanvas(canvasId)), before); assert.equal(changes.length, notifications);
  const generate = await call('canvas.node.add', { canvasId, type: 'text-to-image', params: { prompt: 'fallback' } });
  const edge = await call('canvas.edge.connect', { canvasId, source: input.nodeId, sourcePort: 'text', target: generate.nodeId, targetPort: 'text' });
  await assert.rejects(call('canvas.edge.connect', { canvasId, source: input.nodeId, sourcePort: 'text', target: generate.nodeId, targetPort: 'text' }), /already connected/);
  await call('canvas.edge.remove', { canvasId, edgeId: edge.edgeId });
  await call('canvas.edge.connect', { canvasId, source: input.nodeId, sourcePort: 'text', target: generate.nodeId, targetPort: 'text' });
  await call('canvas.node.remove', { canvasId, nodeId: input.nodeId });
  assert.equal((await store.readCanvas(canvasId)).edges.length, 0);
  assert.ok(changes.every(change => change.projectPath === dir && change.canvasId === canvasId));
  const media = await call('canvas.node.add', { canvasId, type: 'image-to-video', params: { prompt: 'test', asset: null } });
  assert.equal(media.node.params.asset, null);
  const observerFailure = new core.CanvasOperations(() => { throw Error('observer failure'); });
  assert.ok((await observerFailure.call('canvas.create', dir, {})).canvasId);
});

test('tool metadata exposes valid JSON Schemas, node parameters, port requirements and result types', async () => {
  const ajv = new Ajv({ strict: false });
  const operations = new core.CanvasOperations();
  const types = await operations.call('canvas.node-types', undefined, {});
  const definition = core.CANVAS_API.find(api => api.name === 'canvas_node_types');
  assert.equal(ajv.compile(definition.outputSchema)(types), true);
  for (const api of core.CANVAS_API) { ajv.compile(api.inputSchema); ajv.compile(api.outputSchema); }
  assert.equal(types.types.length, 11);
  const text = types.types.find(type => type.type === 'text-input');
  assert.equal(text.outputs[0].id, 'text'); assert.equal(text.paramsSchema.properties.text.type, 'string');
  const video = types.types.find(type => type.type === 'image-to-video');
  assert.deepEqual(video.requiredInputPorts, ['image', 'text']); assert.equal(video.exampleParams.durationMs, 5000);
  assert.equal(video.outputs[0].id, 'video');
});

test('canvas names persist across create, list and rename without invalidating render content', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-names-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new core.ProjectStore(dir); await store.init('Names');
  const changes = [], ops = new core.CanvasOperations(change => changes.push(change));
  const call = (method, input = {}) => ops.call(method, dir, input);
  const created = await call('canvas.create', { name: '  广州塔  ' });
  assert.equal(created.canvas.name, '广州塔');
  const graph = core.createCanvas('legacy');
  assert.equal(graph.name, undefined);
  const gen = core.addNode(graph, 'text-to-image', { prompt: 'test' }, 'gen');
  const output = core.addNode(graph, 'output', {}, 'out');
  const asset = { id: 'cached', path: 'cached.png', type: 'image', sizeBytes: 1 };
  for (const node of [gen, output]) { node.cachedResult = asset; node.status = 'succeeded'; }
  await store.writeCanvas(graph);
  const timeline = await store.readTimeline();
  core.addCanvasClip(core.addTrack(timeline, 'video', 'V1'), graph, 0, 5000, asset);
  await store.writeTimeline(timeline);
  const before = structuredClone(graph), key = core.nodeCacheKey(gen, {}, core.defaultProjectSettings());
  const renamed = await call('canvas.rename', { canvasId: graph.id, name: '  悟空飞到鸟巢 🐒  ' });
  const saved = await new core.ProjectStore(dir).readCanvas(graph.id);
  assert.equal(renamed.name, '悟空飞到鸟巢 🐒');
  assert.equal(saved.version, before.version + 1);
  assert.equal(saved.graphHash, before.graphHash);
  assert.equal(core.computeGraphHash(saved), before.graphHash);
  assert.deepEqual(saved.nodes, before.nodes); assert.deepEqual(saved.edges, before.edges);
  assert.equal(core.nodeCacheKey(saved.nodes[0], {}, core.defaultProjectSettings()), key);
  assert.equal((await store.readTimeline()).tracks[0].clips[0].status, 'fresh');
  assert.equal((await call('canvas.list')).canvases.find(c => c.id === graph.id).name, renamed.name);
  assert.equal((await call('canvas.get', { canvasId: graph.id })).name, renamed.name);
  assert.equal((await call('canvas.rename', { canvasId: graph.id, name: `  ${renamed.name} ` })).version, saved.version);
  const notifications = changes.length;
  for (const name of ['', '  ', '\ninvalid', 'x'.repeat(101), 42, null]) {
    await assert.rejects(call('canvas.rename', { canvasId: graph.id, name }));
  }
  assert.deepEqual(await store.readCanvas(graph.id), saved);
  assert.equal(changes.length, notifications);
  await assert.rejects(call('canvas.rename', { canvasId: 'missing', name: 'valid' }), /not found/i);
  await assert.rejects(call('canvas.create', { name: '   ' }));
  await Promise.all([
    call('canvas.rename', { canvasId: graph.id, name: '并发改名' }),
    call('canvas.node.add', { canvasId: graph.id, type: 'text-input', params: { text: 'parallel' } })
  ]);
  const final = await store.readCanvas(graph.id);
  assert.equal(final.name, '并发改名'); assert.equal(final.nodes.length, 3);
  const ajv = new Ajv({ strict: false });
  assert.equal(ajv.compile(core.CANVAS_API.find(api => api.method === 'canvas.get').outputSchema)(final), true);
  assert.equal(ajv.compile(core.CANVAS_API.find(api => api.method === 'canvas.list').outputSchema)(await call('canvas.list')), true);
});
