import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS, type QuickJSDeferredPromise, type QuickJSHandle } from 'quickjs-emscripten';
import type { Limits } from './config';

const port = parentPort!;
const { code, aliases, limits } = workerData as { code: string; aliases: string[]; limits: Limits };

async function main() {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + limits.timeoutMs;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const vm = runtime.newContext();
  const pending = new Map<number, QuickJSDeferredPromise>();
  const logs: string[] = [];
  let sequence = 0, logBytes = 0;
  let promise: QuickJSHandle | undefined;
  const errorText = (handle: QuickJSHandle) => {
    const error = vm.dump(handle);
    return typeof error?.message === 'string' ? error.message : String(error);
  };
  const pump = () => {
    const jobs = runtime.executePendingJobs();
    if (jobs.error) {
      const message = errorText(jobs.error); jobs.error.dispose(); throw new Error(message);
    }
  };
  const reply = (message: any) => {
    if (message.type !== 'reply') return;
    const deferred = pending.get(message.id);
    if (!deferred) return;
    pending.delete(message.id);
    try {
      if (message.error) {
        const error = vm.newError(message.error);
        deferred.reject(error); error.dispose();
      } else {
        const value = vm.unwrapResult(vm.evalCode(`JSON.parse(${JSON.stringify(message.json)})`));
        deferred.resolve(value); value.dispose();
      }
      deferred.dispose(); pump();
    } catch (error) { port.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Bridge failed' }); }
  };
  try {
    const bridge = vm.newFunction('__callTool', (name, args) => {
      const id = ++sequence;
      if (id > limits.maxCalls) throw new Error('Tool call limit exceeded');
      const deferred = vm.newPromise();
      pending.set(id, deferred);
      port.postMessage({ type: 'call', id, alias: vm.getString(name), input: vm.dump(args) });
      return deferred.handle;
    });
    vm.setProp(vm.global, '__callTool', bridge); bridge.dispose();
    const log = vm.newFunction('__log', value => {
      const text = vm.getString(value);
      logBytes += Buffer.byteLength(text);
      if (logBytes > Math.min(64 * 1024, limits.maxOutputBytes / 2)) throw new Error('Log limit exceeded');
      logs.push(text);
    });
    vm.setProp(vm.global, '__log', log); log.dispose();
    vm.unwrapResult(vm.evalCode(`
      (() => {
        const call = globalThis.__callTool, log = globalThis.__log;
        delete globalThis.__callTool; delete globalThis.__log;
        const api = Object.create(null);
        for (const name of ${JSON.stringify(aliases)}) api[name] = (args = {}) => call(name, args);
        globalThis.tools = Object.freeze(api);
        globalThis.console = Object.freeze({ log: (...values) => log(values.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) });
      })();
    `)).dispose();
    port.on('message', reply);
    // Input is an async function body, supporting top-level await and return.
    // JSON serialization runs inside QuickJS and is subject to its limits.
    promise = vm.unwrapResult(vm.evalCode(`(async () => {\n${code}\n})().then(value => JSON.stringify({ result: value === undefined ? null : value }))`, 'codemode.js'));
    const settled = vm.resolvePromise(promise);
    pump();
    const result = await settled;
    if (result.error) { const message = errorText(result.error); result.error.dispose(); throw new Error(message); }
    const json = vm.getString(result.value); result.value.dispose();
    if (Buffer.byteLength(json) + logBytes > limits.maxOutputBytes) throw new Error('Execution output limit exceeded');
    port.postMessage({ type: 'done', value: { ...JSON.parse(json), logs } });
  } finally {
    port.off('message', reply);
    for (const deferred of pending.values()) deferred.dispose();
    promise?.dispose(); vm.dispose(); runtime.dispose();
  }
}
void main().catch(error => port.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Execution failed' }));
