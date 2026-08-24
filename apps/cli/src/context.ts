import { ProjectStore, resolveProjectRoot, withProjectLock } from '@canvas-cut/core';
import type { CliOptions } from './args';

export function createStore(options: CliOptions): ProjectStore {
  return new ProjectStore(resolveProjectRoot(process.cwd(), options.project));
}

export async function withLockedStore<T>(
  options: CliOptions,
  fn: (store: ProjectStore) => Promise<T>
): Promise<T> {
  const store = createStore(options);
  return withProjectLock(store.paths.root, () => fn(store));
}
