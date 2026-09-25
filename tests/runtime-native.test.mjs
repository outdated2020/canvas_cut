import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const run = promisify(execFile), require = createRequire(resolve('apps/desktop/package.json'));
test('node-pty executes in both Node and Electron runtimes', async () => {
  for (const executable of [process.execPath, require('electron')]) {
    const { stdout } = await run(executable, [resolve('tests/fixtures/pty-smoke.cjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 15000 });
    assert.match(stdout, /NATIVE_PTY_OK/);
  }
});
