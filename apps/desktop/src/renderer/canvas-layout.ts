// Presentation-only layout. Groups never become execution-graph nodes.
export interface Point { x: number; y: number; }
export interface LayoutNode { id: string; position: Point; width?: number | null; height?: number | null; data: { type?: string }; }
export interface CanvasGroup { id: string; label: string; members: string[]; }
export interface SavedCanvasLayout { positions: Record<string, Point>; groups: CanvasGroup[]; }
export interface SnapPreview {
  targetId: string;
  bounds: Point & { width: number; height: number };
  lines: Array<{ from: Point; to: Point }>;
}
const size = (node: LayoutNode) => ({ width: node.width ?? 300, height: node.height ?? 190 });
export function buildSnapPreview(moving: LayoutNode, target: LayoutNode, position: Point): SnapPreview {
  const own = size(moving), other = size(target), p = target.position;
  const lines: SnapPreview['lines'] = [], extension = 12;
  if (Math.abs(position.y - p.y) < 0.01) {
    const from = Math.min(position.x, p.x) - extension;
    const to = Math.max(position.x + own.width, p.x + other.width) + extension;
    lines.push({ from: { x: from, y: p.y }, to: { x: to, y: p.y } });
    if (Math.abs(own.height - other.height) < 0.01) lines.push({
      from: { x: from, y: p.y + other.height }, to: { x: to, y: p.y + other.height }
    });
  }
  if (Math.abs(position.x - p.x) < 0.01) {
    const from = Math.min(position.y, p.y) - extension;
    const to = Math.max(position.y + own.height, p.y + other.height) + extension;
    lines.push({ from: { x: p.x, y: from }, to: { x: p.x, y: to } });
    if (Math.abs(own.width - other.width) < 0.01) lines.push({
      from: { x: p.x + other.width, y: from }, to: { x: p.x + other.width, y: to }
    });
  }
  return { targetId: target.id, bounds: { ...position, ...own }, lines };
}
export function groupBounds(group: CanvasGroup, nodes: LayoutNode[]) {
  const members = nodes.filter(node => group.members.includes(node.id));
  if (!members.length) return null;
  const x = Math.min(...members.map(node => node.position.x)) - 24;
  const y = Math.min(...members.map(node => node.position.y)) - 44;
  return { x, y, width: Math.max(...members.map(node => node.position.x + size(node).width)) + 24 - x,
    height: Math.max(...members.map(node => node.position.y + size(node).height)) + 24 - y };
}
export function cleanGroups(groups: CanvasGroup[], ids: Set<string>): CanvasGroup[] {
  const assigned = new Set<string>();
  return groups.flatMap(group => {
    const members = [...new Set(group.members)].filter(id => ids.has(id) && !assigned.has(id));
    members.forEach(id => assigned.add(id));
    return members.length ? [{ ...group, members }] : [];
  });
}
export function findSameTypeSnap(moving: LayoutNode, nodes: LayoutNode[], groups: CanvasGroup[], zoom: number) {
  const ownGroup = groups.find(group => group.members.includes(moving.id))?.id;
  const threshold = 32 / Math.max(zoom, 0.1), gap = 24, own = size(moving);
  let best: { position: Point; targetId: string; distance: number } | null = null;
  for (const other of nodes) {
    if (other.id === moving.id || other.data.type !== moving.data.type) continue;
    if (groups.find(group => group.members.includes(other.id))?.id !== ownGroup) continue;
    const dimensions = size(other), p = other.position;
    const candidates = [
      { x: p.x + dimensions.width + gap, y: p.y }, { x: p.x - own.width - gap, y: p.y },
      { x: p.x, y: p.y + dimensions.height + gap }, { x: p.x, y: p.y - own.height - gap }
    ];
    for (const position of candidates) {
      const distance = Math.hypot(position.x - moving.position.x, position.y - moving.position.y);
      if (distance > threshold || (best && distance >= best.distance)) continue;
      const overlaps = nodes.some(node => {
        if (node.id === moving.id) return false;
        const s = size(node);
        return position.x < node.position.x + s.width && position.x + own.width > node.position.x
          && position.y < node.position.y + s.height && position.y + own.height > node.position.y;
      });
      if (!overlaps) best = { position, targetId: other.id, distance };
    }
  }
  return best;
}
export function parseCanvasLayout(value: string | null): SavedCanvasLayout {
  const empty = { positions: {}, groups: [] };
  try {
    const parsed = JSON.parse(value ?? 'null');
    if (!parsed || parsed.version !== 1) return empty;
    const positions: Record<string, Point> = {};
    for (const [id, point] of Object.entries(parsed.positions ?? {})) {
      const p = point as Point;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[id] = { x: p.x, y: p.y };
    }
    const seen = new Set<string>();
    const groups: CanvasGroup[] = Array.isArray(parsed.groups) ? parsed.groups.filter((g: CanvasGroup) => {
      if (!g || typeof g.id !== 'string' || !g.id.startsWith('ui-group:') || seen.has(g.id)
        || typeof g.label !== 'string' || !Array.isArray(g.members) || !g.members.every(id => typeof id === 'string')) return false;
      seen.add(g.id); return true;
    }) : [];
    return { positions, groups };
  } catch { return empty; }
}
