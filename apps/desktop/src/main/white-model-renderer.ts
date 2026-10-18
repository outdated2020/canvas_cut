import { BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { buildWhiteModelRequest, CanvasCutError, ERROR_CODES, probeMedia, runFfmpeg, type AssetRef, type WhiteModelRequest } from '@canvas-cut/core';

export interface WhiteModelRenderContext {
  assetsDir: string;
  cacheDir: string;
  ffmpegPath?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}
export type WhiteModelRenderer = (request: WhiteModelRequest, context: WhiteModelRenderContext) => Promise<AssetRef>;

export const renderWhiteModelVideo: WhiteModelRenderer = async (input, context) => {
  const request = buildWhiteModelRequest(input as unknown as Record<string, unknown>);
  const checkCancelled = () => {
    if (context.signal?.aborted) throw new CanvasCutError(ERROR_CODES.JOB_CANCELLED, 'White model rendering cancelled');
  };
  checkCancelled();
  let ffmpeg = context.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  if ((await fs.stat(ffmpeg).catch(() => undefined))?.isDirectory()) ffmpeg = join(ffmpeg, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  await runFfmpeg(ffmpeg, ['-version'], { signal: context.signal, timeoutMs: 10000 });
  const capabilities = await Promise.all([
    runFfmpeg(ffmpeg, ['-hide_banner', '-demuxers'], { signal: context.signal, timeoutMs: 10000 }),
    runFfmpeg(ffmpeg, ['-hide_banner', '-decoders'], { signal: context.signal, timeoutMs: 10000 }),
    runFfmpeg(ffmpeg, ['-hide_banner', '-encoders'], { signal: context.signal, timeoutMs: 10000 })
  ]);
  if (!/\bimage2\b/.test(capabilities[0]!.output) || !/\bpng\b/.test(capabilities[1]!.output) || !/\blibx264\b/.test(capabilities[2]!.output)) {
    throw new CanvasCutError(ERROR_CODES.RENDER_FAILED, '白模视频需要支持 image2、PNG 解码和 libx264 编码的完整 FFmpeg。当前 FFmpeg 是精简版，请在 Settings 中配置完整的 ffmpeg.exe 路径。');
  }
  const cacheDir = resolve(context.cacheDir);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(context.assetsDir, { recursive: true });
  const framesDir = await fs.mkdtemp(join(cacheDir, 'white-model-'));
  const outputPath = join(context.assetsDir, `white-model-${randomUUID()}.mp4`);
  const session = randomUUID();
  const channel = `canvas-cut:white-model:${session}`;
  let window: BrowserWindow | undefined;
  let nextFrame = 0;
  let writing = false;
  let pendingWrite: Promise<void> | undefined;
  let settled = false;
  let resolveFrames!: () => void;
  let rejectFrames!: (error: Error) => void;
  const framesDone = new Promise<void>((resolvePromise, reject) => { resolveFrames = resolvePromise; rejectFrames = reject; });
  // A load error can occur before the frame promise is awaited.
  void framesDone.catch(() => undefined);
  const fail = (error: Error) => { if (!settled) { settled = true; rejectFrames(error); } };
  const abort = () => fail(new CanvasCutError(ERROR_CODES.JOB_CANCELLED, 'White model rendering cancelled'));
  let watchdog: NodeJS.Timeout | undefined;
  const resetWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => fail(new CanvasCutError(ERROR_CODES.RENDER_FAILED, 'White model renderer stopped responding')), 120000);
  };
  let succeeded = false;
  try {
    checkCancelled();
    window = new BrowserWindow({
      show: false, width: request.width, height: request.height,
      webPreferences: {
        preload: join(__dirname, '..', 'preload', 'white-model-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, additionalArguments: [`--white-model-session=${session}`]
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', (_event, details) => fail(new Error(`White model renderer exited: ${details.reason}`)));
    window.on('closed', () => fail(new Error('White model render window closed')));
    ipcMain.handle(channel, async (event, message: { action?: string; index?: number; png?: string; error?: string }) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid white model render sender');
      checkCancelled();
      if (settled) throw new Error('White model render already finished');
      try {
        resetWatchdog();
        if (message.action === 'config') return request;
        if (message.action === 'frame') {
          if (writing || message.index !== nextFrame || nextFrame >= request.frameCount || typeof message.png !== 'string' || message.png.length > 24 * 1024 * 1024) throw new Error('Invalid white model frame');
          const png = Buffer.from(message.png, 'base64');
          if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== request.width || png.readUInt32BE(20) !== request.height) throw new Error('Invalid white model frame size or format');
          writing = true;
          try { pendingWrite = fs.writeFile(join(framesDir, `frame-${String(nextFrame).padStart(6, '0')}.png`), png); await pendingWrite; }
          finally { writing = false; }
          checkCancelled();
          nextFrame++;
          if (nextFrame % Math.max(1, Math.ceil(request.fps / 5)) === 0 || nextFrame === request.frameCount) context.onProgress?.(nextFrame / request.frameCount * 85);
          return;
        }
        if (message.action === 'complete') {
          if (message.error) throw new Error(`White model rendering failed: ${String(message.error).slice(0, 2000)}`);
          if (writing || nextFrame !== request.frameCount) throw new Error('White model render has missing frames');
          settled = true;
          resolveFrames();
          return;
        }
        throw new Error('Unknown white model render action');
      } catch (error) { fail(error as Error); throw error; }
    });
    context.signal?.addEventListener('abort', abort, { once: true });
    resetWatchdog();
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    await Promise.all([
      devUrl ? window.loadURL(new URL('white-model.html', devUrl.endsWith('/') ? devUrl : `${devUrl}/`).href)
        : window.loadFile(join(__dirname, '..', 'renderer', 'white-model.html')),
      framesDone
    ]);
    if (watchdog) clearTimeout(watchdog);
    window.destroy();
    checkCancelled();
    context.onProgress?.(90);
    await runFfmpeg(ffmpeg, [
      '-y', '-framerate', String(request.fps), '-start_number', '0', '-i', join(framesDir, 'frame-%06d.png'),
      '-frames:v', String(request.frameCount), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath
    ], { signal: context.signal, timeoutMs: 30 * 60 * 1000 });
    checkCancelled();
    const ffprobe = process.env.FFPROBE_PATH ?? (dirname(ffmpeg) !== '.' ? join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : undefined);
    const info = await probeMedia(outputPath, ffprobe);
    if (info.hasVideo && (info.width !== request.width || info.height !== request.height)) throw new Error('White model output dimensions do not match the request');
    checkCancelled();
    const stat = await fs.stat(outputPath);
    const id = createHash('sha256').update(await fs.readFile(outputPath)).digest('hex');
    checkCancelled();
    context.onProgress?.(100);
    succeeded = true;
    return { id, path: outputPath, type: 'video', width: request.width, height: request.height, durationMs: info.durationMs ?? request.frameCount / request.fps * 1000, sizeBytes: stat.size };
  } finally {
    if (watchdog) clearTimeout(watchdog);
    context.signal?.removeEventListener('abort', abort);
    ipcMain.removeHandler(channel);
    if (window && !window.isDestroyed()) window.destroy();
    await pendingWrite?.catch(() => undefined);
    // Only delete the unique temporary directory created inside this project's cache.
    const rel = relative(cacheDir, resolve(framesDir));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) await fs.rm(framesDir, { recursive: true, force: true, maxRetries: 3 });
    if (!succeeded) await fs.rm(outputPath, { force: true });
  }
};
