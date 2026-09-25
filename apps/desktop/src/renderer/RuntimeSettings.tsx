import { useEffect, useState } from 'react';

export function RuntimeSettings({ projectPath }: { projectPath: string }) {
  const [text, setText] = useState(''), [info, setInfo] = useState<any>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const load = async () => {
    const value = await window.api.invoke('agent.runtime.get', { path: projectPath }) as any;
    setInfo(value); setText(JSON.stringify({ maxSteps: 64, contextLimitCharacters: 200000, mcpServers: [], ...value.config }, null, 2));
  };
  useEffect(() => { void load().catch(error => setMessage(String(error))); }, [projectPath]);
  const action = async (test: boolean) => {
    setBusy(true); setMessage('');
    try {
      const result = await window.api.invoke(test ? 'agent.runtime.test' : 'agent.runtime.set', { path: projectPath, config: JSON.parse(text) });
      setMessage(test ? JSON.stringify(result, null, 2) : '配置已保存，下次运行生效。');
      if (!test) await load();
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  return <details>
    <summary>Agent Runtime / MCP / Skills</summary>
    <p>PTY：{info ? info.ptyAvailable ? '可用' : '不可用，请为 Electron 构建 node-pty' : '检查中'}</p>
    <p>可配置 bashPath、powershellPath、执行预算和 mcpServers。MCP 类型为 stdio（command / args）或 http（url）。env / headers 加密保存，读取时不显示；省略保留，空对象清除。</p>
    <label>运行配置 JSON<textarea aria-label="Agent runtime configuration" rows={14} style={{ width: '100%', fontFamily: 'monospace' }} value={text} onChange={e => setText(e.target.value)} spellCheck={false} /></label>
    <div><button type="button" disabled={busy || !info} onClick={() => void action(false)}>保存 Runtime 配置</button> <button type="button" disabled={busy || !info} onClick={() => void action(true)}>测试 MCP 连接</button></div>
    {message && <pre style={{ whiteSpace: 'pre-wrap' }}>{message}</pre>}
    <p>已发现的 Skills</p>
    <ul>{info?.skills?.map((skill: any) => <li key={skill.name}><strong>{skill.name}</strong> — {skill.description}<br /><small>{skill.path}</small></li>)}</ul>
    {info?.diagnostics?.length > 0 && <pre>{JSON.stringify(info.diagnostics, null, 2)}</pre>}
  </details>;
}
