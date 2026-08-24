import { promises as fs, constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CanvasCutError, ERROR_CODES } from '../errors';

export interface ProjectLock {
  release(): Promise<void>;
}

interface LockData {
  pid: number;
  timestamp: number;
  token: string;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export class FileProjectLock {
  private readonly lockPath: string;
  private token = '';
  private held = false;

  constructor(projectDir: string) {
    this.lockPath = join(projectDir, '.lock');
  }

  async acquire(options?: { timeoutMs?: number; staleMs?: number; intervalMs?: number }): Promise<ProjectLock> {
    const timeoutMs = options?.timeoutMs ?? 10_000;
    const staleMs = options?.staleMs ?? 60_000;
    const intervalMs = options?.intervalMs ?? 100;
    const startedAt = Date.now();

    while (true) {
      try {
        await fs.mkdir(join(this.lockPath, '..'), { recursive: true });
        const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const handle = await fs.open(this.lockPath, 'wx');
        const data: LockData = { pid: process.pid, timestamp: Date.now(), token };
        await handle.writeFile(JSON.stringify(data), 'utf8');
        await handle.sync();
        await handle.close();
        this.token = token;
        this.held = true;
        const lock = this;
        return {
          async release(): Promise<void> {
            await lock.release();
          }
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw error;
        }
      }

      const stale = await this.tryRemoveStale(staleMs);
      if (stale) continue;

      if (Date.now() - startedAt >= timeoutMs) {
        throw new CanvasCutError('LOCK_TIMEOUT', `Failed to acquire project lock at ${this.lockPath}`, {
          retryable: true
        });
      }
      await sleep(intervalMs);
    }
  }

  private async tryRemoveStale(staleMs: number): Promise<boolean> {
    try {
      const content = await fs.readFile(this.lockPath, 'utf8');
      const data = JSON.parse(content) as Partial<LockData>;
      const timestamp = typeof data.timestamp === 'number' ? data.timestamp : 0;
      const stale = Date.now() - timestamp > staleMs;
      const dead = !isPidAlive(Number(data.pid));
      if (stale || dead) {
        await fs.rm(this.lockPath, { force: true });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async release(): Promise<void> {
    if (!this.held) return;
    try {
      const content = await fs.readFile(this.lockPath, 'utf8');
      const data = JSON.parse(content) as Partial<LockData>;
      if (data.token === this.token || data.pid === process.pid) {
        await fs.rm(this.lockPath, { force: true });
      }
    } catch {
      await fs.rm(this.lockPath, { force: true }).catch(() => undefined);
    } finally {
      this.held = false;
    }
  }
}

export async function withProjectLock<T>(
  projectDir: string,
  fn: (lock: ProjectLock) => Promise<T>,
  options?: { timeoutMs?: number }
): Promise<T> {
  const locker = new FileProjectLock(projectDir);
  const lock = await locker.acquire(options);
  try {
    return await fn(lock);
  } finally {
    await lock.release();
  }
}
