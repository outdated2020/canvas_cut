import type { ModelMessage } from 'ai';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentHost, atomicText } from './host';
import { AgentEvent, AgentRuntimeOptions, closePendingTools, runAgentMessage } from './runtime';
import { SkillRegistry } from './skills';
import { contextUsage, CONTEXT_COMPACT_THRESHOLD } from './context-usage';

export interface AgentRun {
  id: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'limited';
  startedAt: number; finishedAt?: number; text?: string; error?: string;
}
export interface AgentSession {
  version: 1; id: string; projectPath: string; conversationId: string;
  messages: ModelMessage[]; events: Array<AgentEvent & { sequence: number; runId: string }>; run?: AgentRun;
}
export interface AgentSessionOptions {
  storageDir: string;
  configure(projectPath: string): Promise<Pick<AgentRuntimeOptions, 'apiKey' | 'baseUrl' | 'model' | 'fetch'>>;
  createHost(projectPath: string, logDir: string): Promise<AgentHost> | AgentHost;
  skillDirectories(projectPath: string): string[];
  maxSteps?: number;
}

export class AgentSessionService {
  private sessions = new Map<string, AgentSession>();
  private active = new Map<string, { controller: AbortController; host?: AgentHost; done: Promise<void> }>();
  private reserved = new Set<string>();
  private loading = new Map<string, Promise<AgentSession>>();
  constructor(private options: AgentSessionOptions) {}
  private key(project: string, conversation: string) {
    const absolute = resolve(project);
    return createHash('sha256').update(JSON.stringify([process.platform === 'win32' ? absolute.toLowerCase() : absolute, conversation])).digest('hex');
  }
  private path(id: string) { return join(this.options.storageDir, `${id}.json`); }
  private async save(session: AgentSession) { await atomicText(this.path(session.id), JSON.stringify(session)); }
  private async load(projectPath: string, conversationId: string) {
    const id = this.key(projectPath, conversationId);
    const cached = this.sessions.get(id); if (cached) return cached;
    const pending = this.loading.get(id); if (pending) return pending;
    const task = (async () => {
      let session: AgentSession;
      try { session = JSON.parse(await fs.readFile(this.path(id), 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        session = { version: 1, id, projectPath: resolve(projectPath), conversationId, messages: [], events: [] };
      }
      if (session.run?.status === 'running') {
        session.run.status = 'interrupted'; session.run.finishedAt = Date.now();
        session.run.error = 'Application stopped during execution. Inspect existing state before continuing.';
        closePendingTools(session.messages, session.run.error);
        session.messages.push({ role: 'assistant', content: session.run.error });
        await this.save(session);
      }
      this.sessions.set(id, session); return session;
    })();
    this.loading.set(id, task);
    try { return await task; } finally { this.loading.delete(id); }
  }
  async history(projectPath: string, conversationId = 'default') {
    const session = await this.load(projectPath, conversationId);
    return structuredClone({ ...session, contextUsage: this.usage(session) });
  }
  private usage(session: AgentSession) {
    const latest = [...session.events].reverse().find(event => event.type === 'usage');
    return { ...contextUsage(session.messages), lastRequest: latest ? { ...(latest.data as Record<string, unknown>), timestamp: latest.timestamp } : null };
  }
  async getRun(projectPath: string, conversationId = 'default', after = 0) {
    const session = await this.load(projectPath, conversationId);
    const events = session.events.filter((event) => event.sequence > after).slice(0, 100);
    return { run: session.run, events: structuredClone(events), cursor: events.at(-1)?.sequence ?? after, contextUsage: this.usage(session) };
  }
  async start(projectPath: string, message: string, conversationId = 'default') {
    if (!message.trim()) throw new Error('Message cannot be empty');
    const id = this.key(projectPath, conversationId);
    if (this.reserved.has(id) || this.active.has(id)) throw new Error('This conversation already has a running task');
    this.reserved.add(id);
    try {
      const config = await this.options.configure(projectPath);
      if (!config.apiKey) throw new Error('Agent API key is not configured');
      const session = await this.load(projectPath, conversationId);
      await this.compact(session);
      session.messages.push({ role: 'user', content: message });
      const run: AgentRun = { id: randomUUID(), status: 'running', startedAt: Date.now() };
      session.run = run;
      await this.save(session);
      const controller = new AbortController();
      const active = { controller, host: undefined as AgentHost | undefined, done: Promise.resolve() };
      this.active.set(id, active);
      active.done = this.execute(session, active, config).catch((error) => {
        run.status = 'failed'; run.error = `Unable to finalize session: ${String(error)}`;
      }).finally(() => { this.active.delete(id); });
      return { runId: run.id, conversationId };
    } finally { this.reserved.delete(id); }
  }
  private async execute(session: AgentSession, active: { controller: AbortController; host?: AgentHost }, config: Awaited<ReturnType<AgentSessionOptions['configure']>>) {
    const run = session.run!;
    const logDir = join(this.options.storageDir, session.id, run.id);
    try {
      const host = await this.options.createHost(session.projectPath, logDir);
      active.host = host;
      const result = await runAgentMessage({
        ...config, host, skills: new SkillRegistry(this.options.skillDirectories(session.projectPath)), logDir,
        context: { sessionId: session.id, runId: run.id, signal: active.controller.signal },
        messages: session.messages, maxSteps: this.options.maxSteps,
        save: async () => this.save(session),
        emit: async (event) => {
          session.events.push({ ...event, runId: run.id, sequence: (session.events.at(-1)?.sequence ?? 0) + 1 });
          await this.save(session);
        }
      });
      run.status = active.controller.signal.aborted ? 'cancelled' : result.status; run.text = result.text;
    } catch (error) {
      run.status = active.controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      closePendingTools(session.messages, run.error);
      session.messages.push({ role: 'assistant', content: `${run.status}: ${run.error}. Existing application jobs may still be running; inspect their status before retrying.` });
    } finally {
      await active.host?.stopRun(run.id);
      run.finishedAt = Date.now();
      await this.save(session);
    }
  }
  private async compact(session: AgentSession) {
    if (JSON.stringify(session.messages).length < CONTEXT_COMPACT_THRESHOLD) return;
    const archivePath = join(this.options.storageDir, session.id, `history-${Date.now()}.json`);
    await atomicText(archivePath, JSON.stringify(session.messages, null, 2));
    const facts: string[] = [];
    const collect = (value: unknown, key = '') => {
      if (typeof value === 'string' && /id$|path$|status$|jobId|canvasId|clipId|nodeId/i.test(key)) facts.push(`${key}: ${value}`);
      else if (Array.isArray(value)) value.forEach((item) => collect(item));
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => collect(item, key));
    };
    collect(session.messages);
    let lastUser = session.messages.length - 1;
    while (lastUser >= 0 && session.messages[lastUser]?.role !== 'user') lastUser--;
    const recent = session.messages.slice(Math.max(0, lastUser));
    session.messages = [{ role: 'assistant', content: `Earlier complete turns archived at ${archivePath}. Read that file for exact history. Do not repeat completed operations. Known identifiers and paths:\n${[...new Set(facts)].join('\n').slice(-40000)}` }, ...(JSON.stringify(recent).length < 60000 ? recent : [])];
  }
  async cancel(projectPath: string, conversationId = 'default') {
    const session = await this.load(projectPath, conversationId);
    const active = this.active.get(session.id);
    if (!active) return { cancelled: false, run: session.run };
    active.controller.abort(new Error('Stopped by user'));
    await active.host?.stopRun(session.run!.id);
    return { cancelled: true, note: 'Application generation jobs are not automatically cancelled.' };
  }
  async chat(projectPath: string, message: string, conversationId = 'default') {
    await this.start(projectPath, message, conversationId);
    await this.active.get(this.key(projectPath, conversationId))?.done;
    const session = await this.load(projectPath, conversationId);
    return { text: session.run?.text ?? session.run?.error ?? '', run: session.run };
  }
  async shutdown() {
    const pending = [...this.active.values()];
    pending.forEach((active) => active.controller.abort(new Error('Application shutting down')));
    await Promise.allSettled(pending.map((active) => active.done));
  }
}
