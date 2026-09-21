import type { JobRecord } from '@canvas-cut/core';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteJson } from '@canvas-cut/core';

const COLUMNS = [
  'id',
  'parent_id',
  'type',
  'status',
  'progress',
  'provider_task_id',
  'request_snapshot',
  'canvas_id',
  'node_id',
  'result',
  'error',
  'created_at',
  'updated_at'
] as const;

export interface JobStore {
  init(): void;
  insert(record: JobRecord): void;
  update(id: string, patch: Partial<JobRecord>): void;
  get(id: string): JobRecord | undefined;
  list(options?: { status?: string; parentId?: string | null; limit?: number }): JobRecord[];
  clear(options?: { status?: string }): number;
  close(): void;
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export class SqliteJobStore implements JobStore {
  private db: any;

  constructor(private readonly filePath: string) {}

  init(): void {
    const DatabaseCtor = require('better-sqlite3') as new (filePath: string) => any;
    this.db = new DatabaseCtor(this.filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL,
        provider_task_id TEXT,
        request_snapshot TEXT,
        canvas_id TEXT,
        node_id TEXT,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_parent_id ON jobs(parent_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at);
    `);
  }

  insert(record: JobRecord): void {
    const db = this.requireDb();
    const statement = db.prepare(`
      INSERT INTO jobs (${COLUMNS.join(', ')})
      VALUES (${COLUMNS.map(() => '?').join(', ')})
    `);
    statement.run(
      record.id,
      record.parent_id ?? null,
      record.type,
      record.status,
      record.progress ?? null,
      record.provider_task_id ?? null,
      record.request_snapshot ?? null,
      record.canvas_id ?? null,
      record.node_id ?? null,
      toNullableString(record.result),
      toNullableString(record.error),
      record.created_at,
      record.updated_at
    );
  }

  update(id: string, patch: Partial<JobRecord>): void {
    const db = this.requireDb();
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const column of COLUMNS) {
      if (column === 'id' || !(column in patch)) continue;
      updates.push(`${column} = ?`);
      values.push(patch[column] ?? null);
    }
    if (updates.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  get(id: string): JobRecord | undefined {
    return this.requireDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRecord | undefined;
  }

  list(options?: { status?: string; parentId?: string | null; limit?: number }): JobRecord[] {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options?.status) {
      conditions.push('status = ?');
      values.push(options.status);
    }
    if (options?.parentId !== undefined) {
      conditions.push('parent_id IS ?');
      values.push(options.parentId);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ? ` LIMIT ?` : '';
    if (options?.limit) values.push(options.limit);
    return this.requireDb()
      .prepare(`SELECT * FROM jobs${where} ORDER BY created_at DESC${limit}`)
      .all(...values) as JobRecord[];
  }

  clear(options?: { status?: string }): number {
    const db = this.requireDb();
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options?.status) {
      conditions.push('status = ?');
      values.push(options.status);
    } else {
      conditions.push("status IN ('succeeded', 'failed', 'cancelled')");
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const result = db.prepare(`DELETE FROM jobs${where}`).run(...values);
    return result.changes ?? 0;
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private requireDb(): any {
    if (!this.db) throw new Error('Job store has not been initialized');
    return this.db;
  }
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  init(): void {}

  insert(record: JobRecord): void {
    this.jobs.set(record.id, { ...record });
  }

  update(id: string, patch: Partial<JobRecord>): void {
    const existing = this.jobs.get(id);
    if (existing) {
      this.jobs.set(id, { ...existing, ...patch, updated_at: patch.updated_at ?? Date.now() });
    }
  }

  get(id: string): JobRecord | undefined {
    const record = this.jobs.get(id);
    return record ? { ...record } : undefined;
  }

  list(options?: { status?: string; parentId?: string | null; limit?: number }): JobRecord[] {
    let records = [...this.jobs.values()];
    if (options?.status) records = records.filter((record) => record.status === options.status);
    if (options?.parentId !== undefined) records = records.filter((record) => (record.parent_id ?? null) === options.parentId);
    records.sort((a, b) => b.created_at - a.created_at);
    if (options?.limit) records = records.slice(0, options.limit);
    return records;
  }

  clear(options?: { status?: string }): number {
    const targetStatus = options?.status
      ? new Set([options.status])
      : new Set(['succeeded', 'failed', 'cancelled']);
    let count = 0;
    for (const [id, job] of this.jobs) {
      if (targetStatus.has(job.status)) {
        this.jobs.delete(id);
        count++;
      }
    }
    return count;
  }

  close(): void {}
}

export class JsonFileJobStore implements JobStore {
  private readonly filePath: string;
  private jobs = new Map<string, JobRecord>();
  private loaded = false;

  constructor(projectRoot: string) {
    this.filePath = join(projectRoot, 'cache', 'jobs.json');
  }

  init(): void {
    void this.load();
  }

  insert(record: JobRecord): void {
    this.ensureLoaded();
    this.jobs.set(record.id, { ...record });
    void this.persist();
  }

  update(id: string, patch: Partial<JobRecord>): void {
    this.ensureLoaded();
    const existing = this.jobs.get(id);
    if (existing) {
      this.jobs.set(id, { ...existing, ...patch, updated_at: patch.updated_at ?? Date.now() });
      void this.persist();
    }
  }

  get(id: string): JobRecord | undefined {
    this.ensureLoaded();
    const record = this.jobs.get(id);
    return record ? { ...record } : undefined;
  }

  list(options?: { status?: string; parentId?: string | null; limit?: number }): JobRecord[] {
    this.ensureLoaded();
    let records = [...this.jobs.values()];
    if (options?.status) records = records.filter((record) => record.status === options.status);
    if (options?.parentId !== undefined) records = records.filter((record) => (record.parent_id ?? null) === options.parentId);
    records.sort((a, b) => b.created_at - a.created_at);
    if (options?.limit) records = records.slice(0, options.limit);
    return records.map((record) => ({ ...record }));
  }

  clear(options?: { status?: string }): number {
    this.ensureLoaded();
    const targetStatus = options?.status
      ? new Set([options.status])
      : new Set(['succeeded', 'failed', 'cancelled']);
    let count = 0;
    for (const [id, job] of this.jobs) {
      if (targetStatus.has(job.status)) {
        this.jobs.delete(id);
        count++;
      }
    }
    if (count > 0) {
      void this.persist();
    }
    return count;
  }

  close(): void {}

  private ensureLoaded(): void {
    if (this.loaded) return;
    try {
      const data = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(data) as JobRecord[];
      this.jobs = new Map(parsed.map((record) => [record.id, record]));
    } catch {
      this.jobs = new Map();
    }
    this.loaded = true;
  }

  private async load(): Promise<void> {
    this.ensureLoaded();
  }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    await atomicWriteJson(this.filePath, [...this.jobs.values()], { pretty: true });
  }
}

