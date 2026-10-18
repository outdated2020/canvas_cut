const { contextBridge } = require('electron');
const core = require('../../packages/core/dist/index.js');
const graph = core.createCanvas('layout-test');
core.addNode(graph, 'text-input', { text: 'Reference A' }, 'a');
core.addNode(graph, 'text-input', { text: 'Reference B' }, 'b');
core.addNode(graph, 'text-to-image', { prompt: 'Landscape' }, 'c');
core.addNode(graph, 'output', {}, 'out');
core.connectEdge(graph, 'a', 'text', 'c', 'text');
core.connectEdge(graph, 'c', 'image', 'out', 'image');
graph.edges[0].id = 'a-to-c'; graph.edges[1].id = 'c-to-out'; core.refreshGraphHash(graph);
const listeners = new Set();
contextBridge.exposeInMainWorld('api', {
  onCanvasChanged: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  invoke: async (channel, payload = {}) => {
    if (channel === 'project.open') return { id: 'test', path: payload.path, name: 'Layout Test', settings: { width: 1280, height: 720, fps: 30 }, timeline: { schemaVersion: 1, tracks: [] } };
    if (channel === 'config.get') return { provider: { volcengine: {} } };
    if (channel === 'canvas.list') return [{ id: graph.id, nodeCount: graph.nodes.length }];
    if (channel === 'canvas.get') return graph;
    if (channel === 'canvas.node.remove') { core.removeNode(graph, payload.nodeId); for (const listener of listeners) listener({ projectPath: payload.path, canvasId: graph.id }); return {}; }
    if (['asset.list', 'preset.list', 'job.list', 'agent.conversations.list'].includes(channel)) return [];
    if (channel === 'agent.history' || channel === 'agent.get-run') return { messages: [], events: [], run: null };
    if (channel === 'timeline.get') return { schemaVersion: 1, tracks: [] };
    return {};
  }
});
contextBridge.exposeInMainWorld('layoutTest', {
  snapshot: () => graph,
  refresh: path => { for (const listener of listeners) listener({ projectPath: path, canvasId: graph.id }); }
});
