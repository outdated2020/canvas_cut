import { NodePort, NodeType, PortType } from '../types';
import { CanvasCutError, ERROR_CODES } from '../errors';

export interface NodeDefinition {
  type: NodeType;
  label: string;
  inputs: NodePort[];
  outputs: NodePort[];
  generationType?: 'text-to-image' | 'text-to-video' | 'image-to-image' | 'image-to-video' | 'video-to-video';
}

const port = (id: string, type: PortType): NodePort => ({ id, type });

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  'text-input': {
    type: 'text-input',
    label: 'Text Input',
    inputs: [],
    outputs: [port('text', 'text')]
  },
  'image-input': {
    type: 'image-input',
    label: 'Image Input',
    inputs: [],
    outputs: [port('image', 'image')]
  },
  'video-input': {
    type: 'video-input',
    label: 'Video Input',
    inputs: [],
    outputs: [port('video', 'video')]
  },
  'canvas-reference': {
    type: 'canvas-reference',
    label: 'Canvas Reference',
    inputs: [],
    outputs: [port('video', 'video')]
  },
  'text-to-image': {
    type: 'text-to-image',
    label: 'Text to Image',
    inputs: [port('text', 'text')],
    outputs: [port('image', 'image')],
    generationType: 'text-to-image'
  },
  'text-to-video': {
    type: 'text-to-video',
    label: 'Text to Video',
    inputs: [port('text', 'text')],
    outputs: [port('video', 'video')],
    generationType: 'text-to-video'
  },
  'image-to-image': {
    type: 'image-to-image',
    label: 'Image to Image',
    inputs: [port('image', 'image'), port('text', 'text')],
    outputs: [port('image', 'image')],
    generationType: 'image-to-image'
  },
  'image-to-video': {
    type: 'image-to-video',
    label: 'Image to Video',
    inputs: [port('image', 'image'), port('text', 'text')],
    outputs: [port('video', 'video')],
    generationType: 'image-to-video'
  },
  'video-to-video': {
    type: 'video-to-video',
    label: 'Video to Video',
    inputs: [port('video', 'video'), port('text', 'text')],
    outputs: [port('video', 'video')],
    generationType: 'video-to-video'
  },
  output: {
    type: 'output',
    label: 'Output',
    inputs: [port('image', 'image'), port('video', 'video')],
    outputs: [port('image', 'image'), port('video', 'video')]
  }
};

export function getNodeDefinition(type: NodeType): NodeDefinition {
  return NODE_DEFINITIONS[type];
}

export function isNodeType(value: string): value is NodeType {
  return value in NODE_DEFINITIONS;
}

export function createNodePorts(type: NodeType): { inputs: NodePort[]; outputs: NodePort[] } {
  const def = getNodeDefinition(type);
  return {
    inputs: def.inputs.map((p) => ({ ...p })),
    outputs: def.outputs.map((p) => ({ ...p }))
  };
}

const REQUIRED_INPUT_PORTS: Partial<Record<NodeType, PortType[]>> = {
  'text-to-image': ['text'],
  'text-to-video': ['text'],
  'image-to-image': ['image', 'text'],
  'image-to-video': ['image', 'text'],
  'video-to-video': ['video', 'text']
};

export function getRequiredInputPorts(type: NodeType): PortType[] {
  return REQUIRED_INPUT_PORTS[type] ?? [];
}

export function assertKnownNodeType(type: string): asserts type is NodeType {
  if (!isNodeType(type)) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Unknown node type: ${type}`);
  }
}
