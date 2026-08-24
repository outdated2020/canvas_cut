import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/desktop/src/renderer/CanvasGraphView.tsx";
let c = readFileSync(path, "utf8");

const start = c.indexOf("function CanvasNodeComponent");
const end = c.indexOf("const nodeTypes", start);
if (start < 0 || end < 0) {
  console.error("Could not find CanvasNodeComponent");
  process.exit(1);
}

const newFn = `function CanvasNodeComponent({ data }: NodeProps<AnyRecord>) {
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
            src={'file:///' + resultPreview.replace(/\\\\/g, '/').replace(/^\\/+/, '')}
            alt="generated"
          />
        </div>
      ) : null}
      {data.inputs?.map((port: AnyRecord) => (
        <Handle
          key={\`in-\${port.id}\`}
          type="target"
          position={Position.Left}
          id={port.id}
          className={\`canvas-handle canvas-handle-\${port.type}\`}
        />
      ))}
      {data.outputs?.map((port: AnyRecord) => (
        <Handle
          key={\`out-\${port.id}\`}
          type="source"
          position={Position.Right}
          id={port.id}
          className={\`canvas-handle canvas-handle-\${port.type}\`}
        />
      ))}
    </div>
  );
}`;

c = c.slice(0, start) + newFn + c.slice(end);
writeFileSync(path, c);
console.log("CanvasNodeComponent patched");