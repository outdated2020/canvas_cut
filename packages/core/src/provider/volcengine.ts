import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  AssetRef,
  GenerationJob,
  GenerationProvider,
  GenerationStatus,
  ImageToImageRequest,
  ImageToVideoRequest,
  ImageResolutionTier,
  ProviderCapabilities,
  TextToImageRequest,
  TextToVideoRequest,
  VideoToVideoRequest
} from '../types';
import { CanvasCutError, ERROR_CODES } from '../errors';
import { logger } from '../logger';
import { AssetDownloader } from './types';
import type { VolcengineConfig } from '../types';

interface ArkLayerData {
  url?: string;
  b64_json?: string;
  size?: string;
  output_format?: string;
  z_index?: number;
  bounding_box?: {
    absolute?: [number, number, number, number];
    normalized?: [number, number, number, number];
  };
  name?: string;
  description?: string;
}

interface ArkImageResponse {
  data?: Array<ArkLayerData>;
  error?: {
    code?: string;
    message?: string;
  };
}

interface ArkTaskResponse {
  id: string;
  status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  content?: {
    video_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

function mapStatus(status?: ArkTaskResponse['status']): GenerationStatus {
  switch (status) {
    case 'queued':
      return 'pending';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'expired':
      return 'failed';
    default:
      return 'pending';
  }
}

const MIN_IMAGE_PIXELS = 921_600;
const MAX_IMAGE_PIXELS = 4_624_220;
const MIN_ASPECT_RATIO = 1 / 16;
const MAX_ASPECT_RATIO = 16;

function mapImageSize(
  width: number | undefined,
  height: number | undefined,
  resolutionTier?: ImageResolutionTier
): string {
  if (resolutionTier) {
    return resolutionTier;
  }
  if (width && height) {
    const pixels = width * height;
    const ratio = width / height;
    if (pixels < MIN_IMAGE_PIXELS) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        `Image size ${width}x${height} (${pixels} pixels) is below minimum ${MIN_IMAGE_PIXELS} pixels. Use a resolution tier (1K/1.5K/2K) or increase dimensions.`
      );
    }
    if (pixels > MAX_IMAGE_PIXELS) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        `Image size ${width}x${height} (${pixels} pixels) exceeds maximum ${MAX_IMAGE_PIXELS} pixels.`
      );
    }
    if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        `Image aspect ratio ${ratio.toFixed(2)} is out of range [${MIN_ASPECT_RATIO}, ${MAX_ASPECT_RATIO}].`
      );
    }
    return `${width}x${height}`;
  }
  return '2K';
}

function mapRatio(width: number, height: number): string {
  const ratio = width / height;
  const candidates: Array<[string, number]> = [
    ['16:9', 16 / 9],
    ['4:3', 4 / 3],
    ['1:1', 1],
    ['3:4', 3 / 4],
    ['9:16', 9 / 16],
    ['21:9', 21 / 9]
  ];
  const match = candidates.reduce((best, item) =>
    Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best
  );
  return match[0];
}

function mapResolution(height: number): string {
  if (height >= 2160) return '4k';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  return '480p';
}

function durationToSeconds(durationMs?: number): number {
  if (durationMs === undefined || durationMs <= 0) return -1;
  return Math.max(1, Math.round(durationMs / 1000));
}

export class VolcengineProvider implements GenerationProvider {
  readonly id = 'volcengine';
  readonly capabilities: ProviderCapabilities = {
    textToImage: true,
    textToVideo: true,
    imageToImage: true,
    imageToVideo: true,
    videoToVideo: true
  };

  constructor(
    private readonly config: VolcengineConfig,
    private readonly apiKey: string,
    private readonly downloader: AssetDownloader,
    private readonly uploader?: {
      upload(asset: AssetRef): Promise<string>;
    }
  ) {}

  async textToImage(req: TextToImageRequest): Promise<GenerationJob> {
    const sizeMode = (req.extra?.sizeMode as ImageResolutionTier | undefined) ?? this.config.imageResolution;
    const watermark = req.extra?.watermark as boolean | undefined ?? this.config.imageWatermark ?? false;
    const background = req.extra?.background as 'transparent' | 'opaque' | undefined;
    const optimizePromptMode = req.extra?.optimizePromptMode as 'standard' | 'fast' | undefined;
    const layerDecomposition = req.extra?.layerDecomposition as boolean | undefined;

    const body: Record<string, unknown> = {
      model: req.model?.trim() || this.config.imageModel,
      prompt: req.prompt,
      size: mapImageSize(req.width, req.height, sizeMode),
      output_format: background === 'transparent' ? 'png' : 'png',
      response_format: 'url',
      watermark
    };
    if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
    if (req.seed !== undefined) body.seed = req.seed;
    if (background) body.background = background;
    if (optimizePromptMode) {
      body.optimize_prompt_options = { mode: optimizePromptMode };
    }
    if (layerDecomposition) {
      body.layer_decomposition = true;
    }

    logger.info('Volcengine textToImage request: ' + JSON.stringify({ model: body.model, prompt: (body.prompt as string).substring(0, 50), size: body.size }));
    const response = await this.fetchJson<ArkImageResponse>('/images/generations', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (response.error) {
      throw this.providerError(response.error.code ?? 'PROVIDER_ERROR', response.error.message ?? 'Image generation failed');
    }
    const data = response.data?.[0];
    if (!data) {
      throw this.providerError('PROVIDER_ERROR', 'Image generation returned no data');
    }

    const asset = await this.downloadImageAsset(data);

    if (layerDecomposition && response.data && response.data.length > 1) {
      const layers = response.data
        .filter((d) => d.z_index !== undefined && d.z_index > 0)
        .map((d) => ({
          zIndex: d.z_index!,
          boundingBox: d.bounding_box,
          name: d.name,
          description: d.description
        }));
      return this.succeededJob('text-to-image', asset, { layers });
    }

    return this.succeededJob('text-to-image', asset);
  }

  async textToVideo(req: TextToVideoRequest): Promise<GenerationJob> {
    const content: unknown[] = [{ type: 'text', text: req.prompt }];
    const body = this.videoBody(req.prompt, content, req.width, req.height, req.durationMs, {
      generateAudio: Boolean(req.extra?.generateAudio), model: req.model
    });
    const task = await this.fetchJson<ArkTaskResponse>('/contents/generations/tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return this.pendingJob('text-to-video', task.id, task.status);
  }

  async imageToImage(req: ImageToImageRequest): Promise<GenerationJob> {
    const imageUrl = await this.publicUrl(req.image);
    const sizeMode = (req.extra?.sizeMode as ImageResolutionTier | undefined) ?? this.config.imageResolution;
    const watermark = req.extra?.watermark as boolean | undefined ?? this.config.imageWatermark ?? false;
    const background = req.extra?.background as 'transparent' | 'opaque' | undefined;
    const optimizePromptMode = req.extra?.optimizePromptMode as 'standard' | 'fast' | undefined;
    const layerDecomposition = req.extra?.layerDecomposition as boolean | undefined;

    const body: Record<string, unknown> = {
      model: req.model?.trim() || this.config.imageModel,
      prompt: req.prompt,
      image: [imageUrl],
      size: mapImageSize(req.width, req.height, sizeMode),
      output_format: 'png',
      response_format: 'url',
      watermark
    };
    if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
    if (req.strength !== undefined) body.strength = req.strength;
    if (req.seed !== undefined) body.seed = req.seed;
    if (background) body.background = background;
    if (optimizePromptMode) {
      body.optimize_prompt_options = { mode: optimizePromptMode };
    }
    if (layerDecomposition) {
      body.layer_decomposition = true;
    }

    logger.info('Volcengine imageToImage request: ' + JSON.stringify({ model: body.model, prompt: (body.prompt as string).substring(0, 50), size: body.size }));
    const response = await this.fetchJson<ArkImageResponse>('/images/generations', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    if (response.error) {
      throw this.providerError(response.error.code ?? 'PROVIDER_ERROR', response.error.message ?? 'Image generation failed');
    }
    const data = response.data?.[0];
    if (!data) {
      throw this.providerError('PROVIDER_ERROR', 'Image generation returned no data');
    }
    const asset = await this.downloadImageAsset(data);

    if (layerDecomposition && response.data && response.data.length > 1) {
      const layers = response.data
        .filter((d) => d.z_index !== undefined && d.z_index > 0)
        .map((d) => ({
          zIndex: d.z_index!,
          boundingBox: d.bounding_box,
          name: d.name,
          description: d.description
        }));
      return this.succeededJob('image-to-image', asset, { layers });
    }

    return this.succeededJob('image-to-image', asset);
  }

  async imageToVideo(req: ImageToVideoRequest): Promise<GenerationJob> {
    const imageUrl = await this.publicUrl(req.image);
    const content: unknown[] = [
      { type: 'text', text: req.prompt },
      { type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' }
    ];
    const body = this.videoBody(req.prompt, content, req.width, req.height, req.durationMs, {
      generateAudio: Boolean(req.extra?.generateAudio), model: req.model
    });
    const task = await this.fetchJson<ArkTaskResponse>('/contents/generations/tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return this.pendingJob('image-to-video', task.id, task.status);
  }

  async videoToVideo(req: VideoToVideoRequest): Promise<GenerationJob> {
    const videoUrl = await this.publicUrl(req.video);
    const content: unknown[] = [
      { type: 'text', text: req.prompt },
      { type: 'video_url', video_url: { url: videoUrl }, role: 'reference_video' }
    ];
    const body = this.videoBody(req.prompt, content, req.width, req.height, req.durationMs, {
      generateAudio: Boolean(req.extra?.generateAudio),
      omniReferenceTaskType: req.mode, model: req.model
    });
    const task = await this.fetchJson<ArkTaskResponse>('/contents/generations/tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return this.pendingJob('video-to-video', task.id, task.status);
  }

  async getJob(jobId: string, type: GenerationJob['type'] = 'text-to-video'): Promise<GenerationJob> {
    const task = await this.fetchJson<ArkTaskResponse>(`/contents/generations/tasks/${encodeURIComponent(jobId)}`, {
      method: 'GET'
    });
    const status = mapStatus(task.status);
    const job: GenerationJob = {
      jobId,
      providerId: this.id,
      type,
      status,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (status === 'failed') {
      const providerError = this.providerError(
        task.error?.code ?? 'PROVIDER_ERROR',
        task.error?.message ?? 'Generation failed'
      );
      job.error = {
        code: providerError.code,
        message: providerError.message,
        retryable: providerError.retryable
      };
    }
    if (status === 'succeeded' && task.content?.video_url) {
      job.result = await this.downloader.download(task.content.video_url, 'video', `${this.id}-${jobId}`);
    }
    return job;
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.fetchJson<unknown>(`/contents/generations/tasks/${encodeURIComponent(jobId)}`, {
      method: 'DELETE'
    });
  }

  private videoBody(
    prompt: string,
    content: unknown[],
    width: number | undefined,
    height: number | undefined,
    durationMs: number | undefined,
    options: { generateAudio: boolean; omniReferenceTaskType?: 'edit' | 'extend'; model?: string }
  ): Record<string, unknown> {
    const w = width ?? 1920;
    const h = height ?? 1080;
    const body: Record<string, unknown> = {
      model: options.model?.trim() || this.config.videoModel,
      content,
      generate_audio: options.generateAudio,
      ratio: options.omniReferenceTaskType ? 'adaptive' : mapRatio(w, h),
      duration: durationToSeconds(durationMs),
      output_format: 'mp4',
      watermark: false
    };
    if (!options.omniReferenceTaskType) {
      body.resolution = mapResolution(h);
    }
    if (options.omniReferenceTaskType) {
      body.omni_reference_task_type = options.omniReferenceTaskType;
    }
    return body;
  }

  private async publicUrl(asset: AssetRef): Promise<string> {
    if (this.uploader) {
      return this.uploader.upload(asset);
    }
    if (asset.path.startsWith('http://') || asset.path.startsWith('https://')) {
      return asset.path;
    }
    throw new CanvasCutError(
      ERROR_CODES.INVALID_PARAMS,
      `Local asset ${asset.path} requires an uploader before it can be sent to the provider`
    );
  }

  private pendingJob(type: GenerationJob['type'], jobId: string, status?: ArkTaskResponse['status']): GenerationJob {
    return {
      jobId,
      providerId: this.id,
      type,
      status: mapStatus(status),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  private succeededJob(type: GenerationJob['type'], result: AssetRef, extra?: Record<string, unknown>): GenerationJob {
    const now = Date.now();
    return {
      jobId: randomUUID(),
      providerId: this.id,
      type,
      status: 'succeeded',
      progress: 100,
      result,
      extra,
      createdAt: now,
      updatedAt: now
    };
  }

  private async downloadImageAsset(data: ArkLayerData): Promise<AssetRef> {
    if (data.url) {
      return this.downloader.download(data.url, 'image', `${this.id}-${randomUUID()}`);
    }
    if (data.b64_json) {
      return this.saveBase64(data.b64_json, 'image');
    }
    throw new CanvasCutError(ERROR_CODES.PROVIDER_ERROR, 'Image generation returned no URL or base64');
  }

  private async saveBase64(base64: string, type: AssetRef['type']): Promise<AssetRef> {
    return this.downloader.download(`data:${type === 'image' ? 'image/png' : 'video/mp4'};base64,${base64}`, type);
  }

  private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    const timeoutMs = this.config.timeoutMs ?? 300_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {})
        },
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text();
        throw this.providerError(`HTTP_${response.status}`, text || `Request failed with status ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof CanvasCutError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new CanvasCutError(ERROR_CODES.GENERATION_TIMEOUT, `Provider request timed out: ${path}`, {
          retryable: true
        });
      }
      throw new CanvasCutError(ERROR_CODES.PROVIDER_ERROR, (error as Error).message, {
        retryable: true,
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private providerError(code: string, message: string): CanvasCutError {
    const retryable = code === '429' || code === 'RATE_LIMIT' || message.toLowerCase().includes('rate');
    return new CanvasCutError(ERROR_CODES.PROVIDER_ERROR, message, { retryable, details: { providerCode: code } });
  }
}

export class FileAssetDownloader implements AssetDownloader {
  constructor(private readonly directory: string) {}

  async download(url: string, type: AssetRef['type'], hint = randomUUID()): Promise<AssetRef> {
    const ext = type === 'image' ? '.png' : type === 'video' ? '.mp4' : '.mp3';
    const target = join(resolve(this.directory), `${hint}${ext}`);
    await fs.mkdir(resolve(this.directory), { recursive: true });

    if (url.startsWith('data:')) {
      const match = url.match(/^data:[^;]+;base64,(.*)$/s);
      if (!match?.[1]) {
        throw new CanvasCutError(ERROR_CODES.PROVIDER_ERROR, 'Invalid data URL');
      }
      await fs.writeFile(target, Buffer.from(match[1], 'base64'));
    } else {
      const response = await fetch(url);
      if (!response.ok) {
        throw new CanvasCutError(ERROR_CODES.PROVIDER_ERROR, `Failed to download asset: ${response.status}`, {
          retryable: true
        });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(target, buffer);
    }

    const stat = await fs.stat(target);
    return {
      id: createHash('sha256').update(await fs.readFile(target)).digest('hex'),
      path: target,
      type,
      sizeBytes: stat.size
    };
  }
}
