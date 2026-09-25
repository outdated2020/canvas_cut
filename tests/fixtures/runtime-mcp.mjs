import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
export function createServer() {
  const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'Echo nested input', inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false } }, additionalProperties: false } }] }));
  server.setRequestHandler(CallToolRequestSchema, async req => ({ content: [{ type: 'text', text: req.params.arguments.value.text }], structuredContent: { echoed: req.params.arguments.value.text } }));
  server.setRequestHandler(ListResourcesRequestSchema, async req => req.params?.cursor ? { resources: [] } : { resources: [{ uri: 'fixture://text', name: 'text' }], nextCursor: 'next' });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [{ uriTemplate: 'fixture://{name}', name: 'fixture' }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async req => ({ contents: [{ uri: req.params.uri, text: 'resource data', mimeType: 'text/plain' }] }));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await createServer().connect(new StdioServerTransport());
