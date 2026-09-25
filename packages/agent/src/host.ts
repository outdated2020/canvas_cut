import { promises as fs, appendFileSync, readSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { FileTools, recoverPatches } from './files';
import { ToolRegistry, BASE_TOOLS } from './tools';
import { PtyProcesses } from './pty';

export const OUTPUT_LIMIT = 32 * 1024;
export interface ToolContext { sessionId: string; runId: string; toolCallId?: string; signal: AbortSignal }
export interface AgentHost {
  mode: string;
  cwd: string;
  shell: string;
  execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
  stopRun(runId: string): Promise<void>;
}
interface ProcessRecord {
  id: string; runId: string; sessionId: string; child: ChildProcess;
  stdoutPath: string; stderrPath: string; exitCode: number | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed-out';
  done: Promise<void>; timer?: NodeJS.Timeout;
  writes?: Promise<unknown>; size?: number; error?: string;
}
export async function atomicText(path: string, content: string) {
  await fs.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, content, 'utf8'); await fs.rename(temp, path); }
  finally { await fs.rm(temp, { force: true }); }
}
function textArg(args: Record<string, unknown>, key: string): string {
  if (typeof args[key] !== 'string') throw new Error(`${key} must be a string`);
  return args[key] as string;
}
function bounded(value: unknown, fallback: number, maximum: number, minimum = 0): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`Expected integer ${minimum}..${maximum}`);
  return Number(value);
}
export function cleanEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!/(API_?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|ACCESS_KEY|ELECTRON_RUN_AS_NODE)/i.test(key)) result[key] = value;
  }
  return result;
}

/** Trusted local execution: cwd is a default, not an access-control boundary. */
export class LocalAgentHost implements AgentHost {
  readonly mode = 'local-trusted';
  readonly cwd: string;
  readonly shell = process.platform === 'win32' ? 'PowerShell' : 'Bash';
  private processes = new Map<string, ProcessRecord>();
  private files: FileTools;
  private registry = new ToolRegistry();
  private pty: PtyProcesses;
  private ready: Promise<unknown>;
  constructor(private options: { cwd: string; logDir: string; env?: NodeJS.ProcessEnv; bashPath?: string; powershellPath?: string; journalDir?: string }) {
    this.cwd = resolve(options.cwd);
    const journal = options.journalDir ?? join(options.logDir, 'patches');
    this.files = new FileTools(this.cwd, journal); this.ready = recoverPatches(journal);
    this.pty = new PtyProcesses(options);
    for (const [name, spec] of Object.entries(BASE_TOOLS)) this.registry.register({ name, description: spec.description,
      inputSchema: { type: 'object', properties: spec.properties, required: spec.required, additionalProperties: false },
      execute: (args, context) => this.dispatch(name, args, context) });
  }

  async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    await this.ready;
    return this.registry.execute(name, args, context);
  }
  private async dispatch(name: string, args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    context.signal.throwIfAborted();
    if (['list_files', 'read_file', 'write_file', 'apply_patch', 'search_files', 'search_text'].includes(name)) return this.files.execute(name, args, context);
    if ((name === 'exec_command' && args.tty) || this.pty.has(String(args.processId ?? ''))) return this.pty.execute(name, args, context);
    switch (name) {
      case 'exec_command': return this.start(args, context);
      case 'write_stdin': {
        const record = this.owned(textArg(args, 'processId'), context);
        const next = (record.writes ?? Promise.resolve()).catch(() => undefined).then(async () => {
          context.signal.throwIfAborted();
          const chars = String(args.chars ?? ''), action = args.action ?? 'write';
          if (!chars && action === 'write') return;
          if (record.status !== 'running') throw new Error('Process has exited');
          if (Buffer.byteLength(chars) > 1024 * 1024) throw new Error('Input exceeds 1 MiB');
          if (action === 'eof') record.child.stdin!.end();
          else if (action === 'interrupt') {
            if (process.platform === 'win32') throw new Error('Use tty for Ctrl-C on Windows, or terminate_process');
            process.kill(-record.child.pid!, 'SIGINT');
          } else await new Promise<void>((done, reject) => record.child.stdin!.write(chars, error => error ? reject(error) : done()));
        });
        record.writes = next; await next;
        if (record.status === 'running') await this.wait(record.done, Number(args.waitMs ?? 1000));
        return this.output(record, Number(args.stdoutOffset ?? 0), Number(args.stderrOffset ?? 0));
      }
      case 'read_process_output': {
        const record = this.owned(textArg(args, 'processId'), context);
        const waitMs = bounded(args.waitMs, 1000, 10000);
        if (record.status === 'running') await this.wait(record.done, waitMs);
        return this.output(record, bounded(args.stdoutOffset, 0, Number.MAX_SAFE_INTEGER), bounded(args.stderrOffset, 0, Number.MAX_SAFE_INTEGER));
      }
      case 'terminate_process': {
        const record = this.owned(textArg(args, 'processId'), context);
        await this.kill(record, 'cancelled');
        return this.output(record, 0, 0);
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }
  private owned(id: string, context: ToolContext) {
    const record = this.processes.get(id);
    if (!record || record.sessionId !== context.sessionId || record.runId !== context.runId) throw new Error('Process not found in this session/run; processes do not survive application restart');
    return record;
  }
  private async start(args: Record<string, unknown>, context: ToolContext) {
    const command = textArg(args, 'command');
    const cwd = args.cwd === undefined ? this.cwd : resolve(this.cwd, textArg(args, 'cwd'));
    const timeoutMs = bounded(args.timeoutMs, 1800000, 1800000, 100);
    const id = randomUUID();
    await fs.mkdir(this.options.logDir, { recursive: true });
    const stdoutPath = join(this.options.logDir, `${id}.stdout.log`);
    const stderrPath = join(this.options.logDir, `${id}.stderr.log`);
    await Promise.all([fs.writeFile(stdoutPath, ''), fs.writeFile(stderrPath, '')]);
    const windows = process.platform === 'win32';
    const prelude = "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n";
    const powershell = args.shell ? args.shell === 'powershell' : windows;
    const executable = powershell ? this.options.powershellPath ?? 'powershell.exe' : await this.pty.bashPath();
    const shellArgs = powershell
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prelude + command, 'utf16le').toString('base64')]
      : ['--noprofile', '--norc', '-c', command];
    const env = cleanEnvironment(process.env);
    for (const [key, value] of Object.entries(this.options.env ?? {})) {
      if (windows) for (const existing of Object.keys(env)) if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
      env[key] = value;
    }
    const child = spawn(executable, shellArgs, {
      cwd, env, windowsHide: true,
      detached: !windows, stdio: ['pipe', 'pipe', 'pipe']
    });
    let finish!: () => void;
    const record: ProcessRecord = { id, runId: context.runId, sessionId: context.sessionId, child, stdoutPath, stderrPath, exitCode: null, status: 'running', done: new Promise((r) => { finish = r; }) };
    this.processes.set(id, record);
    const append = (file: string, chunk: Buffer) => {
      record.size = (record.size ?? 0) + chunk.length;
      if (record.size > 64 * 1024 * 1024) { record.error = 'Process log exceeded 64 MiB'; void this.kill(record, 'failed'); return; }
      try { appendFileSync(file, chunk); } catch { void this.kill(record, 'failed'); }
    };
    child.stdin?.on('error', error => { record.error = error.message; });
    child.stdout?.on('data', (chunk: Buffer) => append(stdoutPath, chunk));
    child.stderr?.on('data', (chunk: Buffer) => append(stderrPath, chunk));
    const abort = () => { void this.kill(record, 'cancelled'); };
    context.signal.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => { append(stderrPath, Buffer.from(error.message)); record.status = 'failed'; });
    child.on('close', (code) => {
      record.exitCode = code;
      if (record.status === 'running') record.status = code === 0 ? 'completed' : 'failed';
      clearTimeout(record.timer); context.signal.removeEventListener('abort', abort); finish();
    });
    record.timer = setTimeout(() => { void this.kill(record, 'timed-out'); }, timeoutMs);
    if (context.signal.aborted) abort();
    await this.wait(record.done, Number(args.yieldTimeMs ?? 1000));
    return this.output(record, 0, 0);
  }
  private async wait(done: Promise<void>, ms: number) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([done, new Promise<void>((r) => { timer = setTimeout(r, ms); })]);
    clearTimeout(timer);
  }
  private output(record: ProcessRecord, stdoutOffset: number, stderrOffset: number) {
    const read = (path: string, offset: number) => {
      const fd = openSync(path, 'r');
      try {
        const buffer = Buffer.alloc(OUTPUT_LIMIT / 3);
        let size = readSync(fd, buffer, 0, buffer.length, offset);
        // Leave an incomplete UTF-8 character for the next incremental read.
        if (size) {
          let lead = size - 1;
          while (lead > 0 && (buffer[lead]! & 0xc0) === 0x80) lead--;
          const byte = buffer[lead]!;
          const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
          if (size - lead < width) size = lead;
        }
        return { text: buffer.subarray(0, size).toString('utf8'), nextOffset: offset + size, logPath: path };
      } finally { closeSync(fd); }
    };
    return { processId: record.id, status: record.status, exitCode: record.exitCode, error: record.error, stdout: read(record.stdoutPath, stdoutOffset), stderr: read(record.stderrPath, stderrOffset) };
  }
  private async kill(record: ProcessRecord, status: ProcessRecord['status']) {
    if (record.status !== 'running') { await this.wait(record.done, 3000); return; }
    record.status = status;
    if (!record.child.pid) return;
    if (process.platform === 'win32') {
      await new Promise<void>((done) => {
        const killer = spawn('taskkill.exe', ['/PID', String(record.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { record.child.kill(); done(); });
        killer.on('close', (code) => { if (code !== 0) record.child.kill(); done(); });
      });
    } else {
      try { process.kill(-record.child.pid, 'SIGKILL'); } catch { record.child.kill('SIGKILL'); }
    }
    await this.wait(record.done, 3000);
  }
  async stopRun(runId: string) { await Promise.all([this.pty.stopRun(runId), ...[...this.processes.values()].filter((p) => p.runId === runId).map((p) => this.kill(p, 'cancelled'))]); }
}
