import { NODE_DEFINITIONS, getRequiredInputPorts } from './registry';

export const idSchema = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[a-zA-Z0-9_-]+$' };
const str = { type: 'string' }, integer = { type: 'integer', minimum: 1 };
export function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}
const assetSchema = { ...objectSchema({ id: str, path: str, type: { enum: ['image', 'video', 'audio'] }, sizeBytes: { type: 'number', minimum: 0 }, width: integer, height: integer, durationMs: { type: 'number', minimum: 0 } }, ['id', 'path', 'type', 'sizeBytes']), additionalProperties: true };
const generation = {
  prompt: { ...str, description: 'Fallback generation prompt. Non-empty connected text-input content takes precedence, so edit that input node instead when connected.' }, negativePrompt: str, seed: { type: 'integer' },
  width: { ...integer, description: 'Requested pixel width. For video, width/height select the provider aspect ratio and resolution tier; exact output dimensions are provider-dependent. For images, sizeMode or configured imageResolution can override explicit dimensions.' },
  height: { ...integer, description: 'Requested pixel height. Example: width=1920,height=1080 requests 16:9 video. Verify actual media dimensions; the provider may map these to a supported resolution tier.' },
  fps: { type: 'number', exclusiveMinimum: 0, description: 'Requested frame rate; provider support varies. Verify the generated file rather than assuming this value was honored.' },
  durationMs: { ...integer, description: 'Requested video duration in milliseconds, not seconds (4000 = 4 seconds). The current adapter rounds to whole seconds; allowed durations depend on the configured model and generation mode. A positive integer passing this schema may still be rejected: Seedance 2.5 reference-image video rejected 3000 in an observed run and accepted 4000. Do not treat that observation as a capability guarantee. No automatic trimming is performed; exact final duration may require external post-processing.' },
  strength: { type: 'number', minimum: 0, maximum: 1 }, motionStrength: { type: 'number' }, style: str,
  mode: { enum: ['edit', 'extend'] },
  sizeMode: { ...str, description: 'Provider image resolution tier, such as 2K. This or the configured imageResolution takes precedence over width/height; include the desired composition/aspect ratio in the prompt and inspect the returned image.' }, watermark: { type: 'boolean' },
  background: str, optimizePromptMode: str, layerDecomposition: { type: 'boolean' }
};
export function nodeParamsSchema(type: string) {
  const optionalAsset = { anyOf: [assetSchema, { type: 'null' }], description: 'Existing media AssetRef. null clears the fallback asset; connected input is used first.' };
  const properties = type === 'text-input' ? { text: { ...str, description: 'Text sent to downstream text ports; use this field, not prompt. Unicode is supported when the client sends UTF-8 JSON-RPC. Read back with canvas_get to confirm Chinese has not been replaced by question marks before rendering.' } }
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
      ? 'Media uses an AssetRef {id,path,type,sizeBytes}; use an existing project asset or connect a matching upstream media port. Non-empty connected text takes precedence over params.prompt. Image-to-video can consume a text-to-image result automatically in the same render; generation follows dependencies and does not pause for approval between nodes. Provider/model duration and size limits are not represented by this catalog.'
      : def.type === 'output' ? 'Connect an upstream image or video output. A renderable graph requires exactly one output node.'
      : 'Non-empty connected text takes precedence over params.prompt. Text input content uses params.text. Generation schemas describe parameter shapes, not provider/model capability limits; inspect the actual returned media.'
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
  spec('canvas_list', 'canvas.list', 'List canvases in the selected project, which defaults to MCP --project rather than the desktop current project. Returns structuredContent.canvases; use its length for the count.', {}, [], objectSchema({ canvases: { type: 'array', items: objectSchema({ id: idSchema, canvasId: idSchema, version: integer, graphHash: str, nodeCount: { type: 'integer' } }, ['id', 'canvasId', 'version', 'graphHash', 'nodeCount']) } }, ['canvases'])),
  spec('canvas_get', 'canvas.get', 'Read the complete canvas graph, including node parameters, ports, cached results and version. Read back Unicode prompts before paid generation to detect client encoding loss. cachedResult contains an AssetRef, not image/video pixels; inspect its local file using host media tools. Partial generation results may be available in job_status.children before they are written to this graph.', { canvasId: idSchema }, ['canvasId'], graph),
  spec('canvas_node_types', 'canvas.node-types', 'Discover supported node types, exact port IDs/types, per-type paramsSchema, exampleParams and input requirements. Use before adding nodes or connecting ports. This is a structural catalog, not provider/model capability discovery; duration, resolution and supported parameter behavior depend on the configured provider.', {}, [], objectSchema({ types: { type: 'array', items: { type: 'object', properties: { type: str, label: str, inputs: { type: 'array', items: port }, outputs: { type: 'array', items: port }, requiredInputPorts: { type: 'array', items: str }, paramsSchema: { type: 'object' }, exampleParams: { type: 'object' }, notes: str, generationType: str } } } }, ['types'])),
  spec('canvas_create', 'canvas.create', 'Create an empty canvas in an initialized project and return canvasId, version and canvas. Does not initialize a project or switch the desktop to the new canvas. Build nodes/edges and exactly one connected output before rendering.', {}, [], objectSchema({ canvasId: idSchema, version: integer, canvas: graph }, ['canvasId', 'version', 'canvas'])),
  spec('canvas_node_add', 'canvas.node.add', 'Add a node. Discover node types/params with canvas_node_types. Incomplete graphs can be saved.', { canvasId: idSchema, type: { enum: Object.keys(NODE_DEFINITIONS) }, params: { type: 'object', additionalProperties: true } }, ['canvasId', 'type'], nodeResult),
  spec('canvas_node_set_params', 'canvas.node.set-param', 'Merge params into an existing node, retaining omitted fields. Use params.text for text-input; a non-empty connected text input takes precedence over a generation node params.prompt. Resets node/output cache and increments canvas version; does not generate. Read back edited prompts before rendering and use a new idempotencyKey for the new generation.', { canvasId: idSchema, nodeId: idSchema, params: { type: 'object', additionalProperties: true } }, ['canvasId', 'nodeId', 'params'], nodeResult),
  spec('canvas_node_remove', 'canvas.node.remove', 'Remove a node and its incident edges.', { canvasId: idSchema, nodeId: idSchema }, ['canvasId', 'nodeId'], objectSchema({ removed: idSchema, version: integer }, ['removed', 'version'])),
  spec('canvas_edge_connect', 'canvas.edge.connect', 'Connect named source/target ports with matching types. Existing occupied inputs are rejected.', { canvasId: idSchema, source: idSchema, sourcePort: idSchema, target: idSchema, targetPort: idSchema }, ['canvasId', 'source', 'sourcePort', 'target', 'targetPort'], objectSchema({ edgeId: idSchema, version: integer, edge }, ['edgeId', 'version', 'edge'])),
  spec('canvas_edge_remove', 'canvas.edge.remove', 'Remove an edge by edgeId.', { canvasId: idSchema, edgeId: idSchema }, ['canvasId', 'edgeId'], objectSchema({ removed: idSchema, version: integer }, ['removed', 'version'])),
  spec('canvas_render', 'canvas.render', 'Submit the WHOLE valid canvas graph and immediately return jobId, not finished media. Requires exactly one connected output and all required inputs. Executes generation nodes in dependency order, including image then video when connected; it does not pause between stages. nodeId forces that node and its downstream nodes to regenerate, NOT a single-node render or stopping point; force=true regenerates all generation nodes. To review a reference first, render an image-only graph and inspect it before adding the video stage. May invoke paid providers. Verify Unicode prompts before submission. Reuse an idempotencyKey only for an uncertain retry of the same submission; use a new key for a new generation, even after editing prompts. Poll job_status in later execute calls, never a long loop here. Provider limits may reject schema-valid duration/size values; no automatic trim/export is performed.', {
    canvasId: idSchema,
    nodeId: { ...idSchema, description: 'Optional cache-bypass root: force this node and all downstream generation nodes to rerun. The entire graph still executes and returns its output; this is not a single-node target or an image-only stopping point. Omit for normal cache reuse.' },
    force: { type: 'boolean', description: 'Default false. true bypasses cache for every generation node in the whole graph, potentially repeating image/video provider charges.' },
    idempotencyKey: { type: 'string', minLength: 1, maxLength: 256, description: 'Stable key for retries of one submission. Reusing it returns that existing job, including failed/succeeded jobs; editing graph parameters alone does not make it a new submission. Use a new key for a new intentional generation; do not reuse it with different render arguments.' }
  }, ['canvasId'], objectSchema({ jobId: idSchema, type: str, childJobIds: { type: 'array', items: idSchema } }, ['jobId', 'type'])),
  spec('job_status', 'job.status', 'Read status/progress/result/error and child node results. Poll in separate execute calls until succeeded, failed or cancelled. pending/running or a child success is not parent completion. On failure inspect error and children: a completed reference image can remain available even if video failed. result/children[].result are AssetRefs with local paths, not pixels; inspect actual media content and probe duration/dimensions before claiming the requested result. Do not retry unchanged provider-invalid parameters.', { jobId: idSchema }, ['jobId'], { type: 'object', properties: { jobId: idSchema, type: str, status: str, progress: nullableNumber, result: {}, error: {}, children: { type: 'array', items: childJob }, canvasId: nullableId, nodeId: nullableId, createdAt: { type: 'number' }, updatedAt: { type: 'number' } }, required: ['jobId', 'type', 'status'], additionalProperties: true }),
  spec('job_cancel', 'job.cancel', 'Cancel a submitted generation job. Cancelling execute itself does not cancel this job.', { jobId: idSchema }, ['jobId'], objectSchema({ cancelled: { type: 'boolean' } }, ['cancelled']))
];
