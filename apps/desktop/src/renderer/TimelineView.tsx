import { useRef, useState, type PointerEvent } from 'react';
import { Icon } from './icons';

type AnyRecord = Record<string, any>;

interface TimelineViewProps {
  timeline: AnyRecord | null;
  onMoveClip: (clipId: string, startMs: number) => void;
  zoom?: number;
  playheadMs?: number;
  onSeek?: (ms: number) => void;
}

const TOTAL_MS = 3_600_000;
const RULER_STEPS = 6;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
}

function timelineDuration(timeline: AnyRecord): number {
  return (timeline.tracks ?? []).reduce((max: number, track: AnyRecord) => {
    return (track.clips ?? []).reduce(
      (trackMax: number, clip: AnyRecord) => Math.max(trackMax, clip.startMs + clip.durationMs),
      max
    );
  }, 0);
}

function clipLabel(clip: AnyRecord): string {
  if (clip.kind === 'subtitle') return clip.text;
  if (clip.kind === 'canvas') return 'Canvas';
  return clip.asset?.type ?? 'Clip';
}

function trackBadge(track: AnyRecord): { label: string; kind: string } {
  if (track.type === 'audio') return { label: 'A', kind: 'audio' };
  if (track.type === 'subtitle') return { label: 'S', kind: 'subtitle' };
  return { label: 'V', kind: 'video' };
}

export function TimelineView({
  timeline,
  onMoveClip,
  zoom = 50,
  playheadMs = 0,
  onSeek
}: TimelineViewProps) {
  const tracks: AnyRecord[] =
    (timeline?.tracks?.length ?? 0) > 0
      ? timeline!.tracks
      : [{ id: 'v1', name: 'Video 1', type: 'video', clips: [] }];
  const visibleMs = Math.max(30_000, TOTAL_MS * (0.2 + zoom / 100));
  const totalMs = Math.max(timeline ? timelineDuration(timeline) : 0, visibleMs);
  const [dragClipId, setDragClipId] = useState<string | null>(null);
  const [dragStartMs, setDragStartMs] = useState(0);
  const dragOriginX = useRef(0);
  const dragLaneWidth = useRef(1);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>, clip: AnyRecord, lane: HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    setDragClipId(clip.id);
    setDragStartMs(clip.startMs);
    dragOriginX.current = event.clientX;
    dragLaneWidth.current = Math.max(lane.getBoundingClientRect().width, 1);
    (event.target as HTMLDivElement).setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>, clip: AnyRecord) {
    if (dragClipId !== clip.id) return;
    const deltaMs = ((event.clientX - dragOriginX.current) / dragLaneWidth.current) * totalMs;
    setDragStartMs(Math.max(0, Math.round(clip.startMs + deltaMs)));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>, clip: AnyRecord) {
    if (dragClipId !== clip.id) return;
    onMoveClip(clip.id, Math.max(0, Math.round(dragStartMs)));
    setDragClipId(null);
  }

  function seekFromEvent(event: PointerEvent<HTMLDivElement>) {
    const lane = event.currentTarget;
    const rect = lane.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
    onSeek?.(Math.round(ratio * totalMs));
  }

  return (
    <div className="timeline-body">
      <div className="timeline-ruler">
        {Array.from({ length: RULER_STEPS + 1 }).map((_, index) => (
          <div
            key={index}
            className="ruler-step"
            style={{ left: `${(index / RULER_STEPS) * 100}%` }}
          >
            <span>{formatTime((index / RULER_STEPS) * totalMs)}</span>
            <i />
          </div>
        ))}
      </div>
      <div className="timeline-tracks">
        {tracks.map((track: AnyRecord) => {
          const badge = trackBadge(track);
          return (
            <div className="track-row" key={track.id}>
              <div className="track-head">
                <span className={`track-badge tb-${badge.kind}`}>{badge.label}</span>
                <span className="track-name">{track.name}</span>
                <span className="track-tools">
                  <Icon name="eye" size={13} />
                  <Icon name="lock" size={13} />
                  <Icon name="target" size={13} />
                </span>
              </div>
              <div className="track-lane" onPointerDown={seekFromEvent}>
                {(track.clips ?? []).map((clip: AnyRecord) => {
                  const start = dragClipId === clip.id ? dragStartMs : clip.startMs;
                  return (
                    <div
                      key={clip.id}
                      className={`timeline-clip timeline-clip-${clip.kind}`}
                      style={{
                        left: `${(start / totalMs) * 100}%`,
                        width: `${Math.max((clip.durationMs / totalMs) * 100, 1)}%`
                      }}
                      onPointerDown={(event) => handlePointerDown(event, clip, event.currentTarget.parentElement as HTMLElement)}
                      onPointerMove={(event) => handlePointerMove(event, clip)}
                      onPointerUp={(event) => handlePointerUp(event, clip)}
                    >
                      {clipLabel(clip)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="playhead" style={{ left: `calc(150px + ${(playheadMs / totalMs) * 100}%)` }} />
      </div>
    </div>
  );
}
