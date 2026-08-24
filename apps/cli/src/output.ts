import { randomUUID } from 'node:crypto';
import { toStructuredError, StructuredError } from '@canvas-cut/core';

export interface CliResult<T> {
  ok: boolean;
  data: T | null;
  error: StructuredError | null;
  requestId: string;
}

export function success<T>(data: T, requestId = randomUUID()): CliResult<T> {
  return { ok: true, data, error: null, requestId };
}

export function failure(error: unknown, requestId = randomUUID()): CliResult<null> {
  return { ok: false, data: null, error: toStructuredError(error), requestId };
}

export function printResult<T>(result: CliResult<T>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.ok) {
    process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
  } else {
    const error = result.error as StructuredError;
    process.stderr.write(`[${error.code}] ${error.message}\n`);
  }
}

export function exitForResult<T>(result: CliResult<T>): void {
  if (result.ok) {
    process.exitCode = 0;
    return;
  }
  const code = result.error?.code ?? '';
  const exitCode = mapExitCode(code);
  process.exitCode = exitCode;
}

export function mapExitCode(code: string): number {
  switch (code) {
    case 'PROJECT_NOT_FOUND':
    case 'CANVAS_NOT_FOUND':
    case 'NODE_NOT_FOUND':
    case 'ASSET_NOT_FOUND':
    case 'JOB_NOT_FOUND':
    case 'PRESET_NOT_FOUND':
    case 'TRACK_NOT_FOUND':
    case 'CLIP_NOT_FOUND':
      return 3;
    case 'PROJECT_EXISTS':
    case 'EDGE_INVALID':
    case 'INVALID_PARAMS':
    case 'LOCK_TIMEOUT':
      return 2;
    case 'JOB_CANCELLED':
      return 6;
    case 'GENERATION_TIMEOUT':
    case 'IPC_TIMEOUT':
      return 5;
    case 'DAEMON_UNAVAILABLE':
      return 4;
    default:
      return 1;
  }
}
