import { randomUUID } from 'node:crypto';
import {
  CanvasEdge,
  CanvasGraph,
  CanvasNode,
  NodeType,
  PortType
} from '../types';
import { canonicalJson, sha256, stableJson } from '../hash';
import { assertKnownNodeType, createNodePorts, getRequiredInputPorts } from './registry';
import { CanvasCutError, ERROR_CODES } from '../errors';

export function createCanvas(id: string, name?: string): CanvasGraph {
  const canvas: CanvasGraph = {
    schemaVersion: 1,
    id,
    version: 1,
    graphHash: '',
    nodes: [],
    edges: []
  };
  canvas.graphHash = computeGraphHash(canvas);
  return canvas;
}

export function graphHashData(graph: CanvasGraph): unknown {
  const nodes = [...graph.nodes]
    .map((node) => {
      const { status: _status, cachedResult: _cachedResult, ...rest } = node;
      return {
        ...rest,
        params: stableJson(rest.params)
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges = [...graph.edges].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: graph.schemaVersion,
    id: graph.id,
    nodes,
    edges
  };
}

export function computeGraphHash(graph: CanvasGraph): string {
  return sha256(canonicalJson(graphHashData(graph)));
}

export function refreshGraphHash(graph: CanvasGraph): void {
  graph.graphHash = computeGraphHash(graph);
}

export function bumpGraphVersion(graph: CanvasGraph): void {
  graph.version += 1;
  refreshGraphHash(graph);
}

export function createNode(type: NodeType, params: Record<string, unknown> = {}, id: string = randomUUID()): CanvasNode {
  assertKnownNodeType(type);
  const ports = createNodePorts(type);
  return {
    id,
    type,
    params,
    inputs: ports.inputs,
    outputs: ports.outputs,
    status: 'idle'
  };
}

export function addNode(
  graph: CanvasGraph,
  type: NodeType,
  params: Record<string, unknown> = {},
  id: string = randomUUID()
): CanvasNode {
  const node = createNode(type, params, id);
  graph.nodes.push(node);
  bumpGraphVersion(graph);
  return node;
}

export function removeNode(graph: CanvasGraph, nodeId: string): void {
  const nodeIndex = graph.nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex < 0) {
    throw new CanvasCutError(ERROR_CODES.NODE_NOT_FOUND, `Node not found: ${nodeId}`);
  }
  graph.nodes.splice(nodeIndex, 1);
  graph.edges = graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
  bumpGraphVersion(graph);
}

export function setNodeParams(graph: CanvasGraph, nodeId: string, params: Record<string, unknown>): CanvasNode {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new CanvasCutError(ERROR_CODES.NODE_NOT_FOUND, `Node not found: ${nodeId}`);
  }
  node.params = { ...node.params, ...params };
  node.status = 'idle';
  node.cachedResult = undefined;
  bumpGraphVersion(graph);
  return node;
}

export function connectEdge(
  graph: CanvasGraph,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
  id: string = randomUUID()
): CanvasEdge {
  const sourceNode = findNode(graph, source);
  const targetNode = findNode(graph, target);
  if (sourceNode.id === targetNode.id) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, 'A node cannot connect to itself');
  }

  const sourcePortDef = sourceNode.outputs.find((port) => port.id === sourcePort);
  const targetPortDef = targetNode.inputs.find((port) => port.id === targetPort);
  if (!sourcePortDef) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Source port not found: ${source}:${sourcePort}`);
  }
  if (!targetPortDef) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Target port not found: ${target}:${targetPort}`);
  }
  if (sourcePortDef.type !== targetPortDef.type) {
    throw new CanvasCutError(
      ERROR_CODES.EDGE_INVALID,
      `Port type mismatch: ${sourcePortDef.type} cannot connect to ${targetPortDef.type}`
    );
  }

  const existing = graph.edges.find((edge) => edge.target === target && edge.targetPort === targetPort);
  if (existing) {
    throw new CanvasCutError(
      ERROR_CODES.EDGE_INVALID,
      `Input port already connected: ${target}:${targetPort}`
    );
  }

  const edge: CanvasEdge = { id, source, sourcePort, target, targetPort };
  graph.edges.push(edge);
  bumpGraphVersion(graph);
  return edge;
}

export function disconnectEdge(graph: CanvasGraph, edgeId: string): void {
  const index = graph.edges.findIndex((edge) => edge.id === edgeId);
  if (index < 0) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Edge not found: ${edgeId}`);
  }
  graph.edges.splice(index, 1);
  bumpGraphVersion(graph);
}

export function findNode(graph: CanvasGraph, nodeId: string): CanvasNode {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new CanvasCutError(ERROR_CODES.NODE_NOT_FOUND, `Node not found: ${nodeId}`);
  }
  return node;
}

export function incomingEdges(graph: CanvasGraph, nodeId: string): CanvasEdge[] {
  return graph.edges.filter((edge) => edge.target === nodeId);
}

export function outgoingEdges(graph: CanvasGraph, nodeId: string): CanvasEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

export function validateGraph(graph: CanvasGraph): void {
  if (graph.nodes.length === 0) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, 'Canvas graph is empty');
  }

  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Duplicate node id: ${node.id}`);
    }
    ids.add(node.id);
    assertKnownNodeType(node.type);
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Edge references missing node: ${edge.id}`);
    }
    const sourceNode = findNode(graph, edge.source);
    const targetNode = findNode(graph, edge.target);
    const sourcePort = sourceNode.outputs.find((port) => port.id === edge.sourcePort);
    const targetPort = targetNode.inputs.find((port) => port.id === edge.targetPort);
    if (!sourcePort || !targetPort) {
      throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Edge references missing port: ${edge.id}`);
    }
    if (sourcePort.type !== targetPort.type) {
      throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Port type mismatch on edge: ${edge.id}`);
    }
  }

  for (const node of graph.nodes) {
    const required = getRequiredInputPorts(node.type);
    for (const portType of required) {
      const incoming = graph.edges.some((edge) => edge.target === node.id && edge.targetPort === portType);
      if (incoming) continue;
      if (portType === 'text') {
        if (typeof node.params.prompt !== 'string' || node.params.prompt.trim() === '') {
          throw new CanvasCutError(
            ERROR_CODES.EDGE_INVALID,
            `Node ${node.id} requires a connected text input or a non-empty prompt`
          );
        }
      } else if (!node.params.asset) {
        throw new CanvasCutError(
          ERROR_CODES.EDGE_INVALID,
          `Node ${node.id} requires a connected ${portType} input or an asset parameter`
        );
      }
    }
  }

  topologicalSort(graph);

  const outputCount = graph.nodes.filter((node) => node.type === 'output').length;
  if (outputCount === 0) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, 'Canvas graph requires an output node');
  }
  if (outputCount > 1) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, 'Canvas graph may only have one output node');
  }
}

export function topologicalSort(graph: CanvasGraph): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  const queue = graph.nodes
    .filter((node) => (inDegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id)
    .sort();
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    result.push(current);
    const next = adjacency.get(current) ?? [];
    next.sort();
    for (const target of next) {
      const degree = (inDegree.get(target) ?? 1) - 1;
      inDegree.set(target, degree);
      if (degree === 0) {
        queue.push(target);
      }
    }
  }

  if (result.length !== graph.nodes.length) {
    throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, 'Canvas graph contains a cycle');
  }

  return result;
}

export function connectedInputPortType(graph: CanvasGraph, nodeId: string, portId: string): PortType | null {
  const edge = graph.edges.find((item) => item.target === nodeId && item.targetPort === portId);
  if (!edge) return null;
  const sourceNode = findNode(graph, edge.source);
  return sourceNode.outputs.find((port) => port.id === edge.sourcePort)?.type ?? null;
}

export function outputInputPort(graph: CanvasGraph): CanvasEdge | null {
  const output = graph.nodes.find((node) => node.type === 'output');
  if (!output) return null;
  return graph.edges.find((edge) => edge.target === output.id) ?? null;
}
