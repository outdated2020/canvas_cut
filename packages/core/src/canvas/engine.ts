import {
  AssetRef,
  CanvasGraph,
  CanvasNode,
  CanvasRenderPlan,
  GenerationType,
  ImageToImageRequest,
  ImageToVideoRequest,
  NodeRenderStep,
  ProjectSettings,
  TextToImageRequest,
  TextToVideoRequest,
  VideoToVideoRequest,
  VolcengineConfig
} from '../types';
import { canonicalJson, sha256 } from '../hash';
import { CanvasCutError, ERROR_CODES } from '../errors';
import { findNode, incomingEdges, topologicalSort, validateGraph } from './graph';
import { buildWhiteModelRequest, type WhiteModelRequest } from './white-model';

export type ResolvedValue = string | AssetRef;

export type ResolvedInputs = Record<string, ResolvedValue | undefined>;

export interface CacheLookup {
  get(cacheKey: string): Promise<AssetRef | undefined>;
  put?(cacheKey: string, asset: AssetRef): Promise<void>;
}

export interface CanvasPlanOptions {
  force?: boolean;
  nodeId?: string;
  modelDefaults?: Pick<VolcengineConfig, 'imageModel' | 'videoModel'>;
}

function resolveNodeModel(node: CanvasNode, defaults?: CanvasPlanOptions['modelDefaults']): string | undefined {
  if (!providerGenerationType(node)) return undefined;
  const model = node.params.model;
  if (model != null && typeof model !== 'string') {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Node ${node.id} model must be a string or null`);
  }
  return (model as string | null | undefined)?.trim() ||
    (node.type.endsWith('-to-video') ? defaults?.videoModel : defaults?.imageModel)?.trim() || undefined;
}

export function resolveInputs(
  graph: CanvasGraph,
  node: CanvasNode,
  results: Record<string, AssetRef | string>
): ResolvedInputs {
  const inputs: ResolvedInputs = {};

  for (const edge of incomingEdges(graph, node.id)) {
    const value = results[edge.source];
    if (value === undefined) {
      throw new CanvasCutError(
        ERROR_CODES.RENDER_FAILED,
        `Upstream value is missing for ${edge.source} -> ${node.id}:${edge.targetPort}`
      );
    }
    inputs[edge.targetPort] = value;
  }

  switch (node.type) {
    case 'text-input':
      inputs.text = String(node.params.text ?? '');
      break;
    case 'image-input':
      inputs.image = node.params.asset as AssetRef | undefined;
      break;
    case 'video-input':
      inputs.video = node.params.asset as AssetRef | undefined;
      break;
    case 'canvas-reference':
      inputs.video = node.params.canvasId
        ? ({ id: String(node.params.canvasId), path: String(node.params.canvasId), type: 'video', sizeBytes: 0 } as AssetRef)
        : undefined;
      break;
    default:
      break;
  }

  return inputs;
}

export function resolvePrompt(node: CanvasNode, inputs: ResolvedInputs): string {
  const connected = inputs.text;
  if (typeof connected === 'string' && connected.trim().length > 0) {
    return connected;
  }
  const fallback = String(node.params.prompt ?? '');
  if (!fallback.trim()) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Node ${node.id} is missing prompt text`);
  }
  return fallback;
}

export function resolveAsset(
  node: CanvasNode,
  inputs: ResolvedInputs,
  port: 'image' | 'video'
): AssetRef {
  const value = inputs[port];
  if (value && typeof value !== 'string') {
    return value;
  }
  const param = node.params.asset as AssetRef | undefined;
  if (param) {
    return param;
  }
  throw new CanvasCutError(
    ERROR_CODES.INVALID_PARAMS,
    `Node ${node.id} is missing ${port} input`
  );
}

export function nodeCacheKey(
  node: CanvasNode,
  inputs: ResolvedInputs,
  settings: ProjectSettings,
  modelDefaults?: CanvasPlanOptions['modelDefaults']
): string {
  const resolution = `${settings.width}x${settings.height}@${settings.fps}`;
  const canonicalInputs = Object.keys(inputs)
    .sort()
    .map((key) => {
      const value = inputs[key];
      if (typeof value === 'string') {
        return `${key}:text:${sha256(value)}`;
      }
      if (value) {
        return `${key}:asset:${value.id}`;
      }
      return `${key}:none`;
    });
  return sha256(
    [
      node.type,
      canonicalJson(providerGenerationType(node) ? { ...node.params, model: resolveNodeModel(node, modelDefaults) } : node.params),
      canonicalJson(canonicalInputs),
      resolution
    ].join('\n')
  );
}

export function providerGenerationType(node: CanvasNode): GenerationType | null {
  switch (node.type) {
    case 'text-to-image':
      return 'text-to-image';
    case 'text-to-video':
      return 'text-to-video';
    case 'image-to-image':
      return 'image-to-image';
    case 'image-to-video':
      return 'image-to-video';
    case 'video-to-video':
      return 'video-to-video';
    default:
      return null;
  }
}

export function buildProviderRequest(
  node: CanvasNode,
  inputs: ResolvedInputs,
  settings: ProjectSettings,
  modelDefaults?: CanvasPlanOptions['modelDefaults']
):
  | TextToImageRequest
  | TextToVideoRequest
  | ImageToImageRequest
  | ImageToVideoRequest
  | VideoToVideoRequest
  | WhiteModelRequest {
  if (node.type === 'white-model-video') return buildWhiteModelRequest(node.params, settings);
  const model = resolveNodeModel(node, modelDefaults);
  const prompt = resolvePrompt(node, inputs);
  const negativePrompt = node.params.negativePrompt as string | undefined;
  const seed = node.params.seed as number | undefined;
  const width = numberOr(node.params.width, settings.width);
  const height = numberOr(node.params.height, settings.height);
  const fps = numberOr(node.params.fps, settings.fps);
  const durationMs = node.params.durationMs as number | undefined;
  const motionStrength = node.params.motionStrength as number | undefined;

  switch (node.type) {
    case 'text-to-image':
      return {
        model,
        prompt,
        negativePrompt,
        width: node.params.width !== undefined ? width : undefined,
        height: node.params.height !== undefined ? height : undefined,
        seed,
        style: node.params.style as string | undefined,
        extra: buildImageExtra(node.params)
      };
    case 'text-to-video':
      return {
        model,
        prompt,
        negativePrompt,
        durationMs,
        fps,
        width,
        height,
        seed,
        motionStrength
      };
    case 'image-to-image':
      return {
        model,
        image: resolveAsset(node, inputs, 'image'),
        prompt,
        negativePrompt,
        strength: node.params.strength as number | undefined,
        width: node.params.width !== undefined ? width : undefined,
        height: node.params.height !== undefined ? height : undefined,
        seed,
        extra: buildImageExtra(node.params)
      };
    case 'image-to-video':
      return {
        model,
        image: resolveAsset(node, inputs, 'image'),
        prompt,
        negativePrompt,
        durationMs: durationMs ?? 5000,
        fps,
        width,
        height,
        seed,
        motionStrength
      };
    case 'video-to-video':
      return {
        model,
        video: resolveAsset(node, inputs, 'video'),
        prompt,
        mode: (node.params.mode as 'edit' | 'extend') ?? 'edit',
        durationMs,
        fps,
        width,
        height,
        seed,
        motionStrength
      };
    default:
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Node is not a generation node: ${node.id}`);
  }
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function buildCanvasRenderPlan(
  graph: CanvasGraph,
  settings: ProjectSettings,
  options: CanvasPlanOptions,
  cache?: CacheLookup
): Promise<CanvasRenderPlan> {
  validateGraph(graph);

  const fullOrder = topologicalSort(graph);
  const forceNode = options.nodeId ? findNode(graph, options.nodeId) : null;
  const forceSet = new Set(
    forceNode ? subsetWithDownstream(graph, fullOrder, forceNode.id) : []
  );

  const steps: NodeRenderStep[] = [];
  const results: Record<string, AssetRef | string> = {};

  for (const nodeId of fullOrder) {
    const node = findNode(graph, nodeId);
    if (node.type === 'output') {
      continue;
    }
    const inputs = resolveInputs(graph, node, results);

    if (node.type === 'text-input') {
      const text = String(node.params.text ?? '');
      results[node.id] = text;
      continue;
    }
    if (node.type === 'image-input' || node.type === 'video-input') {
      const asset = resolveAsset(node, inputs, node.type === 'image-input' ? 'image' : 'video');
      results[node.id] = asset;
      continue;
    }
    if (node.type === 'canvas-reference') {
      const value = inputs.video;
      if (value && typeof value !== 'string') {
        results[node.id] = value;
      } else {
        results[node.id] = placeholderAsset(node.id, 'canvas-reference');
      }
      continue;
    }
    if (node.type === 'white-model-video') buildWhiteModelRequest(node.params, settings);
    const cacheKey = nodeCacheKey(node, inputs, settings, options.modelDefaults);
    let cacheHit = false;
    let cached: AssetRef | undefined;
    const shouldForce = Boolean(options.force) || forceSet.has(node.id);
    if (!shouldForce && cache) {
      cached = await cache.get(cacheKey);
      cacheHit = Boolean(cached);
    }
    if (cached) {
      results[node.id] = cached;
    } else {
      results[node.id] = placeholderAsset(node.id, cacheKey);
    }

    steps.push({
      nodeId: node.id,
      type: node.type,
      cacheKey,
      cacheHit,
      force: shouldForce,
      providerJobType: providerGenerationType(node)
    });
  }

  return {
    modelDefaults: options.modelDefaults ? { ...options.modelDefaults } : undefined,
    canvasId: graph.id,
    graphHash: graph.graphHash,
    nodes: graph.nodes,
    edges: graph.edges,
    topologicalOrder: fullOrder,
    childJobs: steps
  };
}

export interface GenerationExecutor {
  onNodeResult?(node: CanvasNode, asset: AssetRef): void;
  execute(
    node: CanvasNode,
    request:
      | TextToImageRequest
      | TextToVideoRequest
      | ImageToImageRequest
      | ImageToVideoRequest
      | VideoToVideoRequest
      | WhiteModelRequest
  ): Promise<AssetRef>;
  renderCanvasReference(canvasId: string): Promise<AssetRef>;
}

export interface CanvasExecutionResult {
  output: AssetRef;
  outputType: 'image' | 'video';
  nodeResults: Record<string, AssetRef | string>;
}

export async function executeCanvasPlan(
  plan: CanvasRenderPlan,
  graph: CanvasGraph,
  settings: ProjectSettings,
  executor: GenerationExecutor,
  cache?: CacheLookup
): Promise<CanvasExecutionResult> {
  const results: Record<string, AssetRef | string> = {};
  const graphById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const nodeId of plan.topologicalOrder) {
    const node = graphById.get(nodeId);
    if (!node) {
      throw new CanvasCutError(ERROR_CODES.NODE_NOT_FOUND, `Node not found while executing canvas: ${nodeId}`);
    }
    const inputs = resolveInputs(graph, node, results);

    if (node.type === 'text-input') {
      results[node.id] = String(node.params.text ?? '');
      continue;
    }
    if (node.type === 'image-input' || node.type === 'video-input') {
      results[node.id] = resolveAsset(node, inputs, node.type === 'image-input' ? 'image' : 'video');
      continue;
    }
    if (node.type === 'canvas-reference') {
      const canvasId = String(node.params.canvasId ?? '');
      if (!canvasId) {
        throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Canvas reference node ${node.id} is missing canvasId`);
      }
      results[node.id] = await executor.renderCanvasReference(canvasId);
      continue;
    }
    if (node.type === 'output') {
      continue;
    }

    const cacheKey = nodeCacheKey(node, inputs, settings, plan.modelDefaults);
    const planStep = plan.childJobs.find((step) => step.nodeId === node.id);
    const cached = !planStep?.force && cache ? await cache.get(cacheKey) : undefined;
    let asset: AssetRef;
    if (cached) {
      asset = cached;
    } else {
      const request = buildProviderRequest(node, inputs, settings, plan.modelDefaults);
      asset = await executor.execute(node, request);
      if (cache?.put) {
        await cache.put(cacheKey, asset);
      }
    }
    results[node.id] = asset;
    executor.onNodeResult?.(node, asset);
  }

  const outputNode = graph.nodes.find((node) => node.type === 'output');
  if (!outputNode) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, 'Canvas graph has no output node');
  }
  const outputEdge = graph.edges.find((edge) => edge.target === outputNode.id);
  if (!outputEdge) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, 'Canvas output node has no input');
  }
  const outputValue = results[outputEdge.source];
  if (!outputValue || typeof outputValue === 'string') {
    throw new CanvasCutError(ERROR_CODES.RENDER_FAILED, 'Canvas output is not an asset');
  }
  const outputType = outputNode.inputs.find((port) => port.id === outputEdge.targetPort)?.type ?? 'video';
  return {
    output: outputValue,
    outputType: outputType === 'image' ? 'image' : 'video',
    nodeResults: results
  };
}

function placeholderAsset(nodeId: string, cacheKey: string): AssetRef {
  return {
    id: `pending:${nodeId}:${cacheKey}`,
    path: '',
    type: 'video',
    sizeBytes: 0
  };
}

function subsetWithDownstream(graph: CanvasGraph, fullOrder: string[], nodeId: string): string[] {
  const downstream = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (downstream.has(current)) continue;
    downstream.add(current);
    for (const edge of graph.edges.filter((edge) => edge.source === current)) {
      queue.push(edge.target);
    }
  }
  return fullOrder.filter((id) => downstream.has(id));
}

function buildImageExtra(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  if (params.sizeMode) extra.sizeMode = params.sizeMode;
  if (params.watermark !== undefined) extra.watermark = params.watermark;
  if (params.background) extra.background = params.background;
  if (params.optimizePromptMode) extra.optimizePromptMode = params.optimizePromptMode;
  if (params.layerDecomposition !== undefined) extra.layerDecomposition = params.layerDecomposition;
  return Object.keys(extra).length > 0 ? extra : undefined;
}
