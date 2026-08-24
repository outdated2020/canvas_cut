import { GenerationProvider } from '../types';
import { CanvasCutError, ERROR_CODES } from '../errors';
import { VolcengineProvider } from './volcengine';
import { AssetDownloader, AssetUploader } from './types';
import type { ProjectConfigFile } from '../types';

export interface ProviderFactoryOptions {
  config: ProjectConfigFile;
  apiKeys: Record<string, string | undefined>;
  downloader: AssetDownloader;
  uploader?: AssetUploader;
}

export function createProvider(options: ProviderFactoryOptions): GenerationProvider {
  const defaultProvider = options.config.provider.default;
  if (defaultProvider === 'volcengine') {
    const apiKey = options.apiKeys.volcengine;
    if (!apiKey) {
      throw new CanvasCutError(
        ERROR_CODES.INVALID_PARAMS,
        'Volcengine API key is not configured. Set ARK_API_KEY or configure Keychain.'
      );
    }
    return new VolcengineProvider(
      options.config.provider.volcengine,
      apiKey,
      options.downloader,
      options.uploader
    );
  }
  throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Unknown provider: ${defaultProvider}`);
}
