import { randomUUID } from 'node:crypto';
import {
  addNode,
  buildCanvasRenderPlan,
  connectEdge,
  createCanvas,
  disconnectEdge,
  isNodeType,
  removeNode,
  setNodeParams,
  CanvasCutError,
  CanvasOperations,
  ERROR_CODES
} from '@canvas-cut/core';
import { createStore, withLockedStore } from '../context';
import type { CliOptions } from '../args';
import { jsonFlag, stringFlag } from '../args';
import { LocalIpcClient } from '../ipc/client';

export async function canvasCreate(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const id = randomUUID();
    const name = stringFlag(options.flags, 'name');
    const canvas = createCanvas(id, name);
    await store.writeCanvas(canvas);
    return { canvasId: id, version: canvas.version, name: canvas.name };
  });
}

export async function canvasGet(options: CliOptions): Promise<unknown> {
  const canvasId = options.positionals[0];
  if (!canvasId) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'canvas get requires a canvas id');
  }
  const store = createStore(options);
  await store.requireOpen();
  return store.readCanvas(canvasId);
}

export async function canvasRename(options: CliOptions): Promise<unknown> {
  const canvasId = options.positionals[0], name = stringFlag(options.flags, 'name');
  if (!canvasId || name === undefined) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'canvas rename requires a canvas id and --name');
  const store = createStore(options);
  const input = { canvasId, name };
  const client = new LocalIpcClient(store.paths.root);
  let online = false;
  try {
    await client.request('ping');
    online = true;
  } catch (error) {
    if (!(error instanceof CanvasCutError) || error.code !== ERROR_CODES.DAEMON_UNAVAILABLE) throw error;
  }
  // Probe read-only first: never replay an uncertain mutation after an IPC failure.
  return online ? client.request('canvas.rename', input) : new CanvasOperations().call('canvas.rename', store.paths.root, input);
}

export async function canvasRemove(options: CliOptions): Promise<unknown> {
  const canvasId = options.positionals[0];
  if (!canvasId) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'canvas remove requires a canvas id');
  }
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    await store.removeCanvas(canvasId);
    return { removed: canvasId };
  });
}

export async function canvasNodeAdd(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const canvasId = stringFlag(options.flags, 'canvas');
    const type = stringFlag(options.flags, 'type');
    if (!canvasId || !type || !isNodeType(type)) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'canvas node add requires --canvas and a valid --type');
    }
    const params = jsonFlag(options.flags, 'params') ?? {};
    const graph = await store.readCanvas(canvasId);
    const node = addNode(graph, type, params);
    await store.writeCanvas(graph);
    return { nodeId: node.id };
  });
}

export async function canvasNodeRemove(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const canvasId = stringFlag(options.flags, 'canvas');
    const nodeId = stringFlag(options.flags, 'node');
    if (!canvasId || !nodeId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'canvas node remove requires --canvas and --node');
    }
    const graph = await store.readCanvas(canvasId);
    removeNode(graph, nodeId);
    await store.writeCanvas(graph);
    return { removed: nodeId };
  });
}

export async function canvasNodeSetParam(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const canvasId = stringFlag(options.flags, 'canvas');
    const nodeId = stringFlag(options.flags, 'node');
    const params = jsonFlag(options.flags, 'params');
    if (!canvasId || !nodeId || !params) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'canvas node set-param requires --canvas, --node and --params'
      );
    }
    const graph = await store.readCanvas(canvasId);
    const node = setNodeParams(graph, nodeId, params);
    await store.writeCanvas(graph);
    return { nodeId: node.id, version: graph.version };
  });
}

export async function canvasEdgeConnect(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const canvasId = stringFlag(options.flags, 'canvas');
    const from = stringFlag(options.flags, 'from');
    const to = stringFlag(options.flags, 'to');
    if (!canvasId || !from || !to || !from.includes(':') || !to.includes(':')) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'canvas edge connect requires --canvas, --from node:port and --to node:port'
      );
    }
    const [source, sourcePort] = from.split(':');
    const [target, targetPort] = to.split(':');
    const graph = await store.readCanvas(canvasId);
    const edge = connectEdge(graph, source as string, sourcePort as string, target as string, targetPort as string);
    await store.writeCanvas(graph);
    return { edgeId: edge.id };
  });
}

export async function canvasEdgeRemove(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const canvasId = stringFlag(options.flags, 'canvas');
    const edgeId = stringFlag(options.flags, 'edge');
    if (!canvasId || !edgeId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'canvas edge remove requires --canvas and --edge');
    }
    const graph = await store.readCanvas(canvasId);
    disconnectEdge(graph, edgeId);
    await store.writeCanvas(graph);
    return { removed: edgeId };
  });
}

export async function canvasStatus(options: CliOptions): Promise<unknown> {
  const canvasId = options.positionals[0];
  if (!canvasId) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'canvas status requires a canvas id');
  }
  const store = createStore(options);
  await store.requireOpen();
  const graph = await store.readCanvas(canvasId);
  return {
    canvasId: graph.id,
    version: graph.version,
    graphHash: graph.graphHash,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      status: node.status,
      hasCachedResult: Boolean(node.cachedResult)
    }))
  };
}

export async function canvasRender(options: CliOptions): Promise<unknown> {
  const canvasId = options.positionals[0] ?? stringFlag(options.flags, 'canvas');
  if (!canvasId) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'canvas render requires a canvas id');
  }
  const store = createStore(options);
  await store.requireOpen();
  const graph = await store.readCanvas(canvasId);
  const force = options.flags.force === true || options.flags.force === 'true';
  const nodeId = stringFlag(options.flags, 'node');

  if (options.dryRun) {
    const project = await store.readProject();
    const config = await store.readConfig();
    return buildCanvasRenderPlan(graph, project.settings, { force, nodeId,
      modelDefaults: { imageModel: config.provider.volcengine.imageModel, videoModel: config.provider.volcengine.videoModel } });
  }

  const client = new LocalIpcClient(store.paths.root, stringFlag(options.flags, 'idempotency-key'));
  return client.request('job.submit', {
    type: 'canvas.render',
    canvasId,
    force,
    nodeId
  });
}
