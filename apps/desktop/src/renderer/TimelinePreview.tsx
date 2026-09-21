import { useEffect, useRef } from 'react';
import type { CanvasClip, MediaClip, TimelineFile } from '@canvas-cut/core';
import { activeTimelineClips, sourceTimeMs } from './timelinePlayback';

interface Props {
  timeline: TimelineFile | null;
  timeMs: number;
  playing: boolean;
  speed: number;
  width: number;
  height: number;
  fileUrl: (path: string) => string;
}

function ClipMedia({ clip, ...props }: Props & { clip: MediaClip | CanvasClip }) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const asset = clip.kind === 'media' ? clip.asset : clip.renderedAsset;
  const sourceTime = sourceTimeMs(clip, props.timeMs) / 1000;
  const rate = props.speed * (clip.speed ?? 1);
  const fadeMs = Math.min(clip.transition?.durationMs ?? 0, clip.durationMs / 2);
  const elapsed = props.timeMs - clip.startMs;
  const fade = fadeMs > 0 ? Math.max(0, Math.min(1, elapsed / fadeMs, (clip.durationMs - elapsed) / fadeMs)) : 1;
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const sync = () => {
      if (Math.abs(media.currentTime - sourceTime) > 0.08) media.currentTime = sourceTime;
      media.playbackRate = Math.min(16, Math.max(0.0625, rate));
      media.volume = Math.min(1, Math.max(0, (clip.volume ?? 1) * fade));
      if (props.playing) void media.play().catch(() => undefined);
      else media.pause();
    };
    sync();
    media.addEventListener('loadedmetadata', sync);
    return () => media.removeEventListener('loadedmetadata', sync);
  }, [sourceTime, rate, props.playing, asset?.path, clip.volume, fade]);
  if (!asset) return null;
  if (asset.type === 'audio') return <audio ref={(el) => { ref.current = el; }} src={props.fileUrl(asset.path)} />;
  const transform = clip.transform;
  const style: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
    opacity: (clip.opacity ?? 1) * fade,
    transform: `translate(${(transform?.x ?? 0) / props.width * 100}%, ${(transform?.y ?? 0) / props.height * 100}%) rotate(${transform?.rotation ?? 0}deg) scale(${transform?.scale ?? 1})`
  };
  return asset.type === 'image'
    ? <img src={props.fileUrl(asset.path)} style={style} alt="" />
    : <video ref={(el) => { ref.current = el; }} src={props.fileUrl(asset.path)} style={style} playsInline />;
}

export function TimelinePreview(props: Props) {
  const clips = activeTimelineClips(props.timeline, props.timeMs);
  return <div style={{ position: 'relative', width: '100%', aspectRatio: `${props.width}/${props.height}`, maxHeight: '100%', overflow: 'hidden', background: '#000' }}>
    {clips.filter((clip) => clip.kind !== 'subtitle').map((clip) => <ClipMedia key={clip.id} clip={clip as MediaClip | CanvasClip} {...props} />)}
    {clips.filter((clip) => clip.kind === 'subtitle').map((clip) => <div key={clip.id} style={{ position: 'absolute', bottom: '7.4%', width: '100%', textAlign: 'center', color: 'white', fontSize: 'clamp(12px, 2vw, 28px)', whiteSpace: 'pre-wrap' }}><span style={{ background: '#0008' }}>{clip.text}</span></div>)}
  </div>;
}
