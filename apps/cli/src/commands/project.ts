import { createStore, withLockedStore } from '../context';
import type { CliOptions } from '../args';

export async function projectInit(options: CliOptions): Promise<unknown> {
  return withLockedStore(options, async (store) => {
    const name = (options.flags.name as string) ?? 'Untitled Project';
    const project = await store.init(name);
    return {
      projectId: project.id,
      path: store.paths.root,
      createdAt: project.createdAt
    };
  });
}

export async function projectOpen(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  const project = await store.requireOpen();
  const timeline = await store.readTimeline();
  const canvasFiles = await store.listCanvasFiles();
  return {
    projectId: project.id,
    name: project.name,
    path: store.paths.root,
    schemaVersion: project.schemaVersion,
    settings: project.settings,
    canvasCount: canvasFiles.length,
    trackCount: timeline.tracks.length
  };
}

export async function projectStatus(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  return store.summary();
}
