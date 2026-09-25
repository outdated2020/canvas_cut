import type { ModelMessage } from 'ai';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentHost, atomicText } from './host';
import { AgentEvent, AgentRuntimeOptions, closePendingTools, runAgentMessage } from './runtime';
import { SkillRegistry } from './skills';
import { contextUsage } from './context-usage';

export interface AgentRun {
  id: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'limited';
  startedAt: number; finishedAt?: number; text?: string; error?: string;
}
export interface AgentSession {
  version: 1; id: string; projectPath: string; conversationId: string;
  title?: string; createdAt?: number; updatedAt?: number; archivedAt?: number; deletedAt?: number;
  messages: ModelMessage[]; events: Array<AgentEvent & { sequence: number; runId: string }>; run?: AgentRun;
  contextBudget?: { limit?: number; threshold?: number };
}
export interface AgentSessionOptions {
  storageDir: string;
  configure(projectPath: string): Promise<Pick<AgentRuntimeOptions, 'apiKey' | 'baseUrl' | 'model' | 'fetch' | 'streaming' | 'applicationPrompt' | 'mcpServers' | 'contextLimitCharacters' | 'compactThresholdCharacters' | 'maxSteps' | 'supportsImages'>>;
  createHost(projectPath: string, logDir: string): Promise<AgentHost> | AgentHost;
  skillDirectories(projectPath: string): string[];
  maxSteps?: number;
}

export class AgentSessionService {
  private sessions = new Map<string, AgentSession>();
  private active = new Map<string, { controller: AbortController; host?: AgentHost; done: Promise<void> }>();
  private reserved = new Set<string>();
  private loading = new Map<string, Promise<AgentSession>>();
  private writes = new Map<string, Promise<void>>();
  constructor(private options: AgentSessionOptions) {}
  private key(project: string, conversation: string) {
    const absolute = resolve(project);
    return createHash('sha256').update(JSON.stringify([process.platform === 'win32' ? absolute.toLowerCase() : absolute, conversation])).digest('hex');
  }
  private path(id: string) { return join(this.options.storageDir, `${id}.json`); }
  private async save(session: AgentSession) {
    const snapshot = JSON.stringify(session);
    const next = (this.writes.get(session.id) ?? Promise.resolve()).catch(() => undefined).then(() => atomicText(this.path(session.id), snapshot));
    this.writes.set(session.id, next); await next;
  }
  private async load(projectPath: string, conversationId: string) {
    const id = this.key(projectPath, conversationId);
    const cached = this.sessions.get(id); if (cached) return cached;
    const pending = this.loading.get(id); if (pending) return pending;
    const task = (async () => {
      let session: AgentSession;
      try {
        session = JSON.parse(await fs.readFile(this.path(id), 'utf8'));
        const backup = this.path(id) + '.v1.bak';
        try { await fs.copyFile(this.path(id), backup, 1); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        session = { version: 1, id, projectPath: resolve(projectPath), conversationId, messages: [], events: [] };
      }
      try {
        const logPath = join(this.options.storageDir, `${id}.events.jsonl`);
        const log = await fs.readFile(logPath, 'utf8'), boundary = log.lastIndexOf('\n') + 1;
        // A torn tail was never fully committed/published. Remove it before append.
        if (boundary !== log.length) await fs.truncate(logPath, Buffer.byteLength(log.slice(0, boundary)));
        let known = session.events.at(-1)?.sequence ?? 0;
        for (const line of log.slice(0, boundary).split('\n').filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.sequence > known) {
            session.events.push(event); known = event.sequence;
            if (event.type === 'run-finished' && event.runId === session.run?.id) session.run = event.data;
          }
        }
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
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
    if (session.deletedAt) throw new Error('Conversation has been deleted');
    return structuredClone({ ...session, contextUsage: this.usage(session) });
  }
  private summary(session: AgentSession) {
    return { conversationId: session.conversationId, title: session.title || (session.conversationId === 'default' ? '默认对话' : '新对话'),
      createdAt: session.createdAt ?? session.run?.startedAt ?? 0,
      updatedAt: session.updatedAt ?? session.run?.finishedAt ?? session.run?.startedAt ?? 0,
      archivedAt: session.archivedAt, deletedAt: session.deletedAt, status: session.run?.status };
  }
  async list(projectPath: string) {
    let files: string[] = [];
    try { files = await fs.readdir(this.options.storageDir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const file of files.filter(file => /^[a-f0-9]{64}\.json$/.test(file))) {
      if (this.sessions.has(file.slice(0, -5))) continue;
      const stored = JSON.parse(await fs.readFile(join(this.options.storageDir, file), 'utf8')) as AgentSession;
      if (this.key(projectPath, stored.conversationId) === stored.id) await this.load(projectPath, stored.conversationId);
    }
    let sessions = [...this.sessions.values()].filter(session => this.key(projectPath, session.conversationId) === session.id);
    if (!sessions.length) {
      const session = await this.load(projectPath, 'default');
      session.createdAt ??= Date.now(); await this.save(session); sessions = [session];
    }
    for (const session of sessions) if (!session.createdAt) {
      session.createdAt = session.run?.startedAt ?? Date.now();
      await this.save(session);
    }
    return sessions.filter(session => !session.deletedAt).map(session => this.summary(session)).sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  }
  async create(projectPath: string) {
    const session = await this.load(projectPath, randomUUID());
    session.createdAt = session.updatedAt = Date.now();
    await this.save(session); return this.summary(session);
  }
  async manage(projectPath: string, conversationId: string, action: string, title?: string) {
    if (!['rename', 'archive', 'restore', 'delete'].includes(action)) throw new Error('Invalid conversation action');
    if (action === 'rename' && (!title?.trim() || title.trim().length > 120)) throw new Error('Title must contain 1–120 characters');
    const id = this.key(projectPath, conversationId);
    if (this.reserved.has(id) || this.active.has(id)) throw new Error('请先停止此对话的任务，再管理对话');
    this.reserved.add(id);
    try {
      const session = await this.load(projectPath, conversationId);
      if (session.deletedAt && action !== 'restore') throw new Error('Conversation has been deleted');
      if (action === 'rename') session.title = title!.trim();
      if (action === 'archive') session.archivedAt = Date.now();
      if (action === 'restore') { delete session.archivedAt; delete session.deletedAt; }
      if (action === 'delete') session.deletedAt = Date.now();
      session.updatedAt = Date.now(); await this.save(session);
      return this.summary(session);
    } finally { this.reserved.delete(id); }
  }
  private usage(session: AgentSession) {
    const latest = [...session.events].reverse().find(event => event.type === 'usage');
    const data = latest?.data as { contextCharacters?: number; inputTokens?: number; overheadCharacters?: number } | undefined;
    return { ...contextUsage(session.messages, { ...session.contextBudget, overhead: data?.overheadCharacters, charactersPerToken: data?.inputTokens && data.contextCharacters ? data.contextCharacters / data.inputTokens : undefined }), lastRequest: latest ? { ...(latest.data as Record<string, unknown>), timestamp: latest.timestamp } : null };
  }
  async getRun(projectPath: string, conversationId = 'default', after = 0) {
    const session = await this.load(projectPath, conversationId);
    if (session.deletedAt) throw new Error('Conversation has been deleted');
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
      if (session.deletedAt || session.archivedAt) throw new Error('请先恢复此对话再发送消息');
      session.createdAt ??= Date.now(); session.updatedAt = Date.now();
      session.title ??= message.trim().replace(/\s+/g, ' ').slice(0, 60);
      session.contextBudget = { limit: config.contextLimitCharacters, threshold: config.compactThresholdCharacters };
      session.messages.push({ role: 'user', content: message });
      const recoveryContext = session.run?.status === 'interrupted'
        ? `The previous run ${session.run.id} was interrupted. Its error was: ${session.run.error ?? 'unknown'}. Inspect persisted state before repeating any operation.`
        : undefined;
      const run: AgentRun = { id: randomUUID(), status: 'running', startedAt: Date.now() };
      session.run = run;
      await this.save(session);
      const controller = new AbortController();
      const active = { controller, host: undefined as AgentHost | undefined, done: Promise.resolve() };
      this.active.set(id, active);
      active.done = this.execute(session, active, config, recoveryContext).catch((error) => {
        run.status = 'failed'; run.error = `Unable to finalize session: ${String(error)}`;
      }).finally(() => { this.active.delete(id); });
      return { runId: run.id, conversationId };
    } finally { this.reserved.delete(id); }
  }
  private async execute(session: AgentSession, active: { controller: AbortController; host?: AgentHost }, config: Awaited<ReturnType<AgentSessionOptions['configure']>>, recoveryContext?: string) {
    const run = session.run!;
    const logDir = join(this.options.storageDir, session.id, run.id);
    try {
      const host = await this.options.createHost(session.projectPath, logDir);
      active.host = host;
      const result = await runAgentMessage({
        ...config, recoveryContext, projectPath: session.projectPath, host, skills: new SkillRegistry(this.options.skillDirectories(session.projectPath)), logDir,
        context: { sessionId: session.id, runId: run.id, signal: active.controller.signal },
        messages: session.messages, maxSteps: config.maxSteps ?? this.options.maxSteps,
        save: async (messages) => { session.messages = messages; await this.save(session); },
        emit: async (event) => {
          const record = { ...event, runId: run.id, sequence: (session.events.at(-1)?.sequence ?? 0) + 1 };
          await fs.appendFile(join(this.options.storageDir, `${session.id}.events.jsonl`), JSON.stringify(record) + '\n');
          session.events.push(record);
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
      const event = { type: 'run-finished', data: { ...run }, timestamp: Date.now(), runId: run.id, sequence: (session.events.at(-1)?.sequence ?? 0) + 1 };
      await fs.appendFile(join(this.options.storageDir, `${session.id}.events.jsonl`), JSON.stringify(event) + '\n'); session.events.push(event);
      await this.save(session);
    }
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
