import test from 'node:test';
import assert from 'node:assert/strict';
import mode from '../dist/index.js';
const { CodeModeService, execute, DEFAULT_LIMITS } = mode;
const signal = () => new AbortController().signal;
const unpack = response => JSON.parse(response.content[0].text);
const echo = {
  name: 'echo', description: 'Echo an integer',
  inputSchema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'integer' } } },
  execute: async input => ({ content: [{ type: 'text', text: JSON.stringify(input) }] })
};
const run = (service, code) => service.call('execute', { code }, signal());

test('discovery searches, paginates, provides schemas and excludes the execution tool itself', async () => {
  const service = new CodeModeService([echo, { ...echo, name: 'other' }]);
  const page = unpack(await service.call('search_tools', { query: '', limit: 1 }, signal()));
  assert.equal(page.total, 2); assert.equal(page.nextOffset, 1);
  assert.match(page.tools[0].declaration, /tools.echo.*value.*number/);
  const next = unpack(await service.call('search_tools', { offset: page.nextOffset }, signal()));
  assert.equal(next.tools[0].name, 'other'); assert.equal(next.nextOffset, null);
  assert.equal(unpack(await service.call('search_tools', { query: 'echo integer' }, signal())).tools.length, 2);
  assert.equal((await service.call('search_tools', { limit: 0 }, signal())).isError, true);
  assert.equal((await service.call('execute', { code: 'return 1', extra: true }, signal())).isError, true);
});

test('JavaScript orchestrates parallel calls, chains results and captures logs', async () => {
  let active = 0, peak = 0;
  const service = new CodeModeService([{ ...echo, execute: async input => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 25)); active--;
    return echo.execute(input);
  } }]);
  const result = await run(service, `
    const batch = await Promise.all([1, 2, 3].map(value => tools.echo({ value })));
    const values = batch.map(r => JSON.parse(r.content[0].text).value);
    const sum = values.reduce((a, b) => a + b, 0);
    console.log('sum', sum);
    return JSON.parse((await tools.echo({ value: sum })).content[0].text);
  `);
  assert.equal(result.isError, undefined);
  assert.deepEqual(unpack(result), { result: { value: 6 }, logs: ['sum 6'], calls: 4 });
  assert.equal(peak, 3);
});

test('guest has no host globals or modules and each execution starts fresh', async () => {
  const service = new CodeModeService([echo]);
  const check = await run(service, 'globalThis.secret = 123; return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof tools.execute, tools.__proto__ === undefined]');
  assert.deepEqual(unpack(check).result, ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', true]);
  assert.equal(unpack(await run(service, 'return typeof secret')).result, 'undefined');
  assert.equal((await run(service, 'return await import("node:fs")')).isError, true);
});

test('schema validation blocks side effects, and tool failures can be caught', async () => {
  let calls = 0;
  const service = new CodeModeService([{ ...echo, execute: async input => { calls++; return echo.execute(input); } }, {
    ...echo, name: 'fail', execute: async () => ({ isError: true, content: [{ type: 'text', text: 'fixture error' }] })
  }]);
  const invalid = await run(service, 'return await tools.echo({value: "bad"})');
  assert.equal(invalid.isError, true); assert.match(invalid.content[0].text, /Invalid tool arguments/); assert.equal(calls, 0);
  const caught = await run(service, 'try { await tools.fail({value: 1}); } catch (e) { return e.message; }');
  assert.match(unpack(caught).result, /fixture error/);
  assert.equal((await run(service, 'return tools.missing({})')).isError, true);
});

test('CPU loops and unresolved promises time out without blocking the host', async () => {
  const limits = { ...DEFAULT_LIMITS, timeoutMs: 400 };
  await assert.rejects(execute('while(true) {}', [], async () => null, limits), /timed out|interrupted/);
  await assert.rejects(execute('await new Promise(() => {})', [], async () => null, limits), /timed out/);
  assert.equal((await execute('return 7', [], async () => null, DEFAULT_LIMITS)).result, 7);
});

test('call, heap, log and output budgets reject excess work', async () => {
  let calls = 0;
  const service = new CodeModeService([{ ...echo, execute: async input => { calls++; return echo.execute(input); } }], { ...DEFAULT_LIMITS, maxCalls: 2 });
  assert.equal((await run(service, 'for(let i=0;i<3;i++) await tools.echo({value:i});')).isError, true);
  assert.equal(calls, 2);
  const small = { ...DEFAULT_LIMITS, maxOutputBytes: 1024 };
  await assert.rejects(execute('return "x".repeat(2048)', [], async () => null, small), /output limit/);
  await assert.rejects(execute('console.log("x".repeat(2048))', [], async () => null, small), /Log limit/);
  await assert.rejects(execute('const a=[]; for(let i=0;i<10000000;i++) a.push({i}); return a.length;', [], async () => null, { ...DEFAULT_LIMITS, memoryBytes: 1024 * 1024 }), /memory|allocation|worker exited/i);
  await assert.rejects(execute('return 1n;', [], async () => null, DEFAULT_LIMITS), /BigInt|serialize/i);
});

test('cancellation aborts the bridge and execution concurrency is bounded', async () => {
  const controller = new AbortController();
  let began, hostSignal;
  const started = new Promise(resolve => { began = resolve; });
  const service = new CodeModeService([{ ...echo, execute: async (_input, cancellation) => {
    hostSignal = cancellation; began(); return new Promise(() => {});
  } }], { ...DEFAULT_LIMITS, maxConcurrent: 1 });
  const pending = service.call('execute', { code: 'return await tools.echo({value:1});' }, controller.signal);
  await started;
  assert.match((await run(service, 'return 2')).content[0].text, /concurrency limit/);
  controller.abort();
  assert.match((await pending).content[0].text, /cancelled/);
  assert.equal(hostSignal.aborted, true);
  assert.equal(unpack(await run(service, 'return 3')).result, 3);
});
