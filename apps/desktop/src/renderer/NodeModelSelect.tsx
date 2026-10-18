import { useEffect, useState } from 'react';
import { listGenerationModels } from '@canvas-cut/core/dist/provider/model-catalog';

const customOption = '__custom_model__';

export function NodeModelSelect({ nodeId, type, providerId, value, savedModel, defaultModel, onChange }: {
  nodeId: string; type: string; providerId: string; value: unknown; savedModel: unknown;
  defaultModel?: string; onChange: (value: string) => void;
}) {
  const [customMode, setCustomMode] = useState(false);
  useEffect(() => setCustomMode(false), [nodeId, savedModel]);
  const options = listGenerationModels(providerId, type);
  const modelId = typeof value === 'string' ? value.trim() : '';
  const custom = customMode || (!!modelId && !options.some(option => option.id === modelId));
  const defaultName = options.find(option => option.id === defaultModel)?.name;
  return <div className="node-model-picker">
    <label className="params-field"><span>生成模型</span>
      <select aria-label="节点模型" title={modelId || defaultModel} value={custom ? customOption : modelId}
        onChange={event => {
          const selected = event.target.value;
          setCustomMode(selected === customOption);
          if (selected !== customOption) onChange(selected);
        }}>
        <option value="">使用项目默认{defaultName ? `（${defaultName}）` : ''}</option>
        {options.length ? <optgroup label={providerId === 'volcengine' ? '火山方舟' : providerId}>
          {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </optgroup> : null}
        <option value={customOption}>自定义模型 ID / 接入点 ID…</option>
      </select>
    </label>
    {custom ? <label className="params-field"><span>自定义模型 ID / 接入点 ID</span>
      <input aria-label="自定义模型 ID" value={typeof value === 'string' ? value : ''}
        placeholder="输入模型 ID 或 ep- 接入点 ID" onChange={event => onChange(event.target.value)} />
    </label> : null}
    <small className="node-param-hint">{custom ? '留空继承项目默认。' : options.length ? '方舟模型目录 · 实际可用取决于账号开通情况。' : '可填写自定义模型 ID。'}</small>
  </div>;
}
