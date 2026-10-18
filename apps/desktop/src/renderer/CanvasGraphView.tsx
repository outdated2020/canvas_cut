import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { reconcileCanvasNodes } from './canvas-sync';
import { buildSnapPreview, cleanGroups, findSameTypeSnap, groupBounds, parseCanvasLayout, type CanvasGroup, type SnapPreview } from './canvas-layout';
import ReactFlow, {
  addEdge,
  applyNodeChanges,
  Background,
  Controls,
  Connection,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  Position,
  ReactFlowInstance,
  useEdgesState,
  useNodesState,
  useViewport,
  useUpdateNodeInternals
} from 'reactflow';
import 'reactflow/dist/style.css';
import { NodeParamsInline, nodeLabels, isGenerationNode } from './NodeParamsInline';
import { Icon } from './icons';

type AnyRecord = Record<string, any>;

interface CanvasGraphViewProps {
  canvas: AnyRecord;
  projectPath: string;
  config?: AnyRecord | null;
  assets?: AnyRecord[];
  canvases?: AnyRecord[];
  onConnect: (source: string, sourcePort: string, target: string, targetPort: string) => Promise<void>;
  onRemoveNode: (nodeId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onUpdateNodeParams: (nodeId: string, params: AnyRecord) => Promise<void> | void;
  onAddNode: (type: string) => Promise<string>;
}

function CanvasNodeComponent({ id, data, selected }: NodeProps<AnyRecord>) {
  const [expanded, setExpanded] = useState(false);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, data, expanded, updateNodeInternals]);

  const cachedResult = data.cachedResult ?? (['image-input', 'video-input'].includes(data.type) ? data.params?.asset : undefined);
  const resultPreview =
    cachedResult && cachedResult.type === 'image' && cachedResult.path
      ? cachedResult.path
      : null;
  const videoPreview = cachedResult?.type === 'video' ? cachedResult.path : null;
  const mediaUrl = (path: string) => /^(https?:|file:)/i.test(path) ? path : 'file:///' + path.replace(/\\/g, '/').replace(/^\/+/, '');

  const isTextToImage = data.type === 'text-to-image';
  const isGeneration = isGenerationNode(data.type);
  const status = data.status ?? 'idle';
  const prompt = data.params?.prompt || data.params?.text || (data.type === 'white-model-video' ? `${data.params?.objects?.length ?? 3} 个物体 · ${(data.params?.durationMs ?? 5000) / 1000} 秒` : '');
  const model = isGeneration && data.type !== 'white-model-video'
    ? (typeof data.params?.model === 'string' && data.params.model.trim()
      ? data.params.model.trim() : data.config?.provider?.volcengine?.[data.type.endsWith('-to-video') ? 'videoModel' : 'imageModel']) || '' : '';

  const isGenerating = status === 'running' || status === 'pending';
  const isSucceeded = status === 'succeeded';
  const isFailed = status === 'failed';

  function handleNodeClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.react-flow__handle')) return;
    if ((e.target as HTMLElement).closest('.node-expanded-panel')) return;
    setExpanded((prev) => !prev);
  }

  return (
    <div
      className={`canvas-node-shell ${data.type === 'white-model-video' ? 'white-model-node' : ''} ${expanded ? 'is-expanded' : ''} ${selected ? 'is-selected' : ''} ${isGenerating ? 'is-generating' : ''}`}
      onClick={handleNodeClick}
    >
      {/* Media Card */}
      <div className="media-card">
        {/* Succeeded - show image */}
        {!isGenerating && !isFailed && resultPreview ? (
          <>
            <img
              src={mediaUrl(resultPreview)}
              alt="generated"
              className="media-image"
            />
            {data.imageCount && data.imageCount > 1 ? (
              <div className="count-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
                {data.imageCount} 张
              </div>
            ) : null}
          </>
        ) : null}
        {!isGenerating && !isFailed && videoPreview ? (
          <video className="media-video nodrag nopan" src={mediaUrl(videoPreview)} controls preload="metadata" playsInline onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} />
        ) : null}

        {/* Generating / Pending */}
        {isGenerating ? (
          <div className={`generating-wash ${status === 'pending' ? 'queued' : ''}`}>
            <div className="gen-content">
              {status === 'pending' ? (
                <>
                  <svg className="gen-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <div className="gen-label">等待生成...</div>
                </>
              ) : (
                <>
                  <div className="gen-spinner"></div>
                  <div className="gen-label">正在生成{data.type.includes('video') ? '视频' : '内容'}...</div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {/* Failed */}
        {isFailed ? (
          <div className="error-card">
            <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <div className="error-title">生成失败</div>
            <div className="error-desc">{data.errorMessage || '点击查看详情'}</div>
          </div>
        ) : null}

        {/* Idle / placeholder - no image yet */}
        {!isGenerating && !isFailed && !resultPreview && !videoPreview && data.type === 'text-input' ? (
          <div className="node-text-preview">{data.params?.text || '点击输入文本'}</div>
        ) : null}
        {!isGenerating && !isFailed && !resultPreview && !videoPreview && data.type !== 'text-input' ? (
          <div className="generating-wash placeholder">
            <div className="gen-content">
              <svg className="gen-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <div className="gen-label">
                {isSucceeded ? '已完成，暂无可预览媒体' : status === 'cancelled' ? '已取消' : isGeneration ? '点击设置生成参数' : data.type === 'output' ? '等待输出' : data.type === 'canvas-reference' ? '点击选择引用画布' : '点击选择素材'}
                <br />
                {isTextToImage && status === 'idle' ? '开始生成图片' : ''}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Node Footer */}
      <div className="node-footer">
        <svg className="footer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
          <path d="M2 17l10 5 10-5"></path>
          <path d="M2 12l10 5 10-5"></path>
        </svg>
        <span className="footer-prompt" title={prompt}>
          {nodeLabels[data.type] ?? data.label} {prompt ? `· ${prompt}` : ''}
        </span>
        {model ? (
          <span className="footer-model" title={model}>{model}</span>
        ) : null}
      </div>

      {expanded ? (
        <div className="node-expanded-panel nodrag nopan nowheel" onClick={(event) => event.stopPropagation()}>
          <NodeParamsInline nodeId={id} type={data.type} params={data.params ?? {}}
            config={data.config} assets={data.assets} canvases={data.canvases}
            result={cachedResult} onSave={data.onUpdateParams} />
        </div>
      ) : null}

      {/* Input handles */}
      {data.inputs?.map((port: AnyRecord, index: number) => (
        <Handle
          key={`in-${port.id}`}
          type="target"
          position={Position.Left}
          id={port.id}
          className={`canvas-handle canvas-handle-${port.type}`}
          style={computeHandleStyle(index, data.inputs?.length ?? 1)}
        />
      ))}
      {/* Output handles */}
      {data.outputs?.map((port: AnyRecord, index: number) => (
        <Handle
          key={`out-${port.id}`}
          type="source"
          position={Position.Right}
          id={port.id}
          className={`canvas-handle canvas-handle-${port.type}`}
          style={computeHandleStyle(index, data.outputs?.length ?? 1)}
        />
      ))}
    </div>
  );
}

function computeHandleStyle(index: number, total: number): React.CSSProperties {
  // Align handles with the media card area
  const cardHeight = 140; // approximate media card height
  if (total <= 1) return { top: `${cardHeight / 2}px` };
  const step = cardHeight / (total + 1);
  return { top: `${step * (index + 1)}px` };
}

function CanvasGroupComponent({ data, selected }: NodeProps<AnyRecord>) {
  return <div className={`canvas-group-frame ${selected ? 'is-selected' : ''}`}>
    <div className="canvas-group-drag">
      <span aria-hidden="true">⠿</span>
      <input className="nodrag" aria-label="分组名称" value={data.label} maxLength={80}
        onChange={event => data.onRename(event.target.value)} />
      <span className="canvas-group-count">{data.count} 个节点</span>
      <button className="nodrag" onClick={data.onUngroup} title="解组">解组</button>
    </div>
  </div>;
}
const nodeTypes = { canvasNode: CanvasNodeComponent, canvasGroup: CanvasGroupComponent };

function SnapGuides({ preview }: { preview: SnapPreview | null }) {
  const { x, y, zoom } = useViewport();
  if (!preview) return null;
  return <svg className="canvas-snap-guides" aria-hidden="true">
    <g transform={`translate(${x}, ${y}) scale(${zoom})`}>
      <rect className="canvas-snap-landing" x={preview.bounds.x} y={preview.bounds.y}
        width={preview.bounds.width} height={preview.bounds.height} rx={10} vectorEffect="non-scaling-stroke" />
      {preview.lines.map((line, index) => <line key={index} x1={line.from.x} y1={line.from.y}
        x2={line.to.x} y2={line.to.y} vectorEffect="non-scaling-stroke" />)}
    </g>
  </svg>;
}

function layoutNodes(
  canvas: AnyRecord,
  config: AnyRecord | null | undefined,
  onUpdateNodeParams: (nodeId: string, params: AnyRecord) => Promise<void> | void,
  assets: AnyRecord[],
  canvases: AnyRecord[]
) {
  return (canvas.nodes ?? []).map((node: AnyRecord, index: number) => ({
    id: node.id,
    type: 'canvasNode',
    position: {
      x: (index % 3) * 340,
      y: Math.floor(index / 3) * 460
    },
    data: {
      label: String(node.type)
        .split('-')
        .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      type: node.type,
      status: node.status,
      cachedResult: node.cachedResult,
      params: node.params,
      inputs: node.inputs,
      outputs: node.outputs,
      config,
      assets,
      canvases: canvases.filter(item => item.id !== canvas.id),
      onUpdateParams: onUpdateNodeParams,
      errorMessage: node.errorMessage,
      imageCount: node.imageCount
    }
  }));
}

function layoutEdges(canvas: AnyRecord) {
  return (canvas.edges ?? []).map((edge: AnyRecord) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourcePort,
    target: edge.target,
    targetHandle: edge.targetPort,
    animated: true
  }));
}

export function CanvasGraphView({
  canvas,
  projectPath,
  config,
  assets,
  canvases,
  onConnect,
  onRemoveNode,
  onRemoveEdge,
  onUpdateNodeParams,
  onAddNode
}: CanvasGraphViewProps) {
  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const storageKey = `canvas-cut:layout:${JSON.stringify([projectPath.replace(/\\/g, '/').toLowerCase(), canvas.id])}`;
  const saved = useMemo(() => {
    try { return parseCanvasLayout(localStorage.getItem(storageKey)); } catch { return parseCanvasLayout(null); }
  }, [storageKey]);
  const [groups, setGroups] = useState<CanvasGroup[]>(saved.groups);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapPreview, setSnapPreview] = useState<SnapPreview | null>(null);
  const snapTarget = snapPreview?.targetId ?? null;
  const [layoutReady, setLayoutReady] = useState(false);
  const latestLayout = useRef({ ready: false, value: '' });
  latestLayout.current = { ready: layoutReady, value: JSON.stringify({ version: 1,
    positions: Object.fromEntries(nodes.map(node => [node.id, node.position])), groups }) };
  const displayedCanvas = useRef(canvas.id);
  const fitOnInit = useRef((canvas.nodes ?? []).length > 0);
  const flow = useRef<ReactFlowInstance | null>(null);
  const addedPositions = useRef(new Map<string, { x: number; y: number }>());
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; position: { x: number; y: number } } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const layout = useMemo(
    () => layoutNodes(canvas, config, onUpdateNodeParams, assets ?? [], canvases ?? []),
    [canvas, config, onUpdateNodeParams, assets, canvases]
  );
  const edgeLayout = useMemo(() => layoutEdges(canvas), [canvas]);

  useEffect(() => {
    const sameCanvas = displayedCanvas.current === canvas.id;
    displayedCanvas.current = canvas.id;
    if (!sameCanvas) { addedPositions.current.clear(); setMenu(null); }
    const positioned = layout.map((node: Node) => addedPositions.current.has(node.id)
      ? { ...node, position: addedPositions.current.get(node.id)!, selected: true }
      : saved.positions[node.id] ? { ...node, position: saved.positions[node.id]! } : node);
    setNodes(previous => sameCanvas ? reconcileCanvasNodes(previous, positioned) : positioned);
    setGroups(previous => cleanGroups(previous, new Set(layout.map((node: Node) => node.id))));
    setLayoutReady(true);
    setEdges(previous => edgeLayout.map((edge: Edge) => ({ ...edge, selected: sameCanvas ? previous.find(old => old.id === edge.id)?.selected : undefined })));
  }, [layout, edgeLayout, setNodes, setEdges]);

  useEffect(() => {
    if (!layoutReady) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify({ version: 1,
        positions: Object.fromEntries(nodes.map(node => [node.id, node.position])), groups })); } catch { /* Storage can be unavailable. */ }
    }, 150);
    return () => clearTimeout(timer);
  }, [nodes, groups, storageKey, layoutReady]);
  useEffect(() => {
    const save = () => {
      if (latestLayout.current.ready) try { localStorage.setItem(storageKey, latestLayout.current.value); } catch { /* Optional local layout storage. */ }
    };
    window.addEventListener('beforeunload', save);
    return () => { save(); window.removeEventListener('beforeunload', save); };
  }, [storageKey]);

  const selectedIds = nodes.filter(node => node.selected).map(node => node.id);
  const ungroupIds = groups.filter(group => selectedGroups.includes(group.id) || group.members.some(id => selectedIds.includes(id))).map(group => group.id);
  const selectionCount = new Set([...selectedIds, ...groups.filter(group => selectedGroups.includes(group.id)).flatMap(group => group.members)]).size;
  function groupSelection() {
    if (selectedIds.length < 2) return;
    const group: CanvasGroup = { id: `ui-group:${crypto.randomUUID()}`, label: `分组 ${groups.length + 1}`, members: selectedIds };
    setGroups(previous => [...cleanGroups(previous.map(g => ({ ...g, members: g.members.filter(id => !selectedIds.includes(id)) })),
      new Set(nodes.map(node => node.id))), group]);
    setNodes(previous => previous.map(node => ({ ...node, selected: false })));
    setSelectedGroups([group.id]); setMenu(null);
  }
  function ungroupSelection() {
    setGroups(previous => previous.filter(group => !ungroupIds.includes(group.id)));
    setSelectedGroups([]); setMenu(null);
  }
  const displayNodes = useMemo(() => {
    const groupNodes: Node[] = groups.flatMap(group => {
      const bounds = groupBounds(group, nodes);
      return bounds ? [{ id: group.id, type: 'canvasGroup', position: { x: bounds.x, y: bounds.y },
        style: { width: bounds.width, height: bounds.height, pointerEvents: 'none' }, width: bounds.width, height: bounds.height,
        dragHandle: '.canvas-group-drag', selected: selectedGroups.includes(group.id), connectable: false, zIndex: 0,
        data: { label: group.label, count: group.members.length,
          onRename: (label: string) => setGroups(previous => previous.map(g => g.id === group.id ? { ...g, label } : g)),
          onUngroup: () => { setGroups(previous => previous.filter(g => g.id !== group.id)); setSelectedGroups(previous => previous.filter(id => id !== group.id)); }
        } }] : [];
    });
    return [...groupNodes, ...nodes.map(node => ({ ...node, zIndex: 1,
      className: node.id === snapTarget ? 'canvas-snap-target' : undefined }))];
  }, [nodes, groups, selectedGroups, snapTarget]);

  function handleNodesChange(changes: NodeChange[]) {
    const groupIds = new Set(groups.map(group => group.id));
    const groupChanges = changes.filter(change => 'id' in change && groupIds.has(change.id));
    const regular = changes.filter(change => !('id' in change) || !groupIds.has(change.id));
    if (groupChanges.some(change => change.type === 'select' || change.type === 'remove')) setSelectedGroups(previous => {
      const next = new Set(previous);
      for (const change of groupChanges) {
        if (change.type === 'select') change.selected ? next.add(change.id) : next.delete(change.id);
        if (change.type === 'remove') next.delete(change.id);
      }
      return [...next];
    });
    setNodes(previous => {
      let next = applyNodeChanges(regular, previous);
      for (const change of groupChanges) {
        if (change.type !== 'position' || !change.position) continue;
        const group = groups.find(g => g.id === change.id)!;
        const bounds = groupBounds(group, previous);
        if (!bounds) continue;
        const dx = change.position.x - bounds.x, dy = change.position.y - bounds.y;
        // React Flow can move selected members in the same batch: apply the delta once.
        next = next.map(node => group.members.includes(node.id)
          ? { ...node, position: { x: previous.find(n => n.id === node.id)!.position.x + dx,
            y: previous.find(n => n.id === node.id)!.position.y + dy } } : node);
      }
      return next;
    });
  }

  function handleDrag(_event: React.MouseEvent, node: Node, finish = false) {
    if (!snapEnabled || node.type === 'canvasGroup' || nodes.filter(n => n.selected).length > 1) { setSnapPreview(null); return; }
    const snap = findSameTypeSnap(node, nodes, groups, flow.current?.getZoom() ?? 1);
    const target = snap && nodes.find(n => n.id === snap.targetId);
    setSnapPreview(!finish && snap && target ? buildSnapPreview(node, target, snap.position) : null);
    if (finish && snap) setNodes(previous => previous.map(n => n.id === node.id ? { ...n, position: snap.position } : n));
  }

  function handleLayoutKey(event: React.KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'g') return;
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault(); event.shiftKey ? ungroupSelection() : groupSelection();
  }

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const element = menuRef.current;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [menu, addError]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenu(null); }
    };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  function openAddMenu(event: React.MouseEvent) {
    event.preventDefault();
    if (adding || !flow.current) return;
    setAddError('');
    setMenu({ x: event.clientX, y: event.clientY,
      position: flow.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
  }

  async function addAtMenu(type: string) {
    if (!menu || adding) return;
    const position = menu.position;
    const canvasId = canvas.id;
    setAdding(true); setAddError('');
    try {
      const nodeId = await onAddNode(type);
      if (displayedCanvas.current !== canvasId) return;
      // The graph may arrive via a change notification before creation returns.
      addedPositions.current.set(nodeId, position);
      setNodes(previous => previous.map(node => ({ ...node,
        ...(node.id === nodeId ? { position, selected: true } : { selected: false }) })));
      setMenu(null);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error));
    } finally { setAdding(false); }
  }

  function navigateMenu(event: React.KeyboardEvent) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function isValidConnection(connection: Connection): boolean {
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
      return false;
    }
    if (connection.source === connection.target) return false;

    const sourceNode = canvas.nodes?.find((n: AnyRecord) => n.id === connection.source);
    const targetNode = canvas.nodes?.find((n: AnyRecord) => n.id === connection.target);
    if (!sourceNode || !targetNode) return false;

    const sourcePort = sourceNode.outputs?.find((p: AnyRecord) => p.id === connection.sourceHandle);
    const targetPort = targetNode.inputs?.find((p: AnyRecord) => p.id === connection.targetHandle);
    if (!sourcePort || !targetPort) return false;

    return sourcePort.type === targetPort.type;
  }

  async function handleConnect(connection: Connection) {
    if (!isValidConnection(connection)) {
      return;
    }
    const tempId = `temp-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`;
    setEdges((currentEdges) =>
      addEdge(
        {
          ...connection,
          id: tempId,
          animated: true
        },
        currentEdges
      )
    );
    try {
      await onConnect(connection.source!, connection.sourceHandle!, connection.target!, connection.targetHandle!);
    } catch (error) {
      setEdges((currentEdges) => currentEdges.filter((e) => e.id !== tempId));
      window.alert('Failed to connect: ' + String(error));
    }
  }

  function handleNodesDelete(deleted: Node[]) {
    for (const node of deleted) {
      if (node.type === 'canvasGroup') {
        setGroups(previous => previous.filter(group => group.id !== node.id));
      } else onRemoveNode(node.id);
    }
  }

  function handleEdgesDelete(deleted: Edge[]) {
    const validEdgeIds = new Set((canvas.edges ?? []).map((e: AnyRecord) => e.id));
    for (const edge of deleted) {
      if (edge.id.startsWith('temp-')) continue;
      if (!validEdgeIds.has(edge.id)) continue;
      onRemoveEdge(edge.id);
    }
  }

  return (
    <div className="canvas-graph" tabIndex={0} onKeyDown={handleLayoutKey}>
      <div className="canvas-layout-tools nodrag nopan" role="toolbar" aria-label="画布布局">
        {selectedIds.length >= 2 || ungroupIds.length ? <div className="canvas-selection-actions">
          <span className="canvas-selection-count">已选 {selectionCount}</span>
          {selectedIds.length >= 2 ? <button onClick={groupSelection} title="打组 · Ctrl+G"><Icon name="grid" size={14} />打组</button> : null}
          {ungroupIds.length ? <button onClick={ungroupSelection} title="解组 · Ctrl+Shift+G"><Icon name="unlink" size={14} />解组</button> : null}
        </div> : null}
        <button className="canvas-snap-toggle" aria-label="同类吸附" aria-pressed={snapEnabled}
          title={`同类吸附${snapEnabled ? '已开启，点击关闭' : '已关闭，点击开启'}`}
          onClick={() => { setSnapEnabled(value => !value); setSnapPreview(null); }}>
          <Icon name="magnet" size={16} />
          {snapEnabled ? <span className="canvas-snap-dot" aria-hidden="true" /> : null}
        </button>
      </div>
      {snapTarget ? <div className="canvas-snap-hint" role="status">松开鼠标，对齐同类节点</div> : null}
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDrag={(event, node) => handleDrag(event, node)}
        onNodeDragStop={(event, node) => handleDrag(event, node, true)}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        isValidConnection={isValidConnection}
        onInit={instance => { flow.current = instance; }}
        onPaneContextMenu={openAddMenu}
        onNodeContextMenu={(event, node) => {
          openAddMenu(event);
          if (node.type === 'canvasGroup') setSelectedGroups([node.id]);
          else if (!node.selected) setNodes(previous => previous.map(n => ({ ...n, selected: n.id === node.id })));
        }}
        onPaneClick={() => setMenu(null)}
        onMoveStart={() => setMenu(null)}
        fitView={fitOnInit.current}
        selectionOnDrag
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        panOnDrag={[1]}
        proOptions={{ hideAttribution: true }}
      >
        <SnapGuides preview={snapPreview} />
        <MiniMap />
        <Controls />
        <Background gap={16} size={1} />
      </ReactFlow>
      {menu ? <div ref={menuRef} className="canvas-add-menu nodrag nopan nowheel" role="menu" aria-label="添加节点"
        style={{ left: menu.x, top: menu.y }} onKeyDown={navigateMenu} onContextMenu={event => event.preventDefault()}>
        <div className="canvas-add-menu-title">{adding ? '正在添加节点…' : '添加节点'}</div>
        <button type="button" role="menuitem" disabled={selectedIds.length < 2 || adding} onClick={groupSelection}>打组 · Ctrl+G</button>
        <button type="button" role="menuitem" disabled={!ungroupIds.length || adding} onClick={ungroupSelection}>解组 · Ctrl+Shift+G</button>
        <div className="canvas-add-menu-separator" />
        {Object.entries(nodeLabels).map(([type, label]) => <button key={type} type="button" role="menuitem"
          disabled={adding} onClick={() => void addAtMenu(type)}>{label}</button>)}
        {addError ? <div className="canvas-add-menu-error" role="alert">{addError}</div> : null}
      </div> : null}
    </div>
  );
}
