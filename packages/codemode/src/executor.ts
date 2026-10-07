import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { Limits } from './config';

export type Invoke = (alias: string, input: unknown, signal: AbortSignal) => Promise<unknown>;
export type Execution = { result: unknown; logs: string[]; calls: number };
export function execute(code: string, aliases: string[], invoke: Invoke, limits: Limits, signal?: AbortSignal): Promise<Execution> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Execution cancelled')); return; }
    if (Buffer.byteLength(code) > 64 * 1024) { reject(new Error('Code exceeds 64 KiB')); return; }
    const controller = new AbortController();
    const worker = new Worker(join(__dirname, 'worker.js'), {
      workerData: { code, aliases, limits },
      // Credentials and process state are never forwarded to the guest.
      env: {}, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }
    });
    let finished = false, calls = 0, bridgeBytes = 0;
    const finish = (error?: Error, value?: Execution) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      controller.abort(); void worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new Error('Execution cancelled; already dispatched operations may have completed'));
    const timer = setTimeout(() => finish(new Error('Execution timed out; already dispatched operations may have completed')), limits.timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (!finished) finish(new Error(`Execution worker exited (${code})`)); });
    worker.on('message', message => {
      if (finished) return;
      if (message.type === 'done') {
        if (Buffer.byteLength(JSON.stringify(message.value)) > limits.maxOutputBytes) finish(new Error('Execution output limit exceeded'));
        else finish(undefined, { ...message.value, calls });
      } else if (message.type === 'error') finish(new Error(message.error));
      else if (message.type === 'call') {
        if (++calls > limits.maxCalls) { finish(new Error('Tool call limit exceeded')); return; }
        if (!aliases.includes(message.alias)) { finish(new Error('Unknown or disallowed tool')); return; }
        void (async () => {
          try {
            const value = await invoke(message.alias, message.input, controller.signal);
            if (finished) return;
            const json = JSON.stringify(value ?? null);
            bridgeBytes += Buffer.byteLength(json);
            if (bridgeBytes > limits.maxOutputBytes * 4) { finish(new Error('Tool result bridge limit exceeded')); return; }
            worker.postMessage({ type: 'reply', id: message.id, json });
          } catch (error) {
            if (!finished) worker.postMessage({ type: 'reply', id: message.id, error: error instanceof Error ? error.message.slice(0, 4096) : 'Tool call failed' });
          }
        })();
      }
    });
  });
}
