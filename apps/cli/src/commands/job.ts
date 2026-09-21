import { CanvasCutError, ERROR_CODES } from '@canvas-cut/core';
import { createStore } from '../context';
import type { CliOptions } from '../args';
import { numberFlag, stringFlag } from '../args';
import { LocalIpcClient } from '../ipc/client';

export async function jobStatus(options: CliOptions): Promise<unknown> {
  const jobId = options.positionals[0];
  if (!jobId) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'job status requires a job id');
  }
  const store = createStore(options);
  await store.requireOpen();
  const client = new LocalIpcClient(store.paths.root);
  return client.request('job.status', { jobId });
}

export async function jobWait(options: CliOptions): Promise<unknown> {
  const jobId = options.positionals[0];
  if (!jobId) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'job wait requires a job id');
  }
  const store = createStore(options);
  await store.requireOpen();
  const client = new LocalIpcClient(store.paths.root);
  const timeoutMs = numberFlag(options.flags, 'timeout-ms', 1_800_000) as number;
  if (timeoutMs < 1 || timeoutMs > 1_800_000) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'timeout-ms must be 1..1800000');
  const result = await client.request<{ status: string; error?: { message?: string } }>('job.wait', {
    jobId,
    timeoutMs
  }, timeoutMs + 5000);
  if (result.status !== 'succeeded') throw new CanvasCutError(result.status === 'cancelled' ? 'JOB_CANCELLED' : ERROR_CODES.RENDER_FAILED, result.error?.message ?? `Job ${result.status}`, { details: result });
  return result;
}

export async function jobCancel(options: CliOptions): Promise<unknown> {
  const jobId = options.positionals[0];
  if (!jobId) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'job cancel requires a job id');
  }
  const store = createStore(options);
  await store.requireOpen();
  const client = new LocalIpcClient(store.paths.root);
  return client.request('job.cancel', { jobId });
}

export async function jobList(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  const client = new LocalIpcClient(store.paths.root);
  return client.request('job.list', {
    status: stringFlag(options.flags, 'status')
  });
}
