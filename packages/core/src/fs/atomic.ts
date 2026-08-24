import { promises as fs } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWriteJson(
  targetPath: string,
  data: unknown,
  options?: { pretty?: boolean }
): Promise<void> {
  const dir = dirname(targetPath);
  const name = basename(targetPath);
  const tmpPath = join(dir, `${name}.tmp-${randomUUID()}`);
  const content = options?.pretty === false ? JSON.stringify(data) : JSON.stringify(data, null, 2);

  await fs.mkdir(dir, { recursive: true });
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function atomicWriteText(targetPath: string, content: string): Promise<void> {
  const dir = dirname(targetPath);
  const name = basename(targetPath);
  const tmpPath = join(dir, `${name}.tmp-${randomUUID()}`);

  await fs.mkdir(dir, { recursive: true });
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const content = await fs.readFile(path, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, '')) as T;
}
