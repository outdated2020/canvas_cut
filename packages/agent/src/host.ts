import { promises as fs, appendFileSync, readSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';

export const OUTPUT_LIMIT = 32 * 1024;
export interface ToolContext { sessionId: string; runId: string; signal: AbortSignal }
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
  constructor(private options: { cwd: string; logDir: string; env?: NodeJS.ProcessEnv }) { this.cwd = resolve(options.cwd); }

  async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    context.signal.throwIfAborted();
    const path = () => resolve(this.cwd, textArg(args, 'path'));
    switch (name) {
      case 'list_files': {
        const root = path();
        const depth = bounded(args.depth, 1, 5, 1);
        const offset = bounded(args.offset, 0, 100000);
        const limit = bounded(args.limit, 100, 500, 1);
        const entries: Array<{ path: string; type: string }> = [];
        let visited = 0; let more = false;
        const walk = async (dir: string, level: number): Promise<void> => {
          const children = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
          for (const child of children) {
            context.signal.throwIfAborted();
            if (entries.length >= limit) { more = true; return; }
            const file = join(dir, child.name);
            if (visited++ >= offset) entries.push({ path: file, type: child.isSymbolicLink() ? 'symlink' : child.isDirectory() ? 'directory' : 'file' });
            if (child.isDirectory() && level < depth) await walk(file, level + 1);
            if (more) return;
          }
        };
        await walk(root, 1);
        return { path: root, entries, nextOffset: more ? offset + entries.length : null };
      }
      case 'read_file': {
        const file = path();
        const start = bounded(args.startLine, 1, 10000000, 1);
        const limit = bounded(args.lineCount, 200, 2000, 1);
        const stat = await fs.stat(file);
        if (stat.size > 16 * 1024 * 1024) throw new Error('Text file exceeds 16 MiB; use shell for targeted reading');
        const content = await fs.readFile(file, 'utf8');
        if (content.includes('\0')) throw new Error('Binary files are not supported');
        const lines = content.split(/\r?\n/);
        return { path: file, startLine: start, totalLines: lines.length, content: lines.slice(start - 1, start - 1 + limit).join('\n'), nextLine: start - 1 + limit < lines.length ? start + limit : null };
      }
      case 'write_file': {
        const file = path(); const content = textArg(args, 'content');
        if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('Writes are limited to 1 MiB per call');
        await atomicText(file, content);
        return { path: file, bytes: Buffer.byteLength(content) };
      }
      case 'edit_file': {
        const file = path(); const old = textArg(args, 'oldText'); const replacement = textArg(args, 'newText');
        if (!old) throw new Error('oldText cannot be empty');
        const original = await fs.readFile(file, 'utf8');
        const position = original.indexOf(old);
        if (position < 0 || original.indexOf(old, position + 1) >= 0) throw new Error('oldText must match exactly once');
        const latest = await fs.readFile(file, 'utf8');
        if (latest !== original) throw new Error('File changed while editing; read it again');
        await atomicText(file, original.slice(0, position) + replacement + original.slice(position + old.length));
        return { path: file, edited: true };
      }
      case 'exec_command': return this.start(args, context);
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
    if (!record || record.sessionId !== context.sessionId) throw new Error('Process not found in this session; processes do not survive application restart');
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
    const shellArgs = windows
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prelude + command, 'utf16le').toString('base64')]
      : ['--noprofile', '--norc', '-c', command];
    const env = cleanEnvironment(process.env);
    for (const [key, value] of Object.entries(this.options.env ?? {})) {
      if (windows) for (const existing of Object.keys(env)) if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
      env[key] = value;
    }
    const child = spawn(windows ? 'powershell.exe' : '/bin/bash', shellArgs, {
      cwd, env, windowsHide: true,
      detached: !windows, stdio: ['ignore', 'pipe', 'pipe']
    });
    let finish!: () => void;
    const record: ProcessRecord = { id, runId: context.runId, sessionId: context.sessionId, child, stdoutPath, stderrPath, exitCode: null, status: 'running', done: new Promise((r) => { finish = r; }) };
    this.processes.set(id, record);
    const append = (file: string, chunk: Buffer) => { try { appendFileSync(file, chunk); } catch { void this.kill(record, 'failed'); } };
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
    await this.wait(record.done, 1000);
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
    return { processId: record.id, status: record.status, exitCode: record.exitCode, stdout: read(record.stdoutPath, stdoutOffset), stderr: read(record.stderrPath, stderrOffset) };
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
  async stopRun(runId: string) { await Promise.all([...this.processes.values()].filter((p) => p.runId === runId).map((p) => this.kill(p, 'cancelled'))); }
}
