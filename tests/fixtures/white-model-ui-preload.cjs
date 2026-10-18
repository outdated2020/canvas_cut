// Isolated UI smoke-test bridge: every operation uses this in-memory graph.
const { contextBridge } = require('electron');
const core = require('../../packages/core/dist/index.js');
const graph = core.createCanvas('white-ui');
core.addNode(graph, 'output', {}, 'output');
contextBridge.exposeInMainWorld('api', {
  onCanvasChanged: () => () => {},
  invoke: async (channel, payload = {}) => {
    if (channel === 'project.open') return { id: 'test', path: payload.path, name: 'White Model UI Test', settings: { width: 1280, height: 720, fps: 30 }, timeline: { schemaVersion: 1, tracks: [] } };
    if (channel === 'config.get') return { provider: { volcengine: {} } };
    if (channel === 'canvas.list') return [{ id: graph.id, nodeCount: graph.nodes.length }];
    if (channel === 'canvas.get') return graph;
    if (channel === 'canvas.node.add') return core.addNode(graph, payload.type, payload.params, 'local');
    if (channel === 'canvas.node.set-param') return core.setNodeParams(graph, payload.nodeId, payload.params);
    if (['asset.list', 'preset.list', 'job.list', 'agent.conversations.list'].includes(channel)) return [];
    if (channel === 'agent.history' || channel === 'agent.get-run') return { messages: [], events: [], run: null };
    if (channel === 'timeline.get') return { schemaVersion: 1, tracks: [] };
    return {};
  }
});
contextBridge.exposeInMainWorld('whiteModelUiTest', { snapshot: () => graph });
