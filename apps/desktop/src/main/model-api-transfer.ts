import { promises as fs } from 'node:fs';

const fields = ['arkBaseUrl', 'arkImageModel', 'arkVideoModel', 'arkApiKey', 'agentBaseUrl', 'agentModel', 'agentApiKey',
  'tosAccessKeyId', 'tosAccessKeySecret', 'tosBucket', 'tosRegion', 'tosEndpoint'] as const;
const secrets = new Set<string>(['arkApiKey', 'agentApiKey', 'tosAccessKeyId', 'tosAccessKeySecret']);
const maxBytes = 256 * 1024;
type Settings = Partial<Record<typeof fields[number], string>>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// This portable format deliberately excludes machine paths, Agent Runtime and project data.
export function modelApiSettings(value: unknown, strict = true): Settings {
  if (!record(value)) throw new Error('模型 API 配置必须是对象');
  if (strict && Object.keys(value).some(key => !fields.includes(key as typeof fields[number]))) {
    throw new Error('配置包含不支持的字段，请选择模型 API 导出文件');
  }
  const settings: Settings = {};
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) continue;
    const item = value[field];
    if (typeof item !== 'string' || item.length > 8192) throw new Error(`配置字段 ${field} 必须是长度不超过 8192 的字符串`);
    if (item.startsWith('encrypted:v1:')) throw new Error('不能导入本机加密配置，请在原电脑使用“导出配置”');
    settings[field] = item;
  }
  if (!Object.keys(settings).length) throw new Error('文件中没有模型 API 配置');
  return settings;
}

export function serializeModelApiSettings(value: unknown, includeSecrets: boolean): string {
  const settings = modelApiSettings(value, false);
  if (!includeSecrets) for (const field of fields) if (secrets.has(field)) delete settings[field];
  if (!Object.keys(settings).length) throw new Error('没有可导出的模型 API 配置');
  const text = JSON.stringify({ format: 'canvas-cut-model-api', version: 1, settings }, null, 2) + '\n';
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('配置文件不能超过 256 KB');
  return text;
}

export function parseModelApiSettings(text: string): Settings {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('配置文件不能超过 256 KB');
  let data: unknown;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('配置文件不是有效的 JSON'); }
  if (!record(data) || data.format !== 'canvas-cut-model-api' || data.version !== 1 ||
      Object.keys(data).some(key => !['format', 'version', 'settings'].includes(key))) {
    throw new Error('不支持的模型 API 配置格式或版本');
  }
  return modelApiSettings(data.settings);
}

export interface ModelApiTransferDialogs {
  save(): Promise<string | undefined>;
  open(): Promise<string | undefined>;
}

export async function exportModelApiSettings(dialogs: ModelApiTransferDialogs, value: unknown, includeSecrets: boolean) {
  const text = serializeModelApiSettings(value, includeSecrets);
  const filePath = await dialogs.save();
  if (!filePath) return { cancelled: true as const };
  await fs.writeFile(filePath, text, { encoding: 'utf8', mode: 0o600 });
  return { cancelled: false as const };
}

export async function importModelApiSettings(dialogs: ModelApiTransferDialogs) {
  const filePath = await dialogs.open();
  if (!filePath) return { cancelled: true as const };
  if ((await fs.stat(filePath)).size > maxBytes) throw new Error('配置文件不能超过 256 KB');
  const settings = parseModelApiSettings(await fs.readFile(filePath, 'utf8'));
  return { cancelled: false as const, settings };
}
