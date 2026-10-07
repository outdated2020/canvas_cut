import test from 'node:test';
import assert from 'node:assert/strict';
import sync from '../apps/desktop/dist/renderer/canvas-sync.js';
const { createCanvasRefreshCoordinator, reconcileCanvasNodes, projectKey } = sync;
const sleep = () => new Promise(resolve => setTimeout(resolve, 25));

test('canvas refresh filters projects, debounces bursts and does not switch to newly created canvases', async () => {
  const sidebar = [], canvas = [], errors = [];
  const target = { projectPath: 'C:\\Project', canvasId: 'open', epoch: 1 };
  const updates = createCanvasRefreshCoordinator({ target: () => target, loadSidebar: async path => path, loadCanvas: async (_path, id) => id, applySidebar: data => sidebar.push(data), applyCanvas: data => canvas.push(data), onError: error => errors.push(error), debounceMs: 5 });
  updates.receive({ projectPath: 'C:/other', canvasId: 'open' }); await sleep(); assert.equal(sidebar.length, 0);
  for (let i = 0; i < 5; i++) updates.receive({ projectPath: 'c:/project/', canvasId: 'open' });
  await sleep(); assert.equal(sidebar.length, 1); assert.deepEqual(canvas, ['open']);
  updates.receive({ projectPath: 'C:/Project', canvasId: 'new' }); await sleep();
  assert.equal(sidebar.length, 2); assert.deepEqual(canvas, ['open']); assert.equal(errors.length, 0);
  updates.receive({ projectPath: 'C:/Project', canvasId: 'open' }); updates.dispose(); await sleep(); assert.equal(sidebar.length, 2);
  assert.notEqual(projectKey('/Project'), projectKey('/project'));
});

test('refresh results cannot overwrite a switched project/canvas, even when switching back', async () => {
  let target = { projectPath: '/project', canvasId: 'a', epoch: 1 }, release;
  const applied = [];
  const updates = createCanvasRefreshCoordinator({ target: () => target,
    loadSidebar: async () => new Promise(resolve => { release = resolve; }), loadCanvas: async () => 'old-a',
    applySidebar: data => applied.push(data), applyCanvas: data => applied.push(data), onError: error => { throw error; }, debounceMs: 1 });
  updates.receive({ projectPath: '/project', canvasId: 'a' }); await sleep();
  target = { projectPath: '/other', canvasId: 'b', epoch: 2 };
  target = { projectPath: '/project', canvasId: 'a', epoch: 3 };
  release('stale-sidebar'); await sleep(); assert.deepEqual(applied, []); updates.dispose();
});

test('canvas refresh keeps positions and selection for surviving nodes and drops removed selections', () => {
  const previous = [{ id: 'keep', position: { x: 50, y: 70 }, selected: true, data: { text: 'old' } }, { id: 'removed', selected: true }];
  const next = [{ id: 'keep', position: { x: 0, y: 0 }, data: { text: 'new' } }, { id: 'added', position: { x: 10, y: 10 } }];
  const merged = reconcileCanvasNodes(previous, next);
  assert.deepEqual(merged[0].position, { x: 50, y: 70 }); assert.equal(merged[0].selected, true);
  assert.equal(merged[0].data.text, 'new'); assert.equal(merged.some(node => node.id === 'removed'), false);
  assert.deepEqual(merged[1], next[1]);
});

test('a newer refresh for the same canvas supersedes a slower earlier response', async () => {
  const releases = [], applied = [];
  const target = { projectPath: '/project', canvasId: 'a', epoch: 1 };
  const updates = createCanvasRefreshCoordinator({ target: () => target,
    loadSidebar: async () => new Promise(resolve => releases.push(resolve)), loadCanvas: async () => 'canvas',
    applySidebar: data => applied.push(data), applyCanvas: () => {}, onError: error => { throw error; }, debounceMs: 1 });
  updates.receive({ projectPath: '/project', canvasId: 'a' }); await sleep();
  updates.receive({ projectPath: '/project', canvasId: 'a' }); await sleep();
  releases[1]('new'); await sleep(); releases[0]('old'); await sleep();
  assert.deepEqual(applied, ['new']); updates.dispose();
});
