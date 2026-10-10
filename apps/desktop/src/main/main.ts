import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import {
  addCanvasClip,
  addMediaClip,
  addSubtitleClip,
  addTrack,
  atomicWriteJson,
  computeGraphHash,
  createCanvas,
  createNode,
  moveClip,
  removeClip,
  removeTrack,
  splitClip,
  trimClip,
  setClipTransform,
  setClipOpacity,
  setClipSpeed,
  setClipVolume,
  addTransition,
  removeTransition,
  ProjectStore,
  CanvasOperations,
  isCanvasOperation,
  type CanvasChange,
  withProjectLock,
  logger
} from '@canvas-cut/core';
import { randomUUID } from 'node:crypto';
import { DaemonService } from './daemon';
import { LocalIpcServer } from './ipc-server';
import type { AgentSessionService } from '@canvas-cut/agent';
import { createAgentService } from './agent-service';
import { parseRuntimeConfig, publicRuntimeConfig, mergeRuntimeConfig, McpManager, SkillRegistry, recoverPatches } from '@canvas-cut/agent';
import { homedir } from 'node:os';
import { captureWindowScreenshot, UiScreenshotResult } from './ui-capture';

let mainWindow: BrowserWindow | null = null;
let daemon: DaemonService;
let ipcServer: LocalIpcServer;
let agentService: AgentSessionService;
function canvasChanged(change: CanvasChange) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('canvas-cut:canvas-changed', change);
}
const canvasOperations = new CanvasOperations(canvasChanged);

function inferAssetType(name: string): 'image' | 'video' | 'audio' {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) return 'video';
  return 'audio';
}

function localRuntimeSettingsPath(): string {
  return join(app.getPath('userData'), 'runtime-settings.json');
}

async function readLocalRuntimeSettings(): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>;
  try {
    const content = await fs.readFile(localRuntimeSettingsPath(), 'utf8');
    data = JSON.parse(content.replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  let migrate = false;
  for (const key of SECRET_SETTINGS) {
    const value = data[key];
    if (typeof value === 'string' && value.startsWith('encrypted:v1:')) {
      data[key] = safeStorage.decryptString(Buffer.from(value.slice('encrypted:v1:'.length), 'base64'));
    } else if (typeof value === 'string' && value) migrate = true;
  }
  if (migrate && safeStorage.isEncryptionAvailable()) await writeLocalRuntimeSettings(data);
  return data;
}

const SECRET_SETTINGS = ['arkApiKey', 'agentApiKey', 'tosAccessKeyId', 'tosAccessKeySecret', 'agentRuntime'];

async function writeLocalRuntimeSettings(data: Record<string, unknown>): Promise<void> {
  const stored = { ...data };
  for (const key of SECRET_SETTINGS) {
    const value = stored[key];
    if (typeof value !== 'string' || !value) continue;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('System credential encryption is unavailable');
    stored[key] = 'encrypted:v1:' + safeStorage.encryptString(value).toString('base64');
  }
  await atomicWriteJson(localRuntimeSettingsPath(), stored, { pretty: true });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'Canvas Cut',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !process.env.VITE_DEV_SERVER_URL
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch((error) => console.error('Unable to open link', error));
    return { action: 'deny' };
  });
  window.once('ready-to-show', () => window.show());

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  window.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void captureMainWindow().catch((error) => {
        console.warn('[ui-capture] startup screenshot failed:', error);
      });
    }, 1500);
  });

  return window;
}

function registerIpcHandlers(): void {
  ipcMain.handle('canvas-cut:invoke', async (_event, channel: string, payload: Record<string, unknown>) => {
    if (isCanvasOperation(channel)) {
      const { path, name: _legacyName, ...input } = payload;
      const data = await canvasOperations.call(channel, path as string, input);
      // Retain the renderer's existing return shapes while sharing operations.
      if (channel === 'canvas.create') return data.canvas;
      if (channel === 'canvas.list') return data.canvases;
      if (channel === 'canvas.node.add' || channel === 'canvas.node.set-param') return data.node;
      if (channel === 'canvas.edge.connect') return data.edge;
      return data;
    }
    switch (channel) {
      case 'agent.runtime.get': {
        const settings = await readLocalRuntimeSettings();
        const config = parseRuntimeConfig(JSON.parse(String(settings.agentRuntime ?? '{}')));
        const skills = new SkillRegistry([join(app.getAppPath(), '..', '..', 'skills'), join(homedir(), '.canvas-cut', 'skills'), join(String(payload.path), 'skills')]);
        let ptyAvailable = false;
        try { require('node-pty'); ptyAvailable = true; } catch {}
        return { config: publicRuntimeConfig(config), ptyAvailable, skills: (await skills.list()).map(s => ({ name: s.frontmatter.name, description: s.frontmatter.description, path: s.sourcePath })), diagnostics: skills.diagnostics };
      }
      case 'agent.runtime.set': {
        const settings = await readLocalRuntimeSettings();
        const config = mergeRuntimeConfig(payload.config, parseRuntimeConfig(JSON.parse(String(settings.agentRuntime ?? '{}'))));
        settings.agentRuntime = JSON.stringify(config); await writeLocalRuntimeSettings(settings);
        return { saved: true };
      }
      case 'agent.runtime.test': {
        const settings = await readLocalRuntimeSettings();
        const config = mergeRuntimeConfig(payload.config, parseRuntimeConfig(JSON.parse(String(settings.agentRuntime ?? '{}'))));
        const manager = new McpManager(config.mcpServers ?? [], String(payload.path), join(app.getPath('userData'), 'agent', 'connection-tests'));
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
        try { await manager.connect(controller.signal); return { servers: manager.diagnostics }; }
        finally { clearTimeout(timer); await manager.close(); }
      }
      case 'project.init':
        {
          const initStore = new ProjectStore(String(payload.path));
          return withProjectLock(initStore.paths.root, async () => {
            const store = initStore;
          const project = await store.init(String(payload.name ?? 'Untitled Project'));
          return { projectId: project.id, path: store.paths.root };
          });
        }
      case 'project.open': {
        const store = new ProjectStore(String(payload.path));
        const project = await store.requireOpen();
        const timeline = await store.readTimeline();
        return {
          projectId: project.id,
          name: project.name,
          path: store.paths.root,
          settings: project.settings,
          timeline
        };
      }
      case 'project.status': {
        const store = new ProjectStore(String(payload.path));
        return store.summary();
      }
      case 'config.get': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        return store.readConfig();
      }
      case 'canvas.remove': {
        const canvasId = String(payload.canvasId);
        const options: Electron.MessageBoxOptions = {
          type: 'warning', title: '删除画布', message: '确定删除这个画布？',
          detail: '此操作无法撤销。已生成的素材文件会保留。',
          buttons: ['取消', '删除画布'], defaultId: 0, cancelId: 0, noLink: true
        };
        const answer = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
        if (answer.response !== 1) return { removed: false };
        const context = await daemon.getContext(String(payload.path));
        return withLockedProject(String(payload.path), async (store) => {
          if (context.jobStore.list().some((job) => job.canvas_id === canvasId && ['pending', 'running'].includes(job.status))) {
            throw new Error('画布仍有生成任务正在运行，请先停止任务再删除。');
          }
          await store.removeCanvas(canvasId);
          return { removed: true };
        });
      }
      case 'asset.list': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        let files: string[] = [];
        try {
          files = await fs.readdir(store.paths.assetsDir);
        } catch {
          files = [];
        }
        return files.map((name) => ({
          name,
          path: join(store.paths.assetsDir, name),
          type: inferAssetType(name)
        }));
      }
      case 'asset.import': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        const dialogOptions = {
          title: 'Import media',
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'aac', 'm4a', 'flac'] }
          ]
        } as Electron.OpenDialogOptions;
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions);
        if (result.canceled || result.filePaths.length === 0) {
          return { imported: [] };
        }
        const imported = [];
        for (const filePath of result.filePaths) {
          const asset = await store.importAsset(filePath);
          imported.push(asset);
        }
        return { imported };
      }
      case 'preset.list': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        return store.listPresets();
      }
      case 'preset.apply':
        return withLockedProject(String(payload.path), async (store) => {
          const preset = await store.readPreset(String(payload.presetId));
          const canvasId = randomUUID();
          const canvas = createCanvas(canvasId, String(payload.name ?? preset.name));
          canvas.nodes = preset.graph.nodes.map((node) => createNode(node.type, node.params, node.id));
          canvas.edges = preset.graph.edges.map((edge) => ({ ...edge }));
          canvas.graphHash = computeGraphHash(canvas);
          await store.writeCanvas(canvas);
          return canvas;
        });
      case 'canvas.render':
        logger.info('canvas.render requested: canvasId=' + payload.canvasId + ' force=' + payload.force);
        return daemon.submitJob(String(payload.path), {
          type: 'canvas.render',
          canvasId: payload.canvasId,
          force: Boolean(payload.force),
          nodeId: payload.nodeId
        });
      case 'timeline.get': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        return store.readTimeline();
      }
      case 'timeline.refresh-canvases':
        return withLockedProject(String(payload.path), async (store) => {
          const timeline = await store.readTimeline();
          for (const track of timeline.tracks) {
            for (const clip of track.clips) {
              if (clip.kind !== 'canvas') continue;
              const canvas = await store.readCanvas(clip.canvasId);
              const asset = canvas.nodes.find((node) => node.type === 'output' && node.status === 'succeeded')?.cachedResult;
              if (!asset) throw new Error(`Render canvas ${canvas.id} before updating clips`);
              clip.canvasGraphHash = canvas.graphHash;
              clip.canvasVersion = canvas.version;
              clip.renderedAsset = asset;
              clip.status = 'fresh';
            }
          }
          await store.writeTimeline(timeline);
          return timeline;
        });
      case 'timeline.add-track':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          const track = addTrack(timeline, String(payload.type) as never, String(payload.name ?? payload.type ?? 'track'));
          await store.writeTimeline(timeline);
          return track;
        });
      case 'timeline.add-clip':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          const track = timeline.tracks.find((item) => item.id === payload.trackId);
          if (!track) throw new Error(`Track not found: ${String(payload.trackId)}`);
          if (payload.kind === 'canvas') {
            const canvas = await store.readCanvas(String(payload.canvasId));
            const clip = addCanvasClip(
              track,
              canvas,
              Number(payload.startMs ?? 0),
              Number(payload.durationMs ?? 5000),
              canvas.nodes.find((node) => node.type === 'output' && node.status === 'succeeded')?.cachedResult
            );
            await store.writeTimeline(timeline);
            return clip;
          }
          const asset = await store.importAsset(String(payload.asset));
          const clip = addMediaClip(track, asset, Number(payload.startMs ?? 0), Number(payload.durationMs ?? asset.durationMs ?? 5000));
          await store.writeTimeline(timeline);
          return clip;
        });
      case 'timeline.add-subtitle':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          const track = timeline.tracks.find((item) => item.id === payload.trackId);
          if (!track) throw new Error(`Track not found: ${String(payload.trackId)}`);
          const clip = addSubtitleClip(
            track,
            String(payload.text ?? ''),
            Number(payload.startMs ?? 0),
            Number(payload.durationMs ?? 2000)
          );
          await store.writeTimeline(timeline);
          return clip;
        });
      case 'timeline.move-clip':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          const clip = moveClip(timeline, String(payload.clipId), Number(payload.startMs ?? 0));
          await store.writeTimeline(timeline);
          return clip;
        });
      case 'timeline.remove-clip':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          removeClip(timeline, String(payload.clipId));
          await store.writeTimeline(timeline);
          return { ok: true };
        });
      case 'timeline.remove-track':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          removeTrack(timeline, String(payload.trackId));
          await store.writeTimeline(timeline);
          return { ok: true };
        });
      case 'timeline.split-clip':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          const result = splitClip(timeline, String(payload.clipId), Number(payload.atMs ?? 0));
          await store.writeTimeline(timeline);
          return result;
        });
      case 'timeline.trim-clip':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          let clip = trimClip(timeline, String(payload.clipId), Number(payload.inMs ?? 0), Number(payload.outMs ?? 0));
          if (payload.startMs !== undefined) clip = moveClip(timeline, clip.id, Number(payload.startMs));
          await store.writeTimeline(timeline);
          return clip;
        });
      case 'timeline.set-clip-param':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          const clipId = String(payload.clipId);
          const param = String(payload.param);
          const value = payload.value;
          let clip;
          if (param === 'transform') {
            clip = setClipTransform(timeline, clipId, value as any);
          } else if (param === 'opacity') {
            clip = setClipOpacity(timeline, clipId, Number(value));
          } else if (param === 'speed') {
            clip = setClipSpeed(timeline, clipId, Number(value));
          } else if (param === 'volume') {
            clip = setClipVolume(timeline, clipId, Number(value));
          } else {
            throw new Error(`Unknown clip param: ${param}`);
          }
          await store.writeTimeline(timeline);
          return clip;
        });
      case 'timeline.add-transition':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          const clip = addTransition(timeline, String(payload.clipId), String(payload.transitionType ?? 'crossfade') as any, Number(payload.durationMs ?? 500));
          await store.writeTimeline(timeline);
          return clip;
        });
      case 'timeline.remove-transition':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const timeline = await store.readTimeline();
          const clip = removeTransition(timeline, String(payload.clipId));
          await store.writeTimeline(timeline);
          return clip;
        });
      case 'timeline.export':
        logger.info('timeline.export requested');
        return daemon.submitJob(String(payload.path), {
          type: 'timeline.export',
          outputPath: payload.outputPath,
          width: payload.width, height: payload.height, fps: payload.fps, crf: payload.crf
        });
      case 'job.submit':
        logger.info('job.submit requested: type=' + payload.type);
        return daemon.submitJob(String(payload.path), payload);
      case 'job.status':
        logger.info('job.status requested: jobId=' + payload.jobId);
        return daemon.getJob(String(payload.path), String(payload.jobId));
      case 'job.wait':
        return daemon.waitJob(String(payload.path), String(payload.jobId), Number(payload.timeoutMs ?? 120_000));
      case 'job.cancel':
        return daemon.cancelJob(String(payload.path), String(payload.jobId));
      case 'job.list':
        return daemon.listJobs(String(payload.path), typeof payload.status === 'string' ? payload.status : undefined);
      case 'job.clear':
        return daemon.clearJobs(String(payload.path), typeof payload.status === 'string' ? payload.status : undefined);
      case 'agent.start':
        return agentService.start(String(payload.path), String(payload.message ?? ''), String(payload.conversationId ?? 'default'));
      case 'agent.get-run':
        return agentService.getRun(String(payload.path), String(payload.conversationId ?? 'default'), Number(payload.after ?? 0));
      case 'agent.cancel':
        return agentService.cancel(String(payload.path), String(payload.conversationId ?? 'default'));
      case 'agent.conversations.list':
        return agentService.list(String(payload.path));
      case 'agent.conversations.create':
        return agentService.create(String(payload.path));
      case 'agent.conversations.manage':
        return agentService.manage(String(payload.path), String(payload.conversationId), String(payload.action), payload.title === undefined ? undefined : String(payload.title));
      case 'agent.history':
        return agentService.history(String(payload.path), String(payload.conversationId ?? 'default'));
      case 'agent.chat':
        return agentService.chat(String(payload.path), String(payload.message ?? ''), String(payload.conversationId ?? 'default'));
      case 'settings.get-runtime': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        const config = await store.readConfig();
        const local = await readLocalRuntimeSettings();
        return {
          arkApiKey: String(local.arkApiKey ?? process.env.ARK_API_KEY ?? ''),
          arkBaseUrl: config.provider.volcengine.baseUrl,
          arkImageModel: config.provider.volcengine.imageModel,
          arkVideoModel: config.provider.volcengine.videoModel,
          tosAccessKeyId: String(local.tosAccessKeyId ?? process.env.TOS_ACCESS_KEY_ID ?? ''),
          tosAccessKeySecret: String(local.tosAccessKeySecret ?? process.env.TOS_ACCESS_KEY_SECRET ?? ''),
          tosBucket: config.tos.bucket,
          tosRegion: config.tos.region,
          tosEndpoint: config.tos.endpoint,
          ffmpegPath: String(local.ffmpegPath ?? process.env.FFMPEG_PATH ?? config.ffmpeg?.path ?? ''),
          agentBaseUrl: String(local.agentBaseUrl ?? 'https://api.openai.com/v1'),
          agentApiKey: String(local.agentApiKey ?? ''),
          agentModel: String(local.agentModel ?? 'gpt-4o-mini')
        };
      }
      case 'settings.set-runtime':
        return withLockedProject(String(payload.path), async (store) => {
          const config = await store.readConfig();
          for (const [field, key] of [['arkBaseUrl', 'baseUrl'], ['arkImageModel', 'imageModel'], ['arkVideoModel', 'videoModel']] as const) {
            if (payload[field] === undefined) continue;
            const value = typeof payload[field] === 'string' ? payload[field].trim() : '';
            if (!value) throw new Error(`${field} 不能为空`);
            if (field === 'arkBaseUrl') {
              let url: URL;
              try { url = new URL(value); } catch { throw new Error('ARK Base URL 必须是完整的 HTTP/HTTPS 地址'); }
              if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('ARK Base URL 必须是不含凭证的 HTTP/HTTPS 地址');
            }
            config.provider.volcengine[key] = value;
          }
          if (typeof payload.arkApiKey === 'string' && payload.arkApiKey) {
            process.env.ARK_API_KEY = payload.arkApiKey;
          }
          if (typeof payload.tosAccessKeyId === 'string' && payload.tosAccessKeyId) {
            process.env.TOS_ACCESS_KEY_ID = payload.tosAccessKeyId;
          }
          if (typeof payload.tosAccessKeySecret === 'string' && payload.tosAccessKeySecret) {
            process.env.TOS_ACCESS_KEY_SECRET = payload.tosAccessKeySecret;
          }
          if (typeof payload.ffmpegPath === 'string' && payload.ffmpegPath) {
            process.env.FFMPEG_PATH = payload.ffmpegPath;
          }

          if (typeof payload.tosBucket === 'string' && payload.tosBucket) {
            config.tos.bucket = payload.tosBucket;
          }
          if (typeof payload.tosRegion === 'string' && payload.tosRegion) {
            config.tos.region = payload.tosRegion;
          }
          if (typeof payload.tosEndpoint === 'string' && payload.tosEndpoint) {
            config.tos.endpoint = payload.tosEndpoint;
          }
          if (typeof payload.ffmpegPath === 'string') {
            config.ffmpeg = { ...(config.ffmpeg ?? {}), path: payload.ffmpegPath };
          }
          await store.writeConfig(config);

          const local = await readLocalRuntimeSettings();
          if (typeof payload.arkApiKey === 'string') local.arkApiKey = payload.arkApiKey;
          if (typeof payload.tosAccessKeyId === 'string') local.tosAccessKeyId = payload.tosAccessKeyId;
          if (typeof payload.tosAccessKeySecret === 'string') local.tosAccessKeySecret = payload.tosAccessKeySecret;
          if (typeof payload.ffmpegPath === 'string') local.ffmpegPath = payload.ffmpegPath;
          if (typeof payload.agentBaseUrl === 'string') local.agentBaseUrl = payload.agentBaseUrl;
          if (typeof payload.agentApiKey === 'string') local.agentApiKey = payload.agentApiKey;
          if (typeof payload.agentModel === 'string') local.agentModel = payload.agentModel;
          await writeLocalRuntimeSettings(local);

          return {
            configured: true,
            hasArkApiKey: Boolean(process.env.ARK_API_KEY),
            hasTosCredentials: Boolean(process.env.TOS_ACCESS_KEY_ID && process.env.TOS_ACCESS_KEY_SECRET),
            tosBucket: config.tos.bucket
          };
        });
      default:
        throw new Error(`Unknown invoke channel: ${channel}`);
    }
  });
}

async function captureMainWindow(): Promise<UiScreenshotResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available');
  }
  return captureWindowScreenshot(mainWindow, app.getPath('userData'));
}

async function withLockedProject<T>(projectPath: string, fn: (store: ProjectStore) => Promise<T>): Promise<T> {
  const store = new ProjectStore(projectPath);
  await store.requireOpen();
  return withProjectLock(store.paths.root, () => fn(store));
}

app.setPath('userData', join(app.getPath('appData'), 'canvas-cut'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    try { require('fs').mkdirSync(join(process.cwd(), 'logs'), { recursive: true }); require('fs').writeFileSync(join(process.cwd(), 'logs', 'startup-test.txt'), 'startup ' + new Date().toISOString() + '\n'); } catch(e) { console.error('STARTUP WRITE FAILED:', (e as Error).message); }
    logger.setLogFile(join(app.getPath('userData'), 'canvas-cut.log'));
    const logDir = join(process.cwd(), 'logs');
    require('node:fs').mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, 'canvas-cut-' + new Date().toISOString().slice(0,19).replace(/:/g,'-').replace('T','-') + '.log');
    logger.setLogFile(logFile);
    require('fs').writeFileSync(logFile, '=== canvas-cut startup ' + new Date().toISOString() + ' ===\n');

    logger.info('App starting...');
    logger.info('userData: ' + app.getPath('userData'));
    logger.info('Loading runtime settings...');
    const localSettings = await readLocalRuntimeSettings();
    if (typeof localSettings.arkApiKey === 'string' && localSettings.arkApiKey) {
      logger.info('ARK_API_KEY found in settings');
      process.env.ARK_API_KEY = localSettings.arkApiKey;
    }
    if (typeof localSettings.tosAccessKeyId === 'string' && localSettings.tosAccessKeyId) {
      process.env.TOS_ACCESS_KEY_ID = localSettings.tosAccessKeyId;
    }
    if (typeof localSettings.tosAccessKeySecret === 'string' && localSettings.tosAccessKeySecret) {
      process.env.TOS_ACCESS_KEY_SECRET = localSettings.tosAccessKeySecret;
    }
    if (typeof localSettings.ffmpegPath === 'string' && localSettings.ffmpegPath) {
      process.env.FFMPEG_PATH = localSettings.ffmpegPath;
    }
    logger.info('Starting DaemonService...');
    daemon = new DaemonService(canvasChanged);
    for (const diagnostic of await recoverPatches(join(app.getPath('userData'), 'agent', 'patches'))) logger.warn(diagnostic);
    agentService = await createAgentService({ userDataDir: app.getPath('userData'), appRoot: app.getAppPath(), executable: process.execPath, settings: readLocalRuntimeSettings });
    logger.info('Starting IPC server...');
    ipcServer = new LocalIpcServer(
      { userDataDir: app.getPath('userData'), captureUi: captureMainWindow, canvasChanged,
        agentRequest: async (method, projectPath, payload) => {
          const conversation = typeof payload.conversationId === 'string' ? payload.conversationId : 'default';
          switch (method) {
            case 'agent.start': return agentService.start(projectPath, String(payload.message ?? ''), conversation);
            case 'agent.get-run': return agentService.getRun(projectPath, conversation, Number(payload.after ?? 0));
            case 'agent.history': return agentService.history(projectPath, conversation);
            case 'agent.cancel': return agentService.cancel(projectPath, conversation);
            default: throw new Error('Unknown Agent operation');
          }
        }
      },
      daemon,
      async (projectPath, payload) => agentService.chat(projectPath, String(payload.message ?? ''), String(payload.conversationId ?? 'default'))
    );
    await ipcServer.start();
    logger.info('IPC server started on ' + ipcServer.endpoint);
    registerIpcHandlers();
    logger.info('Creating main window...');
    mainWindow = createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  let shutdownComplete = false;
  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      await agentService?.shutdown();
    logger.info('App quitting...');
      await ipcServer?.stop();
      await daemon?.shutdown();
      shutdownComplete = true; app.quit();
    })().catch((error) => { logger.error(String(error)); shutdownComplete = true; app.quit(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
