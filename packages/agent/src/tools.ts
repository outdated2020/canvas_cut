import { CLI_MANIFEST } from '@canvas-cut/core';

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function cliToolsFromManifest(): AgentToolDefinition[] {
  return CLI_MANIFEST.map((command) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const parameter of command.parameters) {
      const type = parameter.type === 'json' ? 'object' : parameter.type;
      properties[parameter.name] = { type };
      if (parameter.required) required.push(parameter.name);
    }
    return {
      name: command.command.replace(/[^a-zA-Z0-9]+/g, '_'),
      description: command.description,
      inputSchema: {
        type: 'object',
        properties,
        required
      }
    };
  });
}
