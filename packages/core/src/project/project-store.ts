import { promises as fs } from 'node:fs';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  AssetRef,
  CanvasGraph,
  CanvasPreset,
  ProjectConfigFile,
  ProjectFile,
  ProjectSummary,
  TimelineFile
} from '../types';
import { atomicWriteJson, readJsonFile } from '../fs/atomic';
import { CanvasCutError, ERROR_CODES } from '../errors';
import { probeMedia } from '../ffmpeg/ffmpeg';

export interface ProjectPaths {
  root: string;
  projectJson: string;
  configJson: string;
  canvasesDir: string;
  presetsDir: string;
  timelineDir: string;
  timelineJson: string;
  assetsDir: string;
  cacheDir: string;
  jobsSqlite: string;
  skillsDir: string;
}

export function projectPaths(root: string): ProjectPaths {
  return {
    root,
    projectJson: join(root, 'project.json'),
    configJson: join(root, 'config.json'),
    canvasesDir: join(root, 'canvases'),
    presetsDir: join(root, 'presets'),
    timelineDir: join(root, 'timeline'),
    timelineJson: join(root, 'timeline', 'timeline.json'),
    assetsDir: join(root, 'assets'),
    cacheDir: join(root, 'cache'),
    jobsSqlite: join(root, 'jobs.sqlite'),
    skillsDir: join(root, 'skills')
  };
}

export function resolveProjectRoot(cwd: string, explicit?: string): string {
  return resolve(cwd, explicit ?? '.');
}

export function defaultProjectSettings() {
  return {
    width: 1920,
    height: 1080,
    fps: 24,
    previewResolution: '720p'
  };
}

export function createDefaultProjectFile(id: string, name: string): ProjectFile {
  const now = Date.now();
  return {
    schemaVersion: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    settings: defaultProjectSettings()
  };
}

export function createDefaultConfigFile(): ProjectConfigFile {
  return {
    schemaVersion: 1,
    provider: {
      default: 'volcengine',
      volcengine: {
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        imageModel: 'doubao-seedream-5-0-pro-260628',
        videoModel: 'doubao-seedance-2-5-260628',
        timeoutMs: 300_000
      }
    },
    tos: {
      endpoint: 'https://tos-cn-beijing.volces.com',
      region: 'cn-beijing',
      bucket: '',
      urlTtlSeconds: 7200
    },
    concurrency: {
      maxGenerationJobs: 3
    },
    ffmpeg: {
      path: ''
    }
  };
}

export function createEmptyTimeline(id = randomUUID()): TimelineFile {
  return {
    schemaVersion: 1,
    id,
    tracks: []
  };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function inferAssetType(ext: string): AssetRef['type'] {
  const normalized = ext.toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(normalized)) return 'image';
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(normalized)) return 'video';
  if (['.mp3', '.wav', '.aac', '.m4a', '.flac'].includes(normalized)) return 'audio';
  throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Unsupported asset extension: ${ext}`);
}

export class ProjectStore {
  readonly paths: ProjectPaths;

  constructor(projectRoot: string) {
    this.paths = projectPaths(resolve(projectRoot));
  }

  async init(name: string): Promise<ProjectFile> {
    if (await pathExists(this.paths.projectJson)) {
      throw new CanvasCutError(ERROR_CODES.PROJECT_EXISTS, `Project already exists at ${this.paths.root}`, {
        retryable: false
      });
    }

    await Promise.all([
      fs.mkdir(this.paths.canvasesDir, { recursive: true }),
      fs.mkdir(this.paths.presetsDir, { recursive: true }),
      fs.mkdir(this.paths.timelineDir, { recursive: true }),
      fs.mkdir(this.paths.assetsDir, { recursive: true }),
      fs.mkdir(this.paths.cacheDir, { recursive: true })
    ]);

    const project = createDefaultProjectFile(randomUUID(), name);
    const config = createDefaultConfigFile();
    const timeline = createEmptyTimeline();

    await atomicWriteJson(this.paths.projectJson, project);
    await atomicWriteJson(this.paths.configJson, config);
    await atomicWriteJson(this.paths.timelineJson, timeline);
    return project;
  }

  async requireOpen(): Promise<ProjectFile> {
    if (!(await pathExists(this.paths.projectJson))) {
      throw new CanvasCutError(ERROR_CODES.PROJECT_NOT_FOUND, `Project not found at ${this.paths.root}`);
    }
    return this.readProject();
  }

  async readProject(): Promise<ProjectFile> {
    return readJsonFile<ProjectFile>(this.paths.projectJson);
  }

  async readConfig(): Promise<ProjectConfigFile> {
    if (!(await pathExists(this.paths.configJson))) {
      const config = createDefaultConfigFile();
      await atomicWriteJson(this.paths.configJson, config);
      return config;
    }
    return readJsonFile<ProjectConfigFile>(this.paths.configJson);
  }

  async writeConfig(config: ProjectConfigFile): Promise<void> {
    await atomicWriteJson(this.paths.configJson, config);
  }

  async readTimeline(): Promise<TimelineFile> {
    if (!(await pathExists(this.paths.timelineJson))) {
      const timeline = createEmptyTimeline();
      await fs.mkdir(this.paths.timelineDir, { recursive: true });
      await atomicWriteJson(this.paths.timelineJson, timeline);
      return timeline;
    }
    const timeline = await readJsonFile<TimelineFile>(this.paths.timelineJson);
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.kind !== 'canvas') continue;
        try {
          const canvas = await this.readCanvas(clip.canvasId);
          if (canvas.graphHash !== clip.canvasGraphHash) clip.status = 'stale';
        } catch { clip.status = 'failed'; }
      }
    }
    return timeline;
  }

  async writeTimeline(timeline: TimelineFile): Promise<void> {
    await fs.mkdir(this.paths.timelineDir, { recursive: true });
    await atomicWriteJson(this.paths.timelineJson, timeline);
  }

  async touchProject(): Promise<void> {
    const project = await this.readProject();
    project.updatedAt = Date.now();
    await atomicWriteJson(this.paths.projectJson, project);
  }

  async listCanvasFiles(): Promise<string[]> {
    if (!(await pathExists(this.paths.canvasesDir))) return [];
    const entries = await fs.readdir(this.paths.canvasesDir);
    return entries.filter((entry) => entry.endsWith('.json'));
  }

  async readCanvas(canvasId: string): Promise<CanvasGraph> {
    const path = this.canvasPath(canvasId);
    if (!(await pathExists(path))) {
      throw new CanvasCutError(ERROR_CODES.CANVAS_NOT_FOUND, `Canvas not found: ${canvasId}`);
    }
    return readJsonFile<CanvasGraph>(path);
  }

  async writeCanvas(canvas: CanvasGraph): Promise<void> {
    await fs.mkdir(this.paths.canvasesDir, { recursive: true });
    await atomicWriteJson(this.canvasPath(canvas.id), canvas);
    await this.touchProject();
  }

  async removeCanvas(canvasId: string): Promise<void> {
    const path = this.canvasPath(canvasId);
    if (!(await pathExists(path))) {
      throw new CanvasCutError(ERROR_CODES.CANVAS_NOT_FOUND, `Canvas not found: ${canvasId}`);
    }
    const timeline = await this.readTimeline();
    if (timeline.tracks.some((track) => track.clips.some((clip) => clip.kind === 'canvas' && clip.canvasId === canvasId))) {
      throw new CanvasCutError(ERROR_CODES.EDGE_INVALID, '画布正在被时间线引用，请先移除对应片段再删除画布。');
    }
    const canvasFiles = await this.listCanvasFiles();
    for (const file of canvasFiles) {
      const other = await this.readCanvas(file.replace(/\.json$/, ''));
      if (other.id === canvasId) continue;
      const referenced = other.nodes.some(
        (node) => node.type === 'canvas-reference' && node.params.canvasId === canvasId
      );
      if (referenced) {
        throw new CanvasCutError(
          ERROR_CODES.EDGE_INVALID,
          `Canvas ${canvasId} is referenced by canvas ${other.id} and cannot be removed`
        );
      }
    }
    await fs.rm(path);
    await this.touchProject();
  }

  canvasPath(canvasId: string): string {
    if (basename(canvasId) !== canvasId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Invalid canvas id: ${canvasId}`);
    }
    return join(this.paths.canvasesDir, `${canvasId}.json`);
  }

  async listPresets(): Promise<CanvasPreset[]> {
    if (!(await pathExists(this.paths.presetsDir))) return [];
    const files = await fs.readdir(this.paths.presetsDir);
    const presets: CanvasPreset[] = [];
    for (const file of files.filter((entry) => entry.endsWith('.json'))) {
      try {
        presets.push(await readJsonFile<CanvasPreset>(join(this.paths.presetsDir, file)));
      } catch {
        // Ignore invalid preset files.
      }
    }
    return presets.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readPreset(presetId: string): Promise<CanvasPreset> {
    if (basename(presetId) !== presetId) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Invalid preset id: ${presetId}`);
    }
    const path = join(this.paths.presetsDir, `${presetId}.json`);
    if (!(await pathExists(path))) {
      throw new CanvasCutError('PRESET_NOT_FOUND', `Preset not found: ${presetId}`);
    }
    return readJsonFile<CanvasPreset>(path);
  }

  async writePreset(preset: CanvasPreset): Promise<void> {
    await fs.mkdir(this.paths.presetsDir, { recursive: true });
    await atomicWriteJson(join(this.paths.presetsDir, `${preset.id}.json`), preset);
  }

  async importAsset(sourcePath: string, type?: AssetRef['type']): Promise<AssetRef> {
    const absolute = resolve(sourcePath);
    if (!(await pathExists(absolute))) {
      throw new CanvasCutError(ERROR_CODES.ASSET_NOT_FOUND, `Asset not found: ${absolute}`);
    }
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
      throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Asset is not a file: ${absolute}`);
    }

    const ext = extname(absolute);
    const assetType = type ?? inferAssetType(ext);
    const content = await fs.readFile(absolute);
    const id = createHash('sha256').update(content).digest('hex');
    const targetName = `${id}${ext}`;
    const targetPath = join(this.paths.assetsDir, targetName);

    if (!(await pathExists(targetPath))) {
      await fs.mkdir(this.paths.assetsDir, { recursive: true });
      await fs.writeFile(targetPath, content);
    }

    const asset: AssetRef = {
      id,
      path: targetPath,
      type: assetType,
      sizeBytes: stat.size
    };

    // Probe media duration for video and audio files (best-effort)
    if (assetType === 'video' || assetType === 'audio') {
      try {
        const info = await probeMedia(targetPath);
        if (info.durationMs) {
          asset.durationMs = info.durationMs;
        }
        if (info.width && info.height) {
          asset.width = info.width;
          asset.height = info.height;
        }
      } catch {
        // ffprobe not available — duration will fall back to default (5s)
      }
    }

    return asset;
  }

  async assetFromLocalPath(localPath: string): Promise<AssetRef> {
    const absolute = resolve(localPath);
    if (!(await pathExists(absolute))) {
      throw new CanvasCutError(ERROR_CODES.ASSET_NOT_FOUND, `Asset not found: ${absolute}`);
    }
    const stat = await fs.stat(absolute);
    const ext = extname(absolute);
    const type = inferAssetType(ext);
    const content = await fs.readFile(absolute);
    const id = createHash('sha256').update(content).digest('hex');
    return {
      id,
      path: absolute,
      type,
      sizeBytes: stat.size
    };
  }

  async summary(runningJobs = 0): Promise<ProjectSummary> {
    const project = await this.requireOpen();
    const timeline = await this.readTimeline();
    const canvasFiles = await this.listCanvasFiles();
    const durationMs = timeline.tracks.reduce(
      (max, track) =>
        Math.max(
          max,
          ...track.clips.map((clip) => ('startMs' in clip ? clip.startMs + clip.durationMs : 0))
        ),
      0
    );
    return {
      projectId: project.id,
      path: this.paths.root,
      canvasCount: canvasFiles.length,
      timelineDurationMs: durationMs,
      runningJobs
    };
  }

  static sanitizeId(value: string): string {
    return normalize(value).replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
