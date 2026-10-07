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
  assert.equal(types.types.length, 10);
  const text = types.types.find(type => type.type === 'text-input');
  assert.equal(text.outputs[0].id, 'text'); assert.equal(text.paramsSchema.properties.text.type, 'string');
  const video = types.types.find(type => type.type === 'image-to-video');
  assert.deepEqual(video.requiredInputPorts, ['image', 'text']); assert.equal(video.exampleParams.durationMs, 5000);
  assert.equal(video.outputs[0].id, 'video');
});
