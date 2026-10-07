import { CANVAS_API } from '@canvas-cut/core';
import type { ToolDefinition } from '@canvas-cut/codemode';
import { LocalIpcClient } from '../ipc/client';

export function canvasTools(defaultProject?: string): ToolDefinition[] {
  return CANVAS_API.map(api => ({
    name: api.name, description: api.description, outputSchema: api.outputSchema,
    inputSchema: { ...api.inputSchema, properties: {
      ...api.inputSchema.properties as Record<string, unknown>,
      projectPath: { type: 'string', minLength: 1, description: 'Project directory. Defaults to the MCP --project argument.' }
    } },
    execute: async (input, signal) => {
      signal.throwIfAborted();
      const { projectPath, idempotencyKey, ...payload } = input;
      const path = projectPath as string | undefined ?? defaultProject;
      if (!path && api.method !== 'canvas.node-types') throw new Error('Specify projectPath or start MCP with --project <path>');
      const data = await new LocalIpcClient(path, idempotencyKey as string | undefined).request<Record<string, unknown>>(
        api.method, payload, 30000, signal
      );
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    }
  }));
}
