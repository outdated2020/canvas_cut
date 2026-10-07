import { createConnection, Socket } from 'node:net';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CanvasCutError, ERROR_CODES } from '@canvas-cut/core';

export interface IpcEnvelope<T = unknown> {
  protocolVersion: number;
  requestId: string;
  ok: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  } | null;
}

interface InstanceInfo {
  protocolVersion: number;
  instanceId: string;
  pid: number;
  endpoint: string;
  token: string;
  startedAt: number;
}

function appDataDir(): string {
  return process.env.APPDATA ? join(process.env.APPDATA, 'canvas-cut') : join(homedir(), '.canvas-cut');
}

function instanceFile(): string {
  return join(appDataDir(), 'ipc', 'instance.json');
}

export function uiScreenshotFile(): string {
  return join(appDataDir(), 'ui-screenshots', 'main-window-latest.png');
}

export class LocalIpcClient {
  constructor(private readonly projectPath?: string, private readonly idempotencyKey?: string) {}

  async request<T>(method: string, payload: unknown = {}, timeoutMs = 30_000, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const info = await this.readInstance();
    signal?.throwIfAborted();
    if (!info) {
      throw new CanvasCutError(ERROR_CODES.DAEMON_UNAVAILABLE, 'Electron main process is not running');
    }

    const requestId = randomUUID();
    const request = {
      protocolVersion: 1,
      requestId,
      method,
      projectPath: this.projectPath,
      idempotencyKey: this.idempotencyKey ?? randomUUID(),
      token: info.token,
      payload,
      sentAt: Date.now()
    };

    return new Promise<T>((resolvePromise, reject) => {
      const socket = createConnection(info.endpoint);
      socket.setEncoding('utf8');
      let buffer = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', abort);
          socket.destroy();
          reject(
            new CanvasCutError(ERROR_CODES.IPC_TIMEOUT, `Local IPC request timed out: ${method}`, {
              retryable: true
            })
          );
        }
      }, timeoutMs);

      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        socket.destroy();
        if (error) reject(error);
      };

      const abort = () => finish(new Error('Local IPC request cancelled; dispatched operations may have completed'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();

      socket.on('connect', () => {
        if (settled) return;
        socket.write(`${JSON.stringify(request)}\n`);
      });
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const response = JSON.parse(line) as IpcEnvelope<T>;
            if (response.ok) {
              finish();
              resolvePromise(response.data as T);
            } else {
              finish();
              reject(
                new CanvasCutError(
                  response.error?.code ?? 'IPC_BAD_REQUEST',
                  response.error?.message ?? 'IPC request failed',
                  { retryable: response.error?.retryable }
                )
              );
            }
          } catch (error) {
            finish(error);
          }
        }
      });
      socket.on('error', (error) => {
        finish(
          new CanvasCutError(ERROR_CODES.DAEMON_UNAVAILABLE, `Failed to connect to main process: ${error.message}`, {
            retryable: false
          })
        );
      });
      socket.on('close', () => {
        if (!settled) {
          finish(
            new CanvasCutError(ERROR_CODES.DAEMON_UNAVAILABLE, 'Main process closed the connection before responding')
          );
        }
      });
    });
  }

  private async readInstance(): Promise<InstanceInfo | null> {
    const file = instanceFile();
    try {
      const content = await fs.readFile(file, 'utf8');
      const info = JSON.parse(content) as InstanceInfo;
      if (info.protocolVersion !== 1) return null;
      if (!this.isPidAlive(info.pid)) return null;
      // A live desktop instance remains valid until it exits, regardless of uptime.
      // Stale instances are rejected by the PID check and authenticated IPC connection.
      return info;
    } catch {
      return null;
    }
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
}
