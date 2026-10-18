// Test-only bridge: no filesystem writes or provider requests.
const { contextBridge } = require('electron');
const core = require('../../packages/core/dist/index.js');
const graph = core.createCanvas('context-menu-test');
const other = core.createCanvas('other-canvas');
core.addNode(graph, 'output', {}, 'output');
let sequence = 0, failNext = false;
const listeners = new Set();
contextBridge.exposeInMainWorld('api', {
  onCanvasChanged: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  invoke: async (channel, payload = {}) => {
    if (channel === 'project.open') return { id: 'test', path: payload.path, name: 'Context Menu Test', settings: { width: 1280, height: 720, fps: 30 }, timeline: { schemaVersion: 1, tracks: [] } };
    if (channel === 'config.get') return { provider: { volcengine: {} } };
    if (channel === 'canvas.list') return [graph, other].map(g => ({ id: g.id, nodeCount: g.nodes.length }));
    if (channel === 'canvas.get') return payload.canvasId === other.id ? other : graph;
    if (channel === 'canvas.node.add') {
      if (failNext) { failNext = false; throw Error('Test creation failed'); }
      const target = payload.canvasId === other.id ? other : graph;
      const node = core.addNode(target, payload.type, payload.params, `added-${++sequence}`);
      for (const listener of listeners) listener({ projectPath: payload.path, canvasId: target.id });
      // Simulate a notification refresh overtaking the create response.
      await new Promise(resolve => setTimeout(resolve, 250));
      return node;
    }
    if (channel === 'canvas.node.set-param') return core.setNodeParams(graph, payload.nodeId, payload.params);
    if (['asset.list', 'preset.list', 'job.list', 'agent.conversations.list'].includes(channel)) return [];
    if (channel === 'agent.history' || channel === 'agent.get-run') return { messages: [], events: [], run: null };
    if (channel === 'timeline.get') return { schemaVersion: 1, tracks: [] };
    return {};
  }
});
contextBridge.exposeInMainWorld('contextMenuTest', { snapshot: () => graph, failNext: () => { failNext = true; } });
