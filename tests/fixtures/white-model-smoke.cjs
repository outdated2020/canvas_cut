// Run with Electron after build: electron tests/fixtures/white-model-smoke.cjs <output-dir> <ffmpeg-path>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { defaultWhiteModelParams, buildWhiteModelRequest, runFfmpeg } = require('../../packages/core/dist/index.js');
const { renderWhiteModelVideo } = require('../../apps/desktop/dist/main/white-model-renderer.js');
const outputDir = path.resolve(process.argv[2]);
const ffmpegPath = process.argv[3];
app.setPath('userData', path.join(outputDir, 'profile'));
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('White model smoke test timed out'); app.exit(1); }, 120000);

app.whenReady().then(async () => {
  const progress = [];
  const request = buildWhiteModelRequest(process.argv[4] === '--default' ? defaultWhiteModelParams() : { ...defaultWhiteModelParams(), width: 640, height: 360, durationMs: 1000, fps: 12 });
  const context = { assetsDir: path.join(outputDir, 'assets'), cacheDir: path.join(outputDir, 'cache'), ffmpegPath, onProgress: value => progress.push(value) };
  if (process.argv[4] === '--expect-missing-ffmpeg') {
    await assert.rejects(renderWhiteModelVideo(request, context), /完整 FFmpeg/);
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    console.log(JSON.stringify({ unsupportedFfmpeg: 'passed' }));
    clearTimeout(timeout); app.exit(0); return;
  }
  const previousVideos = (await fs.readdir(context.assetsDir).catch(() => [])).filter(file => file.endsWith('.mp4')).length;
  const asset = await renderWhiteModelVideo(request, context);
  assert.equal(asset.width, request.width);
  assert.equal(asset.height, request.height);
  assert.equal(Math.round(asset.durationMs), request.durationMs);
  assert.ok(asset.sizeBytes > 1000);
  assert.equal(progress.at(-1), 100);
  assert.deepEqual(await fs.readdir(context.cacheDir), []);
  const first = path.join(outputDir, 'first.png');
  const last = path.join(outputDir, 'last.png');
  await runFfmpeg(ffmpegPath, ['-y', '-i', asset.path, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', first]);
  await runFfmpeg(ffmpegPath, ['-y', '-i', asset.path, '-vf', `select=eq(n\\,${request.frameCount - 1})`, '-frames:v', '1', last]);
  const digest = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  assert.notEqual(await digest(first), await digest(last), 'Camera movement must change the rendered frame');
  const controller = new AbortController();
  await assert.rejects(renderWhiteModelVideo({ ...request, durationMs: 5000 }, { ...context, signal: controller.signal, onProgress: value => { if (value > 0) controller.abort(); } }));
  assert.equal((await fs.readdir(context.assetsDir)).filter(file => file.endsWith('.mp4')).length, previousVideos + 1);
  assert.deepEqual(await fs.readdir(context.cacheDir), []);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  console.log(JSON.stringify({ asset, first, last, progress, cancellation: 'passed' }));
  clearTimeout(timeout);
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
