import { Icon } from './icons';
import { TimelinePreview } from './TimelinePreview';
import type { TimelineFile } from '@canvas-cut/core';

type AnyRecord = Record<string, any>;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTime(ms: number, fps: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frameMs = 1000 / fps;
  const frames = Math.floor((ms % 1000) / frameMs);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

const SPEEDS = [0.5, 1, 1.5, 2];

interface PlayerProps {
  timelineMode: boolean;
  timeline: TimelineFile | null;
  width: number;
  height: number;
  previewAsset: AnyRecord | null;
  playing: boolean;
  playheadMs: number;
  speed: number;
  looping: boolean;
  duration: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onToggle: () => void;
  onGoToStart: () => void;
  onGoToEnd: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSetSpeed: (factor: number) => void;
  onToggleLoop: () => void;
  fps: number;
  fileUrl: (path: string) => string;
}

export function Player({
  timelineMode, timeline, width, height,
  previewAsset,
  playing,
  playheadMs,
  speed,
  looping,
  duration,
  videoRef,
  audioRef,
  onToggle,
  onGoToStart,
  onGoToEnd,
  onStepBack,
  onStepForward,
  onSetSpeed,
  onToggleLoop,
  fileUrl,
  fps
}: PlayerProps) {
  return (
    <section className="viewer-panel">
      <div className="viewer-label">
        Viewer
        {previewAsset?.name && <span className="viewer-title">{previewAsset.name}</span>}
      </div>
      <div className="viewer-body">
        {timelineMode ? <TimelinePreview timeline={timeline} timeMs={playheadMs} playing={playing} speed={speed} width={width} height={height} fileUrl={fileUrl} /> : previewAsset?.path ? (
          <div className="viewer-stage">
            {/\.(png|jpe?g|webp|gif|bmp)$/i.test(previewAsset.path) ? (
              <img
                key={previewAsset.path}
                className="viewer-media"
                src={fileUrl(previewAsset.path)}
                alt="preview"
              />
            ) : /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(previewAsset.path) ? (
              <video
                key={previewAsset.path}
                ref={videoRef as React.Ref<HTMLVideoElement>}
                className="viewer-media"
                src={fileUrl(previewAsset.path)}
                controls
                playsInline
              />
            ) : /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(previewAsset.path) ? (
              <div className="viewer-audio-wrap" key={previewAsset.path}>
                <Icon name="audio" size={64} />
                <div className="viewer-audio-name">{previewAsset.name}</div>
                <div className={`viewer-audio-bars${playing ? ' active' : ''}`}>
                  <span className="audio-bar" style={{ animationDelay: '0s' }} />
                  <span className="audio-bar" style={{ animationDelay: '0.1s' }} />
                  <span className="audio-bar" style={{ animationDelay: '0.2s' }} />
                  <span className="audio-bar" style={{ animationDelay: '0.15s' }} />
                  <span className="audio-bar" style={{ animationDelay: '0.05s' }} />
                </div>
                <audio
                  ref={audioRef as React.Ref<HTMLAudioElement>}
                  className="viewer-audio"
                  src={fileUrl(previewAsset.path)}
                  controls
                />
              </div>
            ) : (
              <div className="viewer-file">
                <Icon name="file" size={40} />
                <div>{previewAsset.name}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="viewer-drop">
            <Icon name="play" size={42} />
            <span className="viewer-drop-title">No media</span>
            <span className="viewer-drop-sub">Add clips to timeline or select an asset to preview</span>
          </div>
        )}
      </div>

      <div className="player-controls">
        <div className="player-controls-left">
          <button className="ibtn" title="Go to start" onClick={onGoToStart}>
            <Icon name="skipBack" size={14} />
          </button>
          <button className="ibtn" title="Step back" onClick={onStepBack}>
            <Icon name="stepBack" size={14} />
          </button>
          <button className={`ibtn ${playing ? 'active' : ''}`} title="Play / pause" onClick={onToggle}>
            <Icon name={playing ? 'pause' : 'play'} size={14} />
          </button>
          <button className="ibtn" title="Step forward" onClick={onStepForward}>
            <Icon name="stepFwd" size={14} />
          </button>
          <button className="ibtn" title="Go to end" onClick={onGoToEnd}>
            <Icon name="skipFwd" size={14} />
          </button>
        </div>

        <span className="player-time">
          {formatTime(playheadMs, fps)} / {formatTime(duration, fps)}
        </span>

        <div className="player-controls-right">
          <button
            className={`ibtn ${looping ? 'active' : ''}`}
            title="Loop"
            onClick={onToggleLoop}
          >
            <Icon name="loop" size={14} />
          </button>
          <div className="player-speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={`speed-btn ${speed === s ? 'active' : ''}`}
                onClick={() => onSetSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
