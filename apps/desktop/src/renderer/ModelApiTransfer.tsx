import { useState } from 'react';

export function ModelApiTransfer({ settings, onImport, disabled }: {
  settings: Record<string, string>;
  onImport: (settings: Record<string, string>) => void;
  disabled: boolean;
}) {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const action = async (mode: 'import' | 'export') => {
    setBusy(true); setMessage('');
    try {
      const result = await window.api.invoke(`settings.${mode}-model-api`, mode === 'export' ? { settings, includeSecrets } : {}) as {
        cancelled: boolean; settings?: Record<string, string>;
      };
      if (result.cancelled) return;
      if (mode === 'import' && result.settings) {
        onImport(result.settings);
        setMessage('配置已填入表单，点击“保存”后生效；文件中未包含的字段保留原值。');
      } else setMessage(includeSecrets ? '配置已导出，文件包含明文密钥，请妥善保管。' : '配置已导出，不包含密钥。');
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  return <fieldset className="model-api-transfer" disabled={disabled || busy}>
    <legend>模型 API 配置迁移</legend>
    <p className="settings-help">迁移当前表单中的图像、视频、Agent 和 TOS 配置。FFmpeg 路径、Runtime 和项目内容不包含在内。</p>
    <label><input type="checkbox" checked={includeSecrets} onChange={event => setIncludeSecrets(event.target.checked)} />包含 API 密钥（明文）</label>
    {includeSecrets && <p className="settings-help">导出文件将包含明文 API Key 和 TOS 凭证，仅传给可信设备；导入并保存后使用新电脑的系统加密。</p>}
    <div className="model-api-transfer-actions">
      <button type="button" onClick={() => void action('import')}>导入配置</button>
      <button type="button" onClick={() => void action('export')}>导出配置</button>
    </div>
    {message && <p role="status">{message}</p>}
  </fieldset>;
}
