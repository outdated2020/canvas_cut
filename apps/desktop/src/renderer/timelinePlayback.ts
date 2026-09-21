import type { CanvasClip, MediaClip, TimelineFile } from '@canvas-cut/core';

export function sourceTimeMs(clip: MediaClip | CanvasClip, timelineMs: number): number {
  return (clip.inMs ?? 0) + Math.max(0, timelineMs - clip.startMs) * (clip.speed ?? 1);
}

export function activeTimelineClips(timeline: TimelineFile | null, timeMs: number) {
  return (timeline?.tracks ?? []).flatMap((track) => track.clips)
    .filter((clip) => timeMs >= clip.startMs && timeMs < clip.startMs + clip.durationMs);
}
