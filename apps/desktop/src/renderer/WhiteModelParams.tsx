import { useEffect, useMemo, useRef, useState } from 'react';
import { buildWhiteModelRequest, defaultWhiteModelParams, type Vector3Tuple, type WhiteModelObject, type WhiteModelRequest } from '@canvas-cut/core/dist/canvas/white-model';
import { WhiteModelScene } from './white-model-scene';

function initialDraft(params: Record<string, unknown>): Record<string, unknown> {
  // MCP may supply only shape or a partial camera; expand the same defaults as export.
  try { return { ...buildWhiteModelRequest(params) }; }
  catch { const defaults = defaultWhiteModelParams(); return { ...defaults, ...params, camera: { ...defaults.camera, ...params.camera as object } }; }
}

function WhiteModelPreview({ request }: { request: WhiteModelRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<WhiteModelScene>();
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const time = useRef(0);
  useEffect(() => {
    setError('');
    try {
      scene.current = new WhiteModelScene(canvas.current!, { ...request, width: 480, height: Math.max(2, Math.round(480 * request.height / request.width)) });
      scene.current.render(time.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    return () => { scene.current?.dispose(); scene.current = undefined; };
  }, [request]);
  useEffect(() => { time.current = progress; scene.current?.render(progress); }, [progress, request]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = (now - previous) / request.durationMs;
      previous = now;
      const next = time.current + delta;
      time.current = next > 1 ? 0 : next;
      setProgress(time.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, request.durationMs]);
  return <div className="white-model-preview nodrag nopan nowheel">
    <canvas ref={canvas} aria-label="白模镜头预览" style={{ aspectRatio: `${request.width}/${request.height}` }} />
    {error ? <div className="node-param-error" role="alert">{error}</div> : <div className="white-model-preview-controls">
      <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? '暂停' : '播放'}</button>
      <input aria-label="预览时间" type="range" min="0" max="1" step="0.001" value={progress} onChange={event => { setPlaying(false); setProgress(Number(event.target.value)); }} />
      <span>{(progress * request.durationMs / 1000).toFixed(1)}s</span>
    </div>}
  </div>;
}

export function WhiteModelParams({ nodeId, params, onSave }: {
  nodeId: string; params: Record<string, unknown>;
  onSave: (id: string, params: Record<string, unknown>) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() => initialDraft(params));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const saved = JSON.stringify(params);
  useEffect(() => { setDraft(initialDraft(JSON.parse(saved))); setMessage(''); setSaveError(''); }, [nodeId, saved]);
  const validation = useMemo(() => {
    try { return { request: buildWhiteModelRequest(draft), error: '' }; }
    catch (error) { return { request: undefined, error: error instanceof Error ? error.message : String(error) }; }
  }, [draft]);
  const objects = draft.objects as WhiteModelObject[];
  const camera = draft.camera as WhiteModelRequest['camera'];
  function change(key: string, value: unknown) { setDraft(previous => ({ ...previous, [key]: value })); setMessage(''); setSaveError(''); }
  function objectChange(index: number, key: string, value: unknown) {
    change('objects', objects.map((object, i) => i === index ? { ...object, [key]: value } : object));
  }
  function vector(label: string, value: Vector3Tuple | number[], onChange: (value: Vector3Tuple) => void, min = -1000, max = 1000) {
    return <div className="white-model-vector"><span>{label}</span><div>
      {['X', 'Y', 'Z'].map((axis, i) => <label key={axis}><span>{axis}</span><input type="number" aria-label={`${label} ${axis}`} min={min} max={max} step="any" required value={Number.isNaN(value[i]) ? '' : value[i] ?? ''}
        onChange={event => { const updated = [...value] as Vector3Tuple; updated[i] = event.target.value === '' ? NaN : Number(event.target.value); onChange(updated); }} /></label>)}
    </div></div>;
  }
  function numeric(key: string, label: string, min: number, max: number, step = 1) {
    return <label className="params-field"><span>{label}</span><input type="number" required min={min} max={max} step={step} value={Number.isNaN(draft[key]) ? '' : draft[key] as number}
      onChange={event => change(key, event.target.value === '' ? NaN : Number(event.target.value))} /></label>;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!validation.request) return;
    setSaving(true); setSaveError('');
    try {
      const { frameCount: _frameCount, ...values } = validation.request;
      await onSave(nodeId, values);
      setMessage('已保存，可点击画布 Render 输出视频。');
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  return <form className="params-inline white-model-params nodrag nopan nowheel" onSubmit={save}>
    <div className="section-title">白模视频渲染</div>
    {validation.request ? <WhiteModelPreview request={validation.request} /> : null}
    <small className="node-param-hint">调整物体和镜头后保存参数，再生成视频。镜头与物体在起止关键帧之间匀速移动。</small>
    <div className="params-row">{numeric('width', '宽度', 64, 1920, 2)}{numeric('height', '高度', 64, 1920, 2)}</div>
    <div className="params-row">{numeric('durationMs', '时长（毫秒）', 100, 30000)}{numeric('fps', '帧率', 1, 60)}</div>
    <details open><summary>相机运镜</summary>
      {vector('起点', camera.start, start => change('camera', { ...camera, start }))}
      {vector('终点', camera.end, end => change('camera', { ...camera, end }))}
      {vector('注视点', camera.target, target => change('camera', { ...camera, target }))}
      <label className="params-field"><span>视角（度）</span><input type="number" min="10" max="100" step="any" required value={Number.isNaN(camera.fov) ? '' : camera.fov} onChange={event => change('camera', { ...camera, fov: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
    </details>
    <details open><summary>场景物体（{objects.length}）</summary>
      {objects.map((object, index) => <details className="white-model-object" key={index}>
        <summary>物体 {index + 1} · {({ box: '方块', sphere: '球体', cylinder: '圆柱' })[object.shape]}</summary>
        <label className="params-field"><span>形状</span><select value={object.shape} onChange={event => objectChange(index, 'shape', event.target.value)}><option value="box">方块</option><option value="sphere">球体</option><option value="cylinder">圆柱</option></select></label>
        {vector('位置', object.position ?? [0, 1, 0], value => objectChange(index, 'position', value))}
        {vector('尺寸', object.size ?? [1, 1, 1], value => objectChange(index, 'size', value), 0.01)}
        {vector('旋转（度）', object.rotation ?? [0, 0, 0], value => objectChange(index, 'rotation', value), -3600, 3600)}
        <label className="white-model-checkbox"><input type="checkbox" checked={!!object.endPosition} onChange={event => {
          const updated = { ...object };
          if (event.target.checked) { updated.endPosition = [...object.position ?? [0, 1, 0]] as Vector3Tuple; updated.endRotation = [...object.rotation ?? [0, 0, 0]] as Vector3Tuple; }
          else { delete updated.endPosition; delete updated.endRotation; }
          change('objects', objects.map((item, i) => i === index ? updated : item));
        }} />启用物体动画</label>
        {object.endPosition ? <>
          {vector('终点位置', object.endPosition, value => objectChange(index, 'endPosition', value))}
          {vector('终点旋转（度）', object.endRotation ?? object.rotation ?? [0, 0, 0], value => objectChange(index, 'endRotation', value), -3600, 3600)}
        </> : null}
        <button type="button" disabled={objects.length <= 1} onClick={() => change('objects', objects.filter((_item, i) => i !== index))}>删除物体</button>
      </details>)}
      <button type="button" disabled={objects.length >= 100} onClick={() => change('objects', [...objects, { shape: 'box', position: [0, 1, 0], size: [1, 2, 1], rotation: [0, 0, 0] }])}>添加物体</button>
    </details>
    <div className="params-row"><label className="params-field"><span>背景颜色</span><input type="color" value={draft.background as string} onChange={event => change('background', event.target.value)} /></label>{numeric('lightIntensity', '灯光强度', 0, 10, 0.1)}</div>
    <label className="white-model-checkbox"><input type="checkbox" checked={draft.ground as boolean} onChange={event => change('ground', event.target.checked)} />地面与阴影</label>
    {validation.error || saveError ? <div className="node-param-error" role="alert">{saveError || validation.error}</div> : null}
    <div className="params-actions"><button type="submit" className="btn-generate" disabled={saving || !validation.request}>{saving ? '保存中…' : '保存参数'}</button></div>
    {message ? <div className="node-param-hint" role="status">{message}</div> : null}
  </form>;
}
