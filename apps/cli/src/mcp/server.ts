import { createInterface } from 'node:readline';
import { promises as fs } from 'node:fs';
import { CliOptions } from '../args';
import { LocalIpcClient, uiScreenshotFile } from '../ipc/client';
import { CodeModeService, CODEMODE_TOOLS } from '@canvas-cut/codemode';
import { canvasTools } from './canvas-tools';

const SERVER_NAME = 'canvas-cut';
const SERVER_VERSION = '0.1.0';
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface UiScreenshotInfo {
  path: string;
  width: number;
  height: number;
  bytes: number;
  capturedAt: number;
}

class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

const TOOLS = [
  ...[
    ['agent_send_prompt', 'Send a prompt to the desktop Agent conversation. Returns runId immediately; use agent_get_run to poll. The Agent can execute local file and shell operations. Requires a running desktop app and configured Agent. Do not blindly retry an uncertain submission; inspect history first.'],
    ['agent_get_run', 'Read the latest run and incremental events after a sequence cursor. A conversation accepts one active run at a time.'],
    ['agent_history', 'Read persisted conversation messages, tool history and latest run.'],
    ['agent_cancel', 'Stop the active Agent run and its shell processes. Submitted generation jobs are not automatically cancelled.']
  ].map(([name, description]) => ({
    name, description,
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        projectPath: { type: 'string', minLength: 1, description: 'Absolute project directory. Defaults to the MCP server --project argument.' },
        conversationId: { type: 'string', minLength: 1, description: 'Defaults to default, the conversation shown in the desktop UI.' },
        ...(name === 'agent_send_prompt' ? { prompt: { type: 'string', minLength: 1 } } : {}),
        ...(name === 'agent_get_run' ? { after: { type: 'integer', minimum: 0, description: 'Sequence cursor returned by the previous poll.' } } : {})
      },
      required: name === 'agent_send_prompt' ? ['prompt'] : []
    }
  })),
  {
    name: 'ui_screenshot',
    description:
      'Capture the canvas-cut desktop app main window and return the screenshot as PNG image content. ' +
      'Requires the desktop app to be running. With fresh=false, returns the latest saved screenshot ' +
      '(e.g. the one captured automatically at startup) without re-capturing.',
    inputSchema: {
      type: 'object',
      properties: {
        fresh: {
          type: 'boolean',
          description: 'true: capture the window now (default); false: return the latest saved screenshot file'
        }
      }
    }
  }
];

export async function runMcpServer(options: CliOptions): Promise<void> {
  const client = new LocalIpcClient(options.project);
  const codeMode = new CodeModeService([...TOOLS.map(tool => ({
    ...tool, name: tool.name!, execute: async (input: Record<string, unknown>, signal: AbortSignal) => {
      signal.throwIfAborted();
      return callTool(client, { name: tool.name, arguments: input }, options.project);
    }
  })), ...canvasTools(options.project)]);
  const pending = new Map<string | number, AbortController>();
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    void handleLine(client, line, options.project, codeMode, pending).catch(() => undefined);
  });
  return new Promise<void>((resolve) => {
    rl.on('close', () => {
      for (const controller of pending.values()) controller.abort();
      resolve();
    });
  });
}

async function handleLine(client: LocalIpcClient, line: string, project: string | undefined, codeMode: CodeModeService, pending: Map<string | number, AbortController>): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }); return;
  }
  if (message.id === undefined || message.id === null) {
    if (message.method === 'notifications/cancelled') {
      const requestId = message.params?.requestId;
      if (typeof requestId === 'string' || typeof requestId === 'number') pending.get(requestId)?.abort();
    }
    return;
  }
  const id = message.id;
  if (pending.has(id)) {
    send({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Duplicate in-flight request id' } }); return;
  }
  const controller = new AbortController(); pending.set(id, controller);
  try {
    const result = await dispatch(client, message.method ?? '', message.params ?? {}, project, codeMode, controller.signal);
    send({ jsonrpc: '2.0', id, result });
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id,
      error: {
        code: error instanceof JsonRpcError ? error.code : -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    });
  } finally { pending.delete(id); }
}

function send(body: unknown): void {
  try {
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } catch {
    // stdout already closed
  }
}

async function dispatch(
  client: LocalIpcClient,
  method: string,
  params: Record<string, unknown>, project: string | undefined, codeMode: CodeModeService, signal: AbortSignal
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion:
          typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: [...TOOLS, ...CODEMODE_TOOLS] };
    case 'tools/call':
      if (CODEMODE_TOOLS.some(tool => tool.name === params.name)) {
        return codeMode.call(String(params.name), (params.arguments ?? {}) as Record<string, unknown>, signal);
      }
      return callTool(client, params, project);
    default:
      throw new JsonRpcError(-32601, `Method not found: ${method}`);
  }
}

async function callTool(client: LocalIpcClient, params: Record<string, unknown>, project?: string): Promise<unknown> {
  const name = String(params.name ?? '');
  const methods: Record<string, string> = { agent_send_prompt: 'agent.start', agent_get_run: 'agent.get-run', agent_history: 'agent.history', agent_cancel: 'agent.cancel' };
  if (methods[name]) {
    try {
      const args = params.arguments ?? {};
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
      const input = args as Record<string, unknown>;
      const allowed = ['projectPath', 'conversationId', ...(name === 'agent_send_prompt' ? ['prompt'] : []), ...(name === 'agent_get_run' ? ['after'] : [])];
      if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Unknown argument');
      for (const key of ['projectPath', 'conversationId', 'prompt']) if (input[key] !== undefined && (typeof input[key] !== 'string' || !String(input[key]).trim())) throw new Error(`${key} must be a non-empty string`);
      const path = input.projectPath as string | undefined ?? project;
      if (!path) throw new Error('Specify projectPath or start MCP with --project <path>');
      if (name === 'agent_send_prompt' && typeof input.prompt !== 'string') throw new Error('prompt is required');
      if (input.after !== undefined && (!Number.isSafeInteger(input.after) || Number(input.after) < 0)) throw new Error('after must be a non-negative integer');
      const data = await new LocalIpcClient(path).request(methods[name]!, { conversationId: input.conversationId ?? 'default', message: input.prompt, after: input.after ?? 0 });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  }
  if (name !== 'ui_screenshot') {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const fresh = args.fresh !== false;

  let info: UiScreenshotInfo;
  try {
    info = fresh ? await client.request<UiScreenshotInfo>('ui.screenshot', {}) : await readSavedScreenshot();
  } catch (error) {
    return {
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true
    };
  }

  const png = await fs.readFile(info.path);
  return {
    content: [
      {
        type: 'text',
        text: `${info.path} (${info.width}x${info.height}, ${Math.round(png.byteLength / 1024)} KB, captured ${new Date(info.capturedAt).toISOString()})`
      },
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }
    ]
  };
}

async function readSavedScreenshot(): Promise<UiScreenshotInfo> {
  const path = uiScreenshotFile();
  const png = await fs.readFile(path);
  const { width, height } = parsePngSize(png);
  const stat = await fs.stat(path);
  return { path, width, height, bytes: png.byteLength, capturedAt: stat.mtimeMs };
}

function parsePngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('Saved screenshot is not a valid PNG file');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
