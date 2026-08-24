import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { AssetRef } from '../types';
import { atomicWriteJson, readJsonFile } from '../fs/atomic';
import { pathExists } from '../project/project-store';
import type { CacheLookup } from '../canvas/engine';

interface CacheEntry {
  cacheKey: string;
  asset: AssetRef;
  createdAt: number;
}

export class FileNodeCacheStore implements CacheLookup {
  private readonly filePath: string;

  constructor(cacheDir: string) {
    this.filePath = join(cacheDir, 'nodes.json');
  }

  async get(cacheKey: string): Promise<AssetRef | undefined> {
    const entries = await this.read();
    const entry = entries[cacheKey];
    if (entry && (await pathExists(entry.asset.path))) {
      return entry.asset;
    }
    return undefined;
  }

  async put(cacheKey: string, asset: AssetRef): Promise<void> {
    const entries = await this.read();
    entries[cacheKey] = { cacheKey, asset, createdAt: Date.now() };
    await fs.mkdir(join(this.filePath, '..'), { recursive: true });
    await atomicWriteJson(this.filePath, entries, { pretty: true });
  }

  private async read(): Promise<Record<string, CacheEntry>> {
    try {
      return await readJsonFile<Record<string, CacheEntry>>(this.filePath);
    } catch {
      return {};
    }
  }
}
