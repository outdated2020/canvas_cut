import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import {
  addCanvasClip,
  addMediaClip,
  addSubtitleClip,
  addTrack,
  atomicWriteJson,
  connectEdge,
  computeGraphHash,
  createCanvas,
  createNode,
  disconnectEdge,
  moveClip,
  ProjectStore,
  addNode,
  removeNode,
  setNodeParams,
  NodeType,
  withProjectLock,
  logger
} from '@canvas-cut/core';
import { randomUUID } from 'node:crypto';
import { DaemonService } from './daemon';
import { LocalIpcServer } from './ipc-server';
import { runAgentMessage } from '@canvas-cut/agent';
import { captureWindowScreenshot, UiScreenshotResult } from './ui-capture';

let mainWindow: BrowserWindow | null = null;
let daemon: DaemonService;
let ipcServer: LocalIpcServer;

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
  try {
    const content = await fs.readFile(localRuntimeSettingsPath(), 'utf8');
    return JSON.parse(content.replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeLocalRuntimeSettings(data: Record<string, unknown>): Promise<void> {
  await atomicWriteJson(localRuntimeSettingsPath(), data, { pretty: true });
}

async function handleAgentChat(
  projectPath: string,
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  daemon: DaemonService
): Promise<{ text: string }> {
  const store = new ProjectStore(projectPath);
  await store.requireOpen();
  const local = await readLocalRuntimeSettings();
  const apiKey = String(local.agentApiKey ?? '');
  if (!apiKey) {
    throw new Error('Agent API key is not configured. Open Settings and set Agent API Key.');
  }
  const text = await runAgentMessage(message, history, {
    apiKey,
    baseUrl: String(local.agentBaseUrl ?? 'https://api.openai.com/v1'),
    model: String(local.agentModel ?? 'gpt-4o-mini'),
    callbacks: {
      createCanvas: async (prompt, name) => {
        return withProjectLock(store.paths.root, async () => {
          const canvas = createCanvas(randomUUID(), name);
          const inputNode = addNode(canvas, 'text-input', { text: prompt });
          const genNode = addNode(canvas, 'text-to-video', { durationMs: 5000 });
          const outputNode = addNode(canvas, 'output', {});
          connectEdge(canvas, inputNode.id, 'text', genNode.id, 'text');
          connectEdge(canvas, genNode.id, 'video', outputNode.id, 'video');
          await store.writeCanvas(canvas);
          return { canvasId: canvas.id };
        });
      },
      renderCanvas: async (canvasId) => {
        return daemon.submitJob(store.paths.root, {
          type: 'canvas.render',
          canvasId,
          force: false
        });
      },
      addCanvasToTimeline: async (canvasId, durationMs) => {
        return withProjectLock(store.paths.root, async () => {
          const timeline = await store.readTimeline();
          let track = timeline.tracks.find((item) => item.type === 'video');
          if (!track) {
            track = addTrack(timeline, 'video', 'V1');
          }
          const canvas = await store.readCanvas(canvasId);
          const clip = addCanvasClip(track, canvas, 0, durationMs);
          await store.writeTimeline(timeline);
          return { clipId: clip.id };
        });
      }
    }
  });
  return { text };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'Canvas Cut',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !process.env.VITE_DEV_SERVER_URL
    }
  });

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
    switch (channel) {
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
      case 'canvas.create':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const id = randomUUID();
          const canvas = createCanvas(id, String(payload.name ?? 'Canvas'));
          await store.writeCanvas(canvas);
          return canvas;
        });
      case 'canvas.get': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        return store.readCanvas(String(payload.canvasId));
      }
      case 'canvas.list': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        const files = await store.listCanvasFiles();
        const canvases = [];
        for (const file of files) {
          const id = file.replace(/\.json$/, '');
          const graph = await store.readCanvas(id);
          canvases.push({
            id: graph.id,
            version: graph.version,
            graphHash: graph.graphHash,
            nodeCount: graph.nodes.length
          });
        }
        return canvases;
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
      case 'canvas.node.add':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const graph = await store.readCanvas(String(payload.canvasId));
          const node = addNode(graph, String(payload.type) as NodeType, (payload.params as Record<string, unknown>) ?? {});
          await store.writeCanvas(graph);
          return node;
        });
      case 'canvas.node.remove':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const graph = await store.readCanvas(String(payload.canvasId));
          removeNode(graph, String(payload.nodeId));
          await store.writeCanvas(graph);
          return { removed: payload.nodeId };
        });
      case 'canvas.node.set-param':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const graph = await store.readCanvas(String(payload.canvasId));
          const node = setNodeParams(graph, String(payload.nodeId), (payload.params as Record<string, unknown>) ?? {});
          await store.writeCanvas(graph);
          return node;
        });
      case 'canvas.edge.connect':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const graph = await store.readCanvas(String(payload.canvasId));
          const edge = connectEdge(
            graph,
            String(payload.source),
            String(payload.sourcePort),
            String(payload.target),
            String(payload.targetPort)
          );
          await store.writeCanvas(graph);
          return edge;
        });
      case 'canvas.edge.remove':
        return withLockedProject(String(payload.path), async (store) => {
          await store.requireOpen();
          const graph = await store.readCanvas(String(payload.canvasId));
          disconnectEdge(graph, String(payload.edgeId));
          await store.writeCanvas(graph);
          return { removed: payload.edgeId };
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
              Number(payload.durationMs ?? 5000)
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
      case 'timeline.export':
        logger.info('timeline.export requested');
        return daemon.submitJob(String(payload.path), {
          type: 'timeline.export',
          outputPath: payload.outputPath
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
      case 'agent.chat': {
        const history = Array.isArray(payload.history)
          ? (payload.history as Array<{ role: 'user' | 'assistant'; content: string }>)
          : [];
        return handleAgentChat(
          String(payload.path),
          String(payload.message ?? ''),
          history,
          daemon
        );
      }
      case 'settings.get-runtime': {
        const store = new ProjectStore(String(payload.path));
        await store.requireOpen();
        const config = await store.readConfig();
        const local = await readLocalRuntimeSettings();
        return {
          arkApiKey: String(local.arkApiKey ?? process.env.ARK_API_KEY ?? ''),
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

          const config = await store.readConfig();
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
    daemon = new DaemonService();
    logger.info('Starting IPC server...');
    ipcServer = new LocalIpcServer(
      { userDataDir: app.getPath('userData'), captureUi: captureMainWindow },
      daemon,
      async (projectPath, payload) =>
        handleAgentChat(
          projectPath,
          String(payload.message ?? ''),
          Array.isArray(payload.history)
            ? (payload.history as Array<{ role: 'user' | 'assistant'; content: string }>)
            : [],
          daemon
        )
    );
    await ipcServer.start();
    logger.info('IPC server started on ' + ipcServer.endpoint);
    registerIpcHandlers();
    logger.info('Creating main window...');
    mainWindow = createWindow();
    logger.info('Creating main window...');
    mainWindow = createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  app.on('before-quit', () => {
    logger.info('App quitting...');
    void ipcServer?.stop();
    void daemon?.shutdown();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
