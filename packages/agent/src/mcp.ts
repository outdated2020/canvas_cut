import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ToolRegistry } from './tools';
import { cleanEnvironment, ToolContext } from './host';
export interface McpServerConfig {
  name: string; transport: 'stdio' | 'http'; enabled?: boolean;
  command?: string; args?: string[]; cwd?: string; env?: Record<string, string>;
  url?: string; headers?: Record<string, string>; timeoutMs?: number;
}
export class McpManager {
  private clients = new Map<string, Client>();
  private configs = new Map<string, McpServerConfig>();
  private images = new Map<string, { data: string; mimeType: string }>();
  diagnostics: Array<{ server: string; status: string; message?: string }> = [];
  constructor(private servers: McpServerConfig[], private cwd: string, private logDir: string) {}
  async connect(signal: AbortSignal) {
    const names = new Set<string>();
    for (const config of this.servers.filter(s => s.enabled !== false)) {
      signal.throwIfAborted();
      if (names.has(config.name)) throw new Error(`Duplicate MCP server: ${config.name}`);
      names.add(config.name);
      if (this.clients.has(config.name)) continue;
      this.configs.set(config.name, config);
      const client = new Client({ name: 'canvas-cut-agent', version: '0.2.0' });
      try {
        const transport = config.transport === 'stdio'
          ? new StdioClientTransport({ command: config.command!, args: config.args ?? [], cwd: config.cwd ?? this.cwd, env: { ...cleanEnvironment(process.env), ...config.env } as Record<string, string>, stderr: 'pipe' })
          : new StreamableHTTPClientTransport(new URL(config.url!), { requestInit: { headers: config.headers } });
        // Drain server stderr without persisting potentially sensitive credential diagnostics.
        if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => undefined);
        await client.connect(transport, { signal, timeout: config.timeoutMs ?? 15000 });
        this.clients.set(config.name, client); this.diagnostics.push({ server: config.name, status: 'connected' });
        client.onclose = () => { if (this.clients.get(config.name) === client) this.clients.delete(config.name); };
      } catch (error) { await client.close().catch(() => undefined); this.diagnostics.push({ server: config.name, status: 'failed', message: error instanceof Error ? error.name : 'Connection failed' }); }
    }
  }
  private options(server: string, ctx: ToolContext) { return { signal: ctx.signal, timeout: this.configs.get(server)?.timeoutMs ?? 30000 }; }
  private client(server: string) { const client = this.clients.get(server); if (!client) throw new Error(`MCP server not connected: ${server}`); return client; }
  async register(registry: ToolRegistry, ctx: ToolContext) {
    for (const [server, client] of this.clients) {
      if (!client.getServerCapabilities()?.tools) continue;
      try {
        let cursor: string | undefined; const seen = new Set<string>();
        do {
          const page = await client.listTools({ cursor }, this.options(server, ctx));
          for (const tool of page.tools) {
            const suffix = createHash('sha256').update(server + '\0' + tool.name).digest('hex').slice(0, 12);
            const name = `mcp_${server}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50) + '_' + suffix;
            registry.register({ name, description: `[${server}/${tool.name}] ${tool.description ?? ''}`, inputSchema: tool.inputSchema,
              execute: async (input, context) => this.content(await this.client(server).callTool({ name: tool.name, arguments: input }, undefined, this.options(server, context))) });
          }
          cursor = page.nextCursor; if (cursor && seen.has(cursor)) throw new Error('Repeated MCP cursor'); if (cursor) seen.add(cursor);
        } while (cursor);
      } catch { this.diagnostics.push({ server, status: 'discovery-failed' }); }
    }
    const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
    const server = { type: 'string', enum: [...this.clients.keys()] }, cursor = { type: 'string' };
    if (!this.clients.size) return;
    registry.register({ name: 'mcp_list_resources', description: 'List resources from a connected MCP server; follow nextCursor.', inputSchema: schema({ server, cursor }, ['server']), execute: (input, context) => this.client(String(input.server)).listResources({ cursor: input.cursor as string | undefined }, this.options(String(input.server), context)) });
    registry.register({ name: 'mcp_list_resource_templates', description: 'List MCP resource URI templates.', inputSchema: schema({ server, cursor }, ['server']), execute: (input, context) => this.client(String(input.server)).listResourceTemplates({ cursor: input.cursor as string | undefined }, this.options(String(input.server), context)) });
    registry.register({ name: 'mcp_read_resource', description: 'Read a resource URI from a connected MCP server.', inputSchema: schema({ server, uri: { type: 'string' } }, ['server', 'uri']), execute: async (input, context) => this.content(await this.client(String(input.server)).readResource({ uri: String(input.uri) }, this.options(String(input.server), context))) });
  }
  private async content(value: unknown): Promise<unknown> {
    const walk = async (item: any): Promise<any> => {
      if (Array.isArray(item)) return Promise.all(item.map(walk));
      if (!item || typeof item !== 'object') return item;
      const encoded = typeof item.blob === 'string' ? item.blob : ['image', 'audio'].includes(item.type) && typeof item.data === 'string' ? item.data : undefined;
      if (encoded !== undefined) {
        const data = Buffer.from(encoded, 'base64'); if (data.length > 32 * 1024 * 1024) throw new Error('MCP attachment exceeds 32 MiB');
        await fs.mkdir(this.logDir, { recursive: true }); const path = join(this.logDir, createHash('sha256').update(data).digest('hex') + '.attachment'); await fs.writeFile(path, data);
        if (String(item.mimeType).startsWith('image/') && data.length <= 4 * 1024 * 1024) this.images.set(path, { data: encoded, mimeType: item.mimeType });
        const { blob, data: ignored, ...metadata } = item; return { ...metadata, attachment: { path, bytes: data.length, mimeType: item.mimeType }, instruction: 'Binary attachment saved locally.' };
      }
      const result: Record<string, unknown> = {}; for (const [key, child] of Object.entries(item)) result[key] = await walk(child); return result;
    };
    return walk(value);
  }
  imageParts(value: unknown) {
    const parts: Array<{ type: 'image-data'; data: string; mediaType: string }> = []; const seen = new Set<string>();
    const walk = (item: any) => {
      if (!item || typeof item !== 'object') return;
      const path = item.attachment?.path, image = this.images.get(path);
      if (image && !seen.has(path) && parts.length < 4) { seen.add(path); parts.push({ type: 'image-data', data: image.data, mediaType: image.mimeType }); }
      for (const child of Object.values(item)) if (child && typeof child === 'object') walk(child);
    };
    walk(value); return parts;
  }
  async close() { await Promise.allSettled([...this.clients.values()].map(client => client.close())); this.clients.clear(); }
}
