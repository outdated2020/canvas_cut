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

type AnyRecord = Record<string, any>;

interface CanvasGraphViewProps {
  canvas: AnyRecord;
  config?: AnyRecord | null;
  onConnect: (source: string, sourcePort: string, target: string, targetPort: string) => Promise<void>;
  onRemoveNode: (nodeId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onUpdateNodeParams: (nodeId: string, params: AnyRecord) => void;
}

function CanvasNodeComponent({ data }: NodeProps<AnyRecord>) {
  const statusColor: Record<string, string> = {
    idle: '#9ca3af',
    pending: '#f59e0b',
    running: '#3b82f6',
    succeeded: '#22c55e',
    failed: '#ef4444',
    cancelled: '#6b7280'
  };

  const promptPreview =
    data.params?.prompt || data.params?.text || '';

  const cachedResult = data.cachedResult;
  const resultPreview =
    cachedResult && cachedResult.type === 'image' && cachedResult.path
      ? cachedResult.path
      : null;

  return (
    <div className="canvas-node" style={{ borderColor: statusColor[data.status] ?? '#d1d5db' }}>
      <div className="canvas-node-title">{data.label}</div>
      <div className="canvas-node-subtitle">{data.type}</div>
      {promptPreview ? (
        <div className="canvas-node-prompt" title={promptPreview}>
          {promptPreview.length > 60 ? promptPreview.slice(0, 60) + '...' : promptPreview}
        </div>
      ) : null}
      {resultPreview ? (
        <div className="canvas-node-result">
          <img
            src={'file:///' + resultPreview.replace(/\\/g, '/').replace(/^\/+/, '')}
            alt="generated"
          />
        </div>
      ) : null}
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
  if (total <= 1) return { top: '50%' };
  const step = 100 / (total + 1);
  return { top: `${step * (index + 1)}%` };
}

const nodeTypes = {
  canvasNode: CanvasNodeComponent
};

function layoutNodes(canvas: AnyRecord) {
  return (canvas.nodes ?? []).map((node: AnyRecord, index: number) => ({
    id: node.id,
    type: 'canvasNode',
    position: {
      x: (index % 3) * 320,
      y: Math.floor(index / 3) * 220
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
      outputs: node.outputs
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

function NodeParamsForm({
  node,
  config,
  onSave,
  onCancel
}: {
  node: AnyRecord;
  config?: AnyRecord | null;
  onSave: (params: AnyRecord) => void;
  onCancel: () => void;
}) {
  const params = node.params ?? {};
  const [prompt, setPrompt] = useState(params.prompt ?? params.text ?? '');
  const [negativePrompt, setNegativePrompt] = useState(params.negativePrompt ?? '');
  const [model, setModel] = useState(
    params.model ?? config?.provider?.volcengine?.imageModel ?? ''
  );
  const [width, setWidth] = useState(String(params.width ?? 1920));
  const [height, setHeight] = useState(String(params.height ?? 1920));
  const [seed, setSeed] = useState(params.seed != null ? String(params.seed) : '');
  const [style, setStyle] = useState(params.style ?? '');

  const modelOptions = config?.provider?.volcengine?.imageModel
    ? [config.provider.volcengine.imageModel]
    : [];

  function handleSave() {
    const newParams: AnyRecord = {
      prompt,
      width: Number(width),
      height: Number(height)
    };
    if (negativePrompt) newParams.negativePrompt = negativePrompt;
    if (model) newParams.model = model;
    if (seed) newParams.seed = Number(seed);
    if (style) newParams.style = style;
    onSave(newParams);
  }

  return (
    <div className="canvas-params-form">
      <div className="canvas-params-title">Edit: {node.type}</div>

      <label className="params-field">
        <span>Prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want to generate..."
          rows={3}
        />
      </label>

      <label className="params-field">
        <span>Negative Prompt</span>
        <input
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder="Optional: what to avoid"
        />
      </label>

      <label className="params-field">
        <span>Model</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list="model-list"
          placeholder="Select or type model name"
        />
        <datalist id="model-list">
          {modelOptions.map((m: string) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <div className="params-row">
        <label className="params-field">
          <span>Width</span>
          <input
            type="number"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            min={64}
            max={4096}
          />
        </label>
        <label className="params-field">
          <span>Height</span>
          <input
            type="number"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            min={64}
            max={4096}
          />
        </label>
      </div>

      <label className="params-field">
        <span>Seed (optional)</span>
        <input
          type="number"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Random if empty"
        />
      </label>

      <label className="params-field">
        <span>Style (optional)</span>
        <input
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          placeholder="e.g. cinematic, anime, photorealistic"
        />
      </label>

      <div className="canvas-params-actions">
        <button onClick={handleSave}>Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function CanvasGraphView({
  canvas,
  config,
  onConnect,
  onRemoveNode,
  onRemoveEdge,
  onUpdateNodeParams
}: CanvasGraphViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [paramsText, setParamsText] = useState('');

  const layout = useMemo(() => layoutNodes(canvas), [canvas]);
  const edgeLayout = useMemo(() => layoutEdges(canvas), [canvas]);

  useEffect(() => {
    setNodes(layout);
    setEdges(edgeLayout);
  }, [layout, edgeLayout, setNodes, setEdges]);

  useEffect(() => {
    setSelectedNodeId(null);
  }, [canvas.id]);

  const selectedNode = canvas.nodes?.find((node: AnyRecord) => node.id === selectedNodeId);
  const isTextToImage = selectedNode?.type === 'text-to-image';

  useEffect(() => {
    if (selectedNode && !isTextToImage) {
      setParamsText(JSON.stringify(selectedNode.params ?? {}, null, 2));
    }
  }, [selectedNodeId, selectedNode, isTextToImage]);

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

  function saveSelectedNodeParams() {
    if (!selectedNodeId) return;
    try {
      const parsed = JSON.parse(paramsText) as AnyRecord;
      onUpdateNodeParams(selectedNodeId, parsed);
      setSelectedNodeId(null);
    } catch {
      window.alert('Params JSON is invalid');
    }
  }

  function handleFormSave(params: AnyRecord) {
    if (!selectedNodeId) return;
    onUpdateNodeParams(selectedNodeId, params);
    setSelectedNodeId(null);
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
        onNodeDoubleClick={(_event, node) => setSelectedNodeId(node.id)}
        isValidConnection={isValidConnection}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap />
        <Controls />
        <Background gap={16} size={1} />
      </ReactFlow>
      {selectedNode && isTextToImage && (
        <NodeParamsForm
          node={selectedNode}
          config={config}
          onSave={handleFormSave}
          onCancel={() => setSelectedNodeId(null)}
        />
      )}
      {selectedNode && !isTextToImage && (
        <div className="canvas-params-editor">
          <div className="canvas-params-title">
            Edit node: {selectedNode.id}
          </div>
          <textarea
            value={paramsText}
            onChange={(event) => setParamsText(event.target.value)}
            spellCheck={false}
          />
          <div className="canvas-params-actions">
            <button onClick={saveSelectedNodeParams}>Save</button>
            <button onClick={() => setSelectedNodeId(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}