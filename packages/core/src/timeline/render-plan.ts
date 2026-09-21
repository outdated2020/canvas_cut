import { join, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import {
  AssetRef,
  CanvasClip,
  CanvasGraph,
  MediaClip,
  ProjectSettings,
  RenderPlan,
  RenderSegment,
  SubtitleClip,
  TimelineFile
} from '../types';
import { CanvasCutError, ERROR_CODES } from '../errors';
import { pathExists } from '../project/project-store';
import { readJsonFile } from '../fs/atomic';

export interface TimelineRenderOptions {
  outputPath: string;
  projectRoot: string;
  settings: ProjectSettings;
  crf?: number;
}

type VideoClip = MediaClip | CanvasClip;

function isVideoMedia(clip: MediaClip): boolean {
  return clip.asset.type === 'video' || clip.asset.type === 'image';
}

function videoAsset(clip: VideoClip): AssetRef {
  if (clip.kind === 'canvas') {
    if (!clip.renderedAsset) {
      throw new CanvasCutError(
        ERROR_CODES.RENDER_FAILED,
        `Canvas clip ${clip.id} has no rendered asset; render its canvas first`
      );
    }
    return clip.renderedAsset;
  }
  return clip.asset;
}

function collectVideoClips(timeline: TimelineFile): VideoClip[] {
  const result: VideoClip[] = [];
  for (const track of timeline.tracks) {
    if (track.type !== 'video' && track.type !== 'image') continue;
    for (const clip of track.clips) {
      if (clip.kind === 'canvas') {
        result.push(clip);
      } else if (clip.kind === 'media' && isVideoMedia(clip)) {
        result.push(clip);
      }
    }
  }
  return result.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function collectAudioClips(timeline: TimelineFile): MediaClip[] {
  const result: MediaClip[] = [];
  for (const track of timeline.tracks) {
    if (track.type !== 'audio') continue;
    for (const clip of track.clips) {
      if (clip.kind === 'media' && clip.asset.type === 'audio') {
        result.push(clip);
      }
    }
  }
  return result.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function collectSubtitleClips(timeline: TimelineFile): SubtitleClip[] {
  const result: SubtitleClip[] = [];
  for (const track of timeline.tracks) {
    if (track.type !== 'subtitle') continue;
    for (const clip of track.clips) {
      if (clip.kind === 'subtitle') {
        result.push(clip);
      }
    }
  }
  return result.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function clipEndMs(clip: { startMs: number; durationMs: number }): number {
  return clip.startMs + clip.durationMs;
}

export function buildRenderPlan(
  timeline: TimelineFile,
  options: TimelineRenderOptions
): RenderPlan {
  const { width, height, fps } = options.settings;
  if (![width, height].every((v) => Number.isInteger(v) && v > 0 && v <= 8192 && v % 2 === 0)
      || !Number.isFinite(fps) || fps <= 0 || fps > 120
      || (options.crf !== undefined && (!Number.isInteger(options.crf) || options.crf < 0 || options.crf > 51))) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Invalid export dimensions, FPS or CRF');
  }
  const videoClips = collectVideoClips(timeline);
  const audioClips = collectAudioClips(timeline);
  const subtitleClips = collectSubtitleClips(timeline);

  const totalDuration = Math.max(
    0,
    ...videoClips.map(clipEndMs),
    ...audioClips.map(clipEndMs),
    ...subtitleClips.map(clipEndMs)
  );

  if (totalDuration <= 0) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Timeline has no clips to export');
  }

  const events = new Set<number>([0, totalDuration]);
  for (const clip of [...videoClips, ...audioClips, ...subtitleClips]) {
    events.add(Math.max(0, clip.startMs));
    events.add(clipEndMs(clip));
  }
  const sortedEvents = [...events].sort((a, b) => a - b);
  const segments: RenderSegment[] = [];

  for (let index = 0; index < sortedEvents.length - 1; index += 1) {
    const startMs = sortedEvents[index] as number;
    const endMs = sortedEvents[index + 1] as number;
    if (endMs <= startMs) continue;
    segments.push({
      id: `seg-${index}`,
      startMs,
      endMs,
      activeVideo: videoClips.filter(
        (clip) => clip.startMs <= startMs && clipEndMs(clip) > startMs
      ),
      activeAudio: audioClips.filter(
        (clip) => clip.startMs <= startMs && clipEndMs(clip) > startMs
      ),
      activeSubtitles: subtitleClips.filter(
        (clip) => clip.startMs <= startMs && clipEndMs(clip) > startMs
      )
    });
  }

  return {
    projectPath: options.projectRoot,
    outputPath: resolve(options.outputPath),
    width: options.settings.width,
    height: options.settings.height,
    fps: options.settings.fps,
    crf: options.crf ?? 18,
    segments,
    tracks: timeline.tracks
  };
}

export async function assertRenderAssetsExist(plan: RenderPlan): Promise<void> {
  const assets = new Set<string>();
  for (const segment of plan.segments) {
    for (const clip of [...segment.activeVideo, ...segment.activeAudio]) {
      if (clip.kind === 'media') {
        assets.add(clip.asset.path);
      } else if (clip.renderedAsset) {
        assets.add(clip.renderedAsset.path);
      }
    }
  }
  for (const assetPath of assets) {
    if (!(await pathExists(assetPath))) {
      throw new CanvasCutError(ERROR_CODES.ASSET_NOT_FOUND, `Render asset not found: ${assetPath}`);
    }
  }
}

export async function resolveCanvasClipsInTimeline(
  projectRoot: string,
  timeline: TimelineFile
): Promise<TimelineFile> {
  const resolved = structuredClone(timeline);

  for (const track of resolved.tracks) {
    for (const clip of track.clips) {
      if (clip.kind !== 'canvas') continue;
      const canvasPath = join(projectRoot, 'canvases', `${clip.canvasId}.json`);
      if (!(await pathExists(canvasPath))) {
        throw new CanvasCutError(ERROR_CODES.CANVAS_NOT_FOUND, `Canvas not found for clip ${clip.id}`);
      }
      const canvas = await readJsonFile<CanvasGraph>(canvasPath);
      if (canvas.graphHash !== clip.canvasGraphHash) {
        throw new CanvasCutError(
          ERROR_CODES.RENDER_FAILED,
          `Canvas clip ${clip.id} is stale: canvas graph has changed. Re-render canvas ${clip.canvasId} first.`
        );
      }
      const outputNode = canvas.nodes.find((node) => node.type === 'output');
      if (!outputNode?.cachedResult) {
        throw new CanvasCutError(
          ERROR_CODES.RENDER_FAILED,
          `Canvas clip ${clip.id} has no rendered output. Re-render canvas ${clip.canvasId} first.`
        );
      }
      clip.renderedAsset = outputNode.cachedResult;
      clip.status = 'fresh';
    }
  }

  return resolved;
}
