import { promises as fs } from 'node:fs';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type { AssetRef, AssetUploader, TosConfig } from '@canvas-cut/core';
import { CanvasCutError, ERROR_CODES } from '@canvas-cut/core';

export interface TosCredentials {
  accessKeyId: string;
  accessKeySecret: string;
}

export class TosUploader implements AssetUploader {
  private client: unknown;

  constructor(
    private readonly config: TosConfig,
    private readonly credentials: TosCredentials
  ) {}

  async upload(asset: AssetRef): Promise<string> {
    if (!this.config.bucket) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'TOS bucket is not configured. Set config.json tos.bucket first.'
      );
    }

    const content = await fs.readFile(asset.path);
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 24);
    const key = `canvas-cut-uploads/${hash}-${basename(asset.path)}`;
    const client = await this.getClient();

    try {
      await (client as { putObject: (args: unknown) => Promise<unknown> }).putObject({
        bucket: this.config.bucket,
        key,
        body: content,
        contentType: asset.type === 'image' ? 'image/png' : asset.type === 'video' ? 'video/mp4' : 'audio/mpeg'
      });
    } catch (error) {
      throw new CanvasCutError(ERROR_CODES.PROVIDER_ERROR, `TOS upload failed: ${(error as Error).message}`, {
        retryable: true,
        cause: error
      });
    }

    const presign = (client as { preSignedUrl?: (args: unknown) => Promise<{ url?: string }> }).preSignedUrl;
    if (presign) {
      try {
        const result = await presign.call(client, {
          bucket: this.config.bucket,
          key,
          method: 'GET',
          expires: this.config.urlTtlSeconds
        });
        return result.url ?? this.publicObjectUrl(key);
      } catch {
        return this.publicObjectUrl(key);
      }
    }
    return this.publicObjectUrl(key);
  }

  async remove(_url: string): Promise<void> {
    // MVP keeps uploaded objects until TTL cleanup; explicit removal can be added later.
  }

  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;
    try {
      const tos = require('@volcengine/tos-sdk') as {
        TosClient: new (options: unknown) => unknown;
      };
      this.client = new tos.TosClient({
        accessKeyId: this.credentials.accessKeyId,
        accessKeySecret: this.credentials.accessKeySecret,
        region: this.config.region,
        endpoint: this.config.endpoint
      });
      return this.client;
    } catch (error) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'Failed to initialize @volcengine/tos-sdk. Install the dependency and provide TOS credentials.',
        { cause: error }
      );
    }
  }

  private publicObjectUrl(key: string): string {
    return `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}/${key}`;
  }
}
