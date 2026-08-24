import { randomUUID } from 'node:crypto';
import {
  AssetRef,
  CanvasClip,
  CanvasGraph,
  Clip,
  MediaClip,
  SubtitleClip,
  TimelineFile,
  Track,
  TrackType,
  Transform
} from '../types';
import { CanvasCutError, ERROR_CODES } from '../errors';

export function addTrack(timeline: TimelineFile, type: TrackType, name: string, id = randomUUID()): Track {
  const track: Track = { id, type, name, clips: [] };
  timeline.tracks.push(track);
  return track;
}

export function removeTrack(timeline: TimelineFile, trackId: string): void {
  const index = timeline.tracks.findIndex((track) => track.id === trackId);
  if (index < 0) {
    throw new CanvasCutError('TRACK_NOT_FOUND', `Track not found: ${trackId}`);
  }
  timeline.tracks.splice(index, 1);
}

export function findTrack(timeline: TimelineFile, trackId: string): Track {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track) {
    throw new CanvasCutError('TRACK_NOT_FOUND', `Track not found: ${trackId}`);
  }
  return track;
}

export function findClip(timeline: TimelineFile, clipId: string): { track: Track; clip: Clip; index: number } {
  for (const track of timeline.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index >= 0) {
      return { track, clip: track.clips[index] as Clip, index };
    }
  }
  throw new CanvasCutError('CLIP_NOT_FOUND', `Clip not found: ${clipId}`);
}

export function addMediaClip(
  track: Track,
  asset: AssetRef,
  startMs: number,
  durationMs?: number,
  id = randomUUID()
): MediaClip {
  const clipDuration = durationMs ?? asset.durationMs ?? 5000;
  const clip: MediaClip = {
    id,
    kind: 'media',
    asset,
    startMs,
    durationMs: clipDuration,
    inMs: 0,
    outMs: clipDuration,
    opacity: 1
  };
  track.clips.push(clip);
  return clip;
}

export function addAudioClip(
  track: Track,
  asset: AssetRef,
  startMs: number,
  id = randomUUID()
): MediaClip {
  const durationMs = asset.durationMs ?? 5000;
  const clip: MediaClip = {
    id,
    kind: 'media',
    asset,
    startMs,
    durationMs,
    inMs: 0,
    outMs: durationMs,
    opacity: 1,
    volume: 1
  };
  track.clips.push(clip);
  return clip;
}

export function addCanvasClip(
  track: Track,
  canvas: CanvasGraph,
  startMs: number,
  durationMs: number,
  renderedAsset?: AssetRef,
  id = randomUUID()
): CanvasClip {
  const clip: CanvasClip = {
    id,
    kind: 'canvas',
    canvasId: canvas.id,
    canvasVersion: canvas.version,
    canvasGraphHash: canvas.graphHash,
    startMs,
    durationMs,
    renderedAsset,
    status: renderedAsset ? 'fresh' : 'stale',
    opacity: 1
  };
  track.clips.push(clip);
  return clip;
}

export function addSubtitleClip(
  track: Track,
  text: string,
  startMs: number,
  durationMs: number,
  id = randomUUID()
): SubtitleClip {
  const clip: SubtitleClip = {
    id,
    kind: 'subtitle',
    text,
    startMs,
    durationMs
  };
  track.clips.push(clip);
  return clip;
}

function isSplittableClip(clip: Clip): clip is MediaClip | CanvasClip {
  return clip.kind === 'media' || clip.kind === 'canvas';
}

export function splitClip(timeline: TimelineFile, clipId: string, atMs: number): { left: Clip; right: Clip } {
  const { track, clip, index } = findClip(timeline, clipId);
  if (!isSplittableClip(clip)) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Clip cannot be split: ${clip.kind}`);
  }
  const start = clip.startMs;
  const end = clip.startMs + clip.durationMs;
  if (atMs <= start || atMs >= end) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Split point must be inside the clip: ${clipId}`);
  }

  const leftDuration = atMs - start;
  const rightDuration = end - atMs;
  const left: Clip = {
    ...clip,
    id: randomUUID(),
    startMs: start,
    durationMs: leftDuration,
    ...(clip.kind === 'media' ? { outMs: clip.inMs + leftDuration } : {})
  };
  const right: Clip = {
    ...clip,
    id: randomUUID(),
    startMs: atMs,
    durationMs: rightDuration,
    ...(clip.kind === 'media' ? { inMs: clip.outMs - rightDuration } : {})
  };
  track.clips.splice(index, 1, left, right);
  return { left, right };
}

export function trimClip(timeline: TimelineFile, clipId: string, inMs: number, outMs: number): Clip {
  const { track, clip, index } = findClip(timeline, clipId);
  if (!isSplittableClip(clip)) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Clip cannot be trimmed: ${clip.kind}`);
  }
  if (inMs < 0 || outMs <= inMs) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Trim range is invalid');
  }
  const durationMs = outMs - inMs;
  const updated: Clip = {
    ...clip,
    durationMs,
    ...(clip.kind === 'media' ? { inMs, outMs } : {})
  };
  track.clips[index] = updated;
  return updated;
}

export function moveClip(timeline: TimelineFile, clipId: string, startMs: number): Clip {
  const { track, clip, index } = findClip(timeline, clipId);
  if (clip.kind === 'subtitle' || clip.kind === 'media' || clip.kind === 'canvas') {
    const updated = { ...clip, startMs: Math.max(0, startMs) };
    track.clips[index] = updated;
    return updated;
  }
  return clip;
}

export function setClipTransform(timeline: TimelineFile, clipId: string, transform: Transform): Clip {
  const { track, clip, index } = findClip(timeline, clipId);
  if (clip.kind === 'media' || clip.kind === 'canvas') {
    const updated = { ...clip, transform };
    track.clips[index] = updated;
    return updated;
  }
  throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Clip does not support transform: ${clip.kind}`);
}

export function setClipOpacity(timeline: TimelineFile, clipId: string, opacity: number): Clip {
  const { track, clip, index } = findClip(timeline, clipId);
  if (clip.kind === 'media' || clip.kind === 'canvas') {
    const updated = { ...clip, opacity: Math.max(0, Math.min(1, opacity)) };
    track.clips[index] = updated;
    return updated;
  }
  throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Clip does not support opacity: ${clip.kind}`);
}

export function setClipSpeed(timeline: TimelineFile, clipId: string, speed: number): Clip {
  const { track, clip, index } = findClip(timeline, clipId);
  if (clip.kind === 'media' || clip.kind === 'canvas') {
    const updated = { ...clip, speed: Math.max(0.1, speed) };
    track.clips[index] = updated;
    return updated;
  }
  throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Clip does not support speed: ${clip.kind}`);
}

export function setClipVolume(timeline: TimelineFile, clipId: string, volume: number): Clip {
  const { track, clip, index } = findClip(timeline, clipId);
  if (clip.kind === 'media') {
    const updated = { ...clip, volume: Math.max(0, Math.min(2, volume)) };
    track.clips[index] = updated;
    return updated;
  }
  throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Clip does not support volume: ${clip.kind}`);
}

export function removeClip(timeline: TimelineFile, clipId: string): void {
  const { track, index } = findClip(timeline, clipId);
  track.clips.splice(index, 1);
}

export function addTransition(
  timeline: TimelineFile,
  clipId: string,
  type: 'crossfade',
  durationMs: number
): Clip {
  const { track, clip, index } = findClip(timeline, clipId);
  if (clip.kind === 'media' || clip.kind === 'canvas') {
    const updated = { ...clip, transition: { type, durationMs } };
    track.clips[index] = updated;
    return updated;
  }
  throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Clip does not support transitions: ${clip.kind}`);
}

export function removeTransition(timeline: TimelineFile, clipId: string): Clip {
  const { track, clip, index } = findClip(timeline, clipId);
  if (clip.kind === 'media' || clip.kind === 'canvas') {
    const { transition: _transition, ...rest } = clip;
    track.clips[index] = rest as Clip;
    return rest as Clip;
  }
  throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Clip does not support transitions: ${clip.kind}`);
}

export function timelineDurationMs(timeline: TimelineFile): number {
  return timeline.tracks.reduce((max, track) => {
    const trackEnd = track.clips.reduce(
      (end, clip) => Math.max(end, clip.startMs + clip.durationMs),
      0
    );
    return Math.max(max, trackEnd);
  }, 0);
}
