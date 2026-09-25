import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as httpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './fixtures/runtime-mcp.mjs';
import agent from '../packages/agent/dist/index.js';
const { McpManager, ToolRegistry, LocalAgentHost } = agent;
const context = () => ({ sessionId: 's', runId: 'r', signal: new AbortController().signal });
async function exercise(servers, dir) {
  const manager = new McpManager(servers, dir, dir), ctx = context();
  try {
    await manager.connect(ctx.signal); assert.equal(manager.diagnostics.filter(d => d.status === 'connected').length, servers.length);
    const registry = new ToolRegistry(); await manager.register(registry, ctx);
    const tools = registry.list().filter(t => t.name.startsWith('mcp_') && t.name.includes('echo'));
    assert.equal(new Set(tools.map(t => t.name)).size, servers.length);
    for (const tool of tools) {
      await assert.rejects(registry.execute(tool.name, { value: { text: 4 } }, ctx), /Invalid/);
      const result = await registry.execute(tool.name, { value: { text: 'hello' } }, ctx); assert.equal(result.structuredContent.echoed, 'hello');
    }
    const page = await registry.execute('mcp_list_resources', { server: servers[0].name }, ctx); assert.equal(page.nextCursor, 'next');
    const last = await registry.execute('mcp_list_resources', { server: servers[0].name, cursor: page.nextCursor }, ctx); assert.equal(last.resources.length, 0);
    const read = await registry.execute('mcp_read_resource', { server: servers[0].name, uri: 'fixture://text' }, ctx); assert.equal(read.contents[0].text, 'resource data');
  } finally { await manager.close(); }
}
test('outbound MCP stdio validates schemas, namespaces duplicate tools and reads resources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-out-'));
  try { await exercise(['one', 'two'].map(name => ({ name, transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/runtime-mcp.mjs')] })), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('outbound MCP Streamable HTTP discovers and executes tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-http-')), active = [];
  const http = httpServer(async (req, res) => {
    const server = createServer(), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); active.push({ server, transport });
    try {
      await server.connect(transport);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  try { await exercise([{ name: 'remote', transport: 'http', url: `http://127.0.0.1:${http.address().port}/mcp` }], dir); }
  finally { await Promise.all(active.map(({ server }) => server.close())); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
test('real PTY accepts input, resize and terminates with its run', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pty-')), host = new LocalAgentHost({ cwd: dir, logDir: dir }), ctx = context();
  try {
    let p = await host.execute('exec_command', { command: process.platform === 'win32' ? '$x = Read-Host; Write-Output ("pty:" + $x); Start-Sleep -Seconds 30' : 'read x; printf "pty:%s" "$x"; sleep 30', tty: true, yieldTimeMs: 500 }, ctx);
    assert.equal(p.status, 'running');
    await host.execute('resize_terminal', { processId: p.processId, cols: 90, rows: 20 }, ctx);
    p = await host.execute('write_stdin', { processId: p.processId, chars: 'hello\r', waitMs: 1000 }, ctx);
    assert.match(p.stdout.text, /pty:hello/);
    await host.stopRun('r'); p = await host.execute('read_process_output', { processId: p.processId, waitMs: 0 }, ctx); assert.equal(p.status, 'cancelled');
  } finally { await host.stopRun('r'); await rm(dir, { recursive: true, force: true }); }
});
