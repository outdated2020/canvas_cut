import { createInterface } from 'node:readline';
import { promises as fs } from 'node:fs';
import { CliOptions } from '../args';
import { LocalIpcClient, uiScreenshotFile } from '../ipc/client';

const SERVER_NAME = 'canvas-cut-ui';
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
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    void handleLine(client, line).catch(() => undefined);
  });
  return new Promise<void>((resolve) => {
    rl.on('close', () => resolve());
  });
}

async function handleLine(client: LocalIpcClient, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (message.id === undefined || message.id === null) return;
  const id = message.id;
  try {
    const result = await dispatch(client, message.method ?? '', message.params ?? {});
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
  }
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
  params: Record<string, unknown>
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
      return { tools: TOOLS };
    case 'tools/call':
      return callTool(client, params);
    default:
      throw new JsonRpcError(-32601, `Method not found: ${method}`);
  }
}

async function callTool(client: LocalIpcClient, params: Record<string, unknown>): Promise<unknown> {
  const name = String(params.name ?? '');
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
