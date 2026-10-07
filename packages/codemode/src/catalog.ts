import Ajv, { type ValidateFunction } from 'ajv';

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  execute(input: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}

// Discovery hints only. JSON Schema validation remains authoritative.
function typeOf(schema: any, depth = 0): string {
  if (schema === false) return 'never';
  if (!schema || schema === true || depth > 12 || schema.$ref) return 'unknown';
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v: unknown) => JSON.stringify(v)).join(' | ') || 'never';
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).map((s: unknown) => typeOf(s, depth + 1)).join(' | ');
  if (schema.allOf) return schema.allOf.map((s: unknown) => typeOf(s, depth + 1)).join(' & ');
  if (Array.isArray(schema.type)) return schema.type.map((type: string) => typeOf({ ...schema, type }, depth + 1)).join(' | ');
  switch (schema.type) {
    case 'string': case 'boolean': case 'null': return schema.type;
    case 'integer': case 'number': return 'number';
    case 'array': return `Array<${typeOf(schema.items, depth + 1)}>`;
    case 'object': {
      const fields = Object.entries(schema.properties ?? {}).map(([key, value]) => `${JSON.stringify(key)}${schema.required?.includes(key) ? '' : '?'}: ${typeOf(value, depth + 1)}`);
      if (schema.additionalProperties !== false) fields.push('[key: string]: unknown');
      return `{ ${fields.join('; ')} }`;
    }
    default: return 'unknown';
  }
}

export class Catalog {
  private entries = new Map<string, { tool: ToolDefinition; validate: ValidateFunction }>();
  private ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  constructor(tools: ToolDefinition[]) {
    for (const tool of tools) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tool.name) || this.entries.has(tool.name)) throw new Error(`Invalid or duplicate tool name: ${tool.name}`);
      this.entries.set(tool.name, { tool, validate: this.ajv.compile(tool.inputSchema) });
    }
  }
  aliases() { return [...this.entries.keys()]; }
  search(query: string, offset: number, limit: number) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = [...this.entries.values()].filter(({ tool }) => {
      const haystack = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
    return {
      total: matches.length,
      nextOffset: offset + limit < matches.length ? offset + limit : null,
      tools: matches.slice(offset, offset + limit).map(({ tool }) => ({
        name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        declaration: `tools.${tool.name}(args: ${typeOf(tool.inputSchema)}): Promise<${tool.outputSchema ? `{ content: unknown[]; structuredContent: ${typeOf(tool.outputSchema)}; isError?: boolean }` : 'McpToolResult'}>`,
        resultType: 'McpToolResult = { content: unknown[]; structuredContent?: Record<string, unknown>; isError?: boolean }'
      }))
    };
  }
  async call(name: string, input: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unknown or disallowed tool: ${name}`);
    if (!entry.validate(input)) throw new Error(`Invalid tool arguments: ${this.ajv.errorsText(entry.validate.errors)}`);
    const result = await entry.tool.execute(input as Record<string, unknown>, signal);
    if ((result as { isError?: boolean })?.isError) throw new Error(`Tool failed: ${JSON.stringify(result)}`);
    return result;
  }
}
