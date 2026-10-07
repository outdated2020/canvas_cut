import { Catalog, type ToolDefinition } from './catalog';
import { DEFAULT_LIMITS, type Limits } from './config';
import { execute } from './executor';
export { execute } from './executor';
export { DEFAULT_LIMITS } from './config';
export type { ToolDefinition } from './catalog';
export type { Limits } from './config';

export const CODEMODE_TOOLS = [
  {
    name: 'search_tools',
    description: 'Discover Canvas Cut tools available inside execute, including canvas editing, generation jobs and Agent tools. Search names/descriptions with space-separated terms (all must match); empty query lists tools. Returns input/output JSON Schemas and TypeScript calling hints. Follow nextOffset for more. Use canvas_node_types to discover node parameters and port IDs.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 1000 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 } } }
  },
  {
    name: 'execute',
    description: 'Run a JavaScript async function BODY with top-level await and return. Discover methods with search_tools, then call await tools.TOOL_NAME(args). Canvas/job tools return business data in result.structuredContent; legacy Agent tools use JSON text in result.content[0].text. Use canvas_node_types for parameter/port definitions. canvas_render immediately returns jobId; check job_status in later execute calls. Use loops, Promise.all, filtering and console.log. Failed tools reject (catch with try/catch). No process, require, filesystem, fetch, imports or timers. Return a JSON-serializable value. Fresh isolated runtime per call; 30s timeout, 32 MiB guest heap, 32 tool calls, 1 MiB output. Calls may have side effects; cancellation/timeouts do not roll back dispatched operations or cancel submitted jobs. Do not retry uncertain submissions without checking status/history.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 65536 } } }
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
