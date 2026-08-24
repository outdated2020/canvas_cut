export type PortType = 'text' | 'image' | 'video';

export type NodeType =
  | 'text-input'
  | 'image-input'
  | 'video-input'
  | 'canvas-reference'
  | 'text-to-image'
  | 'text-to-video'
  | 'image-to-image'
  | 'image-to-video'
  | 'video-to-video'
  | 'output';

export type NodeStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface NodePort {
  id: string;
  type: PortType;
}

export interface AssetRef {
  id: string;
  path: string;
  type: 'image' | 'video' | 'audio';
  width?: number;
  height?: number;
  durationMs?: number;
  sizeBytes: number;
}

export interface CanvasNode {
  id: string;
  type: NodeType;
  params: Record<string, unknown>;
  inputs: NodePort[];
  outputs: NodePort[];
  status: NodeStatus;
  cachedResult?: AssetRef;
}

export interface CanvasEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface CanvasGraph {
  schemaVersion: 1;
  id: string;
  version: number;
  graphHash: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export type GenerationType =
  | 'text-to-image'
  | 'text-to-video'
  | 'image-to-image'
  | 'image-to-video'
  | 'video-to-video';

export type GenerationStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface GenerationError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface GenerationJob {
  jobId: string;
  providerId: string;
  type: GenerationType;
  status: GenerationStatus;
  progress?: number;
  result?: AssetRef;
  error?: GenerationError;
  extra?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderCapabilities {
  textToImage: boolean;
  textToVideo: boolean;
  imageToImage: boolean;
  imageToVideo: boolean;
  videoToVideo: boolean;
}

export interface TextToImageRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  style?: string;
  extra?: Record<string, unknown>;
}

export interface TextToVideoRequest {
  prompt: string;
  negativePrompt?: string;
  durationMs?: number;
  fps?: number;
  width?: number;
  height?: number;
  seed?: number;
  motionStrength?: number;
  extra?: Record<string, unknown>;
}

export interface ImageToImageRequest {
  image: AssetRef;
  prompt: string;
  negativePrompt?: string;
  strength?: number;
  width?: number;
  height?: number;
  seed?: number;
  extra?: Record<string, unknown>;
}

export interface ImageToVideoRequest {
  image: AssetRef;
  prompt: string;
  negativePrompt?: string;
  durationMs: number;
  fps?: number;
  width?: number;
  height?: number;
  seed?: number;
  motionStrength?: number;
  extra?: Record<string, unknown>;
}

export interface VideoToVideoRequest {
  video: AssetRef;
  prompt: string;
  mode: 'edit' | 'extend';
  durationMs?: number;
  fps?: number;
  width?: number;
  height?: number;
  seed?: number;
  motionStrength?: number;
  extra?: Record<string, unknown>;
}

export interface GenerationProvider {
  id: string;
  capabilities: ProviderCapabilities;
  textToImage(req: TextToImageRequest): Promise<GenerationJob>;
  textToVideo(req: TextToVideoRequest): Promise<GenerationJob>;
  imageToImage(req: ImageToImageRequest): Promise<GenerationJob>;
  imageToVideo(req: ImageToVideoRequest): Promise<GenerationJob>;
  videoToVideo(req: VideoToVideoRequest): Promise<GenerationJob>;
  getJob(jobId: string, type?: GenerationType): Promise<GenerationJob>;
  cancelJob(jobId: string): Promise<void>;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  previewResolution: string;
}

export interface ProjectFile {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
}

export type ImageResolutionTier = '1K' | '1.5K' | '2K';

export interface VolcengineConfig {
  baseUrl: string;
  imageModel: string;
  videoModel: string;
  imageResolution?: ImageResolutionTier;
  imageWatermark?: boolean;
  timeoutMs?: number;
}

export interface TosConfig {
  endpoint: string;
  region: string;
  bucket: string;
  urlTtlSeconds: number;
}

export interface ProjectConfigFile {
  schemaVersion: 1;
  provider: {
    default: string;
    volcengine: VolcengineConfig;
  };
  tos: TosConfig;
  concurrency: {
    maxGenerationJobs: number;
  };
  ffmpeg?: {
    path?: string;
  };
}

export interface ProjectSummary {
  projectId: string;
  path: string;
  canvasCount: number;
  timelineDurationMs: number;
  runningJobs: number;
}

export type TrackType = 'video' | 'audio' | 'subtitle' | 'image';

export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface MediaClip {
  id: string;
  kind: 'media';
  asset: AssetRef;
  startMs: number;
  durationMs: number;
  inMs: number;
  outMs: number;
  transform?: Transform;
  opacity: number;
  blendMode?: string;
  speed?: number;
  volume?: number;
  transition?: {
    type: 'crossfade';
    durationMs: number;
  };
}

export interface CanvasClip {
  id: string;
  kind: 'canvas';
  canvasId: string;
  canvasVersion: number;
  canvasGraphHash: string;
  startMs: number;
  durationMs: number;
  renderedAsset?: AssetRef;
  status: 'fresh' | 'stale' | 'rendering' | 'failed';
  transform?: Transform;
  opacity: number;
  speed?: number;
  volume?: number;
  transition?: {
    type: 'crossfade';
    durationMs: number;
  };
}

export interface SubtitleClip {
  id: string;
  kind: 'subtitle';
  text: string;
  startMs: number;
  durationMs: number;
}

export type Clip = MediaClip | CanvasClip | SubtitleClip;

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  clips: Clip[];
}

export interface TimelineFile {
  schemaVersion: 1;
  id: string;
  tracks: Track[];
}

export interface CanvasPresetNode {
  id: string;
  type: NodeType;
  params: Record<string, unknown>;
}

export interface CanvasPresetInputSlot {
  id: string;
  name: string;
  type: PortType;
  required: boolean;
  description?: string;
}

export interface CanvasPreset {
  schemaVersion: 1;
  id: string;
  name: string;
  version: number;
  graph: {
    nodes: CanvasPresetNode[];
    edges: CanvasEdge[];
  };
  inputs: CanvasPresetInputSlot[];
}

export interface JobRecord {
  id: string;
  parent_id?: string | null;
  type: string;
  status: GenerationStatus | string;
  progress?: number | null;
  provider_task_id?: string | null;
  request_snapshot?: string | null;
  canvas_id?: string | null;
  node_id?: string | null;
  result?: string | null;
  error?: string | null;
  created_at: number;
  updated_at: number;
}

export interface CanvasRenderPlan {
  canvasId: string;
  graphHash: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  topologicalOrder: string[];
  childJobs: NodeRenderStep[];
}

export interface NodeRenderStep {
  nodeId: string;
  type: NodeType;
  cacheKey: string;
  cacheHit: boolean;
  providerJobType: GenerationType | null;
}

export interface RenderSegment {
  id: string;
  startMs: number;
  endMs: number;
  activeVideo: Array<MediaClip | CanvasClip>;
  activeAudio: MediaClip[];
  activeSubtitles: SubtitleClip[];
}

export interface RenderPlan {
  projectPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  segments: RenderSegment[];
  tracks: Track[];
}
