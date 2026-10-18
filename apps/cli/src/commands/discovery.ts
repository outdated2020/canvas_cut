import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { CLI_MANIFEST, CanvasCutError, ERROR_CODES } from '@canvas-cut/core';
import { createStore, withLockedStore } from '../context';
import { CliOptions, stringFlag } from '../args';

export function manifest() {
  return { commands: CLI_MANIFEST, globalOptions: ['--project <path>', '--json', '--dry-run', '--help', '--params-file <path>', '--idempotency-key <key>'],
    positionalIds: ['canvas.get', 'canvas.status', 'canvas.rename', 'canvas.remove', 'canvas.render', 'job.status', 'job.wait', 'job.cancel'],
    examples: ['canvas-cut canvas get <canvasId> --json', 'canvas-cut canvas node add --canvas <canvasId> --type text-input --params-file params.json --json', 'canvas-cut job wait <jobId> --timeout-ms 1800000 --json'] };
}
export async function canvasList(options: CliOptions) {
  const store = createStore(options); await store.requireOpen();
  const graphs = await Promise.all((await store.listCanvasFiles()).map((file) => store.readCanvas(file.replace(/\.json$/, ''))));
  return graphs.map((graph) => ({ canvasId: graph.id, name: graph.name, graphHash: graph.graphHash, version: graph.version }));
}
export async function assetList(options: CliOptions) {
  const store = createStore(options); await store.requireOpen();
  const entries = await fs.readdir(store.paths.assetsDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => ({ name: entry.name, path: join(store.paths.assetsDir, entry.name) }));
}
export async function assetImport(options: CliOptions) {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const path = stringFlag(options.flags, 'file');
    if (!path) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'asset import requires --file');
    return store.importAsset(path);
  });
}
export async function refreshCanvasClips(options: CliOptions) {
  return withLockedStore(options, async (store) => {
    await store.requireOpen(); const timeline = await store.readTimeline();
    const targetId = stringFlag(options.flags, 'clip');
    let updated = 0;
    for (const track of timeline.tracks) for (const clip of track.clips) {
      if (clip.kind !== 'canvas' || (targetId && clip.id !== targetId)) continue;
      const canvas = await store.readCanvas(clip.canvasId);
      const asset = canvas.nodes.find((node) => node.type === 'output' && node.status === 'succeeded')?.cachedResult;
      if (!asset) throw new CanvasCutError(ERROR_CODES.RENDER_FAILED, `Render canvas ${canvas.id} first`);
      Object.assign(clip, { canvasVersion: canvas.version, canvasGraphHash: canvas.graphHash, renderedAsset: asset, status: 'fresh' });
      updated++;
    }
    if (targetId && updated === 0) throw new CanvasCutError('CLIP_NOT_FOUND', 'Canvas clip not found');
    await store.writeTimeline(timeline); return { updated };
  });
}
