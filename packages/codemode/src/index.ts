import { Catalog, type ToolDefinition } from './catalog';
import { DEFAULT_LIMITS, type Limits } from './config';
import { execute } from './executor';
export { execute } from './executor';
export { DEFAULT_LIMITS } from './config';
export type { ToolDefinition } from './catalog';
export type { Limits } from './config';

export const CODEMODE_INSTRUCTIONS = [
  'Use search_tools to discover internal methods, then execute a plain JavaScript async function body calling await tools.NAME(args). Internal canvas/job methods are not top-level MCP tools. Native canvas operations do not require starting a separate Agent conversation.',
  'Transport newline-delimited JSON-RPC as UTF-8 without a BOM. Chinese and other Unicode text must reach stdin unchanged. For PowerShell/.NET ProcessStartInfo, explicitly set StandardInputEncoding, StandardOutputEncoding and StandardErrorEncoding to new UTF8Encoding(false); console encoding alone does not set redirected stdin encoding. Prefer an MCP SDK transport. Read back text with canvas_get before paid generation; question marks replacing Chinese indicate irreversible client-side encoding loss.',
  'Inside execute, canvas/job calls return data in r.structuredContent. The top-level execute MCP response instead stores JSON {result,logs,calls} in content[0].text; check isError before JSON.parse. Return values and IDs are not retained between executions.',
  'canvas_render submits a job and returns jobId, not a completed image/video. It executes the whole graph in dependency order. nodeId forces that node and its downstream nodes to regenerate; it does not stop execution at that node. To inspect a reference image before video generation, first render an image-only canvas with its output connected to the image; add the video stage after inspecting the image.',
  'Poll job_status in later execute calls until succeeded, failed or cancelled. Inspect child results for intermediate assets, including after parent failure. Verify the actual media and metadata before claiming the requested subject, duration or aspect ratio was produced. Provider/model limits are not advertised by canvas_node_types; parameter schema acceptance is not provider acceptance. This Code Mode API has no trim/export tool.',
  'Use the same idempotencyKey only to retry the same submission. For a new intentional generation, including after editing prompts, use a new key; reusing an old key can return the old job. Cancelling execute does not roll back edits or cancel submitted jobs; use job_cancel explicitly.'
].join('\n\n');

export const CODEMODE_TOOLS = [
  {
    name: 'search_tools',
    description: 'Discover internal Canvas Cut methods callable only as tools.NAME(args) inside execute; do not send their names as top-level MCP tools/call requests. Includes native canvas editing, generation jobs and separate Agent conversation tools. Search names/descriptions with space-separated terms (all must match); empty query lists tools. Returns input/output JSON Schemas and TypeScript calling hints, not executable TypeScript. Parse JSON from content[0].text and follow nextOffset for more. Use canvas_node_types for node parameters and exact port IDs; it does not discover provider/model limits. All stdio JSON-RPC must be UTF-8; read back non-ASCII prompts with canvas_get before generating.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 1000 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 } } }
  },
  {
    name: 'execute',
    description: 'Run a plain JavaScript async function BODY, not a function declaration or TypeScript. Supports top-level await, return, loops, Promise.all and try/catch. Discover methods with search_tools, then call await tools.NAME(args). Inside code, canvas/job results use r.structuredContent; legacy Agent results use JSON.parse(r.content[0].text). The execute MCP response itself is JSON {result,logs,calls} in content[0].text, not structuredContent; check isError before parsing. Failed internal tools throw catchable errors. Use UTF-8 stdio and read back Chinese prompts before generation. canvas_render executes the whole graph and immediately returns jobId; nodeId forces regeneration, not a stopping point. Poll job_status in later calls; inspect actual output media before claiming success. Provider duration/size limits are separate from schemas; no trimming/export tool exists here. No process, require, filesystem, fetch, imports or timers. Return a JSON-serializable value; preserve returned IDs in the caller for later calls. Fresh runtime each time: 30s timeout, 32 MiB guest heap, 32 tool calls, 1 MiB output. Script cancellation/failure does not roll back prior edits or cancel submitted jobs. For retries reuse a submission key; for a new generation use a new key.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 65536, description: 'Plain JavaScript async function body. Example: return (await tools.canvas_list({})).structuredContent; Send Unicode source in UTF-8 JSON-RPC. No TypeScript annotations or surrounding async function wrapper.' } } }
  }
];

const validation = new Catalog(CODEMODE_TOOLS.map(tool => ({ ...tool, execute: async () => undefined })));
export class CodeModeService {
  private catalog: Catalog;
  private active = 0;
  constructor(tools: ToolDefinition[], private limits: Limits = DEFAULT_LIMITS) { this.catalog = new Catalog(tools); }
  async call(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    try {
      await validation.call(name, args, signal);
      let result: unknown;
      if (name === 'search_tools') result = this.catalog.search(args.query as string ?? '', args.offset as number ?? 0, args.limit as number ?? 10);
      else {
        if (this.active >= this.limits.maxConcurrent) throw new Error('Execution concurrency limit reached');
        this.active++;
        try { result = await execute(args.code as string, this.catalog.aliases(), (alias, input, cancellation) => this.catalog.call(alias, input, cancellation), this.limits, signal); }
        finally { this.active--; }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : 'Code Mode failed' }], isError: true };
    }
  }
}
