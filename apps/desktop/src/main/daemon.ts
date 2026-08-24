import { randomUUID } from 'node:crypto';
import { logger } from '@canvas-cut/core';
import {
  buildCanvasRenderPlan,
  CanvasCutError,
  ERROR_CODES,
  JobRecord,
  ProjectStore
} from '@canvas-cut/core';
import { JobStore, JsonFileJobStore, SqliteJobStore } from './job-store';
import { JobWorker } from './job-worker';

interface ProjectContext {
  store: ProjectStore;
  jobStore: JobStore;
  worker: JobWorker;
  activeCanvasRenders: Map<string, string>;
}

export interface SubmitResult {
  jobId: string;
  type: string;
  childJobIds?: string[];
}

export class DaemonService {
  private readonly contexts = new Map<string, ProjectContext>();

  async getContext(projectPath: string): Promise<ProjectContext> {
    const normalized = projectPath.toLowerCase();
    const existing = this.contexts.get(normalized);
    if (existing) return existing;

    const store = new ProjectStore(projectPath);
    await store.requireOpen();
    const jobStore = this.createJobStore(store);
    const worker = new JobWorker(store, jobStore);
    worker.start();
    const context = {
      store,
      jobStore,
      worker,
      activeCanvasRenders: new Map<string, string>()
    };
    this.contexts.set(normalized, context);
    return context;
  }

  private createJobStore(store: ProjectStore): JobStore {
    try {
      const sqlite = new SqliteJobStore(store.paths.jobsSqlite);
      sqlite.init();
      return sqlite;
    } catch (error) {
      console.warn('[daemon] SQLite job store unavailable, falling back to JSON job store', error);
      const json = new JsonFileJobStore(store.paths.root);
      json.init();
      return json;
    }
  }

  async submitJob(
    projectPath: string,
    payload: Record<string, unknown>,
    _idempotencyKey?: string
  ): Promise<SubmitResult> {
    const context = await this.getContext(projectPath);
    const type = String(payload.type ?? '');
    logger.info('Daemon submitJob: type=' + type + (payload.canvasId ? ' canvasId=' + payload.canvasId : ''));
    const now = Date.now();

    if (type.startsWith('generate.')) {
      const jobId = randomUUID();
      context.jobStore.insert({
        id: jobId,
        type,
        status: 'pending',
        request_snapshot: JSON.stringify(payload.request ?? {}),
        created_at: now,
        updated_at: now
      });
      return { jobId, type };
    }

    if (type === 'canvas.render') {
      const canvasId = String(payload.canvasId ?? '');
      const force = Boolean(payload.force);
      const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : undefined;
      const graph = await context.store.readCanvas(canvasId);
      const project = await context.store.readProject();
      const plan = await buildCanvasRenderPlan(graph, project.settings, { force, nodeId });
      const dedupeKey = `${canvasId}:${graph.graphHash}`;
      const existingId = context.activeCanvasRenders.get(dedupeKey);
      if (!force && existingId) {
        const existing = context.jobStore.get(existingId);
        if (existing && (existing.status === 'pending' || existing.status === 'running')) {
          return { jobId: existingId, type };
        }
      }
      const parentId = randomUUID();
      logger.info('Daemon canvas.render: parentId=' + parentId + ' childJobs=' + plan.childJobs.length);

      context.jobStore.insert({
        id: parentId,
        type: 'canvas.render',
        status: 'pending',
        request_snapshot: JSON.stringify({ canvasId, force, nodeId }),
        canvas_id: canvasId,
        created_at: now,
        updated_at: now
      });

      const childJobIds: string[] = [];
      for (const step of plan.childJobs) {
        const childId = randomUUID();
        context.jobStore.insert({
          id: childId,
          parent_id: parentId,
          type: 'canvas.node',
          status: 'pending',
          request_snapshot: JSON.stringify(step),
          canvas_id: canvasId,
          node_id: step.nodeId,
          created_at: now,
          updated_at: now
        });
        childJobIds.push(childId);
      }

      context.activeCanvasRenders.set(dedupeKey, parentId);

      return { jobId: parentId, type, childJobIds };
    }

    if (type === 'timeline.export') {
      const jobId = randomUUID();
      context.jobStore.insert({
        id: jobId,
        type: 'timeline.export',
        status: 'pending',
        request_snapshot: JSON.stringify({ outputPath: payload.outputPath }),
        created_at: now,
        updated_at: now
      });
      return { jobId, type };
    }

    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Unknown job submit type: ${type}`);
  }

  async getJob(projectPath: string, jobId: string): Promise<unknown> {
    const context = await this.getContext(projectPath);
    const job = context.jobStore.get(jobId);
    if (!job) {
      throw new CanvasCutError(ERROR_CODES.JOB_NOT_FOUND, `Job not found: ${jobId}`);
    }
    return this.hydrateJob(context.jobStore, job);
  }

  async waitJob(projectPath: string, jobId: string, timeoutMs = 1_800_000): Promise<unknown> {
    const context = await this.getContext(projectPath);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const job = context.jobStore.get(jobId);
      if (!job) {
        throw new CanvasCutError(ERROR_CODES.JOB_NOT_FOUND, `Job not found: ${jobId}`);
      }
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        return this.hydrateJob(context.jobStore, job);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new CanvasCutError(ERROR_CODES.GENERATION_TIMEOUT, `Timed out waiting for job: ${jobId}`, {
      retryable: true
    });
  }

  async cancelJob(projectPath: string, jobId: string): Promise<unknown> {
    const context = await this.getContext(projectPath);
    const job = context.jobStore.get(jobId);
    if (!job) {
      throw new CanvasCutError(ERROR_CODES.JOB_NOT_FOUND, `Job not found: ${jobId}`);
    }
    context.jobStore.update(jobId, { status: 'cancelled', updated_at: Date.now() });
    const children = context.jobStore.list({ parentId: jobId });
    for (const child of children) {
      context.jobStore.update(child.id, { status: 'cancelled', updated_at: Date.now() });
    }
    return { cancelled: true };
  }

  async listJobs(projectPath: string, status?: string): Promise<unknown> {
    const context = await this.getContext(projectPath);
    const jobs = context.jobStore.list({ status });
    return jobs.map((job) => this.hydrateJob(context.jobStore, job));
  }

  async clearJobs(projectPath: string, status?: string): Promise<unknown> {
    const context = await this.getContext(projectPath);
    const count = context.jobStore.clear({ status });
    return { cleared: count };
  }

  private hydrateJob(jobStore: JobStore, job: JobRecord): Record<string, unknown> {
    const children = jobStore.list({ parentId: job.id });
    return {
      jobId: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      result: job.result ? JSON.parse(job.result) : null,
      error: job.error ? JSON.parse(job.error) : null,
      canvasId: job.canvas_id,
      nodeId: job.node_id,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      children: children.map((child) => ({
        jobId: child.id,
        type: child.type,
        status: child.status,
        progress: child.progress,
        result: child.result ? JSON.parse(child.result) : null,
        error: child.error ? JSON.parse(child.error) : null,
        nodeId: child.node_id
      }))
    };
  }

  async shutdown(): Promise<void> {
    for (const context of this.contexts.values()) {
      context.worker.stop();
      context.jobStore.close();
    }
    this.contexts.clear();
  }
}
