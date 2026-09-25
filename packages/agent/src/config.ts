import Ajv from 'ajv';
import type { McpServerConfig } from './mcp';
export interface RuntimeConfig { bashPath?: string; powershellPath?: string; maxSteps?: number; contextLimitCharacters?: number; compactThresholdCharacters?: number; mcpServers?: McpServerConfig[]; supportsImages?: boolean }
const text = { type: 'string' }, dict = { type: 'object', additionalProperties: text };
const validate = new Ajv({ allErrors: true }).compile({ type: 'object', additionalProperties: false, properties: {
  bashPath: text, powershellPath: text, supportsImages: { type: 'boolean' }, maxSteps: { type: 'integer', minimum: 1, maximum: 1000 },
  contextLimitCharacters: { type: 'integer', minimum: 10000, maximum: 2000000 }, compactThresholdCharacters: { type: 'integer', minimum: 5000, maximum: 1900000 },
  mcpServers: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['name', 'transport'], properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 }, transport: { enum: ['stdio', 'http'] }, enabled: { type: 'boolean' }, command: text, args: { type: 'array', items: text }, cwd: text, env: dict, url: text, headers: dict, timeoutMs: { type: 'integer', minimum: 1000, maximum: 120000 }
  } } }
} });
export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!validate(value)) throw new Error(`Invalid runtime configuration: ${JSON.stringify(validate.errors)}`);
  const config = value as RuntimeConfig;
  if ((config.compactThresholdCharacters ?? Math.floor((config.contextLimitCharacters ?? 200000) * .6)) >= (config.contextLimitCharacters ?? 200000)) throw new Error('Compaction threshold must be below context limit');
  const names = new Set<string>();
  for (const server of config.mcpServers ?? []) {
    if (names.has(server.name)) throw new Error('MCP names must be unique'); names.add(server.name);
    if (server.transport === 'stdio' && !server.command?.trim()) throw new Error('stdio MCP requires command');
    if (server.transport === 'http') { const url = new URL(server.url ?? ''); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('MCP requires HTTP(S) URL without embedded credentials'); }
  }
  return config;
}
export function publicRuntimeConfig(config: RuntimeConfig) {
  return { ...config, mcpServers: config.mcpServers?.map(({ env, headers, ...server }) => ({ ...server, hasCredentials: Boolean(Object.keys(env ?? {}).length || Object.keys(headers ?? {}).length) })) };
}
export function mergeRuntimeConfig(value: unknown, previous: RuntimeConfig): RuntimeConfig {
  if (!value || typeof value !== 'object') return parseRuntimeConfig(value);
  const copy = structuredClone(value) as any;
  for (const server of copy.mcpServers ?? []) {
    const old = previous.mcpServers?.find(s => s.name === server.name);
    delete server.hasCredentials;
    // Omitted credentials retain stored values; explicit {} clears them.
    server.env ??= old?.env; server.headers ??= old?.headers;
  }
  return parseRuntimeConfig(copy);
}
