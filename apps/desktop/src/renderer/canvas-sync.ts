export interface CanvasChangeNotification { projectPath: string; canvasId: string; }
export interface CanvasTarget { projectPath: string; canvasId: string | null; epoch: number; }
export function projectKey(path: string): string {
  const slash = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(slash) || slash.startsWith('//') ? slash.toLowerCase() : slash;
}
export function createCanvasRefreshCoordinator<Sidebar, Canvas>(options: {
  target: () => CanvasTarget;
  loadSidebar: (path: string) => Promise<Sidebar>;
  loadCanvas: (path: string, id: string) => Promise<Canvas>;
  applySidebar: (data: Sidebar) => void;
  applyCanvas: (data: Canvas) => void;
  onError: (error: unknown) => void;
  debounceMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false, pendingEpoch = -1, revision = 0;
  const ids = new Set<string>();
  const flush = async () => {
    timer = undefined;
    const target = options.target(), changed = new Set(ids); ids.clear();
    if (disposed || target.epoch !== pendingEpoch) return;
    const currentRevision = ++revision;
    const refreshCanvas = !!target.canvasId && changed.has(target.canvasId);
    const [sidebar, canvas] = await Promise.allSettled([
      options.loadSidebar(target.projectPath),
      refreshCanvas ? options.loadCanvas(target.projectPath, target.canvasId!) : Promise.resolve(undefined)
    ]);
    if (disposed || options.target().epoch !== target.epoch || currentRevision !== revision) return;
    if (sidebar.status === 'fulfilled') options.applySidebar(sidebar.value); else options.onError(sidebar.reason);
    if (refreshCanvas) {
      if (canvas.status === 'fulfilled') options.applyCanvas(canvas.value as Canvas); else options.onError(canvas.reason);
    }
  };
  return {
    receive(change: CanvasChangeNotification) {
      const target = options.target();
      if (disposed || !change || typeof change.projectPath !== 'string' || typeof change.canvasId !== 'string' || projectKey(change.projectPath) !== projectKey(target.projectPath)) return;
      if (pendingEpoch !== target.epoch) ids.clear();
      pendingEpoch = target.epoch; ids.add(change.canvasId);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void flush().catch(options.onError); }, options.debounceMs ?? 150);
    },
    dispose() { disposed = true; revision++; if (timer) clearTimeout(timer); ids.clear(); }
  };
}

export function reconcileCanvasNodes<T extends { id: string; position?: unknown; selected?: boolean; width?: number | null; height?: number | null }>(previous: T[], next: T[]): T[] {
  const existing = new Map(previous.map(node => [node.id, node]));
  return next.map(node => {
    const old = existing.get(node.id);
    return old ? { ...node, position: old.position, selected: old.selected,
      ...(old.width == null ? {} : { width: old.width }), ...(old.height == null ? {} : { height: old.height }) } : node;
  });
}
