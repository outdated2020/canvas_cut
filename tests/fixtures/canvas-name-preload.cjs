const { contextBridge } = require('electron');
const core = require('../../packages/core/dist/index.js');
const fs = require('node:fs/promises');
if (!process.env.CANVAS_NAME_TEST_ROOT) throw Error('CANVAS_NAME_TEST_ROOT is required');
const store = new core.ProjectStore(process.env.CANVAS_NAME_TEST_ROOT);
let failNext = false, presentedPath = '';
const listeners = new Set();
const ops = new core.CanvasOperations(change => {
  for (const listener of listeners) listener({ ...change, projectPath: presentedPath });
});
const ready = (async () => {
  try { await fs.access(store.paths.projectJson); }
  catch {
    await store.init('Canvas Name UI Test');
    await store.writeCanvas(core.createCanvas('legacy'));
    await store.writeCanvas(core.createCanvas('named', '已有名称'));
  }
})();
contextBridge.exposeInMainWorld('api', {
  onCanvasChanged: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  invoke: async (channel, payload = {}) => {
    await ready;
    presentedPath = payload.path ?? presentedPath;
    if (channel === 'project.open') return { id: 'name-test', path: payload.path, name: 'Canvas Name UI Test', settings: core.defaultProjectSettings(), timeline: { schemaVersion: 1, tracks: [] } };
    if (channel === 'config.get') return core.createDefaultConfigFile();
    if (core.isCanvasOperation(channel)) {
      if (channel === 'canvas.rename' && failNext) { failNext = false; throw Error('测试保存失败，请重试'); }
      const { path, ...input } = payload;
      const data = await ops.call(channel, store.paths.root, input);
      return channel === 'canvas.list' ? data.canvases : channel === 'canvas.create' ? data.canvas : data;
    }
    if (['asset.list', 'preset.list', 'job.list', 'agent.conversations.list'].includes(channel)) return [];
    if (channel === 'agent.history' || channel === 'agent.get-run') return { messages: [], events: [], run: null };
    if (channel === 'timeline.get') return { schemaVersion: 1, tracks: [] };
    throw Error(`Unexpected test channel ${channel}`);
  }
});
contextBridge.exposeInMainWorld('canvasNameTest', {
  failNext: () => { failNext = true; },
  read: async id => { await ready; return store.readCanvas(id); },
  renameExternally: async (id, name) => { await ready; return ops.call('canvas.rename', store.paths.root, { canvasId: id, name }); }
});
