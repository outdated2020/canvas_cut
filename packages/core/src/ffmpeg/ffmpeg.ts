import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import {
  CanvasClip,
  MediaClip,
  RenderPlan,
  RenderSegment
} from '../types';
import { CanvasCutError, ERROR_CODES } from '../errors';

type VideoClip = MediaClip | CanvasClip;

function isCanvasClip(clip: VideoClip): clip is CanvasClip {
  return clip.kind === 'canvas';
}

function clipAssetPath(clip: VideoClip | MediaClip): string {
  if (clip.kind === 'canvas') {
    if (!clip.renderedAsset) {
      throw new CanvasCutError(ERROR_CODES.RENDER_FAILED, `Canvas clip ${clip.id} is not rendered`);
    }
    return clip.renderedAsset.path;
  }
  return clip.asset.path;
}

function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

function uniqueVideoClips(plan: RenderPlan): VideoClip[] {
  const map = new Map<string, VideoClip>();
  for (const segment of plan.segments) {
    for (const clip of segment.activeVideo) {
      map.set(clip.id, clip);
    }
  }
  return [...map.values()].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function uniqueAudioClips(plan: RenderPlan): MediaClip[] {
  const map = new Map<string, MediaClip>();
  for (const segment of plan.segments) {
    for (const clip of segment.activeAudio) {
      map.set(clip.id, clip);
    }
  }
  return [...map.values()].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function subtitleClips(plan: RenderPlan): NonNullable<RenderSegment['activeSubtitles']> {
  const map = new Map<string, RenderSegment['activeSubtitles'][number]>();
  for (const segment of plan.segments) {
    for (const clip of segment.activeSubtitles) {
      map.set(clip.id, clip);
    }
  }
  return [...map.values()].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

export function buildFfmpegArgs(plan: RenderPlan): string[] {
  const videoClips = uniqueVideoClips(plan);
  const audioClips = uniqueAudioClips(plan);
  const subtitles = subtitleClips(plan);

  if (videoClips.length === 0) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Cannot export a timeline without a video or image track');
  }
  if (videoClips.some((clip) => clip.transition) || audioClips.some((clip) => clip.transition)) {
    throw new CanvasCutError(
      ERROR_CODES.INVALID_PARAMS,
      'Transitions are not implemented in the current FFmpeg exporter; remove transitions before exporting.'
    );
  }

  const args: string[] = ['-y'];
  const filters: string[] = [];
  const inputs = new Map<string, number>();

  // Rebuild input order deterministically: all video clips first, then audio clips.
  for (const clip of videoClips) {
    if (clip.kind === 'media' && clip.asset.type === 'image') {
      args.push('-loop', '1', '-t', String(clip.durationMs / 1000), '-i', clipAssetPath(clip));
    } else {
      args.push('-i', clipAssetPath(clip));
    }
    inputs.set(clip.id, inputs.size);
  }
  for (const clip of audioClips) {
    args.push('-i', clipAssetPath(clip));
    inputs.set(clip.id, inputs.size);
  }

  videoClips.forEach((clip, index) => {
    const input = inputs.get(clip.id);
    const w = plan.width;
    const h = plan.height;
    const fps = plan.fps;
    const start = clip.startMs / 1000;
    const duration = clip.durationMs / 1000;
    const speed = clip.speed ?? 1;
    const inSec = clip.kind === 'media' ? clip.inMs / 1000 : 0;
    const sourceDuration = clip.kind === 'media' ? (clip.outMs - clip.inMs) / 1000 : duration;
    const label = `v${index}`;
    const filter = clip.kind === 'media' && clip.asset.type === 'image'
      ? `[${input}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${duration},setpts=PTS-STARTPTS+${start}/TB[${label}]`
      : `[${input}:v]trim=start=${inSec}:duration=${sourceDuration},setpts=(PTS-STARTPTS)/${speed}+${start}/TB,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[${label}]`;
    filters.push(filter);
  });

  let currentVideoLabel = 'v0';
  for (let index = 1; index < videoClips.length; index += 1) {
    const nextLabel = `vo${index}`;
    filters.push(
      `[${currentVideoLabel}][v${index}]overlay=0:0:eof_action=pass[${nextLabel}]`
    );
    currentVideoLabel = nextLabel;
  }

  let subtitleTarget = currentVideoLabel;
  subtitles.forEach((subtitle, index) => {
    const start = subtitle.startMs / 1000;
    const end = (subtitle.startMs + subtitle.durationMs) / 1000;
    const nextLabel = `vs${index}`;
    filters.push(
      `[${subtitleTarget}]drawtext=text='${escapeDrawText(subtitle.text)}':x=(w-text_w)/2:y=h-th-80:fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:enable='between(t,${start},${end})'[${nextLabel}]`
    );
    subtitleTarget = nextLabel;
  });
  filters.push(`[${subtitleTarget}]format=yuv420p[vout]`);

  const audioLabels: string[] = [];
  audioClips.forEach((clip, index) => {
    const input = inputs.get(clip.id);
    const label = `a${index}`;
    const inSec = clip.inMs / 1000;
    const duration = (clip.outMs - clip.inMs) / 1000;
    const startMs = clip.startMs;
    const volume = clip.volume ?? 1;
    const speed = clip.speed ?? 1;
    filters.push(
      `[${input}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${inSec}:duration=${duration},asetpts=PTS-STARTPTS,atempo=${speed},adelay=${startMs}|${startMs},volume=${volume}[${label}]`
    );
    audioLabels.push(label);
  });

  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.map((label) => `[${label}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[aout]`
    );
  }

  args.push('-filter_complex', filters.join(';'));
  if (audioLabels.length > 0) {
    args.push('-map', '[vout]', '-map', '[aout]');
  } else {
    args.push('-map', '[vout]', '-an');
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  if (audioLabels.length > 0) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }
  args.push('-movflags', '+faststart', plan.outputPath);
  return args;
}

export interface FfmpegRunResult {
  code: number;
  output: string;
}

export function runFfmpeg(
  executable: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
): Promise<FfmpegRunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: options?.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = options?.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(
            new CanvasCutError(ERROR_CODES.RENDER_FAILED, `FFmpeg timed out after ${options.timeoutMs}ms`, {
              retryable: true
            })
          );
        }, options.timeoutMs)
      : undefined;
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(
        new CanvasCutError(ERROR_CODES.RENDER_FAILED, `Failed to start FFmpeg: ${error.message}`)
      );
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const output = `${stdout}\n${stderr}`;
      if (code !== 0) {
        reject(
          new CanvasCutError(ERROR_CODES.RENDER_FAILED, `FFmpeg exited with code ${code}: ${stderr.slice(-2000)}`)
        );
      } else {
        resolvePromise({ code: code ?? 0, output });
      }
    });
  });
}

export async function ensureOutputDir(outputPath: string): Promise<void> {
  await fs.mkdir(dirname(outputPath), { recursive: true });
}
