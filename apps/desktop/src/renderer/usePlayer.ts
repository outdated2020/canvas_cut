import { useEffect, useRef, useMemo, useState, useCallback } from 'react';

type AnyRecord = Record<string, any>;

interface UsePlayerOptions {
  timeline: AnyRecord | null;
  assets: AnyRecord[];
  canvas: AnyRecord | null;
  selectedAssetPath: string | null;
  fps?: number;
}

export function usePlayer({ timeline, assets, canvas, selectedAssetPath, fps = 30 }: UsePlayerOptions) {
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [looping, setLooping] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [timelineMode, setTimelineMode] = useState(false);
  useEffect(() => { setTimelineMode(false); setPlaying(false); }, [selectedAssetPath]);

  // Refs for latest values used in rAF callback (avoids stale closures)
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const loopingRef = useRef(looping);
  loopingRef.current = looping;
  const durationRef = useRef(0);

  const duration = useMemo(() => {
    if (!timeline) return 0;
    return (timeline.tracks ?? []).reduce((max: number, track: AnyRecord) => {
      return (track.clips ?? []).reduce(
        (trackMax: number, clip: AnyRecord) => Math.max(trackMax, clip.startMs + clip.durationMs),
        max
      );
    }, 0);
  }, [timeline]);
  durationRef.current = duration;

  const activeClip = useMemo(() => {
    if (!timelineMode) return null;
    let active: AnyRecord | null = null;
    for (const track of timeline?.tracks ?? []) {
      if (track.type !== 'video' && track.type !== 'image') continue;
      for (const clip of track.clips ?? []) {
        if (playheadMs >= clip.startMs && playheadMs < clip.startMs + clip.durationMs) active = clip;
      }
    }
    return active;
  }, [timelineMode, timeline, playheadMs]);

  const previewAsset = useMemo(() => {
    if (timelineMode) return activeClip?.kind === 'canvas' ? activeClip.renderedAsset ?? null : activeClip?.asset ?? null;
    const selected = assets.find((a: AnyRecord) => a.path === selectedAssetPath);
    if (selected) return selected;
    const outputNode = canvas?.nodes?.find(
      (n: AnyRecord) => n.type === 'output' && n.status === 'succeeded'
    );
    if (outputNode?.cachedResult) return outputNode.cachedResult;
    return null;
  }, [timelineMode, activeClip, assets, selectedAssetPath, canvas]);

  // rAF playback loop
  useEffect(() => {
    if (!playing) return;
    let rafId: number;
    let lastTs = performance.now();
    const tick = (ts: number) => {
      const elapsed = ts - lastTs;
      lastTs = ts;
      const s = speedRef.current;
      const dur = durationRef.current;
      setPlayheadMs((current) => {
        const next = current + elapsed * s;
        if (dur > 0 && next >= dur) {
          if (loopingRef.current) {
            return 0;
          }
          setPlaying(false);
          return dur;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing]);

  // Sync video play/pause and playbackRate
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.playbackRate = speed * (activeClip?.speed ?? 1);
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [playing, previewAsset?.path, speed, activeClip?.speed]);

  // Sync audio play/pause
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  }, [playing, previewAsset?.path]);

  // Slave video currentTime to playhead during playback (throttled by 50ms threshold)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !timelineMode) return;
    const targetTime = ((activeClip?.inMs ?? 0) + Math.max(0, playheadMs - (activeClip?.startMs ?? 0)) * (activeClip?.speed ?? 1)) / 1000;
    if (Math.abs(v.currentTime - targetTime) > 0.05) {
      v.currentTime = targetTime;
    }
  });

  // Reverse sync: when user scrubs video controls, update playhead
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const handler = () => {
      if (!playing && !timelineMode && v.currentTime !== undefined) {
        setPlayheadMs(Math.round(v.currentTime * 1000));
      }
    };
    v.addEventListener('timeupdate', handler);
    return () => v.removeEventListener('timeupdate', handler);
  }, [playing, timelineMode, previewAsset?.path]);

  // Control functions
  const toggle = useCallback(() => { setTimelineMode(true); setPlaying((p) => !p); }, []);
  const play = useCallback(() => { setTimelineMode(true); setPlaying(true); }, []);
  const pause = useCallback(() => setPlaying(false), []);

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(ms, durationRef.current));
    setPlayheadMs(clamped);
    setTimelineMode(true);
  }, []);

  const goToStart = useCallback(() => seek(0), [seek]);
  const goToEnd = useCallback(() => seek(durationRef.current), [seek]);

  const stepForward = useCallback(() => {
    setTimelineMode(true);
    setPlayheadMs((p) => {
      const next = Math.min(p + 1000 / fps, durationRef.current);
      return next;
    });
  }, [fps]);

  const stepBack = useCallback(() => {
    setTimelineMode(true);
    setPlayheadMs((p) => {
      const next = Math.max(0, p - 1000 / fps);
      return next;
    });
  }, [fps]);

  const setSpeed = useCallback((factor: number) => {
    setSpeedState(factor);
  }, []);

  const toggleLoop = useCallback(() => setLooping((l) => !l), []);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepForward();
          break;
        case 'Home':
          e.preventDefault();
          goToStart();
          break;
        case 'End':
          e.preventDefault();
          goToEnd();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          toggleLoop();
          break;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, stepBack, stepForward, goToStart, goToEnd, toggleLoop]);

  return {
    playing,
    playheadMs,
    speed,
    looping,
    duration,
    previewAsset,
    timelineMode,
    videoRef,
    audioRef,
    play,
    pause,
    toggle,
    seek,
    stepForward,
    stepBack,
    goToStart,
    goToEnd,
    setSpeed,
    toggleLoop,
  };
}
