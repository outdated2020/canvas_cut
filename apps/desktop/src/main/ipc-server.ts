import { createServer, Server, Socket } from 'node:net';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { toStructuredError } from '@canvas-cut/core';
import { DaemonService } from './daemon';
import { UiScreenshotResult } from './ui-capture';

export interface IpcServerOptions {
  agentRequest?: (method: string, projectPath: string, payload: Record<string, unknown>) => Promise<unknown>;
  userDataDir: string;
  instanceId?: string;
  captureUi?: () => Promise<UiScreenshotResult>;
}

interface Envelope {
  protocolVersion: number;
  requestId: string;
  idempotencyKey?: string;
  method: string;
  projectPath?: string;
  token?: string;
  payload: Record<string, unknown>;
}

export class LocalIpcServer {
  private server: Server | undefined;
  readonly instanceId: string;
  readonly token: string;
  readonly endpoint: string;

  constructor(
    private readonly options: IpcServerOptions,
    private readonly daemon: DaemonService,
    private readonly agentChat?: (
      projectPath: string,
      payload: Record<string, unknown>
    ) => Promise<unknown>
  ) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.token = randomUUID();
    this.endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\canvas-cut-${this.instanceId}`
        : join(options.userDataDir, 'ipc', `canvas-cut-${this.instanceId}.sock`);
  }

  async start(): Promise<void> {
    await this.writeInstanceFile();
    if (process.platform !== 'win32') {
      await fs.mkdir(dirname(this.endpoint), { recursive: true });
      await fs.rm(this.endpoint, { force: true }).catch(() => undefined);
    }

    this.server = createServer((socket) => {
      void this.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.endpoint, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    if (process.platform !== 'win32') {
      await fs.rm(this.endpoint, { force: true }).catch(() => undefined);
    }
    await fs.rm(this.instanceFile(), { force: true }).catch(() => undefined);
  }

  private instanceFile(): string {
    return join(this.options.userDataDir, 'ipc', 'instance.json');
  }

  private async writeInstanceFile(): Promise<void> {
    const file = this.instanceFile();
    await fs.mkdir(dirname(file), { recursive: true });
    const data = {
      protocolVersion: 1,
      instanceId: this.instanceId,
      pid: process.pid,
      endpoint: this.endpoint,
      token: this.token,
      startedAt: Date.now()
    };
    const tmp = `${file}.tmp-${randomUUID()}`;
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  private async handleConnection(socket: Socket): Promise<void> {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        void this.handleLine(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(line) as Envelope;
    } catch {
      this.respond(socket, {
        requestId: randomUUID(),
        ok: false,
        data: null,
        error: { code: 'IPC_BAD_REQUEST', message: 'Invalid JSON envelope', retryable: false }
      });
      return;
    }

    if (envelope.protocolVersion !== 1) {
      this.respond(socket, {
        requestId: envelope.requestId ?? randomUUID(),
        ok: false,
        data: null,
        error: { code: 'IPC_PROTOCOL_VERSION', message: 'Unsupported IPC protocol version', retryable: false }
      });
      return;
    }
    if (envelope.token !== this.token) {
      this.respond(socket, {
        requestId: envelope.requestId ?? randomUUID(),
        ok: false,
        data: null,
        error: { code: 'IPC_AUTH_FAILED', message: 'IPC authentication failed', retryable: false }
      });
      return;
    }

    try {
      const data = await this.dispatch(envelope);
      this.respond(socket, {
        requestId: envelope.requestId,
        ok: true,
        data,
        error: null
      });
    } catch (error) {
      this.respond(socket, {
        requestId: envelope.requestId,
        ok: false,
        data: null,
        error: toStructuredError(error)
      });
    }
  }

  private async dispatch(envelope: Envelope): Promise<unknown> {
    const projectPath = envelope.projectPath;
    switch (envelope.method) {
      case 'ping':
        return { pong: true, instanceId: this.instanceId };
      case 'job.submit':
        if (!projectPath) throw new Error('projectPath is required for job.submit');
        return this.daemon.submitJob(projectPath, envelope.payload, envelope.idempotencyKey);
      case 'job.status':
        if (!projectPath) throw new Error('projectPath is required for job.status');
        return this.daemon.getJob(projectPath, String(envelope.payload.jobId ?? ''));
      case 'job.wait':
        if (!projectPath) throw new Error('projectPath is required for job.wait');
        return this.daemon.waitJob(
          projectPath,
          String(envelope.payload.jobId ?? ''),
          Number(envelope.payload.timeoutMs ?? 1_800_000)
        );
      case 'job.cancel':
        if (!projectPath) throw new Error('projectPath is required for job.cancel');
        return this.daemon.cancelJob(projectPath, String(envelope.payload.jobId ?? ''));
      case 'job.list':
        if (!projectPath) throw new Error('projectPath is required for job.list');
        return this.daemon.listJobs(
          projectPath,
          typeof envelope.payload.status === 'string' ? envelope.payload.status : undefined
        );
      case 'job.clear':
        if (!projectPath) throw new Error('projectPath is required for job.clear');
        return this.daemon.clearJobs(
          projectPath,
          typeof envelope.payload.status === 'string' ? envelope.payload.status : undefined
        );
      case 'agent.start':
      case 'agent.get-run':
      case 'agent.history':
      case 'agent.cancel':
        if (!projectPath) throw new Error('projectPath is required for Agent operations');
        if (!this.options.agentRequest) throw new Error('Agent operations are unavailable');
        return this.options.agentRequest(envelope.method, projectPath, envelope.payload);
      case 'agent.chat':
        if (!projectPath) throw new Error('projectPath is required for agent.chat');
        if (!this.agentChat) throw new Error('Agent chat is not available in this IPC server');
        return this.agentChat(projectPath, envelope.payload);
      case 'ui.screenshot':
        if (!this.options.captureUi) {
          throw new Error('UI capture is not available');
        }
        return this.options.captureUi();
      default:
        throw new Error(`Unknown IPC method: ${envelope.method}`);
    }
  }

  private respond(
    socket: Socket,
    body: {
      requestId: string;
      ok: boolean;
      data: unknown;
      error: { code: string; message: string; retryable?: boolean } | null;
    }
  ): void {
    socket.write(`${JSON.stringify({ protocolVersion: 1, ...body })}\n`);
  }
}
