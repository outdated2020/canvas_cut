import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = join(workspaceRoot, 'apps', 'cli', 'dist', 'index.js');

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`CLI exited with ${result.status}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

test('CLI project init and status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-cut-cli-'));
  try {
    const init = runCli(['project', 'init', '--name', 'CLI Demo', '--path', dir, '--json']);
    assert.equal(init.ok, true);
    assert.equal(init.data.path, dir);

    const status = runCli(['project', 'status', '--project', dir, '--json']);
    assert.equal(status.ok, true);
    assert.equal(status.data.canvasCount, 0);
    assert.equal(status.data.runningJobs, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI canvas graph and dry-run render', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-cut-cli-'));
  try {
    runCli(['project', 'init', '--name', 'Canvas Test', '--path', dir, '--json']);
    const created = runCli(['canvas', 'create', '--name', 'Test', '--project', dir, '--json']);
    const canvasId = created.data.canvasId;

    const text = runCli([
      'canvas', 'node', 'add', '--canvas', canvasId, '--type', 'text-input',
      '--params', JSON.stringify({ text: 'A red apple' }), '--project', dir, '--json'
    ]);
    const gen = runCli([
      'canvas', 'node', 'add', '--canvas', canvasId, '--type', 'text-to-image',
      '--params', '{}', '--project', dir, '--json'
    ]);
    const output = runCli([
      'canvas', 'node', 'add', '--canvas', canvasId, '--type', 'output',
      '--params', '{}', '--project', dir, '--json'
    ]);

    const edge1 = runCli([
      'canvas', 'edge', 'connect', '--canvas', canvasId,
      '--from', `${text.data.nodeId}:text`, '--to', `${gen.data.nodeId}:text`,
      '--project', dir, '--json'
    ]);
    const edge2 = runCli([
      'canvas', 'edge', 'connect', '--canvas', canvasId,
      '--from', `${gen.data.nodeId}:image`, '--to', `${output.data.nodeId}:image`,
      '--project', dir, '--json'
    ]);
    assert.equal(edge1.ok, true);
    assert.equal(edge2.ok, true);

    const plan = runCli([
      'canvas', 'render', canvasId, '--project', dir, '--dry-run', '--json'
    ]);
    assert.equal(plan.ok, true);
    assert.equal(plan.data.childJobs.length, 1);
    assert.equal(plan.data.childJobs[0].type, 'text-to-image');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI timeline add-track and get', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-cut-cli-'));
  try {
    runCli(['project', 'init', '--name', 'Timeline Test', '--path', dir, '--json']);
    const added = runCli([
      'timeline', 'add-track', '--type', 'video', '--name', 'V1',
      '--project', dir, '--json'
    ]);
    assert.equal(added.ok, true);
    const timeline = runCli(['timeline', 'get', '--project', dir, '--json']);
    assert.equal(timeline.data.tracks.length, 1);
    assert.equal(timeline.data.tracks[0].name, 'V1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
