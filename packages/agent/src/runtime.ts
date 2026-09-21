import type { ModelMessage, ToolSet } from 'ai';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentHost, atomicText, OUTPUT_LIMIT, ToolContext } from './host';
import { SkillRegistry } from './skills';
import { CONTEXT_CHARACTER_LIMIT } from './context-usage';

export interface AgentEvent { type: string; data: unknown; timestamp: number }
export interface AgentRuntimeOptions {
  apiKey: string; baseUrl?: string; model?: string; fetch?: typeof globalThis.fetch;
  host: AgentHost; skills: SkillRegistry; context: ToolContext; logDir: string;
  messages: ModelMessage[]; maxSteps?: number;
  save(messages: ModelMessage[]): Promise<void>;
  emit(event: AgentEvent): Promise<void>;
}
const string = { type: 'string' };
const integer = { type: 'integer', minimum: 0 };
export const BASE_TOOLS = {
  list_files: { description: 'List a directory; use nextOffset for pagination. Absolute paths are allowed.', properties: { path: string, depth: integer, offset: integer, limit: integer }, required: ['path'] },
  read_file: { description: 'Read a UTF-8 text file by one-based lines. Read relevant SKILL.md files before domain tasks.', properties: { path: string, startLine: integer, lineCount: integer }, required: ['path'] },
  write_file: { description: 'Create or atomically overwrite a UTF-8 text file.', properties: { path: string, content: string }, required: ['path', 'content'] },
  edit_file: { description: 'Replace exactly one occurrence of oldText. Read the current file first.', properties: { path: string, oldText: string, newText: string }, required: ['path', 'oldText', 'newText'] },
  exec_command: { description: 'Start a non-interactive native shell command. Returns a process ID; inspect exit status and poll incremental output. Shell state is not shared across commands.', properties: { command: string, cwd: string, timeoutMs: integer }, required: ['command'] },
  read_process_output: { description: 'Read process output using byte offsets; waitMs is capped at 10000. Inspect final status, not just output text.', properties: { processId: string, stdoutOffset: integer, stderrOffset: integer, waitMs: integer }, required: ['processId'] },
  terminate_process: { description: 'Stop an owned shell process tree. This does not cancel separately submitted remote or application jobs.', properties: { processId: string }, required: ['processId'] }
};

function checkInput(name: string, input: unknown): asserts input is Record<string, unknown> {
  const spec = BASE_TOOLS[name as keyof typeof BASE_TOOLS];
  if (!spec || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid tool or input');
  const fields = spec.properties as Record<string, { type: string }>;
  for (const key of spec.required) if (!(key in input)) throw new Error(`Missing ${key}`);
  for (const [key, value] of Object.entries(input)) {
    if (!fields[key] || (fields[key]!.type === 'string' ? typeof value !== 'string' : !Number.isInteger(value))) throw new Error(`Invalid ${key}`);
  }
}
export async function boundedToolResult(result: unknown, logDir: string): Promise<unknown> {
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized) <= OUTPUT_LIMIT) return result;
  const path = join(logDir, `${randomUUID()}.result.json`);
  await atomicText(path, serialized);
  return { truncated: true, logPath: path, bytes: Buffer.byteLength(serialized), preview: Buffer.from(serialized).subarray(0, 8000).toString('utf8'), instruction: 'Read logPath in sections for the complete result.' };
}
export function closePendingTools(messages: ModelMessage[], reason: string): ModelMessage[] {
  const pending = new Map<string, string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === 'tool-call') pending.set(part.toolCallId, part.toolName);
      if (part.type === 'tool-result') pending.delete(part.toolCallId);
    }
  }
  if (pending.size) messages.push({ role: 'tool', content: [...pending].map(([toolCallId, toolName]) => ({ type: 'tool-result', toolCallId, toolName, output: { type: 'json', value: { ok: false, interrupted: true, error: reason, instruction: 'Inspect existing state before repeating this operation.' } } })) });
  return messages;
}

export async function runAgentMessage(options: AgentRuntimeOptions): Promise<{ text: string; status: 'completed' | 'limited' }> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
  const { generateText, tool, jsonSchema } = await dynamicImport('ai') as typeof import('ai');
  const { createOpenAI } = await dynamicImport('@ai-sdk/openai') as typeof import('@ai-sdk/openai');
  const openai = createOpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl || 'https://api.openai.com/v1', fetch: options.fetch });
  const tools: ToolSet = {};
  for (const [name, spec] of Object.entries(BASE_TOOLS)) tools[name] = tool({ description: spec.description, inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object', properties: spec.properties, required: spec.required, additionalProperties: false }) });
  const skills = await options.skills.list();
  const system = [
    'You are a general-purpose local assistant. Use the provided tools to complete the requested work and report actual results.',
    `Execution mode: ${options.host.mode}. Native shell: ${options.host.shell}. Default working directory: ${options.host.cwd}.`,
    'This is trusted local execution, not a sandbox. Stay within the user request. Each command starts a fresh shell. Do not expose credentials.',
    'CLI entry: canvas-cut (available in PATH). Use --help and manifest --json to discover commands. Project directory is the default cwd.',
    'Before a specialized task, read the relevant SKILL.md with read_file. Skills are guidance, not executable tool registrations. Do not invent unavailable tools.',
    'Check tool errors, command exit codes, CLI ok, and asynchronous job status. Do not repeat a potentially completed operation without inspecting state.',
    'Web search is not available in this version. Stopping this run stops its shell processes, not remote jobs already submitted.',
    'Available skills (name, description, path):',
    ...skills.map((skill) => JSON.stringify({ name: skill.frontmatter.name, description: skill.frontmatter.description, path: skill.sourcePath }))
  ].join('\n');
  const emit = (type: string, data: unknown) => options.emit({ type, data, timestamp: Date.now() });
  if (options.skills.diagnostics.length) await emit('diagnostic', options.skills.diagnostics);
  for (let step = 0; step < (options.maxSteps ?? 64); step++) {
    options.context.signal.throwIfAborted();
    if (JSON.stringify(options.messages).length > CONTEXT_CHARACTER_LIMIT) break;
    await emit('step', { number: step + 1 });
    const result = await generateText<ToolSet>({ model: openai.chat(options.model || 'gpt-4o-mini'), system, messages: options.messages, tools, abortSignal: options.context.signal, maxRetries: 0 });
    await emit('usage', { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, model: options.model || 'gpt-4o-mini' });
    options.messages.push(...result.responseMessages);
    await options.save(options.messages);
    if (result.text) await emit('assistant', { text: result.text });
    if (!result.toolCalls.length) return { text: result.text, status: 'completed' };
    for (const call of result.toolCalls) {
      await emit('tool-start', { id: call.toolCallId, name: call.toolName, input: call.input });
      let value: unknown;
      try {
        options.context.signal.throwIfAborted();
        checkInput(call.toolName, call.input);
        value = { ok: true, data: await options.host.execute(call.toolName, call.input, options.context) };
      } catch (error) {
        value = { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
      }
      value = await boundedToolResult(value, options.logDir);
      options.messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, output: { type: 'json', value: value as never } }] });
      await options.save(options.messages);
      await emit('tool-result', { id: call.toolCallId, name: call.toolName, result: value });
      options.context.signal.throwIfAborted();
    }
  }
  const text = `Reached the execution budget (${options.maxSteps ?? 64} steps or 200000 context characters). State was saved; inspect existing results before continuing.`;
  options.messages.push({ role: 'assistant', content: text }); await options.save(options.messages);
  return { text, status: 'limited' };
}
