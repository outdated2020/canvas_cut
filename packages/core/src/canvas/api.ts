import { NODE_DEFINITIONS, getRequiredInputPorts } from './registry';

export const idSchema = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[a-zA-Z0-9_-]+$' };
const str = { type: 'string' }, integer = { type: 'integer', minimum: 1 };
export function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}
const assetSchema = { ...objectSchema({ id: str, path: str, type: { enum: ['image', 'video', 'audio'] }, sizeBytes: { type: 'number', minimum: 0 }, width: integer, height: integer, durationMs: { type: 'number', minimum: 0 } }, ['id', 'path', 'type', 'sizeBytes']), additionalProperties: true };
const generation = {
  prompt: { ...str, description: 'Fallback generation prompt; a connected text-input takes precedence.' }, negativePrompt: str, seed: { type: 'integer' }, width: integer, height: integer,
  fps: { type: 'number', exclusiveMinimum: 0 }, durationMs: integer,
  strength: { type: 'number', minimum: 0, maximum: 1 }, motionStrength: { type: 'number' }, style: str,
  mode: { enum: ['edit', 'extend'] }, sizeMode: str, watermark: { type: 'boolean' },
  background: str, optimizePromptMode: str, layerDecomposition: { type: 'boolean' }
};
export function nodeParamsSchema(type: string) {
  const optionalAsset = { anyOf: [assetSchema, { type: 'null' }], description: 'Existing media AssetRef. null clears the fallback asset; connected input is used first.' };
  const properties = type === 'text-input' ? { text: { ...str, description: 'Text sent to downstream text ports.' } }
    : ['image-input', 'video-input'].includes(type) ? { asset: optionalAsset }
    : type === 'canvas-reference' ? { canvasId: idSchema }
    : type === 'output' ? {} : { ...generation, asset: optionalAsset };
  // Preserve application/provider extension parameters; validate known fields.
  return { type: 'object', properties, additionalProperties: true };
}
export function nodeTypeCatalog() {
  return { types: Object.values(NODE_DEFINITIONS).map(def => ({
    ...def, requiredInputPorts: getRequiredInputPorts(def.type), paramsSchema: nodeParamsSchema(def.type),
    exampleParams: def.type === 'text-input' ? { text: '山间日出，电影感' }
      : def.generationType ? { prompt: '山间日出，电影感', ...(def.generationType.endsWith('video') ? { durationMs: 5000 } : {}) }
      : def.type === 'canvas-reference' ? { canvasId: 'existing-canvas-id' } : {},
    notes: ['image-input', 'video-input', 'image-to-image', 'image-to-video', 'video-to-video'].includes(def.type)
      ? 'Media uses an AssetRef {id,path,type,sizeBytes}; use an existing project asset. Generation inputs can also come from connected ports.'
      : def.type === 'output' ? 'Connect an upstream image or video output. A renderable graph requires exactly one output node.'
      : 'A connected text port takes precedence over params.prompt. Text input content uses params.text.'
  })) };
}
const port = objectSchema({ id: str, type: { enum: ['text', 'image', 'video'] } }, ['id', 'type']);
const node = objectSchema({ id: idSchema, type: { enum: Object.keys(NODE_DEFINITIONS) }, params: { type: 'object', additionalProperties: true }, inputs: { type: 'array', items: port }, outputs: { type: 'array', items: port }, status: str, cachedResult: assetSchema }, ['id', 'type', 'params', 'inputs', 'outputs', 'status']);
const edge = objectSchema({ id: idSchema, source: idSchema, sourcePort: str, target: idSchema, targetPort: str }, ['id', 'source', 'sourcePort', 'target', 'targetPort']);
const graph = objectSchema({ schemaVersion: { const: 1 }, id: idSchema, version: integer, graphHash: str, nodes: { type: 'array', items: node }, edges: { type: 'array', items: edge } }, ['schemaVersion', 'id', 'version', 'graphHash', 'nodes', 'edges']);
const nodeResult = objectSchema({ nodeId: idSchema, version: integer, node }, ['nodeId', 'version', 'node']);
const nullableNumber = { type: ['number', 'null'] };
const nullableId = { anyOf: [idSchema, { type: 'null' }] };
const childJob = {
  type: 'object', properties: { jobId: idSchema, type: str, status: str, progress: nullableNumber, result: {}, error: {}, nodeId: nullableId },
  required: ['jobId', 'type', 'status'], additionalProperties: true
};
export interface CanvasApiDefinition { name: string; method: string; description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>; }
const spec = (name: string, method: string, description: string, properties: Record<string, unknown>, required: string[], outputSchema: Record<string, unknown>): CanvasApiDefinition => ({ name, method, description, inputSchema: objectSchema(properties, required), outputSchema });
export const CANVAS_API: CanvasApiDefinition[] = [
  spec('canvas_list', 'canvas.list', 'List canvases in the project.', {}, [], objectSchema({ canvases: { type: 'array', items: objectSchema({ id: idSchema, canvasId: idSchema, version: integer, graphHash: str, nodeCount: { type: 'integer' } }, ['id', 'canvasId', 'version', 'graphHash', 'nodeCount']) } }, ['canvases'])),
  spec('canvas_get', 'canvas.get', 'Read the complete canvas graph, including node parameters, ports, cached results and version.', { canvasId: idSchema }, ['canvasId'], graph),
  spec('canvas_node_types', 'canvas.node-types', 'Discover supported node types, port IDs/types, per-type paramsSchema, exampleParams and input requirements. Use before adding nodes or connecting ports.', {}, [], objectSchema({ types: { type: 'array', items: { type: 'object', properties: { type: str, label: str, inputs: { type: 'array', items: port }, outputs: { type: 'array', items: port }, requiredInputPorts: { type: 'array', items: str }, paramsSchema: { type: 'object' }, exampleParams: { type: 'object' }, notes: str, generationType: str } } } }, ['types'])),
  spec('canvas_create', 'canvas.create', 'Create an empty canvas. Build nodes/edges before rendering. Returns canvasId, version and canvas.', {}, [], objectSchema({ canvasId: idSchema, version: integer, canvas: graph }, ['canvasId', 'version', 'canvas'])),
  spec('canvas_node_add', 'canvas.node.add', 'Add a node. Discover node types/params with canvas_node_types. Incomplete graphs can be saved.', { canvasId: idSchema, type: { enum: Object.keys(NODE_DEFINITIONS) }, params: { type: 'object', additionalProperties: true } }, ['canvasId', 'type'], nodeResult),
  spec('canvas_node_set_params', 'canvas.node.set-param', 'Merge params into an existing node. Use text for text-input, prompt for generation nodes. Resets node/output cache and increments canvas version; does not automatically render.', { canvasId: idSchema, nodeId: idSchema, params: { type: 'object', additionalProperties: true } }, ['canvasId', 'nodeId', 'params'], nodeResult),
  spec('canvas_node_remove', 'canvas.node.remove', 'Remove a node and its incident edges.', { canvasId: idSchema, nodeId: idSchema }, ['canvasId', 'nodeId'], objectSchema({ removed: idSchema, version: integer }, ['removed', 'version'])),
  spec('canvas_edge_connect', 'canvas.edge.connect', 'Connect named source/target ports with matching types. Existing occupied inputs are rejected.', { canvasId: idSchema, source: idSchema, sourcePort: idSchema, target: idSchema, targetPort: idSchema }, ['canvasId', 'source', 'sourcePort', 'target', 'targetPort'], objectSchema({ edgeId: idSchema, version: integer, edge }, ['edgeId', 'version', 'edge'])),
  spec('canvas_edge_remove', 'canvas.edge.remove', 'Remove an edge by edgeId.', { canvasId: idSchema, edgeId: idSchema }, ['canvasId', 'edgeId'], objectSchema({ removed: idSchema, version: integer }, ['removed', 'version'])),
  spec('canvas_render', 'canvas.render', 'Submit canvas generation and immediately return jobId. Graph must be valid. May invoke paid providers. Use a stable idempotencyKey for uncertain retries and query job_status in later execute calls; never wait in a loop inside execute.', { canvasId: idSchema, nodeId: idSchema, force: { type: 'boolean' }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 256 } }, ['canvasId'], objectSchema({ jobId: idSchema, type: str, childJobIds: { type: 'array', items: idSchema } }, ['jobId', 'type'])),
  spec('job_status', 'job.status', 'Read job status/progress/result/error; follow up in separate execute calls until succeeded, failed or cancelled.', { jobId: idSchema }, ['jobId'], { type: 'object', properties: { jobId: idSchema, type: str, status: str, progress: nullableNumber, result: {}, error: {}, children: { type: 'array', items: childJob }, canvasId: nullableId, nodeId: nullableId, createdAt: { type: 'number' }, updatedAt: { type: 'number' } }, required: ['jobId', 'type', 'status'], additionalProperties: true }),
  spec('job_cancel', 'job.cancel', 'Cancel a submitted generation job. Cancelling execute itself does not cancel this job.', { jobId: idSchema }, ['jobId'], objectSchema({ cancelled: { type: 'boolean' } }, ['cancelled']))
];
