import { AssetRef } from '../types';

export interface AssetDownloader {
  download(url: string, type: AssetRef['type'], hint?: string): Promise<AssetRef>;
}

export interface AssetUploader {
  upload(asset: AssetRef): Promise<string>;
  remove(url: string): Promise<void>;
}
