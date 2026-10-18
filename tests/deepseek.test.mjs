import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import agent from '../packages/agent/dist/index.js';

const reasoning = ['mock-reasoning 一🌟', 'mock-reasoning 二🌟', 'mock-reasoning 三🌟'];

function completion(step, streaming, model = 'deepseek-flash') {
  const toolCall = step < 2 ? { id: `call-${step}`, type: 'function', function: { name: 'list_skills', arguments: '{}' } } : undefined;
  const content = step === 0 ? 'Checking' : step >= 2 ? 'Done' : null;
  const usage = { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 };
  if (!streaming) return new Response(JSON.stringify({
    id: `response-${step}`, object: 'chat.completion', created: 1, model, usage,
    choices: [{ index: 0, finish_reason: toolCall ? 'tool_calls' : 'stop', message: {
      role: 'assistant', content, reasoning_content: reasoning[Math.min(step, 2)], ...(toolCall ? { tool_calls: [toolCall] } : {})
    } }]
  }), { headers: { 'content-type': 'application/json' } });
  const text = reasoning[Math.min(step, 2)];
  const deltas = [{ role: 'assistant', reasoning_content: text.slice(0, 8) }, { reasoning_content: text.slice(8) },
    ...(content ? [{ content }] : []), ...(toolCall ? [{ tool_calls: [{ index: 0, ...toolCall }] }] : [])];
  const chunks = deltas.map(delta => ({ id: `response-${step}`, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: null }] }));
  chunks.push({ id: `response-${step}`, object: 'chat.completion.chunk', created: 1, model, usage, choices: [{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }] });
  const bytes = new TextEncoder().encode(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
  // Split SSE frames and multibyte UTF-8 across network chunks.
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    const end = Math.min(bytes.length, offset + 11);
    controller.enqueue(bytes.slice(offset, end)); offset = end;
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

for (const scenario of [
  { name: 'non-streaming official alias', streaming: false, model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1' },
  { name: 'streaming proxy model ID', streaming: true, model: 'vendor/deepseek-v4-pro', baseUrl: 'https://proxy.example.test/v1' },
  { name: 'official endpoint with custom model alias', streaming: true, model: 'my-model-alias', baseUrl: 'https://api.deepseek.com' }
]) test(`DeepSeek reasoning survives tool steps, new user turns and session reload: ${scenario.name}`, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const requests = [];
  const fetch = async (url, request) => {
    const body = JSON.parse(request.body), step = requests.length;
    assert.equal(url, `${scenario.baseUrl}/chat/completions`);
    assert.equal(body.model, scenario.model);
    assert.notEqual(body.thinking?.type, 'disabled');
    const assistants = body.messages.filter(message => message.role === 'assistant');
    assert.deepEqual(assistants.map(message => message.reasoning_content), reasoning.slice(0, Math.min(step, 3)), 'Every prior assistant response must echo exact reasoning, including the previous turn final answer');
    assert.equal(body.messages.filter(message => message.role === 'tool').length, Math.min(step, 2));
    for (let i = 0; i < Math.min(step, 2); i++) assert.equal(assistants[i].tool_calls[0].id, `call-${i}`);
    requests.push(body);
    return completion(step, scenario.streaming, scenario.model);
  };
  const options = {
    storageDir: join(dir, 'sessions'), configure: async () => ({ apiKey: 'mock-key', ...scenario, fetch }),
    createHost: (cwd, logDir) => new agent.LocalAgentHost({ cwd, logDir }), skillDirectories: () => []
  };
  const first = new agent.AgentSessionService(options);
  const done = await first.chat(dir, 'Inspect available skills twice');
  assert.equal(done.run.status, 'completed', done.text);
  assert.equal(done.text, 'Done'); assert.equal(requests.length, 3);
  const history = await first.history(dir);
  assert.equal(history.events.filter(event => event.type === 'tool-start').length, 2);
  assert.equal(JSON.stringify(history.events).includes('mock-reasoning'), false, 'Reasoning must not appear as visible assistant text or tool events');
  const persisted = JSON.parse(await readFile(join(options.storageDir, history.id + '.json'), 'utf8'));
  const assistantReasoning = persisted.messages.filter(message => message.role === 'assistant').map(message => message.content.filter(part => part.type === 'reasoning').map(part => part.text).join(''));
  assert.deepEqual(assistantReasoning, reasoning);
  await first.shutdown();
  const restarted = new agent.AgentSessionService(options);
  const resumed = await restarted.chat(dir, 'Continue from the saved results');
  assert.equal(resumed.run.status, 'completed', resumed.text);
  assert.equal(requests.length, 4);
  assert.equal((await restarted.history(dir)).events.filter(event => event.type === 'tool-start').length, 2, 'Restart must not repeat tool calls');
  await restarted.shutdown();
});

test('OpenAI Chat continues to use its own adapter with DeepSeek reasoning history present', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'openai-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let called = false;
  const result = await agent.runAgentMessage({
    apiKey: 'mock-key', model: 'gpt-4o-mini', streaming: false,
    host: new agent.LocalAgentHost({ cwd: dir, logDir: dir }), skills: new agent.SkillRegistry([]), logDir: dir,
    context: { sessionId: 's', runId: 'r', signal: new AbortController().signal },
    messages: [{ role: 'user', content: 'Earlier task' }, { role: 'assistant', content: [{ type: 'reasoning', text: 'mock-reasoning' }, { type: 'text', text: 'Earlier result' }] }, { role: 'user', content: 'Next task' }],
    save: async () => {}, emit: async () => {}, fetch: async (url, request) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(request.body);
      assert.equal(body.messages.some(message => 'reasoning_content' in message), false);
      called = true; return completion(3, false, 'gpt-4o-mini');
    }
  });
  assert.equal(called, true); assert.equal(result.text, 'Done');
});
