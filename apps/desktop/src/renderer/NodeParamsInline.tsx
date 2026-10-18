import { useEffect, useState } from 'react';
import { WhiteModelParams } from './WhiteModelParams';
import { NodeModelSelect } from './NodeModelSelect';

type RecordValue = Record<string, any>;
export const nodeLabels: Record<string, string> = {
  'text-input': '文本输入', 'image-input': '图片输入', 'video-input': '视频输入',
  'canvas-reference': '画布引用', 'text-to-image': '文生图', 'image-to-image': '图生图',
  'text-to-video': '文生视频', 'image-to-video': '图生视频', 'video-to-video': '视频转视频', 'white-model-video': '白模视频', output: '输出'
};
export const isGenerationNode = (type: string) => ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'video-to-video', 'white-model-video'].includes(type);

export function NodeParamsInline(props: Parameters<typeof StandardNodeParamsInline>[0]) {
  return props.type === 'white-model-video' ? <WhiteModelParams nodeId={props.nodeId} params={props.params} onSave={props.onSave} /> : <StandardNodeParamsInline {...props} />;
}

function StandardNodeParamsInline({ nodeId, type, params, config, assets = [], canvases = [], result, onSave }: {
  nodeId: string; type: string; params: RecordValue; config?: RecordValue | null;
  assets?: RecordValue[]; canvases?: RecordValue[]; result?: RecordValue;
  onSave: (id: string, params: RecordValue) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<RecordValue>({ ...params });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const savedParams = JSON.stringify(params);
  useEffect(() => {
    setDraft(JSON.parse(savedParams));
    setMessage('');
    setError('');
  }, [nodeId, savedParams]);
  const generating = isGenerationNode(type);
  const video = type.endsWith('-to-video');
  const assetType = type === 'image-input' || type === 'image-to-image' || type === 'image-to-video' ? 'image' : 'video';
  const usesAsset = ['image-input', 'video-input', 'image-to-image', 'image-to-video', 'video-to-video'].includes(type);
  const defaultModel = config?.provider?.volcengine?.[video ? 'videoModel' : 'imageModel'];
  const model = typeof draft.model === 'string' && draft.model.trim() ? draft.model.trim() : defaultModel;
  function change(key: string, value: unknown) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setMessage('');
    setError('');
  }
  function numberField(key: string, label: string, min: number, step = 1, max?: number) {
    return <label className="params-field" key={key}><span>{label}</span>
      <input type="number" min={min} max={max} step={step} required={params[key] != null} value={draft[key] ?? ''}
        placeholder="默认" onChange={event => change(key, event.target.value === '' ? undefined : Number(event.target.value))} />
    </label>;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      await onSave(nodeId, draft);
      setMessage('已保存');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  }
  const ratio = draft.width && draft.height ? Number(draft.width) / Number(draft.height) : null;
  const ratios = [
    { label: '1:1', w: 1024, h: 1024 }, { label: '16:9', w: 1920, h: 1080 },
    { label: '9:16', w: 1080, h: 1920 }, { label: '3:2', w: 1536, h: 1024 }, { label: '2:3', w: 1024, h: 1536 }
  ];
  const mediaOptions = assets.filter(asset => asset.type === assetType);
  if (draft.asset?.id && !mediaOptions.some(asset => asset.id === draft.asset.id)) mediaOptions.push(draft.asset);
  return <form className="params-inline" onSubmit={save}>
    <div className="section-title">{nodeLabels[type] ?? type}参数</div>
    {generating || type === 'text-input' ? <label className="params-field">
      <span>{type === 'text-input' ? '文本内容' : '提示词'}</span>
      <textarea className="prompt-input" rows={3} value={draft[type === 'text-input' ? 'text' : 'prompt'] ?? ''}
        placeholder={type === 'text-input' ? '输入传给下游节点的文本…' : video ? '描述画面、动作和镜头变化…' : '描述你想要生成的图像…'}
        onChange={event => change(type === 'text-input' ? 'text' : 'prompt', event.target.value)} />
    </label> : null}
    {usesAsset ? <label className="params-field"><span>{assetType === 'image' ? '图片素材' : '视频素材'}</span>
      <select value={draft.asset?.id ?? ''} required={!generating}
        onChange={event => change('asset', mediaOptions.find(asset => asset.id === event.target.value) ?? null)}>
        <option value="">{generating ? '使用上游连接的素材' : '请选择素材'}</option>
        {mediaOptions.map(asset => <option key={asset.id} value={asset.id}>{asset.name ?? asset.path?.split(/[\\/]/).pop() ?? asset.id}</option>)}
      </select>
      <small className="node-param-hint">{generating ? '已连接的上游素材优先；也可选择项目素材。' : '可先在素材页导入文件，再从此处选择。'}</small>
    </label> : null}
    {type === 'canvas-reference' ? <label className="params-field"><span>引用画布</span>
      <select required value={draft.canvasId ?? ''} onChange={event => change('canvasId', event.target.value)}>
        <option value="">请选择画布</option>
        {draft.canvasId && !canvases.some(canvas => canvas.id === draft.canvasId) ? <option value={draft.canvasId}>{draft.canvasId}（不可用）</option> : null}
        {canvases.map(canvas => <option key={canvas.id} value={canvas.id}>{canvas.name ?? canvas.id}</option>)}
      </select>
    </label> : null}
    {generating ? <>
      <NodeModelSelect nodeId={nodeId} type={type} providerId={config?.provider?.default ?? 'volcengine'}
        value={draft.model} savedModel={params.model} defaultModel={defaultModel} onChange={value => change('model', value)} />
      <div className="params-toolbar"><span className="node-model-info" title={model}>
        {typeof draft.model === 'string' && draft.model.trim() ? '节点模型' : '项目默认'}：{model || '未配置，请在 Settings 中设置'}
      </span></div>
      <div className="params-section"><div className="param-label">画幅比例</div><div className="param-tabs">
        {ratios.map(item => <button type="button" key={item.label} aria-pressed={ratio !== null && Math.abs(ratio - item.w / item.h) < 0.01}
          className={`param-tab ${ratio !== null && Math.abs(ratio - item.w / item.h) < 0.01 ? 'active' : ''}`}
          onClick={() => { change('width', item.w); change('height', item.h); }}>{item.label}</button>)}
      </div></div>
      <div className="params-row">{numberField('width', '宽度', 64)}{numberField('height', '高度', 64)}</div>
      {video ? <div className="params-row">{numberField('durationMs', '时长（毫秒）', 1)}{numberField('fps', '帧率', 1)}</div> : null}
      {type === 'video-to-video' ? <label className="params-field"><span>处理模式</span><select value={draft.mode ?? 'edit'} onChange={event => change('mode', event.target.value)}><option value="edit">编辑</option><option value="extend">延长</option></select></label> : null}
      <details className="params-advanced"><summary>高级参数</summary><div className="advanced-content">
        {type !== 'video-to-video' ? <label className="params-field"><span>负面提示词</span><input value={draft.negativePrompt ?? ''} onChange={event => change('negativePrompt', event.target.value)} placeholder="需要避免的内容" /></label> : null}
        {numberField('seed', '随机种子', -1)}
        {type === 'text-to-image' ? <label className="params-field"><span>风格</span><input value={draft.style ?? ''} onChange={event => change('style', event.target.value)} /></label> : null}
        {type === 'image-to-image' ? numberField('strength', '变化强度', 0, 0.01, 1) : null}
        {video ? numberField('motionStrength', '运动强度', 0, 0.01, 1) : null}
      </div></details>
    </> : null}
    {type === 'output' ? <div className="node-output-info"><p>连接上游图片或视频，渲染后在此预览结果。</p>
      {result?.path ? <><span>输出文件</span><p className="node-result-path">{result.path}</p>{result.width && result.height ? <p>{result.width} × {result.height}</p> : null}{result.durationMs ? <p>{result.durationMs / 1000} 秒</p> : null}</> : <p>暂无输出结果</p>}
    </div> : <div className="params-actions"><button type="submit" className="btn-generate" disabled={saving}>{saving ? '保存中…' : '保存参数'}</button></div>}
    {message ? <div className="node-param-hint" role="status">{message}</div> : null}
    {error ? <div className="node-param-error" role="alert">{error}</div> : null}
  </form>;
}
