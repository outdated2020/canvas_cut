import { promises as fs, appendFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IPty } from 'node-pty';
import { cleanEnvironment, ToolContext } from './host';
/** node-pty 1.1.0's Windows cleanup races AttachConsole and retains its drain
 * worker on natural exit. Keep this version-specific workaround at the adapter
 * boundary; native smoke tests cover both Node and Electron. */
export function createTerminal(executable: string, args: string[], options: import('node-pty').IPtyForkOptions | import('node-pty').IWindowsPtyForkOptions): IPty {
  const module: typeof import('node-pty') = require('node-pty');
  const pty = module.spawn(executable, args, { ...options, useConptyDll: false });
  if (process.platform === 'win32') {
    const agent = (pty as unknown as { _agent: { _getConsoleProcessList(): Promise<number[]>; kill(): void; _conoutSocketWorker: { dispose(): void }; _inSocket: { destroy(): void } } })._agent;
    const kill = agent.kill.bind(agent), list = agent._getConsoleProcessList.bind(agent);
    let killing = false;
    agent.kill = () => {
      if (killing) return; killing = true;
      void list().then(pids => { agent._getConsoleProcessList = async () => pids; kill(); }).catch(() => kill());
    };
    pty.onExit(() => { agent._conoutSocketWorker.dispose(); agent._inSocket.destroy(); });
  }
  return pty;
}
interface RecordValue { id: string; pty: IPty; runId: string; sessionId: string; path: string; size: number; status: string; exitCode: number | null; done: Promise<void>; timer?: NodeJS.Timeout; error?: string }
export class PtyProcesses {
  private records = new Map<string, RecordValue>();
  constructor(private options: { cwd: string; logDir: string; env?: NodeJS.ProcessEnv; bashPath?: string; powershellPath?: string }) {}
  has(id: string) { return this.records.has(id); }
  async bashPath() {
    if (this.options.bashPath) return this.options.bashPath;
    if (process.platform !== 'win32') return '/bin/bash';
    for (const path of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']) {
      try { await fs.access(path); return path; } catch {}
    }
    throw new Error('Bash unavailable: configure a Git Bash executable');
  }
  async execute(name: string, args: Record<string, any>, ctx: ToolContext): Promise<unknown> {
    if (name === 'exec_command') return this.start(args, ctx);
    const record = this.records.get(args.processId);
    if (!record || record.runId !== ctx.runId || record.sessionId !== ctx.sessionId) throw new Error('PTY not found in this session/run');
    ctx.signal.throwIfAborted();
    if (name === 'terminate_process') await this.kill(record, 'cancelled');
    if (name === 'resize_terminal') { if (record.status !== 'running') throw new Error('PTY exited'); record.pty.resize(args.cols, args.rows); return { resized: true }; }
    if (name === 'write_stdin') {
      const action = args.action ?? 'write', chars = args.chars ?? '';
      if (chars || action !== 'write') {
        if (record.status !== 'running') throw new Error('PTY exited');
        if (action === 'eof') throw new Error('PTY has no portable EOF; send the shell-specific control character in chars');
        if (Buffer.byteLength(chars) > 1024 * 1024) throw new Error('Input exceeds 1 MiB');
        record.pty.write(action === 'interrupt' ? '\x03' : chars);
      }
    }
    await this.wait(record, args.waitMs ?? 1000); return this.output(record, args.stdoutOffset ?? 0);
  }
  private async start(args: Record<string, any>, ctx: ToolContext) {
    let module: typeof import('node-pty');
    try { module = require('node-pty'); } catch (e) { throw new Error(`PTY unavailable; rebuild node-pty for this runtime: ${String(e)}`); }
    const powershell = args.shell ? args.shell === 'powershell' : process.platform === 'win32';
    const executable = powershell ? this.options.powershellPath ?? 'powershell.exe' : await this.bashPath();
    const shellArgs = powershell ? ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(args.command, 'utf16le').toString('base64')] : ['--noprofile', '--norc', '-c', args.command];
    const env = cleanEnvironment(process.env);
    for (const [key, value] of Object.entries(this.options.env ?? {})) { if (process.platform === 'win32') for (const k of Object.keys(env)) if (k.toLowerCase() === key.toLowerCase()) delete env[k]; env[key] = value; }
    const id = randomUUID(), path = join(this.options.logDir, `${id}.pty.log`);
    await fs.mkdir(this.options.logDir, { recursive: true }); await fs.writeFile(path, ''); ctx.signal.throwIfAborted();
    const pty = createTerminal(executable, shellArgs, { cwd: resolve(this.options.cwd, args.cwd ?? '.'), env: env as Record<string, string>, cols: args.cols ?? 100, rows: args.rows ?? 30, name: 'xterm-256color' });
    let finish!: () => void;
    const record: RecordValue = { id, pty, path, runId: ctx.runId, sessionId: ctx.sessionId, size: 0, status: 'running', exitCode: null, done: new Promise(r => { finish = r; }) };
    this.records.set(id, record);
    const abort = () => { void this.kill(record, 'cancelled'); };
    pty.onData(data => { if (data.includes('\x1b[6n')) pty.write('\x1b[1;1R'); record.size += Buffer.byteLength(data); if (record.size > 64 * 1024 * 1024) { record.error = 'PTY log exceeded 64 MiB'; void this.kill(record, 'failed'); } else { try { appendFileSync(path, data); } catch (e) { record.error = String(e); void this.kill(record, 'failed'); } } });
    pty.onExit(event => { record.exitCode = event.exitCode; if (record.status === 'running') record.status = event.exitCode === 0 ? 'completed' : 'failed'; clearTimeout(record.timer); ctx.signal.removeEventListener('abort', abort); finish(); });
    ctx.signal.addEventListener('abort', abort, { once: true });
    record.timer = setTimeout(() => void this.kill(record, 'timed-out'), args.timeoutMs ?? 1800000);
    if (ctx.signal.aborted) abort();
    await this.wait(record, args.yieldTimeMs ?? 1000); return this.output(record, 0);
  }
  private async wait(record: RecordValue, ms: number) { let timer: NodeJS.Timeout | undefined; await Promise.race([record.done, new Promise<void>(r => { timer = setTimeout(r, ms); })]); clearTimeout(timer); }
  private output(record: RecordValue, offset: number) {
    const fd = openSync(record.path, 'r'); let text: string; let size: number;
    try {
      const buffer = Buffer.alloc(10000); size = readSync(fd, buffer, 0, buffer.length, offset);
      if (size) { let lead = size - 1; while (lead > 0 && (buffer[lead]! & 0xc0) === 0x80) lead--; const byte = buffer[lead]!; const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1; if (size - lead < width) size = lead; }
      text = buffer.subarray(0, size).toString('utf8');
    } finally { closeSync(fd); }
    return { processId: record.id, tty: true, status: record.status, exitCode: record.exitCode, error: record.error, stdout: { text, nextOffset: offset + size, logPath: record.path }, stderr: { text: '', nextOffset: 0 } };
  }
  private async kill(record: RecordValue, status: string) {
    if (record.status !== 'running') return;
    record.status = status;
    // node-pty enumerates and kills the Windows console tree itself. Killing the
    // shell with taskkill first races its AttachConsole helper.
    if (process.platform !== 'win32') { try { process.kill(-record.pty.pid, 'SIGKILL'); } catch {} }
    try { record.pty.kill(); } catch {} await this.wait(record, 3000);
  }
  async stopRun(runId: string) { await Promise.all([...this.records.values()].filter(r => r.runId === runId).map(r => this.kill(r, 'cancelled'))); }
}
