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
  return client.request('job.wait', {
    jobId,
    timeoutMs: numberFlag(options.flags, 'timeout-ms', 1_800_000)
  });
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
