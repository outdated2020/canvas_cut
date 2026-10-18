import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import { CANVAS_API, nodeParamsSchema, nodeTypeCatalog } from './api';
import { addNode, connectEdge, createCanvas, disconnectEdge, findNode, removeNode, renameCanvas, setNodeParams } from './graph';
import type { NodeType } from '../types';
import { NODE_DEFINITIONS } from './registry';
import { buildWhiteModelRequest } from './white-model';
import { ProjectStore } from '../project/project-store';
import { withProjectLock } from '../fs/lock';
import { CanvasCutError, ERROR_CODES } from '../errors';

export interface CanvasChange { projectPath: string; canvasId: string; }
export type CanvasChanged = (change: CanvasChange) => void;
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map(CANVAS_API.map(api => [api.method, ajv.compile(api.inputSchema)]));
const paramsValidators = new Map(Object.keys(NODE_DEFINITIONS).map(type => [type, ajv.compile(nodeParamsSchema(type))]));
export const isCanvasOperation = (method: string) => CANVAS_API.some(api => api.method === method && !['canvas.render', 'job.status', 'job.cancel'].includes(method));
export function validateCanvasInput(method: string, input: unknown) {
  const validate = validators.get(method);
  if (!validate || !validate(input)) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Invalid ${method}: ${validate ? ajv.errorsText(validate.errors) : 'unknown operation'}`);
}
export function notifyCanvasChanged(callback: CanvasChanged | undefined, change: CanvasChange) {
  // Observers must not turn an already committed mutation into a reported failure.
  try { callback?.(change); } catch { /* UI notification is best effort. */ }
}
export class CanvasOperations {
  constructor(private changed?: CanvasChanged) {}
  async call(method: string, projectPath: string | undefined, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    validateCanvasInput(method, input);
    if (method === 'canvas.node-types') return nodeTypeCatalog();
    if (!isCanvasOperation(method)) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Not a canvas editing operation');
    if (!projectPath?.trim()) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'projectPath is required');
    const store = new ProjectStore(projectPath);
    await store.requireOpen();
    if (method === 'canvas.get') return await store.readCanvas(String(input.canvasId)) as unknown as Record<string, unknown>;
    if (method === 'canvas.list') {
      const canvases = await Promise.all((await store.listCanvasFiles()).map(async file => {
        const canvas = await store.readCanvas(file.slice(0, -5));
        return { id: canvas.id, canvasId: canvas.id, ...(canvas.name === undefined ? {} : { name: canvas.name }), version: canvas.version, graphHash: canvas.graphHash, nodeCount: canvas.nodes.length };
      }));
      return { canvases };
    }
    const result = await withProjectLock(store.paths.root, async () => {
      const graph = method === 'canvas.create' ? createCanvas(randomUUID(), input.name as string | undefined) : await store.readCanvas(String(input.canvasId));
      let result: Record<string, unknown>;
      switch (method) {
        case 'canvas.create': result = { canvasId: graph.id, canvas: graph }; break;
        case 'canvas.rename': {
          renameCanvas(graph, input.name);
          result = { canvasId: graph.id, name: graph.name }; break;
        }
        case 'canvas.node.add': {
          const type = input.type as NodeType, params = input.params as Record<string, unknown> ?? {};
          this.validateParams(type, params);
          const node = addNode(graph, type, params); result = { nodeId: node.id, node }; break;
        }
        case 'canvas.node.set-param': {
          const existing = findNode(graph, String(input.nodeId));
          this.validateParams(existing.type, { ...existing.params, ...input.params as Record<string, unknown> });
          const node = setNodeParams(graph, existing.id, input.params as Record<string, unknown>);
          result = { nodeId: node.id, node }; break;
        }
        case 'canvas.node.remove': removeNode(graph, String(input.nodeId)); result = { removed: input.nodeId }; break;
        case 'canvas.edge.connect': {
          const edge = connectEdge(graph, String(input.source), String(input.sourcePort), String(input.target), String(input.targetPort));
          result = { edgeId: edge.id, edge }; break;
        }
        case 'canvas.edge.remove': disconnectEdge(graph, String(input.edgeId)); result = { removed: input.edgeId }; break;
        default: throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Unknown canvas operation');
      }
      await store.writeCanvas(graph);
      return { ...result, version: graph.version, changedCanvasId: graph.id };
    });
    const { changedCanvasId, ...data } = result;
    notifyCanvasChanged(this.changed, { projectPath: store.paths.root, canvasId: changedCanvasId as string });
    return data;
  }
  private validateParams(type: string, params: unknown) {
    const validate = paramsValidators.get(type);
    if (!validate || !validate(params)) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Invalid ${type} parameters: ${validate ? ajv.errorsText(validate.errors) : 'unknown node type'}`);
    if (type === 'white-model-video') buildWhiteModelRequest(params as Record<string, unknown>);
  }
}
