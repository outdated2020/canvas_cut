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
  const order = new Map(plan.tracks.flatMap((track) => track.clips).map((clip, index) => [clip.id, index]));
  return [...map.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
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

export function buildFfmpegArgs(plan: RenderPlan, audioAssetPaths: ReadonlySet<string> = new Set()): string[] {
  const videoClips = uniqueVideoClips(plan);
  const audioClips = uniqueAudioClips(plan);
  const subtitles = subtitleClips(plan);
  const totalDuration = Math.max(...plan.segments.map((segment) => segment.endMs)) / 1000;

  if (videoClips.length === 0) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Cannot export a timeline without a video or image track');
  }

  const args: string[] = ['-y'];
  const filters: string[] = [];
  const inputs = new Map<string, number>();

  // Rebuild input order deterministically: all video clips first, then audio clips.
  for (const clip of videoClips) {
    if ((clip.kind === 'media' ? clip.asset : clip.renderedAsset)?.type === 'image') {
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
    const inSec = (clip.inMs ?? 0) / 1000;
    const sourceDuration = duration * speed;
    const label = `v${index}`;
    const hasTransition = clip.transition && clip.transition.type === 'crossfade';
    const transDuration = hasTransition ? clip.transition!.durationMs / 1000 : 0;
    const fadeOutStart = Math.max(0, duration - transDuration);
    let fadeFilter = '';
    if (hasTransition && transDuration > 0) {
      fadeFilter = `,fade=t=in:st=0:d=${transDuration}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${transDuration}:alpha=1`;
    }
    const scale = clip.transform?.scale ?? 1;
    const scaledW = Math.max(2, Math.round(w * scale / 2) * 2);
    const scaledH = Math.max(2, Math.round(h * scale / 2) * 2);
    const angle = (clip.transform?.rotation ?? 0) * Math.PI / 180;
    const isImage = (clip.kind === 'media' ? clip.asset : clip.renderedAsset)?.type === 'image';
    const timing = isImage ? `trim=duration=${duration},setpts=PTS-STARTPTS` : `trim=start=${inSec}:duration=${sourceDuration},setpts=(PTS-STARTPTS)/${speed}`;
    const filter = `[${input}:v]${timing},scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease,setsar=1,fps=${fps},format=rgba,rotate=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=none,colorchannelmixer=aa=${clip.opacity ?? 1}${fadeFilter},setpts=PTS+${start}/TB[${label}]`;
    filters.push(filter);
  });

  filters.push(`color=c=black:s=${plan.width}x${plan.height}:r=${plan.fps}:d=${totalDuration}[base]`);
  let currentVideoLabel = 'base';
  for (let index = 0; index < videoClips.length; index += 1) {
    const nextLabel = `vo${index}`;
    const clip = videoClips[index]!;
    const x = clip.transform?.x ?? 0;
    const y = clip.transform?.y ?? 0;
    filters.push(
      `[${currentVideoLabel}][v${index}]overlay=x=(W-w)/2+${x}:y=(H-h)/2+${y}:eof_action=pass:repeatlast=0:enable='gte(t,${clip.startMs / 1000})*lt(t,${(clip.startMs + clip.durationMs) / 1000})'[${nextLabel}]`
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
  const allAudio: Array<MediaClip | CanvasClip> = [...audioClips, ...videoClips.filter((clip) => audioAssetPaths.has(clipAssetPath(clip)))];
  allAudio.forEach((clip, index) => {
    const input = inputs.get(clip.id);
    const label = `a${index}`;
    const inSec = (clip.inMs ?? 0) / 1000;
    const duration = clip.durationMs / 1000;
    const startMs = clip.startMs;
    const volume = clip.volume ?? 1;
    const speed = clip.speed ?? 1;
    const hasTransition = clip.transition && clip.transition.type === 'crossfade';
    const transDuration = hasTransition ? clip.transition!.durationMs / 1000 : 0;
    const fadeOutStart = Math.max(0, duration - transDuration);
    let afadeFilter = '';
    if (hasTransition && transDuration > 0) {
      afadeFilter = `,afade=t=in:st=0:d=${transDuration},afade=t=out:st=${fadeOutStart}:d=${transDuration}`;
    }
    filters.push(
      `[${input}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${inSec}:duration=${duration * speed},asetpts=PTS-STARTPTS,${tempoFilters(speed)},atrim=duration=${duration},volume=${volume}${afadeFilter},adelay=${startMs}|${startMs}[${label}]`
    );
    audioLabels.push(label);
  });

  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.map((label) => `[${label}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${totalDuration}[aout]`
    );
  }

  args.push('-filter_complex', filters.join(';'));
  if (audioLabels.length > 0) {
    args.push('-map', '[vout]', '-map', '[aout]');
  } else {
    args.push('-map', '[vout]', '-an');
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(plan.crf ?? 18), '-pix_fmt', 'yuv420p', '-t', String(totalDuration));
  if (audioLabels.length > 0) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }
  args.push('-movflags', '+faststart', plan.outputPath);
  return args;
}

function tempoFilters(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Invalid audio speed');
  const filters: string[] = [];
  while (speed < 0.5) { filters.push('atempo=0.5'); speed /= 0.5; }
  while (speed > 2) { filters.push('atempo=2'); speed /= 2; }
  filters.push(`atempo=${speed}`);
  return filters.join(',');
}

export interface FfmpegRunResult {
  code: number;
  output: string;
}

export function runFfmpeg(
  executable: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<FfmpegRunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: options?.cwd,
      windowsHide: true,
      signal: options?.signal,
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

export interface MediaProbeInfo {
  durationMs?: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

/**
 * Probe a media file using ffprobe to get duration, dimensions, and stream info.
 * If ffprobe is not available, returns empty info (all optional fields undefined).
 */
export async function probeMedia(filePath: string, ffprobePath?: string): Promise<MediaProbeInfo> {
  const exe = ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe';
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath
    ];
    const proc = spawn(exe, args, { windowsHide: true });
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ hasVideo: false, hasAudio: false });
    }, 10_000);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ hasVideo: false, hasAudio: false });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ hasVideo: false, hasAudio: false });
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const streams = data.streams ?? [];
        const format = data.format ?? {};
        const videoStream = streams.find((s: any) => s.codec_type === 'video');
        const audioStream = streams.find((s: any) => s.codec_type === 'audio');
        const durationSec = format.duration ? parseFloat(format.duration) : undefined;
        resolve({
          durationMs: durationSec ? Math.round(durationSec * 1000) : undefined,
          width: videoStream?.width ? Number(videoStream.width) : undefined,
          height: videoStream?.height ? Number(videoStream.height) : undefined,
          hasVideo: !!videoStream,
          hasAudio: !!audioStream
        });
      } catch {
        resolve({ hasVideo: false, hasAudio: false });
      }
    });
  });
}
