import { randomUUID } from 'node:crypto';
import {
  CanvasCutError,
  CanvasPreset,
  createCanvas,
  createNode,
  ERROR_CODES
} from '@canvas-cut/core';
import { createStore, withLockedStore } from '../context';
import type { CliOptions } from '../args';
import { stringFlag } from '../args';

export async function presetSave(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const canvasId = stringFlag(options.flags, 'canvas');
    const name = stringFlag(options.flags, 'name');
    if (!canvasId || !name) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'preset save requires --canvas and --name');
    }
    const canvas = await store.readCanvas(canvasId);
    const preset: CanvasPreset = {
      schemaVersion: 1,
      id: randomUUID(),
      name,
      version: 1,
      graph: {
        nodes: canvas.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          params: node.params
        })),
        edges: canvas.edges.map((edge) => ({ ...edge }))
      },
      inputs: []
    };
    await store.writePreset(preset);
    return { presetId: preset.id, name: preset.name };
  });
}

export async function presetList(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  const presets = await store.listPresets();
  return presets.map((preset) => ({
    presetId: preset.id,
    name: preset.name,
    version: preset.version
  }));
}

export async function presetApply(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const presetId = stringFlag(options.flags, 'preset');
    const name = stringFlag(options.flags, 'name');
    if (!presetId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'preset apply requires --preset');
    }
    const preset = await store.readPreset(presetId);
    const canvasId = randomUUID();
    const canvasName = name ?? preset.name;
    const canvas = createCanvas(canvasId, canvasName);
    canvas.nodes = preset.graph.nodes.map((node) => createNode(node.type, node.params, node.id));
    canvas.edges = preset.graph.edges.map((edge) => ({ ...edge }));
    canvas.version = 1;
    const { computeGraphHash } = await import('@canvas-cut/core');
    canvas.graphHash = computeGraphHash(canvas);
    await store.writeCanvas(canvas);
    return { canvasId, name: canvasName };
  });
}
