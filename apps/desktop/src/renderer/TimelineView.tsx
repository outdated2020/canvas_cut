import { useEffect, useRef, useState, type PointerEvent } from 'react';

type AnyRecord = Record<string, any>;

interface TimelineViewProps {
  timeline: AnyRecord | null;
  onMoveClip: (clipId: string, startMs: number) => void;
  onRemoveClip?: (clipId: string) => void;
  onSplitClip?: (clipId: string, atMs: number) => void;
  onTrimClip?: (clipId: string, inMs: number, outMs: number, startMs?: number) => void;
  onRemoveTrack?: (trackId: string) => void;
  onDropAsset?: (asset: AnyRecord, trackId: string, startMs: number) => void;
  draggingAsset?: AnyRecord | null;
  dragPos?: { x: number; y: number } | null;
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string | null) => void;
  zoom?: number;
  playheadMs?: number;
  onSeek?: (ms: number) => void;
  razorMode?: boolean;
  fps?: number;
}

const TOTAL_MS = 3_600_000;
const RULER_STEPS = 6;
const RESIZE_HANDLE_WIDTH = 8;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTime(ms: number, fps: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const frameMs = 1000 / fps;
  const frames = Math.floor((ms % 1000) / frameMs);
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}:${pad(frames)}`;
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

type DragMode = 'move' | 'resize-left' | 'resize-right';

export function TimelineView({
  timeline,
  onMoveClip,
  onRemoveClip,
  onSplitClip,
  onTrimClip,
  onRemoveTrack,
  onDropAsset,
  draggingAsset = null,
  dragPos = null,
  selectedClipId = null,
  onSelectClip,
  zoom = 50,
  playheadMs = 0,
  onSeek,
  razorMode = false,
  fps = 30
}: TimelineViewProps) {
  const tracks: AnyRecord[] =
    (timeline?.tracks?.length ?? 0) > 0
      ? timeline!.tracks
      : [{ id: 'v1', name: 'Video 1', type: 'video', clips: [] }];
  const visibleMs = Math.max(30_000, TOTAL_MS * (0.05 + zoom / 100));
  const totalMs = Math.max(timeline ? timelineDuration(timeline) : 0, visibleMs);

  const [dragClipId, setDragClipId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>('move');
  const [dragStartMs, setDragStartMs] = useState(0);
  const [dragDurationMs, setDragDurationMs] = useState(0);
  const [dragInMs, setDragInMs] = useState(0);
  const dragOriginX = useRef(0);
  const dragLaneWidth = useRef(1);
  const dragOrigStart = useRef(0);
  const dragOrigDuration = useRef(0);
  const dragOrigInMs = useRef(0);

  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  const [dragOverMs, setDragOverMs] = useState(0);
  const tracksRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Compute which track the pointer is over during external asset drag
  useEffect(() => {
    if (!draggingAsset || !dragPos) {
      setDragOverTrackId(null);
      return;
    }
    let found = false;
    tracksRef.current.forEach((lane, trackId) => {
      const rect = lane.getBoundingClientRect();
      if (dragPos.y >= rect.top && dragPos.y <= rect.bottom &&
          dragPos.x >= rect.left && dragPos.x <= rect.right) {
        const ratio = Math.max(0, Math.min(1, (dragPos.x - rect.left) / Math.max(rect.width, 1)));
        const ms = Math.round(ratio * totalMs);
        setDragOverTrackId(trackId);
        setDragOverMs(ms);
        found = true;
      }
    });
    if (!found) {
      setDragOverTrackId(null);
    }
  }, [draggingAsset, dragPos, totalMs]);

  useEffect(() => {
    if (!onRemoveClip) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        onRemoveClip!(selectedClipId);
      }
    }
    window.addEventListener('keydown', handleKeyDown);

  return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, onRemoveClip]);

  function startDrag(event: PointerEvent<HTMLDivElement>, clip: AnyRecord, lane: HTMLElement, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    setDragClipId(clip.id);
    setDragMode(mode);
    setDragStartMs(clip.startMs);
    setDragDurationMs(clip.durationMs);
    setDragInMs(clip.inMs ?? 0);
    dragOriginX.current = event.clientX;
    dragLaneWidth.current = Math.max(lane.getBoundingClientRect().width, 1);
    dragOrigStart.current = clip.startMs;
    dragOrigDuration.current = clip.durationMs;
    dragOrigInMs.current = clip.inMs ?? 0;
    (event.target as HTMLDivElement).setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>, clip: AnyRecord) {
    if (dragClipId !== clip.id) return;
    const deltaMs = ((event.clientX - dragOriginX.current) / dragLaneWidth.current) * totalMs;

    if (dragMode === 'move') {
      setDragStartMs(Math.max(0, Math.round(dragOrigStart.current + deltaMs)));
    } else if (dragMode === 'resize-left') {
      const newStart = Math.max(0, dragOrigStart.current - dragOrigInMs.current / (clip.speed ?? 1), Math.round(dragOrigStart.current + deltaMs));
      const newDuration = dragOrigDuration.current + (dragOrigStart.current - newStart);
      if (newDuration > 100) {
        setDragStartMs(newStart);
        setDragDurationMs(newDuration);
      }
    } else if (dragMode === 'resize-right') {
      const newDuration = Math.max(100, Math.round(dragOrigDuration.current + deltaMs));
      setDragDurationMs(newDuration);
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>, clip: AnyRecord) {
    if (dragClipId !== clip.id) return;
    const msToPx = dragLaneWidth.current / totalMs;

    if (dragMode === 'move') {
      onMoveClip(clip.id, Math.max(0, Math.round(dragStartMs)));
    } else if (dragMode === 'resize-left') {
      const deltaStart = dragStartMs - dragOrigStart.current;
      const newInMs = Math.max(0, dragOrigInMs.current + Math.round(deltaStart * (clip.speed ?? 1)));
      const newOutMs = newInMs + Math.round(dragDurationMs * (clip.speed ?? 1));
      if (onTrimClip) {
        onTrimClip(clip.id, newInMs, newOutMs, dragStartMs);
      } else {
        onMoveClip(clip.id, dragStartMs);
      }
    } else if (dragMode === 'resize-right') {
      const newOutMs = (clip.inMs ?? 0) + Math.round(dragDurationMs * (clip.speed ?? 1));
      if (onTrimClip) {
        onTrimClip(clip.id, clip.inMs ?? 0, newOutMs);
      }
    }

    setDragClipId(null);
    setDragMode('move');
  }

  function handleClipClick(event: React.MouseEvent, clip: AnyRecord) {
    event.stopPropagation();
    if (razorMode && onSplitClip) {
      const clipStartMs = dragClipId === clip.id ? dragStartMs : clip.startMs;
      const splitAt = clipStartMs + (playheadMs > clipStartMs ? Math.min(playheadMs - clipStartMs, clip.durationMs) : clip.durationMs / 2);
      onSplitClip(clip.id, Math.round(splitAt));
    } else {
      onSelectClip?.(clip.id);
    }
  }

  function handleLanePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onSelectClip?.(null);
      seekFromEvent(event);
    }
  }

  function handleRulerPointerDown(event: PointerEvent<HTMLDivElement>) {
    const ruler = event.currentTarget;
    const rect = ruler.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
    onSeek?.(Math.round(ratio * totalMs));
  }

  function seekFromEvent(event: PointerEvent<HTMLDivElement>) {
    const lane = event.currentTarget;
    const rect = lane.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
    onSeek?.(Math.round(ratio * totalMs));
  }

  return (
    <div className="timeline-body">
      <div className="timeline-ruler" onPointerDown={handleRulerPointerDown}>
        {Array.from({ length: RULER_STEPS + 1 }).map((_, index) => (
          <div
            key={index}
            className="ruler-step"
            style={{ left: `${(index / RULER_STEPS) * 100}%` }}
          >
            <span>{formatTime((index / RULER_STEPS) * totalMs, fps)}</span>
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
                  {onRemoveTrack && (
                    <button
                      className="track-delete-btn"
                      title="Delete track"
                      onClick={() => onRemoveTrack(track.id)}
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
              <div
                ref={(el) => { if (el) tracksRef.current.set(track.id, el); else tracksRef.current.delete(track.id); }}
                data-track-id={track.id}
                className={`track-lane${dragOverTrackId === track.id ? ' drag-over' : ''}`}
                onPointerDown={handleLanePointerDown}
              >
                {dragOverTrackId === track.id && (
                  <div
                    className="drop-indicator"
                    style={{ left: `${(dragOverMs / totalMs) * 100}%` }}
                  />
                )}
                {(track.clips ?? []).map((clip: AnyRecord) => {
                  const isActive = dragClipId === clip.id;
                  const start = isActive ? dragStartMs : clip.startMs;
                  const duration = isActive ? dragDurationMs : clip.durationMs;
                  const isSelected = selectedClipId === clip.id;
                  const canvasStatus = clip.kind === 'canvas' ? (clip.status ?? 'stale') : '';

  return (
                    <div
                      key={clip.id}
                      className={`timeline-clip timeline-clip-${clip.kind}${isSelected ? ' selected' : ''}${razorMode ? ' razor-mode' : ''}${canvasStatus ? ` canvas-${canvasStatus}` : ''}`}
                      style={{
                        left: `${(start / totalMs) * 100}%`,
                        width: `${Math.max((duration / totalMs) * 100, 1)}%`
                      }}
                      onPointerDown={(event) => startDrag(event, clip, event.currentTarget.parentElement as HTMLElement, 'move')}
                      onPointerMove={(event) => handlePointerMove(event, clip)}
                      onPointerUp={(event) => handlePointerUp(event, clip)}
                      onClick={(event) => handleClipClick(event, clip)}
                    >
                      <span className="clip-label">{clipLabel(clip)}</span>
                      {!razorMode && (
                        <>
                          <div
                            className="resize-handle resize-left"
                            onPointerDown={(event) => startDrag(event, clip, event.currentTarget.parentElement?.parentElement as HTMLElement, 'resize-left')}
                          />
                          <div
                            className="resize-handle resize-right"
                            onPointerDown={(event) => startDrag(event, clip, event.currentTarget.parentElement?.parentElement as HTMLElement, 'resize-right')}
                          />
                        </>
                      )}
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
