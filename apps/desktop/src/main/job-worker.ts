import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  AssetRef,
  buildCanvasRenderPlan,
  buildFfmpegArgs,
  buildRenderPlan,
  CanvasCutError,
  createProvider,
  ERROR_CODES,
  executeCanvasPlan,
  FileAssetDownloader,
  FileNodeCacheStore,
  GenerationProvider,
  GenerationType,
  ImageToImageRequest,
  ImageToVideoRequest,
  ProjectStore,
  TextToImageRequest,
  TextToVideoRequest,
  toStructuredError,
  VideoToVideoRequest,
  withProjectLock,
  assertRenderAssetsExist,
  ensureOutputDir,
  runFfmpeg,
  probeMedia,
  resolveCanvasClipsInTimeline,
  JobRecord
} from '@canvas-cut/core';
import type { WhiteModelRequest } from '@canvas-cut/core';
import type { WhiteModelRenderer } from './white-model-renderer';
import { notifyCanvasChanged, type CanvasChanged } from '@canvas-cut/core';
import type { JobStore } from './job-store';
import { logger } from '@canvas-cut/core';
import { TosUploader } from './uploader';

export interface WorkerOptions {
  onCanvasChanged?: CanvasChanged;
  pollIntervalMs?: number;
  ffmpegPath?: string;
  maxConcurrency?: number;
  renderWhiteModel?: WhiteModelRenderer;
}

export class JobWorker {
  private timer: NodeJS.Timeout | undefined;
  private scheduling = false;
  private controllers = new Map<string, AbortController>();
  private remoteTasks = new Map<string, { provider: GenerationProvider; id: string }>();

  async cancel(jobId: string): Promise<void> {
    this.controllers.get(jobId)?.abort();
    const remote = this.remoteTasks.get(jobId);
    if (remote) await remote.provider.cancelJob(remote.id);
  }
  private active = new Set<Promise<void>>();
  private readonly maxConcurrency: number;

  private readonly store: ProjectStore;
  private readonly jobStore: JobStore;
  private readonly options: WorkerOptions;

  constructor(store: ProjectStore, jobStore: JobStore, options: WorkerOptions = {}) {
    this.store = store;
    this.jobStore = jobStore;
    this.options = options;
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 3);
  }

  start(): void {
    if (this.timer) return;
    void this.reconcile();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.pollIntervalMs ?? 500);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
      this.cleanupFinished();
      const available = this.maxConcurrency - this.active.size;
      if (available <= 0) return;
      const pending = this.jobStore.list({ status: 'pending', parentId: null, limit: available });
      for (const job of pending) {
        const promise = this.process(job).finally(() => {
          this.active.delete(promise);
        });
        this.active.add(promise);
      }
    } finally {
      this.scheduling = false;
    }
  }

  private cleanupFinished(): void {
    for (const promise of this.active) {
      void promise;
    }
  }

  private async reconcile(): Promise<void> {
    const running = this.jobStore.list({ status: 'running', limit: 10_000 });
    for (const job of running) {
      if (job.type.startsWith('generate.') && job.provider_task_id) {
        this.jobStore.update(job.id, { status: 'pending', updated_at: Date.now() });
        continue;
      }
      this.jobStore.update(job.id, {
        status: 'failed',
        error: JSON.stringify({
          code: 'RECONCILE_FAILED',
          message: 'Worker restarted while job was running; re-submit the job.',
          retryable: true
        }),
        updated_at: Date.now()
      });
    }
  }

  private async process(job: JobRecord): Promise<void> {
    this.controllers.set(job.id, new AbortController());
    logger.info('JobWorker processing: id=' + job.id + ' type=' + job.type);
    const now = Date.now();
    this.jobStore.update(job.id, { status: 'running', updated_at: now });
    try {
      if (job.type.startsWith('generate.')) {
        await this.processGeneration(job);
      } else if (job.type === 'canvas.render') {
        await this.processCanvasRender(job);
      } else if (job.type === 'canvas.node') {
        throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Canvas nodes must be executed by their parent');
      } else if (job.type === 'timeline.export') {
        await this.processTimelineExport(job);
      } else {
        throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Unknown job type: ${job.type}`);
      }
    } catch (error) {
      if (this.jobStore.get(job.id)?.status === 'cancelled') return;
      logger.error('JobWorker process failed: id=' + job.id + ' type=' + job.type + ' error=' + ((error as Error).message || String(error)));
      const structured = toStructuredError(error);
      this.jobStore.update(job.id, {
        status: 'failed',
        error: JSON.stringify(structured),
        updated_at: Date.now()
      });
      if (job.type === 'canvas.render') {
        const children = this.jobStore.list({ parentId: job.id, limit: 10_000 });
        for (const child of children) {
          if (child.status === 'succeeded' || child.status === 'cancelled') continue;
          this.jobStore.update(child.id, {
            status: 'failed',
            error: JSON.stringify(structured),
            updated_at: Date.now()
          });
        }
      }
    } finally {
      this.controllers.delete(job.id);
      this.remoteTasks.delete(job.id);
      if (job.canvas_id) notifyCanvasChanged(this.options.onCanvasChanged, { projectPath: this.store.paths.root, canvasId: job.canvas_id });
    }
  }

  private async processGeneration(job: JobRecord): Promise<void> {
    logger.info('JobWorker processGeneration: id=' + job.id);
    const request = JSON.parse(job.request_snapshot ?? '{}') as
      | TextToImageRequest
      | TextToVideoRequest
      | ImageToImageRequest
      | ImageToVideoRequest
      | VideoToVideoRequest;
    const provider = await this.createProvider();
    const providerJob = job.provider_task_id
      ? await provider.getJob(job.provider_task_id, generationTypeForJob(job.type))
      : await this.callProvider(provider, job.type, request);
    this.remoteTasks.set(job.id, { provider, id: providerJob.jobId });
    if (this.jobStore.get(job.id)?.status === 'cancelled') { await provider.cancelJob(providerJob.jobId); return; }

    if (providerJob.status === 'succeeded') {
      logger.info('JobWorker ' + job.id + ' generation succeeded (sync)');
      this.completeJob(job.id, providerJob.result);
      return;
    }

    this.jobStore.update(job.id, {
      provider_task_id: providerJob.jobId,
      status: providerJob.status === 'cancelled' ? 'cancelled' : 'running',
      updated_at: Date.now()
    });

    let delay = 1000;
    const startedAt = Date.now();
    const timeoutMs = 30 * 60 * 1000;
    while (true) {
      const localJob = this.jobStore.get(job.id);
      if (localJob?.status === 'cancelled') {
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new CanvasCutError(ERROR_CODES.GENERATION_TIMEOUT, `Generation job ${job.id} timed out`, {
          retryable: true
        });
      }
      await this.sleep(delay);
      const current = await provider.getJob(providerJob.jobId, generationTypeForJob(job.type));
      if (current.status === 'succeeded') {
        this.completeJob(job.id, current.result);
        return;
      }
      if (current.status === 'failed' || current.status === 'cancelled') {
        this.jobStore.update(job.id, {
          status: current.status,
          error: current.error ? JSON.stringify(current.error) : null,
          updated_at: Date.now()
        });
        return;
      }
      this.jobStore.update(job.id, {
        progress: current.progress,
        updated_at: Date.now()
      });
      delay = Math.min(10_000, Math.round(delay * 1.5));
    }
  }

  private async callProvider(
    provider: GenerationProvider,
    type: string,
    request:
      | TextToImageRequest
      | TextToVideoRequest
      | ImageToImageRequest
      | ImageToVideoRequest
      | VideoToVideoRequest
  ) {
    switch (type) {
      case 'generate.text-to-image':
        return provider.textToImage(request as TextToImageRequest);
      case 'generate.text-to-video':
        return provider.textToVideo(request as TextToVideoRequest);
      case 'generate.image-to-image':
        return provider.imageToImage(request as ImageToImageRequest);
      case 'generate.image-to-video':
        return provider.imageToVideo(request as ImageToVideoRequest);
      case 'generate.video-to-video':
        return provider.videoToVideo(request as VideoToVideoRequest);
      default:
        throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Unsupported generation type: ${type}`);
    }
  }

  private async processCanvasRender(job: JobRecord): Promise<void> {
    logger.info('JobWorker processCanvasRender: id=' + job.id);
    const canvasId = job.canvas_id;
    if (!canvasId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Canvas render job is missing canvas_id');
    }
    const snapshot = JSON.parse(job.request_snapshot ?? '{}') as {
      canvasId?: string;
      force?: boolean;
      nodeId?: string;
    };
    const result = await this.renderCanvas(canvasId, job.id, {
      force: Boolean(snapshot.force),
      nodeId: snapshot.nodeId
    });
    this.completeJob(job.id, result);
  }

  private async renderCanvas(
    canvasId: string,
    parentJobId?: string,
    options?: { force?: boolean; nodeId?: string },
    visited: Set<string> = new Set()
  ): Promise<AssetRef> {
    if (visited.has(canvasId)) {
      throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, `Canvas reference cycle detected at ${canvasId}`);
    }
    visited.add(canvasId);
    if (visited.size > 2) throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, 'Canvas nesting is limited to two levels');
    const graph = await this.store.readCanvas(canvasId);
    const project = await this.store.readProject();
    const config = await this.store.readConfig();
    const cache = new FileNodeCacheStore(this.store.paths.cacheDir);
    const plan = await buildCanvasRenderPlan(
      graph,
      project.settings,
      { force: options?.force, nodeId: options?.nodeId,
        modelDefaults: { imageModel: config.provider.volcengine.imageModel, videoModel: config.provider.volcengine.videoModel } },
      cache
    );
    let providerPromise: Promise<GenerationProvider> | undefined;
    const getProvider = () => providerPromise ??= this.createProvider();

    const execution = await executeCanvasPlan(
      plan,
      graph,
      project.settings,
      {
        onNodeResult: (node, asset) => {
          if (!parentJobId || this.jobStore.get(parentJobId)?.status === 'cancelled') return;
          const children = this.jobStore.list({ parentId: parentJobId, limit: 10_000 });
          const child = children.find((item) => item.node_id === node.id && item.canvas_id === canvasId);
          if (child) this.jobStore.update(child.id, { status: 'succeeded', progress: 100, result: JSON.stringify(asset), updated_at: Date.now() });
          const completed = this.jobStore.list({ parentId: parentJobId, limit: 10_000 }).filter((item) => item.status === 'succeeded').length;
          this.jobStore.update(parentJobId, { progress: children.length ? completed / children.length * 100 : 0, updated_at: Date.now() });
        },
        execute: async (node, request) => {
          if (parentJobId && this.jobStore.get(parentJobId)?.status === 'cancelled') throw new Error('Job cancelled');
          const child = parentJobId ? this.jobStore.list({ parentId: parentJobId }).find((item) => item.node_id === node.id) : undefined;
          if (child) this.jobStore.update(child.id, { status: 'running', updated_at: Date.now() });
          const type = node.type;
          if (type === 'white-model-video') {
            if (!this.options.renderWhiteModel) throw new CanvasCutError(ERROR_CODES.RENDER_FAILED, 'White model rendering requires the desktop renderer');
            return this.options.renderWhiteModel(request as WhiteModelRequest, {
              assetsDir: this.store.paths.assetsDir, cacheDir: this.store.paths.cacheDir,
              ffmpegPath: this.options.ffmpegPath,
              signal: parentJobId ? this.controllers.get(parentJobId)?.signal : undefined,
              onProgress: progress => {
                if (!parentJobId || this.jobStore.get(parentJobId)?.status === 'cancelled') return;
                if (child) this.jobStore.update(child.id, { progress, updated_at: Date.now() });
                const children = this.jobStore.list({ parentId: parentJobId, limit: 10_000 });
                const total = children.reduce((sum, item) => sum + (item.status === 'succeeded' ? 100 : item.progress ?? 0), 0);
                this.jobStore.update(parentJobId, { progress: children.length ? total / children.length : progress, updated_at: Date.now() });
              }
            });
          }
          const provider = await getProvider();
          switch (type) {
            case 'text-to-image':
              return (await provider.textToImage(request as TextToImageRequest)).result as AssetRef;
            case 'text-to-video':
              return await this.executeVideoGeneration(provider, 'text-to-video', request as TextToVideoRequest, parentJobId);
            case 'image-to-image':
              return (await provider.imageToImage(request as ImageToImageRequest)).result as AssetRef;
            case 'image-to-video':
              return await this.executeVideoGeneration(provider, 'image-to-video', request as ImageToVideoRequest, parentJobId);
            case 'video-to-video':
              return await this.executeVideoGeneration(provider, 'video-to-video', request as VideoToVideoRequest, parentJobId);
            default:
              throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Unsupported generation node: ${type}`);
          }
        },
        renderCanvasReference: async (childCanvasId) =>
          this.renderCanvas(childCanvasId, parentJobId, undefined, new Set(visited))
      },
      cache
    );

    if (parentJobId && this.jobStore.get(parentJobId)?.status === 'cancelled') throw new Error('Job cancelled');
    if (parentJobId && visited.size === 1) {
      const children = this.jobStore.list({ parentId: parentJobId, limit: 10_000 });
      for (const child of children) {
        const value = child.node_id ? execution.nodeResults[child.node_id] : undefined;
        if (value && typeof value !== 'string') {
          this.jobStore.update(child.id, {
            status: 'succeeded',
            progress: 100,
            result: JSON.stringify(value),
            updated_at: Date.now()
          });
        } else {
          this.jobStore.update(child.id, {
            status: 'failed',
            error: JSON.stringify(toStructuredError(new CanvasCutError(ERROR_CODES.RENDER_FAILED, 'Node did not produce a result'))),
            updated_at: Date.now()
          });
        }
      }
    }

    await withProjectLock(this.store.paths.root, async () => {
      const latest = await this.store.readCanvas(canvasId);
      if (latest.graphHash !== graph.graphHash) {
        return;
      }
      for (const node of latest.nodes) {
        const value = execution.nodeResults[node.id];
        if (value && typeof value !== 'string') {
          node.cachedResult = value;
          node.status = 'succeeded';
        } else if (node.type === 'text-input' && typeof value === 'string') {
          node.status = 'succeeded';
        }
      }
      const outputNode = latest.nodes.find((node) => node.type === 'output');
      if (outputNode) {
        outputNode.cachedResult = execution.output;
        outputNode.status = 'succeeded';
      }
      await this.store.writeCanvas(latest);
      notifyCanvasChanged(this.options.onCanvasChanged, { projectPath: this.store.paths.root, canvasId });
    });

    return execution.output;
  }

  private async executeVideoGeneration(
    provider: GenerationProvider,
    type: 'text-to-video' | 'image-to-video' | 'video-to-video',
    request: TextToVideoRequest | ImageToVideoRequest | VideoToVideoRequest,
    parentJobId?: string
  ): Promise<AssetRef> {
    const job =
      type === 'text-to-video'
        ? await provider.textToVideo(request as TextToVideoRequest)
        : type === 'image-to-video'
          ? await provider.imageToVideo(request as ImageToVideoRequest)
          : await provider.videoToVideo(request as VideoToVideoRequest);

    if (parentJobId) this.remoteTasks.set(parentJobId, { provider, id: job.jobId });
    if (parentJobId && this.jobStore.get(parentJobId)?.status === 'cancelled') { await provider.cancelJob(job.jobId); throw new Error('Job cancelled'); }
    if (job.status === 'succeeded') {
      if (!job.result) throw new CanvasCutError(ERROR_CODES.PROVIDER_ERROR, 'Video generation returned no result');
      return job.result;
    }

    let delay = 1000;
    const startedAt = Date.now();
    while (true) {
      if (parentJobId && this.jobStore.get(parentJobId)?.status === 'cancelled') throw new Error('Job cancelled');
      if (Date.now() - startedAt > 30 * 60 * 1000) {
        throw new CanvasCutError(ERROR_CODES.GENERATION_TIMEOUT, 'Video generation timed out', { retryable: true });
      }
      await this.sleep(delay);
      const current = await provider.getJob(job.jobId, type);
      if (current.status === 'succeeded') {
        if (!current.result) throw new CanvasCutError(ERROR_CODES.PROVIDER_ERROR, 'Video generation returned no result');
        return current.result;
      }
      if (current.status === 'failed' || current.status === 'cancelled') {
        throw new CanvasCutError(
          current.error?.code ?? ERROR_CODES.PROVIDER_ERROR,
          current.error?.message ?? 'Video generation failed',
          { retryable: current.error?.retryable }
        );
      }
      delay = Math.min(10_000, Math.round(delay * 1.5));
    }
  }

  private async processTimelineExport(job: JobRecord): Promise<void> {
    const snapshot = JSON.parse(job.request_snapshot ?? '{}') as { outputPath?: string; width?: number; height?: number; fps?: number; crf?: number };
    if (!snapshot.outputPath) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'Timeline export is missing outputPath');
    }
    const project = await this.store.readProject();
    const rawTimeline = await this.store.readTimeline();
    const timeline = await resolveCanvasClipsInTimeline(this.store.paths.root, rawTimeline);
    const plan = buildRenderPlan(timeline, {
      outputPath: snapshot.outputPath,
      projectRoot: this.store.paths.root,
      settings: { ...project.settings, width: snapshot.width ?? project.settings.width, height: snapshot.height ?? project.settings.height, fps: snapshot.fps ?? project.settings.fps },
      crf: snapshot.crf
    });
    await assertRenderAssetsExist(plan);
    await ensureOutputDir(plan.outputPath);
    const audioPaths = new Set<string>();
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        const asset = clip.kind === 'media' ? clip.asset : clip.kind === 'canvas' ? clip.renderedAsset : undefined;
        if (asset?.type === 'video') {
          const ffmpegPath = this.options.ffmpegPath ?? process.env.FFMPEG_PATH;
          const ffprobePath = process.env.FFPROBE_PATH ?? (ffmpegPath && dirname(ffmpegPath) !== '.' ? join(dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : undefined);
          const info = await probeMedia(asset.path, ffprobePath);
          if (!info.hasVideo) throw new CanvasCutError(ERROR_CODES.RENDER_FAILED, `Could not probe video ${asset.path}; configure a working ffprobe before export`);
          if (info.hasAudio) audioPaths.add(asset.path);
        }
      }
    }
    const ffmpegArgs = buildFfmpegArgs(plan, audioPaths);
    await runFfmpeg(this.options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg', ffmpegArgs, {
      cwd: this.store.paths.root,
      signal: this.controllers.get(job.id)?.signal,
      timeoutMs: 30 * 60 * 1000
    });

    const stat = await fs.stat(plan.outputPath);
    const asset: AssetRef = {
      id: createHash('sha256').update(plan.outputPath).digest('hex'),
      path: plan.outputPath,
      type: 'video',
      durationMs: timelineDurationFromPlan(plan),
      sizeBytes: stat.size
    };
    this.completeJob(job.id, asset);
  }

  private completeJob(id: string, result?: AssetRef): void {
    logger.info('JobWorker completeJob: id=' + id + ' result=' + (result ? result.type + ':' + (result.sizeBytes / 1024).toFixed(1) + 'KB' : 'none'));
    const existing = this.jobStore.get(id);
    if (existing?.status === 'cancelled') {
      this.jobStore.update(id, { updated_at: Date.now() });
      return;
    }
    this.jobStore.update(id, {
      status: 'succeeded',
      progress: 100,
      result: result ? JSON.stringify(result) : null,
      error: null,
      updated_at: Date.now()
    });
  }

  private async createProvider(): Promise<GenerationProvider> {
    const config = await this.store.readConfig();
    const apiKey = process.env.ARK_API_KEY;
    const downloader = new FileAssetDownloader(this.store.paths.assetsDir);
    const accessKeyId = process.env.TOS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.TOS_ACCESS_KEY_SECRET;
    const uploader =
      accessKeyId && accessKeySecret
        ? new TosUploader(config.tos, { accessKeyId, accessKeySecret })
        : undefined;
    return createProvider({
      config,
      apiKeys: { volcengine: apiKey },
      downloader,
      uploader
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function timelineDurationFromPlan(plan: { segments: Array<{ endMs: number }> }): number {
  return plan.segments.reduce((max, segment) => Math.max(max, segment.endMs), 0);
}

function generationTypeForJob(type: string): GenerationType {
  switch (type) {
    case 'generate.text-to-image':
      return 'text-to-image';
    case 'generate.text-to-video':
      return 'text-to-video';
    case 'generate.image-to-image':
      return 'image-to-image';
    case 'generate.image-to-video':
      return 'image-to-video';
    case 'generate.video-to-video':
      return 'video-to-video';
    default:
      return 'text-to-video';
  }
}
