import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import agent from '../packages/agent/dist/index.js';
const { LocalAgentHost, ToolRegistry, SkillRegistry, runAgentMessage, recoverPatches, fileHash, parseRuntimeConfig, publicRuntimeConfig, mergeRuntimeConfig } = agent;
const ctx = () => ({ sessionId: 's', runId: 'r', signal: new AbortController().signal });
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'runtime 中文 ')); const host = new LocalAgentHost({ cwd: dir, logDir: join(dir, 'logs') }); t.after(async () => { await host.stopRun('r'); await rm(dir, { recursive: true, force: true }); }); return { dir, host, context: ctx() }; }

test('file tool schemas reject invalid types and deprecated edit_file', async t => {
  const { host, context } = await fixture(t);
  await assert.rejects(host.execute('read_file', { path: 'a', lineCount: 0 }, context), /Invalid/);
  await assert.rejects(host.execute('write_file', { path: 'a', content: 'a', unexpected: true }, context), /Invalid/);
  await assert.rejects(host.execute('edit_file', { path: 'a' }, context), /Unknown/);
});
test('read, exclusive create and hash overwrite preserve BOM and line endings', async t => {
  const { host, dir, context } = await fixture(t);
  await writeFile(join(dir, 'a'), '\ufeffone\r\ntwo\r\n');
  const read = await host.execute('read_file', { path: 'a', lineCount: 1 }, context);
  assert.equal(read.content, 'one\r\n'); assert.equal(read.nextLine, 2); assert.equal(read.hasBom, true);
  await assert.rejects(host.execute('write_file', { path: 'a', content: 'oops' }, context), /a/);
  await assert.rejects(host.execute('write_file', { path: 'a', content: 'oops', mode: 'overwrite', expectedHash: '0'.repeat(64) }, context), /expectedHash/);
  await host.execute('write_file', { path: 'a', content: 'new', mode: 'overwrite', expectedHash: read.fileHash }, context);
  assert.equal(await readFile(join(dir, 'a'), 'utf8'), '\ufeffnew');
});
test('apply_patch handles multi-file add update move delete and stale snapshots', async t => {
  const { host, dir, context } = await fixture(t);
  await writeFile(join(dir, 'a'), 'one\r\ntwo\r\n'); await writeFile(join(dir, 'remove'), 'delete');
  await host.execute('read_file', { path: 'a' }, context); await host.execute('read_file', { path: 'remove' }, context);
  const result = await host.execute('apply_patch', { patch: '*** Begin Patch\n*** Update File: a\n*** Move to: nested/b\n@@\n one\n-two\n+three\n*** Add File: created\n+hello\n*** Delete File: remove\n*** End Patch' }, context);
  assert.equal(result.files.length, 3); assert.equal(await readFile(join(dir, 'nested/b'), 'utf8'), 'one\r\nthree\r\n');
  await assert.rejects(readFile(join(dir, 'a')), /ENOENT/); await assert.rejects(readFile(join(dir, 'remove')), /ENOENT/);
  await host.execute('read_file', { path: 'created' }, context); await writeFile(join(dir, 'created'), 'external\n');
  await assert.rejects(host.execute('apply_patch', { patch: '*** Begin Patch\n*** Update File: created\n@@\n-hello\n+bye\n*** End Patch' }, context), /Read all current/);
  assert.equal(await readFile(join(dir, 'created'), 'utf8'), 'external\n');
});
test('patch preflight failure leaves all files intact and ambiguous contexts fail', async t => {
  const { host, dir, context } = await fixture(t);
  await writeFile(join(dir, 'a'), 'same\nsame\n'); await host.execute('read_file', { path: 'a' }, context);
  await assert.rejects(host.execute('apply_patch', { patch: '*** Begin Patch\n*** Add File: new\n+new\n*** Update File: a\n@@\n-same\n+new\n*** End Patch' }, context), /context/i);
  await assert.rejects(readFile(join(dir, 'new')), /ENOENT/); assert.equal(await readFile(join(dir, 'a'), 'utf8'), 'same\nsame\n');
});
test('recovery restores pending patch but retains external modifications', async t => {
  const { dir } = await fixture(t), journal = join(dir, 'journal'); await mkdir(journal);
  const file = join(dir, 'a'); await writeFile(file, 'after');
  const record = { id: 't', status: 'pending', changes: [{ path: file, before: Buffer.from('before').toString('base64'), after: Buffer.from('after').toString('base64') }] };
  await writeFile(join(journal, 't.json'), JSON.stringify(record)); await recoverPatches(journal); assert.equal(await readFile(file, 'utf8'), 'before');
  await writeFile(file, 'external'); await writeFile(join(journal, 't.json'), JSON.stringify(record));
  assert.match((await recoverPatches(journal))[0], /conflict/); assert.equal(await readFile(file, 'utf8'), 'external');
});
test('search ignores hidden and gitignored files and paginates matches', async t => {
  const { dir, host, context } = await fixture(t);
  await writeFile(join(dir, '.gitignore'), 'skip.txt\n'); await writeFile(join(dir, 'skip.txt'), 'needle'); await writeFile(join(dir, '.hidden'), 'needle'); await writeFile(join(dir, 'a.txt'), 'needle\nneedle\n');
  const found = await host.execute('search_files', { pattern: '**/*.txt' }, context); assert.deepEqual(found.files.map(f => f.relativePath), ['a.txt']);
  const matches = await host.execute('search_text', { query: 'needle', limit: 1 }, context); assert.equal(matches.matches.length, 1); assert.equal(matches.nextOffset, 1);
});
test('pipe stdin, incremental output, EOF and ownership', async t => {
  const { host, context } = await fixture(t);
  const command = process.platform === 'win32' ? '$x = [Console]::ReadLine(); [Console]::Write("got:" + $x)' : 'read x; printf "got:%s" "$x"';
  let p = await host.execute('exec_command', { command, yieldTimeMs: 50 }, context);
  assert.equal(p.status, 'running');
  await assert.rejects(host.execute('write_stdin', { processId: p.processId, chars: 'x' }, { ...context, runId: 'other' }), /session/);
  p = await host.execute('write_stdin', { processId: p.processId, chars: 'hello\n', waitMs: 1000 }, context);
  while (p.status === 'running') p = await host.execute('read_process_output', { processId: p.processId, waitMs: 1000 }, context);
  assert.equal(p.exitCode, 0); assert.match(p.stdout.text, /got:hello/);
});
test('streamed tool calls are complete and persisted before effects; text uses stable message ID', async t => {
  const { host, dir, context } = await fixture(t); let request = 0, saved = [], events = [];
  const execute = host.execute.bind(host); host.execute = async (...args) => { assert.equal(saved.at(-1).role, 'assistant'); return execute(...args); };
  const fetch = async () => {
    const deltas = request++ === 0 ? [{ tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'write_file', arguments: '{"path":"a",' } }] }, { tool_calls: [{ index: 0, function: { arguments: '"content":"ok"}' } }] }] : [{ content: 'Do' }, { content: 'ne' }];
    const stream = deltas.map(delta => 'data: ' + JSON.stringify({ id: 'r', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n').join('') + 'data: ' + JSON.stringify({ id: 'r', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: request === 1 ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  const result = await runAgentMessage({ apiKey: 'test', model: 'test', fetch, host, context, skills: new SkillRegistry([]), logDir: dir, messages: [{ role: 'user', content: 'create a' }], save: async messages => { saved = structuredClone(messages); }, emit: async event => { events.push(event); } });
  assert.equal(result.text, 'Done'); assert.equal(await readFile(join(dir, 'a'), 'utf8'), 'ok');
  assert.equal(events.find(e => e.type === 'assistant-delta').data.messageId, events.find(e => e.type === 'assistant').data.messageId);
});
test('runtime configuration validates and redacts MCP credentials', () => {
  const config = parseRuntimeConfig({ mcpServers: [{ name: 'x', transport: 'http', url: 'http://localhost/mcp', headers: { Authorization: 'secret' } }] });
  const shown = publicRuntimeConfig(config); assert.equal(JSON.stringify(shown).includes('secret'), false);
  assert.equal(mergeRuntimeConfig(shown, config).mcpServers[0].headers.Authorization, 'secret');
  assert.throws(() => parseRuntimeConfig({ mcpServers: [{ name: 'x', transport: 'stdio' }] }), /command/);
});

test('in-run compaction archives exact history and retains task identifiers', async t => {
  const { dir, host, context } = await fixture(t), events = [], messages = [{ role: 'user', content: 'Finish job abc123' }, { role: 'assistant', content: 'history '.repeat(3000) }, { role: 'user', content: 'Continue abc123 without resubmitting' }];
  let requests = 0;
  const fetch = async (_url, request) => {
    requests++; const body = JSON.parse(request.body), summarizing = body.messages[0].content.includes('Summarize task state');
    if (!summarizing) { assert.ok(JSON.stringify(body.messages).includes('abc123')); assert.ok(JSON.stringify(body.messages).length < 15000); }
    return new Response(JSON.stringify({ id: 'r', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: summarizing ? 'Job abc123 was submitted. Inspect its status before retrying.' : 'Done abc123' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }), { headers: { 'content-type': 'application/json' } });
  };
  const result = await runAgentMessage({ apiKey: 'test', fetch, streaming: false, host, context, logDir: dir, skills: new SkillRegistry([]), messages, contextLimitCharacters: 40000, compactThresholdCharacters: 25000, save: async () => {}, emit: async event => events.push(event) });
  assert.equal(result.status, 'completed'); assert.equal(requests, 2);
  const compacted = events.find(e => e.type === 'context-compacted'); assert.ok(compacted);
  assert.match(await readFile(compacted.data.archive, 'utf8'), /history history/);
});
test('persistence failure prevents tool side effects', async t => {
  const { dir, host, context } = await fixture(t);
  const fetch = async () => new Response(JSON.stringify({ id: 'r', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'write_file', arguments: '{"path":"never","content":"bad"}' } }] } }] }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(runAgentMessage({ apiKey: 'test', fetch, streaming: false, host, context, logDir: dir, skills: new SkillRegistry([]), messages: [{ role: 'user', content: 'write' }], save: async () => { throw new Error('disk unavailable'); }, emit: async () => {} }), /disk unavailable/);
  await assert.rejects(readFile(join(dir, 'never')), /ENOENT/);
});
test('patch requires all read pages and preserves an empty file', async t => {
  const { dir, host, context } = await fixture(t); await writeFile(join(dir, 'a'), 'one\ntwo\n');
  await host.execute('read_file', { path: 'a', lineCount: 1 }, context);
  const patch = '*** Begin Patch\n*** Update File: a\n@@\n-one\n-two\n*** End Patch';
  await assert.rejects(host.execute('apply_patch', { patch }, context), /Read all/);
  await host.execute('read_file', { path: 'a', startLine: 2 }, context); await host.execute('apply_patch', { patch }, context);
  assert.equal(await readFile(join(dir, 'a'), 'utf8'), '');
});

test('session replays committed terminal events and removes a torn journal tail', async t => {
  const { dir } = await fixture(t), storageDir = join(dir, 'sessions');
  const options = { storageDir, configure: async () => ({ apiKey: 'test' }), createHost: (cwd, logDir) => new LocalAgentHost({ cwd, logDir }), skillDirectories: () => [] };
  const service = new agent.AgentSessionService(options), session = await service.history(dir);
  session.run = { id: 'run', status: 'running', startedAt: 1 };
  await mkdir(storageDir, { recursive: true }); await writeFile(join(storageDir, session.id + '.json'), JSON.stringify(session));
  const event = { sequence: 1, runId: 'run', type: 'run-finished', timestamp: 2, data: { ...session.run, status: 'completed', finishedAt: 2, text: 'saved' } };
  const log = join(storageDir, session.id + '.events.jsonl'); await writeFile(log, JSON.stringify(event) + '\n{"sequence":');
  const recovered = await new agent.AgentSessionService(options).history(dir);
  assert.equal(recovered.run.status, 'completed'); assert.equal(recovered.events.length, 1);
  assert.equal(await readFile(log, 'utf8'), JSON.stringify(event) + '\n');
});
