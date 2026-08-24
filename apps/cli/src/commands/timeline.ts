import { resolve } from 'node:path';
import {
  addAudioClip,
  addCanvasClip,
  addMediaClip,
  addSubtitleClip,
  addTrack,
  addTransition,
  buildRenderPlan,
  resolveCanvasClipsInTimeline,
  CanvasCutError,
  ERROR_CODES,
  findTrack,
  moveClip,
  removeClip,
  removeTrack,
  removeTransition,
  setClipOpacity,
  setClipSpeed,
  setClipTransform,
  setClipVolume,
  splitClip,
  trimClip
} from '@canvas-cut/core';
import { createStore, withLockedStore } from '../context';
import type { CliOptions } from '../args';
import { boolFlag, numberFlag, stringFlag } from '../args';
import { LocalIpcClient } from '../ipc/client';

export async function timelineInit(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    await store.writeTimeline(timeline);
    return { timelineId: timeline.id, trackCount: timeline.tracks.length };
  });
}

export async function timelineGet(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  return store.readTimeline();
}

export async function timelineAddTrack(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const type = stringFlag(options.flags, 'type');
    const name = stringFlag(options.flags, 'name') ?? type ?? 'track';
    if (type !== 'video' && type !== 'audio' && type !== 'subtitle' && type !== 'image') {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, '--type must be video|audio|subtitle|image');
    }
    const track = addTrack(timeline, type, name);
    await store.writeTimeline(timeline);
    return { trackId: track.id };
  });
}

export async function timelineRemoveTrack(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const trackId = stringFlag(options.flags, 'track');
    if (!trackId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline remove-track requires --track');
    }
    removeTrack(timeline, trackId);
    await store.writeTimeline(timeline);
    return { removed: trackId };
  });
}

export async function timelineAddClip(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const trackId = stringFlag(options.flags, 'track');
    const kind = stringFlag(options.flags, 'kind');
    const startMs = numberFlag(options.flags, 'start-ms', 0) as number;
    const durationMs = numberFlag(options.flags, 'duration-ms');
    if (!trackId || (kind !== 'media' && kind !== 'canvas')) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline add-clip requires --track and --kind media|canvas');
    }
    const track = findTrack(timeline, trackId);
    if (kind === 'media') {
      const assetPath = stringFlag(options.flags, 'asset');
      if (!assetPath) {
        throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'media clip requires --asset');
      }
      const asset = await store.importAsset(assetPath);
      const clip = addMediaClip(track, asset, startMs, durationMs ?? asset.durationMs ?? 5000);
      await store.writeTimeline(timeline);
      return { clipId: clip.id };
    }

    const canvasId = stringFlag(options.flags, 'canvas');
    if (!canvasId || durationMs === undefined) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'canvas clip requires --canvas and --duration-ms'
      );
    }
    const canvas = await store.readCanvas(canvasId);
    const clip = addCanvasClip(track, canvas, startMs, durationMs);
    await store.writeTimeline(timeline);
    return { clipId: clip.id };
  });
}

export async function timelineAddSubtitle(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const trackId = stringFlag(options.flags, 'track');
    const text = stringFlag(options.flags, 'text');
    const startMs = numberFlag(options.flags, 'start-ms', 0) as number;
    const durationMs = numberFlag(options.flags, 'duration-ms', 2000) as number;
    if (!trackId || !text) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'timeline add-subtitle requires --track and --text'
      );
    }
    const track = findTrack(timeline, trackId);
    const clip = addSubtitleClip(track, text, startMs, durationMs);
    await store.writeTimeline(timeline);
    return { clipId: clip.id };
  });
}

export async function timelineAddAudio(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const trackId = stringFlag(options.flags, 'track');
    const assetPath = stringFlag(options.flags, 'asset');
    const startMs = numberFlag(options.flags, 'start-ms', 0) as number;
    if (!trackId || !assetPath) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline add-audio requires --track and --asset');
    }
    const track = findTrack(timeline, trackId);
    const asset = await store.importAsset(assetPath, 'audio');
    const clip = addAudioClip(track, asset, startMs);
    await store.writeTimeline(timeline);
    return { clipId: clip.id };
  });
}

export async function timelineSplitClip(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    const atMs = numberFlag(options.flags, 'at-ms');
    if (!clipId || atMs === undefined) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline split-clip requires --clip and --at-ms');
    }
    const result = splitClip(timeline, clipId, atMs);
    await store.writeTimeline(timeline);
    return { leftClipId: result.left.id, rightClipId: result.right.id };
  });
}

export async function timelineTrimClip(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    const inMs = numberFlag(options.flags, 'in-ms');
    const outMs = numberFlag(options.flags, 'out-ms');
    if (!clipId || inMs === undefined || outMs === undefined) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'timeline trim-clip requires --clip, --in-ms and --out-ms'
      );
    }
    const clip = trimClip(timeline, clipId, inMs, outMs);
    await store.writeTimeline(timeline);
    return { clipId: clip.id, inMs, outMs };
  });
}

export async function timelineMoveClip(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    const startMs = numberFlag(options.flags, 'start-ms');
    if (!clipId || startMs === undefined) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline move-clip requires --clip and --start-ms');
    }
    const clip = moveClip(timeline, clipId, startMs);
    await store.writeTimeline(timeline);
    return { clipId: clip.id, startMs };
  });
}

export async function timelineSetTransform(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    if (!clipId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline set-transform requires --clip');
    }
    const clip = setClipTransform(timeline, clipId, {
      x: numberFlag(options.flags, 'x', 0) as number,
      y: numberFlag(options.flags, 'y', 0) as number,
      scale: numberFlag(options.flags, 'scale', 1) as number,
      rotation: numberFlag(options.flags, 'rotation', 0) as number
    });
    await store.writeTimeline(timeline);
    return { clipId: clip.id };
  });
}

export async function timelineSetOpacity(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    const opacity = numberFlag(options.flags, 'opacity');
    if (!clipId || opacity === undefined) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline set-opacity requires --clip and --opacity');
    }
    const clip = setClipOpacity(timeline, clipId, opacity);
    await store.writeTimeline(timeline);
    return { clipId: clip.id, opacity };
  });
}

export async function timelineSetSpeed(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    const speed = numberFlag(options.flags, 'speed');
    if (!clipId || speed === undefined) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline set-speed requires --clip and --speed');
    }
    const clip = setClipSpeed(timeline, clipId, speed);
    await store.writeTimeline(timeline);
    return { clipId: clip.id, speed };
  });
}

export async function timelineSetVolume(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    const volume = numberFlag(options.flags, 'volume');
    if (!clipId || volume === undefined) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline set-volume requires --clip and --volume');
    }
    const clip = setClipVolume(timeline, clipId, volume);
    await store.writeTimeline(timeline);
    return { clipId: clip.id, volume };
  });
}

export async function timelineRemoveClip(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    if (!clipId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline remove-clip requires --clip');
    }
    removeClip(timeline, clipId);
    await store.writeTimeline(timeline);
    return { removed: clipId };
  });
}

export async function timelineAddTransition(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    const type = stringFlag(options.flags, 'type');
    const durationMs = numberFlag(options.flags, 'duration-ms', 500) as number;
    if (!clipId || type !== 'crossfade') {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'timeline add-transition requires --clip and --type crossfade'
      );
    }
    const clip = addTransition(timeline, clipId, type, durationMs);
    await store.writeTimeline(timeline);
    return { clipId: clip.id, type, durationMs };
  });
}

export async function timelineRemoveTransition(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    await store.requireOpen();
    const timeline = await store.readTimeline();
    const clipId = stringFlag(options.flags, 'clip');
    if (!clipId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline remove-transition requires --clip');
    }
    const clip = removeTransition(timeline, clipId);
    await store.writeTimeline(timeline);
    return { clipId: clip.id };
  });
}

export async function timelineExport(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  const project = await store.readProject();
  const rawTimeline = await store.readTimeline();
  const timeline = await resolveCanvasClipsInTimeline(store.paths.root, rawTimeline);
  const output = stringFlag(options.flags, 'output');
  if (!output) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeline export requires --output');
  }
  const outputPath = resolve(process.cwd(), output);
  const plan = buildRenderPlan(timeline, {
    outputPath,
    projectRoot: store.paths.root,
    settings: project.settings
  });

  if (options.dryRun) {
    return plan;
  }

  const client = new LocalIpcClient(store.paths.root);
  return client.request('job.submit', {
    type: 'timeline.export',
    outputPath
  });
}
