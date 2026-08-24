import type { ModelMessage } from 'ai';
import { z } from 'zod';

export interface AgentRuntimeOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  callbacks: {
    createCanvas(prompt: string, name: string): Promise<{ canvasId: string }>;
    renderCanvas(canvasId: string): Promise<{ jobId: string }>;
    addCanvasToTimeline(canvasId: string, durationMs: number): Promise<{ clipId: string }>;
  };
}

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function runAgentMessage(
  message: string,
  history: AgentChatMessage[],
  options: AgentRuntimeOptions
): Promise<string> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<any>;
  const { generateText, tool } = (await dynamicImport('ai')) as typeof import('ai');
  const { createOpenAI } = (await dynamicImport('@ai-sdk/openai')) as typeof import('@ai-sdk/openai');
  const openai = createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl || 'https://api.openai.com/v1'
  });

  const messages: ModelMessage[] = [
    ...history.map(
        (item): ModelMessage =>
        item.role === 'assistant'
          ? { role: 'assistant', content: item.content }
          : { role: 'user', content: item.content }
    ),
    { role: 'user', content: message }
  ];

  const result = await generateText({
    // Ark/Volcengine and other OpenAI-compatible endpoints expose the
    // Chat Completions API, not the Responses API that `openai(model)`
    // defaults to. Use `openai.chat(model)` to hit `/chat/completions`.
    model: openai.chat(options.model || 'gpt-4o-mini'),
    system:
      options.systemPrompt ??
      'You are a video creation agent. Use tools to create and render canvas flows, then add results to the timeline.',
    messages,
    tools: {
      create_canvas: tool({
        description: 'Create a text-to-video canvas from a prompt.',
        inputSchema: z.object({
          name: z.string().optional(),
          prompt: z.string()
        }),
        execute: async ({ name, prompt }) => options.callbacks.createCanvas(prompt, name ?? 'Agent canvas')
      }),
      render_canvas: tool({
        description: 'Render an existing canvas.',
        inputSchema: z.object({
          canvasId: z.string()
        }),
        execute: async ({ canvasId }) => options.callbacks.renderCanvas(canvasId)
      }),
      add_canvas_to_timeline: tool({
        description: 'Add a rendered canvas to the timeline.',
        inputSchema: z.object({
          canvasId: z.string(),
          durationMs: z.number().optional()
        }),
        execute: async ({ canvasId, durationMs }) =>
          options.callbacks.addCanvasToTimeline(canvasId, durationMs ?? 5000)
      })
    }
  });

  return result.text;
}
