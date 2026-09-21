import { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  Connection,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  useEdgesState,
  useNodesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import { NodeParamsInline, nodeLabels, isGenerationNode } from './NodeParamsInline';

type AnyRecord = Record<string, any>;

interface CanvasGraphViewProps {
  canvas: AnyRecord;
  config?: AnyRecord | null;
  assets?: AnyRecord[];
  canvases?: AnyRecord[];
  onConnect: (source: string, sourcePort: string, target: string, targetPort: string) => Promise<void>;
  onRemoveNode: (nodeId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onUpdateNodeParams: (nodeId: string, params: AnyRecord) => Promise<void> | void;
}

function CanvasNodeComponent({ id, data, selected }: NodeProps<AnyRecord>) {
  const [expanded, setExpanded] = useState(false);

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
  const prompt = data.params?.prompt || data.params?.text || '';
  const model = isGeneration ? data.config?.provider?.volcengine?.[data.type.endsWith('-to-video') ? 'videoModel' : 'imageModel'] || '' : '';

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
      className={`canvas-node-shell ${expanded ? 'is-expanded' : ''} ${selected ? 'is-selected' : ''} ${isGenerating ? 'is-generating' : ''}`}
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
          <span className="footer-model">{model.split('-').slice(0, 2).join('-')}</span>
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

const nodeTypes = {
  canvasNode: CanvasNodeComponent
};

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
  config,
  assets,
  canvases,
  onConnect,
  onRemoveNode,
  onRemoveEdge,
  onUpdateNodeParams
}: CanvasGraphViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const layout = useMemo(
    () => layoutNodes(canvas, config, onUpdateNodeParams, assets ?? [], canvases ?? []),
    [canvas, config, onUpdateNodeParams, assets, canvases]
  );
  const edgeLayout = useMemo(() => layoutEdges(canvas), [canvas]);

  useEffect(() => {
    setNodes(layout);
    setEdges(edgeLayout);
  }, [layout, edgeLayout, setNodes, setEdges]);

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
      onRemoveNode(node.id);
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
    <div className="canvas-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        isValidConnection={isValidConnection}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap />
        <Controls />
        <Background gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
